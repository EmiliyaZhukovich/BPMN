<template>
  <div class="home-container">
    <div class="constructor-container">
      <ConstructorPanel
        @bpmn-xml-updated="handleBpmnXml"
        @export-png="exportPng"
        @export-svg="exportSvg"
      />
    </div>
    <div
      id="canvas"
      class="canvas-container"
      @dragover.prevent
      @drop="handleDrop"
    ></div>
    <v-snackbar v-model="snackbar.show" :color="snackbar.color" :timeout="3000">
      {{ snackbar.text }}
    </v-snackbar>
  </div>
</template>

<script>
import BpmnModeler from 'bpmn-js/lib/Modeler';
import ConstructorPanel from '../components/ConstructorPanel.vue';
import { bpmnLayoutServerUrl } from '../config';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';

export default {
  name: 'HomeView',
  components: {
    ConstructorPanel,
  },
  data() {
    return {
      bpmnXml: '',
      bpmnViewer: null,
      snackbar: {
        show: false,
        text: '',
        color: 'success',
      },
    };
  },
  mounted() {
    this.bpmnViewer = new BpmnModeler({
      container: '#canvas',
    });

    // this.bpmnViewer
    //   .importXML(initialDiagram)
    //   .then((result) => {
    //     const { warnings } = result;
    //     console.log("BPMN diagram imported successfully", warnings);
    //     this.bpmnViewer.get("canvas").zoom("fit-viewport");
    //   })
    //   .catch((err) => {
    //     console.error("Failed to import BPMN diagram:", err);
    //   });
  },
  beforeUnmount() {
    if (this.bpmnViewer) {
      this.bpmnViewer.destroy();
    }
  },
  methods: {
    showSnackbar(text, color = 'success') {
      this.snackbar.text = text;
      this.snackbar.color = color;
      this.snackbar.show = true;
    },
    async handleDrop(event) {
      event.preventDefault(); // Prevent the browser from default file handling
      if (event.dataTransfer.items) {
        for (let i = 0; i < event.dataTransfer.items.length; i++) {
          if (event.dataTransfer.items[i].kind === 'file') {
            const file = event.dataTransfer.items[i].getAsFile();

            if (file.name.endsWith('.bpmn')) {
              const reader = new FileReader();
              reader.onload = async (e) => {
                const xmlContent = e.target.result;
                try {
                  await this.bpmnViewer.importXML(xmlContent);
                  this.bpmnViewer.get('canvas').zoom('fit-viewport');
                  console.log('BPMN diagram loaded successfully');
                  this.bpmnXml = xmlContent;
                  await this.createBpmnJson();
                } catch (err) {
                  console.error('Failed to import BPMN diagram:', err);
                }
              };
              reader.readAsText(file);
            }
          }
        }
      }
    },
    async exportPng() {
      if (!this.bpmnViewer || !this.bpmnXml) {
        this.showSnackbar('Сначала постройте диаграмму', 'error');
        return;
      }
      try {
        const { svg } = await this.bpmnViewer.saveSVG();
        const img = new Image();
        const svgBlob = new Blob([svg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(svgBlob);

        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          canvas.toBlob((blob) => {
            const downloadUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = 'diagram.png';
            a.click();
            URL.revokeObjectURL(downloadUrl);
            URL.revokeObjectURL(url);
          });
        };

        img.src = url;
        this.showSnackbar('PNG exported successfully', 'success');
      } catch (error) {
        console.error('Error exporting PNG:', error);
        this.showSnackbar('Error exporting PNG', 'error');
      }
    },
    async exportSvg() {
      if (!this.bpmnViewer || !this.bpmnXml) {
        this.showSnackbar('Сначала постройте диаграмму', 'error');
        return;
      }
      try {
        const { svg } = await this.bpmnViewer.saveSVG();
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'diagram.svg';
        a.click();
        window.URL.revokeObjectURL(url);
        this.showSnackbar('SVG exported successfully', 'success');
      } catch (error) {
        console.error('Error exporting SVG:', error);
        this.showSnackbar('Error exporting SVG', 'error');
      }
    },
    async handleBpmnXml(bpmnXmlValue) {
      if (!bpmnXmlValue || bpmnXmlValue === '') {
        // Clear the diagram but keep viewer initialized
        if (this.bpmnViewer) {
          try {
            // Import empty diagram to clear
            await this.bpmnViewer.importXML('<?xml version="1.0" encoding="UTF-8"?><definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="definitions_1"><process id="Process_1" isExecutable="false"></process></definitions>');
          } catch (err) {
            console.error('Failed to clear diagram:', err);
          }
        }
        this.bpmnXml = '';
        return;
      }

      if (!this.bpmnViewer) {
        console.error('BPMN viewer is not initialized');
        return;
      }

      try {
        console.log('Processing BPMN XML:', bpmnXmlValue.substring(0, 200));

        // Try auto-layout first, but don't fail if it doesn't work
        let xmlToImport = bpmnXmlValue;
        const hasCollaboration = /<collaboration[\s>]/i.test(bpmnXmlValue) || /<participant[\s>]/i.test(bpmnXmlValue);
        try {
          // Always try auto-layout (including diagrams with Collaboration/pools).
          // If layout server fails or returns empty result, we fall back to original XML.
          const layoutedXml = await this.processDiagram(bpmnXmlValue);
          if (layoutedXml && layoutedXml.trim() !== '') {
            console.log('Layouted XML received:', layoutedXml.substring(0, 200));
            xmlToImport = layoutedXml;
          } else {
            console.warn('Layout server returned empty result, using original XML');
          }
        } catch (layoutError) {
          console.warn('Layout server error, using original XML:', layoutError);
          // Continue with original XML
        }

        this.bpmnXml = xmlToImport;

        // Import the diagram
        const { warnings } = await this.bpmnViewer.importXML(xmlToImport);
        console.log('BPMN diagram imported successfully', warnings);
        this.bpmnViewer.get('canvas').zoom('fit-viewport');
        this.showSnackbar('Диаграмма построена успешно', 'success');
      } catch (error) {
        console.error('Error handling BPMN XML:', error);
        this.showSnackbar(`Ошибка при построении диаграммы: ${error.message}`, 'error');

        // Try to import without layout as fallback
        try {
          await this.bpmnViewer.importXML(bpmnXmlValue);
          this.bpmnViewer.get('canvas').zoom('fit-viewport');
          this.showSnackbar('Диаграмма построена (без авто-разметки)', 'warning');
          this.bpmnXml = bpmnXmlValue;
        } catch (fallbackError) {
          console.error('Fallback import also failed:', fallbackError);
          this.showSnackbar(`Критическая ошибка: ${fallbackError.message}`, 'error');
        }
      }
    },
    async processDiagram(bpmnDiagram) {
      try {
        const response = await fetch(`${bpmnLayoutServerUrl}/process-bpmn`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ bpmnXml: bpmnDiagram }),
        });

        if (!response.ok) {
          throw new Error('Network response was not ok');
        }

        const { layoutedXml } = await response.json();

        console.log(layoutedXml);

        return layoutedXml;
      } catch (error) {
        console.error('Failed to process the diagram:', error);
      }
    },
  },
};
</script>

<style scoped>
.home-container {
  display: flex;
  flex-direction: row;
  height: 100vh;
  overflow: hidden;
}

.constructor-container {
  flex: 0 0 450px;
  min-width: 400px;
  max-width: 600px;
  height: 100vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.canvas-container {
  flex: 1;
  height: 100vh;
  border-left: 1px solid #e0e0e0;
  background: #fafafa;
}

#canvas {
  width: 100%;
  height: 100%;
}

@media (min-width: 1800px) {
  .constructor-container {
    flex: 0 0 500px;
  }
}
</style>
