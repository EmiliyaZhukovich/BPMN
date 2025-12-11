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

  // Validate input early to avoid passing empty/invalid XML to the layout engine
  if (!bpmnXml || typeof bpmnXml !== 'string' || bpmnXml.trim() === '') {
    return res.status(400).json({ error: 'Empty BPMN XML in request body' });
  }

  try {
    // If the diagram contains Collaboration/Participant (pools), skip auto-layout
    // and return the original XML because bpmn-auto-layout doesn't reliably
    // preserve pool visuals. This avoids removing pools from the canvas.
    const hasCollaboration = /<collaboration[\s>]/i.test(bpmnXml || '') || /<participant[\s>]/i.test(bpmnXml || '');

    if (hasCollaboration) {
      console.log('Diagram contains Collaboration/Participant — attempting per-process auto-layout while preserving pools');

      try {
        // Extract collaboration block to reinsert later
        const collaborationMatch = (bpmnXml || '').match(/<collaboration[\s\S]*?<\/collaboration>/i);
        const collaborationBlock = collaborationMatch ? collaborationMatch[0] : '';

        // Extract all <process> blocks
        const processRegex = /<process[\s\S]*?<\/process>/gi;
        const processes = [];
        let pMatch;
        while ((pMatch = processRegex.exec(bpmnXml || '')) !== null) {
          processes.push(pMatch[0]);
        }

        if (processes.length === 0) {
          return res.json({ layoutedXml: bpmnXml });
        }

        // Helpers to collect shapes/edges from each layouted process
        const shapeRegex = /<bpmndi:BPMNShape[\s\S]*?<\/bpmndi:BPMNShape>/gi;
        const edgeRegex = /<bpmndi:BPMNEdge[\s\S]*?<\/bpmndi:BPMNEdge>/gi;

        const collectedShapes = [];
        const collectedEdges = [];

        // Build mapping processId -> participantId from collaboration block so we can
        // place each process's nodes inside the correct pool. Use a robust parse
        // that handles attributes in any order.
        const procToParticipant = {};
        if (collaborationBlock) {
          const participantTagRegex = /<participant\b[^>]*>/gi;
          let ptag;
          while ((ptag = participantTagRegex.exec(collaborationBlock)) !== null) {
            const tag = ptag[0];
            const idMatch = tag.match(/\bid\s*=\s*"([^"]+)"/i);
            const procRefMatch = tag.match(/\bprocessRef\s*=\s*"([^"]+)"/i);
            const participantId = idMatch ? idMatch[1] : null;
            const pid = procRefMatch ? procRefMatch[1] : null;
            if (participantId && pid) {
              procToParticipant[pid.trim()] = participantId.trim();
            }
          }
        }

        // Extract original BPMNDI diagram (if any) early so we can read participant bounds
        const originalDiagramMatchEarly = (bpmnXml || '').match(/<bpmndi:BPMNDiagram[\s\S]*?<\/bpmndi:BPMNDiagram>/i);
        const originalDiagramEarly = originalDiagramMatchEarly ? originalDiagramMatchEarly[0] : '';

        // Pre-extract participant bounds from the original diagram so we can
        // quickly lookup coordinates. This avoids repeated regex searches later.
        const participantBounds = {};
        if (originalDiagramEarly) {
          const partShapeRegex = /<bpmndi:BPMNShape[\s\S]*?>[\s\S]*?<\/bpmndi:BPMNShape>/gi;
          let psh;
          while ((psh = partShapeRegex.exec(originalDiagramEarly)) !== null) {
            const s = psh[0];
            const beMatch = s.match(/bpmnElement="([^"]+)"/i);
            if (!beMatch) continue;
            const be = beMatch[1];
            // consider only participant and lane shapes
            if (!/^pool_|^participant|^lane_/i.test(be)) continue;
            const bMatch = s.match(/<dc:Bounds[^>]*x="([0-9+.\-eE]+)"[^>]*y="([0-9+.\-eE]+)"/i);
            if (bMatch) {
              participantBounds[be] = { x: parseFloat(bMatch[1]), y: parseFloat(bMatch[2]) };
            }
          }
        }

        // Layout each process separately
        const debugInfo = []; // collect diagnostics per process
        for (const proc of processes) {
          // Build a minimal definitions containing only this process (no collaboration, no BPMNDI)
          const minimal = `<?xml version="1.0"?>\n<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="tmp_def">\n${proc}\n</definitions>`;

          // Call layoutProcess for this single-process diagram
          let layouted;
          try {
            layouted = await layoutProcess(minimal);
          } catch (err) {
            console.warn('Layout failed for a process, skipping it:', err);
            continue;
          }

          if (!layouted) continue;

          // Extract BPMNPlane content from layouted result
          const planeMatch = layouted.match(/<bpmndi:BPMNPlane[\s\S]*?<\/bpmndi:BPMNPlane>/i);
          const plane = planeMatch ? planeMatch[0] : '';
          if (!plane) continue;

          // Collect shapes and edges and compute bounding box for this process
          const shapesForProc = [];
          const edgesForProc = [];
          let sm;
          while ((sm = shapeRegex.exec(plane)) !== null) {
            shapesForProc.push(sm[0]);
          }
          while ((sm = edgeRegex.exec(plane)) !== null) {
            edgesForProc.push(sm[0]);
          }

          if (shapesForProc.length === 0 && edgesForProc.length === 0) continue;

          // Parse shapes to find minX/minY
          const boundsRegex = /<dc:Bounds[^>]*x="([0-9+.\-eE]+)"[^>]*y="([0-9+.\-eE]+)"[^>]*>/i;
          let minX = Number.POSITIVE_INFINITY;
          let minY = Number.POSITIVE_INFINITY;
          for (const sxml of shapesForProc) {
            const b = sxml.match(boundsRegex);
            if (b) {
              const x = parseFloat(b[1]);
              const y = parseFloat(b[2]);
              if (!isNaN(x) && !isNaN(y)) {
                if (x < minX) minX = x;
                if (y < minY) minY = y;
              }
            }
          }
          if (!isFinite(minX)) minX = 0;
          if (!isFinite(minY)) minY = 0;

          // Determine participant bounds for this process (to place shapes inside the pool)
          const procIdMatch = proc.match(/<process[^>]*id="([^"]+)"/i);
          const procId = procIdMatch ? procIdMatch[1] : null;
          const participantId = procId ? procToParticipant[procId] : null;
          let participantX = 40; // defaults inside lane
          let participantY = 0;
          // Prefer pre-extracted participantBounds map
          if (participantId && participantBounds && participantBounds[participantId]) {
            participantX = participantBounds[participantId].x;
            participantY = participantBounds[participantId].y;
          } else if (proc && originalDiagramEarly) {
            // fallback: try to find lane id inside process and use lane bounds
            const laneRegex = /<lane[^>]*id="([^"]+)"[^>]*>/i;
            const laneMatch = proc.match(laneRegex);
            if (laneMatch) {
              const laneId = laneMatch[1];
              if (participantBounds && participantBounds[laneId]) {
                participantX = participantBounds[laneId].x;
                participantY = participantBounds[laneId].y;
              } else {
                // final fallback: try to search originalDiagramEarly for the lane shape
                const laneShapeRegex = new RegExp(`<bpmndi:BPMNShape[\\s\\S]*?bpmnElement=\"${laneId}\"[\\s\\S]*?<\\/bpmndi:BPMNShape>`, 'i');
                const laneShapeMatch = originalDiagramEarly.match(laneShapeRegex);
                if (laneShapeMatch) {
                  const b2 = laneShapeMatch[0].match(/<dc:Bounds[^>]*x="([0-9+.\-eE]+)"[^>]*y="([0-9+.\-eE]+)"/i);
                  if (b2) {
                    participantX = parseFloat(b2[1]);
                    participantY = parseFloat(b2[2]);
                  }
                }
              }
            }
          }

          // Desired placement inside participant: keep some margin
          const desiredLeft = participantX + 82; // common left offset observed
          const desiredTop = participantY + 22;

          const offsetX = desiredLeft - minX;
          const offsetY = desiredTop - minY;

          // Apply offset to shapes and edges and collect adjusted XML
          for (const sxml of shapesForProc) {
              const adjusted = sxml.replace(/<dc:Bounds([^>]*)>/i, (m, g1) => {
              const bx = (g1.match(/x=\"([0-9+.\-eE]+)\"/) || [])[1];
              const by = (g1.match(/y=\"([0-9+.\-eE]+)\"/) || [])[1];
              const newX = (parseFloat(bx) || 0) + offsetX;
              const newY = (parseFloat(by) || 0) + offsetY;
                // Remove existing x/y attributes and any trailing slash/space, keep other attributes
                const rest = g1.replace(/x=\"[^\"]+\"|y=\"[^\"]+\"/g, '').replace(/\s*\/?\s*$/, '');
                const spacer = rest.length > 0 ? ' ' : '';
                return `<dc:Bounds x="${newX}" y="${newY}"${spacer}${rest} />`;
            });
            collectedShapes.push(adjusted);
          }

          for (const exml of edgesForProc) {
            const adjustedEdge = exml.replace(/<di:waypoint[^>]*>/gi, (wp) => {
              const mx = wp.match(/x=\"([0-9+.\-eE]+)\"/i);
              const my = wp.match(/y=\"([0-9+.\-eE]+)\"/i);
              const x = mx ? parseFloat(mx[1]) + offsetX : null;
              const y = my ? parseFloat(my[1]) + offsetY : null;
              if (x !== null && y !== null) {
                return `<di:waypoint x="${x}" y="${y}"/>`;
              }
              return wp;
            });
            collectedEdges.push(adjustedEdge);
          }

          // Collect debug info for this process
          const shapeDetails = [];
          const boundsExtract = /<dc:Bounds[^>]*x="([0-9+.\-eE]+)"[^>]*y="([0-9+.\-eE]+)"[^>]*width="([0-9+.\-eE]+)"[^>]*height="([0-9+.\-eE]+)"[^>]*\/?>/i;
          const bpmnElementExtract = /bpmnElement=\"([^\"]+)\"/i;
          // Look at last N adjusted shapes from this process (they were pushed in order)
          const startIndex = Math.max(0, collectedShapes.length - shapesForProc.length);
          for (let i = startIndex; i < collectedShapes.length; i++) {
            const sx = collectedShapes[i];
            const be = (sx.match(bpmnElementExtract) || [null, null])[1];
            const b = sx.match(boundsExtract);
            if (b) {
              shapeDetails.push({ id: be || null, x: parseFloat(b[1]), y: parseFloat(b[2]), width: parseFloat(b[3]), height: parseFloat(b[4]) });
            } else {
              // try to extract x/y without width/height
              const b2 = sx.match(/<dc:Bounds[^>]*x=\"([0-9+.\-eE]+)\"[^>]*y=\"([0-9+.\-eE]+)\"/i);
              if (b2) shapeDetails.push({ id: be || null, x: parseFloat(b2[1]), y: parseFloat(b2[2]) });
              else shapeDetails.push({ id: be || null, raw: sx.slice(0, 200) });
            }
          }

          debugInfo.push({
            procId: procId || null,
            participantId: participantId || null,
            participantX,
            participantY,
            minX,
            minY,
            offsetX,
            offsetY,
            shapesForProc: shapesForProc.length,
            edgesForProc: edgesForProc.length,
            shapes: shapeDetails
          });
        }

        // Extract original BPMNDI diagram (if any)
        const originalDiagramMatch = (bpmnXml || '').match(/<bpmndi:BPMNDiagram[\s\S]*?<\/bpmndi:BPMNDiagram>/i);
        if (!originalDiagramMatch) {
          // No original diagram: create a new BPMNDI with the collected shapes/edges and reinsert collaboration
          const newDiagram = `<bpmndi:BPMNDiagram id="BPMNDiagram_1">\n  <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collaboration_1">\n${collectedShapes.join('\n')}\n${collectedEdges.join('\n')}\n  </bpmndi:BPMNPlane>\n</bpmndi:BPMNDiagram>`;
          const merged = (bpmnXml || '').replace(/<definitions([^>]*)>/i, (m, g1) => `<definitions${g1}>${collaborationBlock}`) + newDiagram;
          return res.json({ layoutedXml: merged, debug: debugInfo });
        }

        const originalDiagram = originalDiagramMatch[0];

        // From original diagram keep only participant and lane shapes (to preserve pools)
        const originalShapeRegex = /<bpmndi:BPMNShape[\s\S]*?<\/bpmndi:BPMNShape>/gi;
        const originalShapes = [];
        let osh;
        while ((osh = originalShapeRegex.exec(originalDiagram)) !== null) {
          const s = osh[0];
          if (/bpmnElement=\"(pool_|participant|lane_)/i.test(s)) {
            originalShapes.push(s);
          }
        }

        // Build merged BPMNPlane: use opening tag from original, then participant/lane shapes, then collected shapes/edges
        const originalPlaneOpenMatch = originalDiagram.match(/<bpmndi:BPMNPlane[^>]*>/i);
        const originalPlaneOpen = originalPlaneOpenMatch ? originalPlaneOpenMatch[0] : '<bpmndi:BPMNPlane bpmnElement="Collaboration_1">';

        const mergedPlaneInner = originalShapes.join('\n') + '\n' + collectedShapes.join('\n') + '\n' + collectedEdges.join('\n');
        const mergedPlane = originalPlaneOpen + '\n' + mergedPlaneInner + '\n</bpmndi:BPMNPlane>';

        // Replace BPMNPlane in original diagram with mergedPlane
        const mergedDiagram = originalDiagram.replace(/<bpmndi:BPMNPlane[\s\S]*?<\/bpmndi:BPMNPlane>/i, mergedPlane);

        // Replace original diagram in original XML with merged diagram
        const finalXml = (bpmnXml || '').replace(/<bpmndi:BPMNDiagram[\s\S]*?<\/bpmndi:BPMNDiagram>/i, mergedDiagram);

        // Return layouted XML with debug diagnostics to help troubleshoot pool placement
        return res.json({ layoutedXml: finalXml, debug: debugInfo });
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
