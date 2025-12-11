const express = require('express');
const bodyParser = require('body-parser');
const { layoutProcess } = require('bpmn-auto-layout');

const app = express();
const port = process.env.PORT || 3001;

app.use(bodyParser.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.get('/', (req, res) => {
  console.log('Health check');
  res.json({ status: 'ok' });
});

app.post('/process-bpmn', async (req, res) => {
  const { bpmnXml } = req.body;

  try {
    // If the diagram contains Collaboration/Participant (pools), skip auto-layout
    // and return the original XML because bpmn-auto-layout doesn't reliably
    // preserve pool visuals. This avoids removing pools from the canvas.
    const hasCollaboration = /<collaboration[\s>]/i.test(bpmnXml || '') || /<participant[\s>]/i.test(bpmnXml || '');

    if (hasCollaboration) {
      console.log('Diagram contains Collaboration/Participant — attempting per-process auto-layout while preserving pools');

      try {
        // Remove the <collaboration> block for layout, keep original for merge
        const collaborationMatch = (bpmnXml || '').match(/<collaboration[\s\S]*?<\/collaboration>/i);
        const collaborationBlock = collaborationMatch ? collaborationMatch[0] : '';

        // Prepare XML for layout: remove collaboration and any existing BPMNDI
        let xmlForLayout = (bpmnXml || '').replace(/<collaboration[\s\S]*?<\/collaboration>/i, '');
        xmlForLayout = xmlForLayout.replace(/<bpmndi:BPMNDiagram[\s\S]*?<\/bpmndi:BPMNDiagram>/i, '');

        const layoutedXml = await layoutProcess(xmlForLayout);

        if (!layoutedXml || !layoutedXml.includes('<bpmndi:BPMNDiagram')) {
          console.warn('Layout server did not return BPMNDI; returning original XML');
          return res.json({ layoutedXml: bpmnXml });
        }

        // Extract BPMNDI plane contents from layoutedXml
        const newPlaneMatch = layoutedXml.match(/<bpmndi:BPMNPlane[\s\S]*?<\/bpmndi:BPMNPlane>/i);
        const newPlane = newPlaneMatch ? newPlaneMatch[0] : '';

        // Extract original BPMNDI diagram (if any)
        const originalDiagramMatch = (bpmnXml || '').match(/<bpmndi:BPMNDiagram[\s\S]*?<\/bpmndi:BPMNDiagram>/i);

        if (!originalDiagramMatch) {
          // No original diagram: return layoutedXml but re-insert collaboration to keep pools visible
          const merged = layoutedXml.replace(/<definitions([^>]*)>/i, (m, g1) => `<definitions${g1}>${collaborationBlock}`);
          return res.json({ layoutedXml: merged });
        }

        const originalDiagram = originalDiagramMatch[0];

        // Extract opening BPMNPlane tag from original diagram
        const originalPlaneOpenMatch = originalDiagram.match(/<bpmndi:BPMNPlane[^>]*>/i);
        const originalPlaneOpen = originalPlaneOpenMatch ? originalPlaneOpenMatch[0] : '<bpmndi:BPMNPlane bpmnElement="Collaboration_1">';

        // From original diagram keep only participant and lane shapes (to preserve pools)
        const shapeRegex = /<bpmndi:BPMNShape[\s\S]*?<\/bpmndi:BPMNShape>/gi;
        const edgeRegex = /<bpmndi:BPMNEdge[\s\S]*?<\/bpmndi:BPMNEdge>/gi;

        const originalShapes = [];
        const originalEdges = [];

        let sh;
        while ((sh = shapeRegex.exec(originalDiagram)) !== null) {
          const s = sh[0];
          if (/bpmnElement="(pool_|participant|lane_)/i.test(s)) {
            originalShapes.push(s);
          }
        }

        while ((sh = edgeRegex.exec(originalDiagram)) !== null) {
          const e = sh[0];
          // do not keep edges from original (we'll use layouted edges)
        }

        // From newPlane take all shapes and edges
        const newShapes = [];
        const newEdges = [];
        if (newPlane) {
          let m;
          while ((m = shapeRegex.exec(newPlane)) !== null) {
            newShapes.push(m[0]);
          }
          while ((m = edgeRegex.exec(newPlane)) !== null) {
            newEdges.push(m[0]);
          }
        }

        // Build merged BPMNPlane content: original opening tag + kept participant/lane shapes + new shapes/edges + closing tag
        const mergedPlaneInner = originalShapes.join('\n') + '\n' + newShapes.join('\n') + '\n' + newEdges.join('\n');

        const mergedPlane = originalPlaneOpen + '\n' + mergedPlaneInner + '\n</bpmndi:BPMNPlane>';

        // Build final BPMNDI: replace original BPMNPlane in originalDiagram with mergedPlane
        const mergedDiagram = originalDiagram.replace(/<bpmndi:BPMNPlane[\s\S]*?<\/bpmndi:BPMNPlane>/i, mergedPlane);

        // Replace original diagram in original XML with merged diagram
        const finalXml = (bpmnXml || '').replace(/<bpmndi:BPMNDiagram[\s\S]*?<\/bpmndi:BPMNDiagram>/i, mergedDiagram);

        return res.json({ layoutedXml: finalXml });
      } catch (err) {
        console.error('Error during collaboration-aware layout:', err);
        return res.json({ layoutedXml: bpmnXml });
      }
    }

    // For diagrams without pools, remove existing BPMN DI (shapes/edges positions)
    // to give the layout engine a clean model. Old DI can cause skewed or overlapping layouts.
    const xmlWithoutDi = (bpmnXml || '').replace(/<bpmndi:BPMNDiagram[\s\S]*?<\/bpmndi:BPMNDiagram>/i, '');

    const layoutedXml = await layoutProcess(xmlWithoutDi);
    res.json({ layoutedXml });
  } catch (error) {
    console.error('Error processing BPMN XML:', error);
    res.status(500).send('Failed to process BPMN XML');
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${port}`);
});
