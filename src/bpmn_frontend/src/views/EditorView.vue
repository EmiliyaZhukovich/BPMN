<template>
  <div class="editor-page">
    <header class="editor-toolbar">
      <v-btn
        variant="text"
        prepend-icon="mdi-arrow-left"
        @click="goHome"
      >
        На главную
      </v-btn>
      <span v-if="savedMetaLine" class="toolbar-meta">{{ savedMetaLine }}</span>
    </header>
    <div class="home-container">
      <div
        class="constructor-container"
        :style="{ width: `${constructorWidth}px` }"
      >
        <ConstructorPanel
          :key="panelKey"
          :initial-save-state="initialSaveState"
          @bpmn-xml-updated="handleBpmnXml"
          @export-png="exportPng"
          @export-svg="exportSvg"
          @save-diagram="handleSaveDiagram"
        />
      </div>
      <div
        class="split-gutter"
        role="separator"
        aria-orientation="vertical"
        aria-label="Изменить ширину панели конструктора"
        title="Потяните, чтобы изменить ширину панели"
        tabindex="0"
        @mousedown.prevent="onResizeStart"
      />
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
  </div>
</template>

<script>
import BpmnModeler from 'bpmn-js/lib/Modeler';
import ConstructorPanel from '../components/ConstructorPanel.vue';
import { bpmnLayoutServerUrl } from '../config';
import { getSavedDiagram, upsertSavedDiagram } from '../utils/diagramStorage';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';

export default {
  name: 'EditorView',
  components: {
    ConstructorPanel,
  },
  data() {
    const savedW = typeof localStorage !== 'undefined'
      ? localStorage.getItem('bpmn-assistant-constructor-width')
      : null;
    let initialW = 450;
    if (savedW != null) {
      const n = parseInt(savedW, 10);
      if (!Number.isNaN(n)) initialW = n;
    }
    return {
      bpmnXml: '',
      bpmnViewer: null,
      constructorWidth: initialW,
      _resizeCleanup: null,
      _bpmnImportSeq: 0,
      panelKey: 0,
      /** Сбрасывает подпись в шапке после первого сохранения новой диаграммы */
      metaTick: 0,
      snackbar: {
        show: false,
        text: '',
        color: 'success',
      },
    };
  },
  computed: {
    diagramRouteId() {
      return this.$route.params.id || null;
    },
    initialSaveState() {
      const id = this.diagramRouteId;
      if (!id) return null;
      const s = getSavedDiagram(id);
      if (!s?.diagram) return null;
      return {
        _rev: s.id,
        diagram: s.diagram,
        diagramBuilt: !!s.diagramBuilt,
        bpmnXml: s.bpmnXml || '',
      };
    },
    savedMetaLine() {
      this.metaTick;
      const id = this.diagramRouteId;
      if (!id) return '';
      const s = getSavedDiagram(id);
      if (!s?.name) return '';
      return s.name;
    },
  },
  watch: {
    '$route.params.id'(next, prev) {
      if (prev != null && next != null && next !== prev) {
        this.panelKey += 1;
      }
    },
  },
  mounted() {
    this.clampConstructorWidth();
    this.handleWindowResize = () => {
      this.clampConstructorWidth();
    };
    window.addEventListener('resize', this.handleWindowResize);
    this.bpmnViewer = new BpmnModeler({
      container: '#canvas',
    });

    this.$nextTick(() => {
      this.hideBpmnLogo();
    });
  },
  beforeUnmount() {
    if (this.handleWindowResize) {
      window.removeEventListener('resize', this.handleWindowResize);
    }
    if (this.bpmnViewer) {
      this.bpmnViewer.destroy();
    }
    this.stopResizeListeners();
  },
  methods: {
    goHome() {
      this.$router.push({ name: 'home' });
    },
    handleSaveDiagram(payload) {
      const id = this.diagramRouteId;
      if (!id) {
        this.showSnackbar('Не удалось определить диаграмму', 'error');
        return;
      }
      try {
        upsertSavedDiagram({
          id,
          name: payload.title,
          diagram: payload.diagram,
          bpmnXml: this.bpmnXml || '',
          diagramBuilt: payload.diagramBuilt,
        });
        this.metaTick += 1;
        this.showSnackbar('Диаграмма сохранена', 'success');
      } catch {
        this.showSnackbar('Не удалось сохранить (лимит хранилища?)', 'error');
      }
    },
    clampConstructorWidth() {
      const min = 280;
      const max = Math.min(Math.floor(window.innerWidth * 0.88), 960);
      let w = this.constructorWidth;
      if (w < min) w = min;
      if (w > max) w = max;
      this.constructorWidth = w;
    },
    persistConstructorWidth() {
      try {
        localStorage.setItem('bpmn-assistant-constructor-width', String(this.constructorWidth));
      } catch {
        /* ignore */
      }
    },
    stopResizeListeners() {
      if (typeof this._resizeCleanup === 'function') {
        this._resizeCleanup();
        this._resizeCleanup = null;
      }
    },
    onResizeStart(event) {
      this.stopResizeListeners();
      const startX = event.clientX;
      const startW = this.constructorWidth;
      const min = 280;
      const max = () => Math.min(Math.floor(window.innerWidth * 0.88), 960);

      const onMove = (e) => {
        const dx = e.clientX - startX;
        let w = startW + dx;
        const hi = max();
        if (w < min) w = min;
        if (w > hi) w = hi;
        this.constructorWidth = w;
      };

      const onUp = () => {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('blur', onUp);
        this._resizeCleanup = null;
        this.clampConstructorWidth();
        this.persistConstructorWidth();
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      window.addEventListener('blur', onUp);
      this._resizeCleanup = onUp;
    },
    hideBpmnLogo() {
      const selectors = [
        '.bjs-powered-by',
        '.bjs-powered-by-bpmn',
        '[class*="powered-by"]',
        'a[href*="bpmn.io"]',
        'a[href*="bpmn-io"]',
      ];

      selectors.forEach((selector) => {
        const elements = document.querySelectorAll(selector);
        elements.forEach((el) => {
          el.style.display = 'none';
        });
      });

      const allLinks = document.querySelectorAll('a');
      allLinks.forEach((link) => {
        if (link.textContent && link.textContent.includes('bpmn.io')) {
          link.style.display = 'none';
        }
      });
    },
    showSnackbar(text, color = 'success') {
      this.snackbar.text = text;
      this.snackbar.color = color;
      this.snackbar.show = true;
    },
    async handleDrop(event) {
      event.preventDefault();
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
      const importSeq = ++this._bpmnImportSeq;

      if (!bpmnXmlValue || bpmnXmlValue === '') {
        if (this.bpmnViewer) {
          try {
            await this.bpmnViewer.importXML('<?xml version="1.0" encoding="UTF-8"?><definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="definitions_1"><process id="Process_1" isExecutable="false"></process></definitions>');
          } catch (err) {
            console.error('Failed to clear diagram:', err);
          }
        }
        if (importSeq !== this._bpmnImportSeq) return;
        this.bpmnXml = '';
        return;
      }

      if (!this.bpmnViewer) {
        console.error('BPMN viewer is not initialized');
        return;
      }

      try {
        console.log('Processing BPMN XML:', bpmnXmlValue.substring(0, 200));

        let xmlToImport = bpmnXmlValue;
        const hasCollaboration = /<collaboration[\s>]/i.test(bpmnXmlValue) || /<participant[\s>]/i.test(bpmnXmlValue);
        const hasEmbeddedBpmnDiEdges = /<bpmndi:BPMNEdge[\s>]/i.test(bpmnXmlValue);
        const skipExternalLayout = hasCollaboration && hasEmbeddedBpmnDiEdges;
        try {
          if (!skipExternalLayout) {
            const layoutedXml = await this.processDiagram(bpmnXmlValue);
            if (importSeq !== this._bpmnImportSeq) return;
            if (layoutedXml && layoutedXml.trim() !== '') {
              console.log('Layouted XML received:', layoutedXml.substring(0, 200));
              xmlToImport = layoutedXml;
            } else {
              console.warn('Layout server returned empty result, using original XML');
            }
          }
        } catch (layoutError) {
          console.warn('Layout server error, using original XML:', layoutError);
        }

        if (importSeq !== this._bpmnImportSeq) return;

        this.bpmnXml = xmlToImport;

        const { warnings } = await this.bpmnViewer.importXML(xmlToImport);
        if (importSeq !== this._bpmnImportSeq) return;
        console.log('BPMN diagram imported successfully', warnings);
        this.bpmnViewer.get('canvas').zoom('fit-viewport');
        this.hideBpmnLogo();
        this.showSnackbar('Диаграмма построена успешно', 'success');
      } catch (error) {
        console.error('Error handling BPMN XML:', error);
        this.showSnackbar(`Ошибка при построении диаграммы: ${error.message}`, 'error');

        try {
          await this.bpmnViewer.importXML(bpmnXmlValue);
          if (importSeq !== this._bpmnImportSeq) return;
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
.editor-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.editor-toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: #fff;
  border-bottom: 1px solid #e0e0e0;
  z-index: 3;
}

.toolbar-meta {
  font-size: 0.9rem;
  color: #616161;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.home-container {
  display: flex;
  flex-direction: row;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  align-items: stretch;
}

.constructor-container {
  flex: 0 0 auto;
  min-width: 280px;
  max-width: min(88vw, 960px);
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.split-gutter {
  flex: 0 0 6px;
  width: 6px;
  cursor: col-resize;
  background: #e8e8e8;
  border-left: 1px solid #d0d0d0;
  border-right: 1px solid #d0d0d0;
  align-self: stretch;
  flex-shrink: 0;
  z-index: 2;
}

.split-gutter:hover {
  background: #bbdefb;
}

.split-gutter:focus-visible {
  outline: 2px solid #2196f3;
  outline-offset: -2px;
}

.canvas-container {
  flex: 1;
  min-width: 0;
  height: 100%;
  border-left: none;
  background: #fafafa;
}

#canvas {
  width: 100%;
  height: 100%;
}
</style>

<style>
.bjs-powered-by,
.bjs-powered-by-bpmn,
[class*="powered-by"] {
  display: none !important;
}

a[href*="bpmn.io"],
a[href*="bpmn-io"] {
  display: none !important;
}
</style>
