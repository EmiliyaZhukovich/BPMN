/**
 * BPMN XML Generator
 * Converts hierarchical process structure to BPMN XML format
 */

import { migrateToDiagramModel, createEmptyDiagram, createPool } from './diagramModel.js';

let elementIdCounter = 1;
let flowIdCounter = 1;

function generateId(prefix = 'element') {
  return `${prefix}_${elementIdCounter++}`;
}

function generateFlowId(source, target) {
  return `flow_${flowIdCounter++}`;
}

/**
 * Transform hierarchical process structure to BPMN XML
 * @param {Object|Array} diagramOrProcess - Diagram with pools/lanes OR flat array of process elements (legacy)
 * @returns {string} BPMN XML string
 */
export function generateBpmnXml(diagramOrProcess) {
  // Check if it's old format (array) or new format (diagram with pools)
  let diagram;
  if (Array.isArray(diagramOrProcess)) {
    // Legacy format - migrate to diagram
    diagram = migrateToDiagramModel(diagramOrProcess);
  } else if (diagramOrProcess && diagramOrProcess.pools) {
    // New format
    diagram = diagramOrProcess;
  } else {
    // Empty or invalid - create empty diagram
    diagram = createEmptyDiagram();
    diagram.pools.push(createPool('Основной процесс'));
  }
  // Reset counters for consistent IDs
  elementIdCounter = 1;
  flowIdCounter = 1;

  const elements = [];
  const flows = [];
  const elementMap = new Map();
  const endEventMap = new Map(); // Map to track end events by label for merging duplicates
  const pendingConnections = []; // Store connections that need to be made in second pass

  // Helper to add flow
  function addFlow(sourceRef, targetRef, condition = null, flowId = null) {
    const id = flowId || generateFlowId(sourceRef, targetRef);
    flows.push({
      id,
      sourceRef,
      targetRef,
      condition: condition || null,
    });
    return id;
  }

  // Transform process recursively
  function transformProcess(processElements, parentNextId = null, localEndEventMap = null, localPendingConnections = null) {
    // Use local or global endEventMap
    const effectiveEndEventMap = localEndEventMap || endEventMap;
    const effectivePendingConnections = localPendingConnections || pendingConnections;

    const transformedElements = [];

    for (let i = 0; i < processElements.length; i++) {
      const element = processElements[i];
      if (!element.id) {
        element.id = generateId(element.type);
      }
      const nextElementId =
        i < processElements.length - 1
          ? processElements[i + 1].id
          : parentNextId;

      let elemId = element.id;
      let isDuplicateEndEvent = false;
      const originalElementId = element.id; // Keep original ID for duplicate detection

      // For end events, check if we already have one with the same label
      if (element.type === 'endEvent' && element.label) {
        const normalizedLabel = element.label.trim().toLowerCase();
        if (endEventMap.has(normalizedLabel)) {
          // Use existing end event ID instead of creating a new one
          const existingId = endEventMap.get(normalizedLabel);
          if (existingId !== originalElementId) {
            console.log(`Found duplicate end event: "${element.label}" (${originalElementId} -> ${existingId})`);
            elemId = existingId;
            isDuplicateEndEvent = true;
            // Don't create duplicate element, flow connection will be handled in second pass
          }
        } else {
          // First time seeing this end event label, register it
          console.log(`Registering new end event: "${element.label}" (${originalElementId})`);
          endEventMap.set(normalizedLabel, originalElementId);
        }
      }

      // If this is a duplicate end event, don't create element
      // Flow connection will be handled in second pass after all elements are processed
      if (isDuplicateEndEvent) {
        continue;
      }

      const transformedElement = {
        id: elemId,
        type: element.type,
        label: element.label || null,
        incoming: [],
        outgoing: [],
      };

      if (element.eventDefinition) {
        transformedElement.eventDefinition = element.eventDefinition;
      }

      transformedElements.push(transformedElement);
      elementMap.set(elemId, transformedElement);

      // Handle different element types
      if (element.type === 'exclusiveGateway' || element.type === 'inclusiveGateway') {
        handleGateway(element, transformedElement, nextElementId, transformedElements);
      } else if (element.type === 'parallelGateway') {
        handleParallelGateway(element, transformedElement, nextElementId, transformedElements);
      } else if (nextElementId && element.type !== 'endEvent') {
        addFlow(elemId, nextElementId);
      } else if (nextElementId && element.type === 'endEvent') {
        // End event with next element - connect to existing end event if duplicate
        const normalizedLabel = (element.label || '').trim().toLowerCase();
        if (endEventMap.has(normalizedLabel)) {
          const existingEndEventId = endEventMap.get(normalizedLabel);
          if (existingEndEventId !== elemId) {
            addFlow(elemId, existingEndEventId);
          }
        }
      }
    }

    return transformedElements;
  }

  function handleGateway(gatewayElement, gateway, nextElementId, elementsList) {
    let joinGatewayId = null;
    let joinGateway = null;

    // Only create join gateway if there are elements after the gateway
    if (nextElementId) {
      joinGatewayId = `${gateway.id}-join`;
      joinGateway = {
        id: joinGatewayId,
        type: gatewayElement.type,
        label: null,
        incoming: [],
        outgoing: [],
      };
      elementsList.push(joinGateway);
      elementMap.set(joinGatewayId, joinGateway);
    }

    let defaultFlowId = null;
    let hasBranchesEndingInEndEvent = false;

    gatewayElement.branches?.forEach((branch) => {
      if (!branch.path || branch.path.length === 0) {
        // Empty branch - connect directly
        const targetRef = branch.next || nextElementId;
        if (targetRef) {
          const flowId = addFlow(gateway.id, targetRef, branch.condition);
          if (branch.isDefault) {
            defaultFlowId = flowId;
          }
        }
        return;
      }

      // Ensure branch path elements have IDs
      branch.path.forEach((pathElem) => {
        if (!pathElem.id) {
          pathElem.id = generateId(pathElem.type);
        }
      });

      // Check if branch ends with end event
      const lastPathElement = branch.path[branch.path.length - 1];
      const branchEndsWithEndEvent = lastPathElement.type === 'endEvent';
      let isDuplicateEndEventInBranch = false;
      let mergedEndEventIdInBranch = null;

        // Transform branch path - don't pass joinGatewayId if branch ends with end event
        const branchTargetId = branchEndsWithEndEvent ? null : joinGatewayId;
        const branchElements = transformProcess(branch.path, branchTargetId);

        // Check if the last element is a duplicate end event
        if (branchEndsWithEndEvent && branchElements.length > 0) {
          const lastBranchElement = branchElements[branchElements.length - 1];
          if (lastBranchElement.type === 'endEvent' && lastBranchElement.label) {
            const normalizedLabel = lastBranchElement.label.trim().toLowerCase();
            if (endEventMap.has(normalizedLabel)) {
              const firstEndEventId = endEventMap.get(normalizedLabel);
              if (firstEndEventId !== lastBranchElement.id) {
                // This is a duplicate - mark it and store the ID of the first occurrence
                isDuplicateEndEventInBranch = true;
                mergedEndEventIdInBranch = firstEndEventId;
                // Remove the duplicate from branchElements
                branchElements.pop();
              }
            }
          }
        }

        // Filter out duplicate end events (keep only first occurrence)
        const uniqueBranchElements = branchElements.filter((elem) => {
          if (elem.type === 'endEvent' && elem.label) {
            const normalizedLabel = elem.label.trim().toLowerCase();
            // Keep only if this is the first occurrence (registered in endEventMap)
            return endEventMap.get(normalizedLabel) === elem.id;
          }
          return true;
        });

        elementsList.push(...uniqueBranchElements);

      if (branchElements.length > 0) {
        const firstElement = branchElements[0];
        const flowId = addFlow(gateway.id, firstElement.id, branch.condition);
        if (branch.isDefault) {
          defaultFlowId = flowId;
        }

        // Only connect last element to join gateway if:
        // 1. Join gateway exists (there are elements after the gateway)
        // 2. Branch doesn't end with end event
        if (joinGatewayId && !branchEndsWithEndEvent) {
          const lastElement = uniqueBranchElements[uniqueBranchElements.length - 1];
          if (lastElement) {
            addFlow(lastElement.id, joinGatewayId);
          }
        } else if (branchEndsWithEndEvent) {
          hasBranchesEndingInEndEvent = true;
          // If this branch ends with a duplicate end event, store connection info for second pass
          if (isDuplicateEndEventInBranch && mergedEndEventIdInBranch) {
            let elementToConnectId = null;
            if (uniqueBranchElements.length > 0) {
              // Connect the last element in the branch to the merged end event
              elementToConnectId = uniqueBranchElements[uniqueBranchElements.length - 1].id;
            } else {
              // Branch has only the end event (which was duplicate), connect gateway directly
              elementToConnectId = gateway.id;
            }
            // Store for second pass
            if (elementToConnectId && mergedEndEventIdInBranch) {
              effectivePendingConnections.push({
                sourceId: elementToConnectId,
                targetId: mergedEndEventIdInBranch,
                label: lastPathElement.label
              });
            }
          }
          // Normal case - branch ends with end event (first occurrence)
          // Flow is already created in transformProcess for sequential elements
        }
      }
    });

    if (defaultFlowId) {
      gateway.defaultFlow = defaultFlowId;
    }

    // Connect join gateway to next element only if it exists
    if (joinGatewayId && nextElementId) {
      addFlow(joinGatewayId, nextElementId);
    }

    // If all branches end with end events and there's no next element, remove join gateway
    if (joinGateway && hasBranchesEndingInEndEvent && !nextElementId) {
      // Check if all branches end with end events
      const allBranchesEndWithEndEvent = gatewayElement.branches?.every((branch) => {
        if (!branch.path || branch.path.length === 0) return false;
        const lastPathElement = branch.path[branch.path.length - 1];
        return lastPathElement.type === 'endEvent';
      });

      if (allBranchesEndWithEndEvent) {
        // Remove join gateway from elements list
        const joinIndex = elementsList.findIndex((e) => e.id === joinGatewayId);
        if (joinIndex !== -1) {
          elementsList.splice(joinIndex, 1);
          elementMap.delete(joinGatewayId);
        }
      }
    }
  }

  function handleParallelGateway(gatewayElement, gateway, nextElementId, elementsList) {
    const joinGatewayId = `${gateway.id}-join`;
    const joinGateway = {
      id: joinGatewayId,
      type: 'parallelGateway',
      label: null,
      incoming: [],
      outgoing: [],
    };

    elementsList.push(joinGateway);
    elementMap.set(joinGatewayId, joinGateway);

    gatewayElement.branches?.forEach((branch) => {
      if (!branch.path || branch.path.length === 0) {
        throw new Error('Parallel gateway cannot have empty branches');
      }

      // Ensure branch path elements have IDs
      branch.path.forEach((pathElem) => {
        if (!pathElem.id) {
          pathElem.id = generateId(pathElem.type);
        }
      });

      const branchElements = transformProcess(branch.path, joinGatewayId);
      elementsList.push(...branchElements);

      if (branchElements.length > 0) {
        const firstElement = branchElements[0];
        addFlow(gateway.id, firstElement.id);

        const lastElement = branchElements[branchElements.length - 1];
        addFlow(lastElement.id, joinGatewayId);
      }
    });

    if (nextElementId) {
      addFlow(joinGatewayId, nextElementId);
    }
  }

  // Process all pools and lanes
  const processes = new Map(); // Map poolId -> { processId, elements, flows, lanes }
  const participants = []; // Collaboration participants
  const messageFlows = diagram.messageFlows || [];

  // First pass: transform each pool's lanes into processes
  diagram.pools.forEach((pool) => {
    if (pool.isExternal) {
      // External participant - add to collaboration but no process
      participants.push({
        id: pool.id,
        name: pool.name,
        processRef: null,
      });
    } else {
      // Internal pool - create process
      const processId = `Process_${pool.id}`;
      const poolElements = [];
      const poolFlows = [];
      const poolEndEventMap = new Map(); // Per-pool end event tracking
      const poolPendingConnections = [];

      // Collect all elements from all lanes
      const laneElementMap = new Map(); // laneId -> element IDs

      pool.lanes?.forEach((lane) => {
        if (lane.elements && lane.elements.length > 0) {
          const laneElementIds = [];
          lane.elements.forEach((elem) => {
            if (!elem.id) {
              elem.id = generateId(elem.type);
            }
            laneElementIds.push(elem.id);
          });
          laneElementMap.set(lane.id, laneElementIds);

          // Transform this lane's elements
          const transformedLaneElements = transformProcess(lane.elements, null, poolEndEventMap, poolPendingConnections);
          poolElements.push(...transformedLaneElements);
        }
      });

      // Collect flows from transformProcess (they were added to the main flows array)
      // Need to separate them by pool
      // For now, keep using global flows but track by pool

      processes.set(pool.id, {
        processId,
        pool,
        elements: poolElements,
        lanes: pool.lanes || [],
        laneElementMap,
      });

      participants.push({
        id: pool.id,
        name: pool.name,
        processRef: processId,
      });
    }
  });

  // Second pass: connect duplicate end events that were skipped
  // This ensures all elements are in elementMap before connecting
  function connectDuplicateEndEventsRecursive(elements, parentGatewayId = null) {
    elements.forEach((element, index) => {
      if (element.type === 'endEvent' && element.label) {
        const normalizedLabel = element.label.trim().toLowerCase();
        if (endEventMap.has(normalizedLabel)) {
          const existingEndEventId = endEventMap.get(normalizedLabel);
          // Only process if this is a duplicate (not the first occurrence)
          if (element.id !== existingEndEventId) {
            let prevElemId = null;

            // Find previous element to connect
            if (index > 0) {
              const prevElement = elements[index - 1];
              prevElemId = prevElement.id;

              // If previous element is a gateway, check for join gateway
              if (prevElement.type === 'exclusiveGateway' || prevElement.type === 'inclusiveGateway') {
                const joinGatewayId = `${prevElement.id}-join`;
                if (elementMap.has(joinGatewayId)) {
                  prevElemId = joinGatewayId;
                }
              }
            } else if (parentGatewayId) {
              // This element is first in a branch, connect from parent gateway
              prevElemId = parentGatewayId;
            }

            // Connect if both elements exist and flow doesn't already exist
            if (prevElemId && elementMap.has(prevElemId) && elementMap.has(existingEndEventId)) {
              const flowExists = flows.some(
                (f) => f.sourceRef === prevElemId && f.targetRef === existingEndEventId
              );
              if (!flowExists) {
                console.log(`Connecting duplicate end event: ${prevElemId} -> ${existingEndEventId} (${element.label})`);
                addFlow(prevElemId, existingEndEventId);
              }
            } else {
              console.warn(`Cannot connect duplicate end event: prevElemId=${prevElemId}, existingEndEventId=${existingEndEventId}, prevInMap=${prevElemId ? elementMap.has(prevElemId) : false}, endInMap=${elementMap.has(existingEndEventId)}`);
            }
          }
        }
      }

      // Recursively process branches
      if (element.branches) {
        element.branches.forEach((branch) => {
          if (branch.path && branch.path.length > 0) {
            // Pass the gateway element ID so we can connect from it if needed
            connectDuplicateEndEventsRecursive(branch.path, element.id);
          }
        });
      }
    });
  }

  // Process main process and all nested branches for each pool
  processes.forEach((processInfo) => {
    connectDuplicateEndEventsRecursive(processInfo.elements);
  });

  // Process pending connections from branches
  pendingConnections.forEach((conn) => {
    if (elementMap.has(conn.sourceId) && elementMap.has(conn.targetId)) {
      const flowExists = flows.some(
        (f) => f.sourceRef === conn.sourceId && f.targetRef === conn.targetId
      );
      if (!flowExists) {
        console.log(`Processing pending connection: ${conn.sourceId} -> ${conn.targetId} (${conn.label})`);
        addFlow(conn.sourceId, conn.targetId);
      }
    } else {
      console.warn(`Cannot process pending connection: sourceId=${conn.sourceId}, targetId=${conn.targetId}, sourceInMap=${elementMap.has(conn.sourceId)}, targetInMap=${elementMap.has(conn.targetId)}`);
    }
  });

  // Build incoming/outgoing arrays for all elements
  flows.forEach((flow) => {
    const source = elementMap.get(flow.sourceRef);
    const target = elementMap.get(flow.targetRef);
    if (source) source.outgoing.push(flow.id);
    if (target) target.incoming.push(flow.id);
  });

  // Determine if we need Collaboration
  // Показываем пулы, даже если он один: для bpmn-js нужен participant.
  const hasPoolsWithLanes = diagram.pools.some((p) => !p.isExternal && p.lanes && p.lanes.length > 0);
  const needsCollaboration =
    diagram.pools.length > 0 || hasPoolsWithLanes || diagram.pools.length > 1 || messageFlows.length > 0;

  // Generate XML
  if (needsCollaboration) {
    return buildCollaborationXml(processes, participants, messageFlows, flows);
  } else {
    // No pools/lanes - use simple process format (legacy backward compatibility)
    // But this shouldn't happen if we have diagram structure - all diagrams should have at least one pool
    const firstProcess = processes.size > 0 ? Array.from(processes.values())[0] : null;
    if (firstProcess) {
      return buildXml(firstProcess.elements, flows, firstProcess);
    } else {
      // Fallback - empty process
      return buildXml([], flows, null);
    }
  }
}

function buildXml(elements, flows, processInfo = null) {
  const xmlns = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
  const bpmndi = 'http://www.omg.org/spec/BPMN/20100524/DI';
  const dc = 'http://www.omg.org/spec/DD/20100524/DC';
  const di = 'http://www.omg.org/spec/DD/20100524/DI';

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<definitions xmlns="${xmlns}" xmlns:bpmndi="${bpmndi}" xmlns:dc="${dc}" xmlns:di="${di}" id="definitions_1">\n`;

  const processId = processInfo?.processId || 'Process_1';
  xml += `  <process id="${processId}" isExecutable="false">\n`;

  // Add laneSet if process has lanes
  if (processInfo && processInfo.lanes && processInfo.lanes.length > 0) {
    xml += `    <laneSet id="LaneSet_${processId}">\n`;
    processInfo.lanes.forEach((lane) => {
      xml += `      <lane id="${lane.id}" name="${escapeXml(lane.name || '')}">\n`;
      const laneElementIds = processInfo.laneElementMap?.get(lane.id) || [];
      laneElementIds.forEach((elemId) => {
        xml += `        <flowNodeRef>${elemId}</flowNodeRef>\n`;
      });
      xml += `      </lane>\n`;
    });
    xml += `    </laneSet>\n`;
  }

  // Add elements
  elements.forEach((element) => {
    const tagName = mapElementTypeToTag(element.type);
    xml += `    <${tagName} id="${element.id}"`;
    if (element.label) {
      xml += ` name="${escapeXml(element.label)}"`;
    }
    if (element.defaultFlow) {
      xml += ` default="${element.defaultFlow}"`;
    }
    xml += `>\n`;

    // Add incoming flows
    element.incoming.forEach((flowId) => {
      xml += `      <incoming>${flowId}</incoming>\n`;
    });

    // Add outgoing flows
    element.outgoing.forEach((flowId) => {
      xml += `      <outgoing>${flowId}</outgoing>\n`;
    });

    // Add event definition if present
    if (element.eventDefinition) {
      const eventDefTag = mapEventDefinitionToTag(element.eventDefinition);
      xml += `      <${eventDefTag} id="${eventDefTag}_${element.id}"/>\n`;
    }

    xml += `    </${tagName}>\n`;
  });

  // Add sequence flows
  flows.forEach((flow) => {
    xml += `    <sequenceFlow id="${flow.id}" sourceRef="${flow.sourceRef}" targetRef="${flow.targetRef}"`;
    if (flow.condition) {
      xml += ` name="${escapeXml(flow.condition)}"`;
    }
    xml += `/>\n`;
  });

  xml += `  </process>\n`;

  // Add minimal BPMNDI (Diagram Interchange) section for layout server compatibility
  xml += `  <bpmndi:BPMNDiagram id="BPMNDiagram_1">\n`;
  xml += `    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">\n`;
  xml += `    </bpmndi:BPMNPlane>\n`;
  xml += `  </bpmndi:BPMNDiagram>\n`;

  xml += `</definitions>`;

  return xml;
}

function buildCollaborationXml(processes, participants, messageFlows, sequenceFlows) {
  const xmlns = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
  const bpmndi = 'http://www.omg.org/spec/BPMN/20100524/DI';
  const dc = 'http://www.omg.org/spec/DD/20100524/DC';
  const di = 'http://www.omg.org/spec/DD/20100524/DI';

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<definitions xmlns="${xmlns}" xmlns:bpmndi="${bpmndi}" xmlns:dc="${dc}" xmlns:di="${di}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="definitions_1">\n`;

  // Add Collaboration
  xml += `  <collaboration id="Collaboration_1">\n`;

  // Add participants
  participants.forEach((participant) => {
    xml += `    <participant id="${participant.id}" name="${escapeXml(participant.name || '')}"`;
    if (participant.processRef) {
      xml += ` processRef="${participant.processRef}"`;
    }
    xml += `/>\n`;
  });

  // Add message flows
  messageFlows.forEach((msgFlow) => {
    xml += `    <messageFlow id="${msgFlow.id || `MessageFlow_${flowIdCounter++}`}"`;
    if (msgFlow.sourceRef) {
      xml += ` sourceRef="${msgFlow.sourceRef}"`;
    }
    if (msgFlow.targetRef) {
      xml += ` targetRef="${msgFlow.targetRef}"`;
    }
    if (msgFlow.name) {
      xml += ` name="${escapeXml(msgFlow.name)}"`;
    }
    xml += `/>\n`;
  });

  xml += `  </collaboration>\n`;

  // Add processes
  processes.forEach((processInfo) => {
    xml += `  <process id="${processInfo.processId}" isExecutable="false">\n`;

    // Add laneSet
    if (processInfo.lanes && processInfo.lanes.length > 0) {
      xml += `    <laneSet id="LaneSet_${processInfo.processId}">\n`;
      processInfo.lanes.forEach((lane) => {
        xml += `      <lane id="${lane.id}" name="${escapeXml(lane.name || '')}">\n`;
        const laneElementIds = processInfo.laneElementMap?.get(lane.id) || [];
        laneElementIds.forEach((elemId) => {
          xml += `        <flowNodeRef>${elemId}</flowNodeRef>\n`;
        });
        xml += `      </lane>\n`;
      });
      xml += `    </laneSet>\n`;
    }

    // Add elements
    processInfo.elements.forEach((element) => {
      const tagName = mapElementTypeToTag(element.type);
      xml += `    <${tagName} id="${element.id}"`;
      if (element.label) {
        xml += ` name="${escapeXml(element.label)}"`;
      }
      if (element.defaultFlow) {
        xml += ` default="${element.defaultFlow}"`;
      }
      xml += `>\n`;

      // Add incoming flows
      element.incoming.forEach((flowId) => {
        xml += `      <incoming>${flowId}</incoming>\n`;
      });

      // Add outgoing flows
      element.outgoing.forEach((flowId) => {
        xml += `      <outgoing>${flowId}</outgoing>\n`;
      });

      // Add event definition if present
      if (element.eventDefinition) {
        const eventDefTag = mapEventDefinitionToTag(element.eventDefinition);
        xml += `      <${eventDefTag} id="${eventDefTag}_${element.id}"/>\n`;
      }

      xml += `    </${tagName}>\n`;
    });

    // Add sequence flows for this process (filter flows by elements in this process)
    const processElementIds = new Set(processInfo.elements.map(e => e.id));
    sequenceFlows.forEach((flow) => {
      if (processElementIds.has(flow.sourceRef) && processElementIds.has(flow.targetRef)) {
        xml += `    <sequenceFlow id="${flow.id}" sourceRef="${flow.sourceRef}" targetRef="${flow.targetRef}"`;
        if (flow.condition) {
          xml += `>\n`;
          xml += `      <conditionExpression xsi:type="tFormalExpression">${escapeXml(flow.condition)}</conditionExpression>\n`;
          xml += `    </sequenceFlow>\n`;
        } else {
          xml += `/>\n`;
        }
      }
    });

    xml += `  </process>\n`;
  });

  // --- Minimal DI generation (shapes/edges) so pools/lanes are visible in bpmn-js ---
  // Simple layout by Y: each pool under previous. Elements spaced along X.
  let currentY = 0;
  const planeShapes = [];
  const planeEdges = [];
  const elementPositionMap = new Map();
  const elementSizeMap = new Map();
  const participantPosByProcess = new Map(); // processId -> {x,y,width,height}
  const fallbackIndexByProcess = new Map(); // processId -> count for positioning missing nodes
  const laneHeights = new Map(); // laneId -> height
  const laneBounds = new Map(); // laneId -> { x, y, w, h }
  const laneIdByElement = new Map(); // elementId -> laneId

  function pushShape(id, bpmnElement, x, y, w, h) {
    planeShapes.push(
      `      <bpmndi:BPMNShape id="Shape_${id}" bpmnElement="${bpmnElement}">\n` +
        `        <dc:Bounds x="${x}" y="${y}" width="${w}" height="${h}"/>\n` +
        `      </bpmndi:BPMNShape>\n`
    );
  }

  function pushEdge(id, bpmnElement, srcPos, tgtPos) {
    if (!srcPos || !tgtPos) return;
    const pts = `      <di:waypoint x="${srcPos.x}" y="${srcPos.y}"/>\n      <di:waypoint x="${tgtPos.x}" y="${tgtPos.y}"/>`;
    planeEdges.push(
      `      <bpmndi:BPMNEdge id="Edge_${id}" bpmnElement="${bpmnElement}">\n${pts}\n      </bpmndi:BPMNEdge>\n`
    );
  }

  // Collect all element ids in a lane, including nested branch elements
  function collectAllElementIds(elements, out) {
    if (!elements) return;
    elements.forEach((el) => {
      if (!el.id) {
        el.id = generateId(el.type);
      }
      out.push(el.id);
      if (el.branches) {
        el.branches.forEach((branch) => {
          collectAllElementIds(branch.path, out);
        });
      }
    });
  }

  participants.forEach((participant) => {
    const processInfo = [...processes.values()].find((p) => p.processId === participant.processRef);
    const lanes = processInfo?.lanes || [];
    const laneCount = Math.max(lanes.length, 1);

    // Pre-calc lane heights based on element count (with nested)
    const laneHeightsLocal = [];
    const laneElementsPerLane = [];
    lanes.forEach((lane) => {
      const laneElements = [];
      collectAllElementIds(lane.elements, laneElements);
      laneElementsPerLane.push(laneElements);
      const height = Math.max(160, 40 + laneElements.length * 70);
      laneHeightsLocal.push(height);
      laneHeights.set(lane.id, height);
    });
    // If no lanes, default height
    if (lanes.length === 0) {
      laneHeightsLocal.push(160);
    }

    const totalLaneHeight =
      laneHeightsLocal.reduce((acc, h) => acc + h, 0) + (laneHeightsLocal.length > 0 ? (laneHeightsLocal.length - 1) * 20 : 0);
    const participantHeight = Math.max(200, totalLaneHeight);
    const participantWidth = 1200;
    const participantX = 0;
    const participantY = currentY;
    if (processInfo) {
      participantPosByProcess.set(processInfo.processId, {
        x: participantX,
        y: participantY,
        w: participantWidth,
        h: participantHeight,
      });
    }

    // Participant shape
    pushShape(`Participant_${participant.id}`, participant.id, participantX, participantY, participantWidth, participantHeight);

    if (lanes.length > 0) {
      let laneYAcc = participantY;
      lanes.forEach((lane, laneIndex) => {
        const laneElements = laneElementsPerLane[laneIndex] || [];
        const laneHeight = laneHeights.get(lane.id) || 160;
        const laneY = laneYAcc;
        const laneX = participantX + 40;
        const laneWidth = participantWidth - 40;
        pushShape(`Lane_${lane.id}`, lane.id, laneX, laneY, laneWidth, laneHeight);
        laneBounds.set(lane.id, { x: laneX, y: laneY, w: laneWidth, h: laneHeight });

        processInfo.laneElementMap?.set(lane.id, laneElements);

        laneElements.forEach((elemId, idx) => {
          laneIdByElement.set(elemId, lane.id);
          const x = laneX + 100 + idx * 200;
          let y;
          if (laneElements.length <= 4) {
            // Для коротких последовательностей — строго по центру дорожки
            y = laneY + laneHeight / 2;
          } else {
            // Разносим элементы по вертикали равномерно
            const step = Math.max(50, (laneHeight - 80) / Math.max(1, laneElements.length));
            const yStart = laneY + 40;
            y = yStart + idx * step;
            const minY = laneY + 30;
            const maxY = laneY + laneHeight - 30;
            if (y < minY) y = minY;
            if (y > maxY) y = maxY;
          }
          elementPositionMap.set(elemId, { x, y });
        });

        laneYAcc += laneHeight + 20;
      });
    } else {
      const laneHeight = participantHeight;
      const laneY = participantY;
      const laneX = participantX + 40;
      const laneWidth = participantWidth - 40;
      pushShape(`Lane_${participant.id}_default`, participant.id, laneX, laneY, laneWidth, laneHeight);
      const processElements = processInfo?.elements || [];
      processElements.forEach((el, idx) => {
        const x = laneX + 80 + idx * 160;
        const y = laneY + laneHeight / 2;
        elementPositionMap.set(el.id, { x, y });
      });
    }

    currentY += participantHeight + 60;
  });

  // Shapes for flow nodes
  processes.forEach((processInfo) => {
    processInfo.elements.forEach((element) => {
      const pos = elementPositionMap.get(element.id);
      let finalPos = pos;
      if (!finalPos) {
        const participantPos = participantPosByProcess.get(processInfo.processId);
        const laneId = laneIdByElement.get(element.id);
        const laneBox = laneId ? laneBounds.get(laneId) : null;
        const laneElems = laneId ? processInfo.laneElementMap?.get(laneId) || [] : [];
        const xs = laneElems
          .map((id) => elementPositionMap.get(id)?.x)
          .filter((v) => typeof v === 'number');
        const baseX = xs.length > 0 ? Math.max(...xs) + 150 : (laneBox ? laneBox.x + 100 : participantPos ? participantPos.x + 80 : 80);
        const baseY = laneBox ? laneBox.y + laneBox.h / 2 : participantPos ? participantPos.y + participantPos.h / 2 : 200;
        finalPos = { x: baseX, y: baseY };
        elementPositionMap.set(element.id, finalPos);
        fallbackIndexByProcess.set(processInfo.processId, (fallbackIndexByProcess.get(processInfo.processId) || 0) + 1);
      }
      const isGateway = element.type && element.type.includes('Gateway');
      const w = isGateway ? 50 : 36;
      const h = w;
      const x = finalPos.x - w / 2;
      const y = finalPos.y - h / 2;
      elementSizeMap.set(element.id, { w, h });
      pushShape(`Node_${element.id}`, element.id, x, y, w, h);
    });
  });

  // Edges for sequence flows
  sequenceFlows.forEach((flow) => {
    const src = elementPositionMap.get(flow.sourceRef);
    const tgt = elementPositionMap.get(flow.targetRef);
    if (!src || !tgt) return;
    const srcSize = elementSizeMap.get(flow.sourceRef) || { w: 36, h: 36 };
    const tgtSize = elementSizeMap.get(flow.targetRef) || { w: 36, h: 36 };
    const start = { x: src.x + srcSize.w / 2, y: src.y };
    const end = { x: tgt.x - tgtSize.w / 2, y: tgt.y };
    pushEdge(flow.id, flow.id, start, end);
  });

  // Add BPMNDI with generated shapes/edges
  xml += `  <bpmndi:BPMNDiagram id="BPMNDiagram_1">\n`;
  xml += `    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collaboration_1">\n`;
  planeShapes.forEach((s) => {
    xml += s;
  });
  planeEdges.forEach((e) => {
    xml += e;
  });
  xml += `    </bpmndi:BPMNPlane>\n`;
  xml += `  </bpmndi:BPMNDiagram>\n`;

  xml += `</definitions>`;

  return xml;
}

function mapElementTypeToTag(type) {
  const mapping = {
    startEvent: 'startEvent',
    endEvent: 'endEvent',
    task: 'task',
    userTask: 'userTask',
    serviceTask: 'serviceTask',
    scriptTask: 'scriptTask',
    businessRuleTask: 'businessRuleTask',
    sendTask: 'sendTask',
    receiveTask: 'receiveTask',
    manualTask: 'manualTask',
    exclusiveGateway: 'exclusiveGateway',
    inclusiveGateway: 'inclusiveGateway',
    parallelGateway: 'parallelGateway',
    intermediateThrowEvent: 'intermediateThrowEvent',
    intermediateCatchEvent: 'intermediateCatchEvent',
  };
  return mapping[type] || 'task';
}

function mapEventDefinitionToTag(eventDef) {
  const mapping = {
    timer: 'timerEventDefinition',
    message: 'messageEventDefinition',
    signal: 'signalEventDefinition',
  };
  return mapping[eventDef] || 'messageEventDefinition';
}

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Validate process structure
 * @param {Array} process - Process elements array
 * @param {Boolean} isTopLevel - Whether this is the top-level process (not nested)
 * @returns {Object} Validation result with isValid and errors
 */
export function validateProcess(process, isTopLevel = true) {
  const errors = [];

  if (!process || process.length === 0) {
    if (isTopLevel) {
      errors.push('Процесс должен содержать хотя бы один элемент');
    }
    return { isValid: errors.length === 0, errors };
  }

  // Check for start event and end event only at top level
  if (isTopLevel) {
    // Check for start event - must be in the main process flow (not in nested branches)
    const hasStartEvent = process.some((e) => e && e.type === 'startEvent');
    if (!hasStartEvent) {
      errors.push('Процесс должен иметь событие начала. Добавьте элемент "Событие начала" через кнопку "Добавить элемент"');
    }

    // Check for end event - check in main process and all nested branches
    let hasEndEvent = process.some((e) => e && e.type === 'endEvent');

    // Also check in nested branches recursively
    if (!hasEndEvent) {
      const checkNestedForEndEvent = (elements) => {
        if (!elements || !Array.isArray(elements)) return false;
        for (const element of elements) {
          if (element && element.type === 'endEvent') {
            return true;
          }
          if (element && element.branches && Array.isArray(element.branches)) {
            for (const branch of element.branches) {
              if (branch && branch.path && checkNestedForEndEvent(branch.path)) {
                return true;
              }
            }
          }
        }
        return false;
      };
      hasEndEvent = checkNestedForEndEvent(process);
    }

    if (!hasEndEvent) {
      errors.push('Процесс должен иметь хотя бы одно событие конца. Добавьте элемент "Событие конца" через кнопку "Добавить элемент"');
    }
  }

  // Validate gateways
  process.forEach((element, index) => {
    if (
      element.type === 'exclusiveGateway' ||
      element.type === 'inclusiveGateway' ||
      element.type === 'parallelGateway'
    ) {
      if (!element.branches || element.branches.length === 0) {
        errors.push(`Шлюз на позиции ${index + 1} должен иметь хотя бы одну ветвь`);
      }

      if (element.type === 'parallelGateway') {
        element.branches?.forEach((branch, branchIndex) => {
          if (!branch.path || branch.path.length === 0) {
            errors.push(
              `Параллельный шлюз на позиции ${index + 1}, ветвь ${branchIndex + 1} не может быть пустой`
            );
          }
        });
      }

      // Validate nested structures (but don't require start/end events in nested branches)
      element.branches?.forEach((branch) => {
        if (branch.path) {
          const nestedValidation = validateProcess(branch.path, false);
          if (!nestedValidation.isValid) {
            // Filter out start/end event errors from nested validation
            const nestedErrors = nestedValidation.errors.filter(
              (err) => !err.includes('событие начала') && !err.includes('событие конца')
            );
            errors.push(...nestedErrors);
          }
        }
      });
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
  };
}

