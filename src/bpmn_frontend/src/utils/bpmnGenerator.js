/**
 * BPMN XML Generator
 * Converts hierarchical process structure to BPMN XML format
 */

import { migrateToDiagramModel, createEmptyDiagram } from './diagramModel.js';

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
    diagram = createEmptyDiagram();
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
        // Если задан явный переход (nextElementId) — не добавляем переход «следующий в дорожке»; он будет добавлен в проходе cross-lane
        if (!element.nextElementId) {
          addFlow(elemId, nextElementId);
        }
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
        // Last branch element → join is already connected by transformProcess(..., joinGatewayId)
        if (branchEndsWithEndEvent) {
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
        // Last element → join is already connected by transformProcess(..., joinGatewayId)
      }
    });

    if (nextElementId) {
      addFlow(joinGatewayId, nextElementId);
    }
  }

  // Диаграмма «Процесс» — один пул с дорожками
  const processes = new Map();
  const participants = [];

  diagram.pools.forEach((pool) => {
    const processId = `Process_${pool.id}`;
    const poolElements = [];
    const poolEndEventMap = new Map();
    const poolPendingConnections = [];
    const laneElementMap = new Map();

    pool.lanes?.forEach((lane) => {
      if (lane.elements && lane.elements.length > 0) {
        lane.elements.forEach((elem) => {
          if (!elem.id) {
            elem.id = generateId(elem.type);
          }
        });
        const transformedLaneElements = transformProcess(lane.elements, null, poolEndEventMap, poolPendingConnections);
        poolElements.push(...transformedLaneElements);
      }
    });

    // Переходы на другую дорожку: если у элемента задан nextElementId, добавляем flow к этому элементу
    const isGatewayType = (t) =>
      t === 'exclusiveGateway' || t === 'inclusiveGateway' || t === 'parallelGateway';
    pool.lanes?.forEach((lane) => {
      (lane.elements || []).forEach((el) => {
        if (
          el.nextElementId &&
          el.id &&
          !isGatewayType(el.type) &&
          el.type !== 'endEvent' &&
          elementMap.has(el.nextElementId)
        ) {
          addFlow(el.id, el.nextElementId);
        }
      });
    });

    // Карта: элемент (id) → индекс ветки (0, 1, …) для элементов внутри gateway.branches[].path в одной дорожке
    const elementToBranchIndex = new Map();
    // Распределяем элементы по дорожкам: основной поток — в свою дорожку; ветки шлюза — в branch.laneId или в дорожку шлюза
    function collectElementIdsByLane(elements, laneId, map, branchIndex) {
      if (!elements) return;
      elements.forEach((el) => {
        if (!el.id) el.id = generateId(el.type);
        let arr = map.get(laneId);
        if (!arr) {
          arr = [];
          map.set(laneId, arr);
        }
        arr.push(el.id);
        if (branchIndex !== undefined) {
          elementToBranchIndex.set(el.id, branchIndex);
        }
        if (el.branches) {
          el.branches.forEach((branch, idx) => {
            const targetLaneId = branch.laneId || laneId;
            if (branch.path && branch.path.length > 0) {
              collectElementIdsByLane(branch.path, targetLaneId, map, idx);
            }
          });
        }
      });
    }
    pool.lanes?.forEach((lane) => {
      laneElementMap.set(lane.id, []);
    });
    pool.lanes?.forEach((lane) => {
      if (lane.elements && lane.elements.length > 0) {
        collectElementIdsByLane(lane.elements, lane.id, laneElementMap);
      }
    });

    processes.set(pool.id, {
      processId,
      pool,
      elements: poolElements,
      lanes: pool.lanes || [],
      laneElementMap,
      elementToBranchIndex,
    });

    participants.push({
      id: pool.id,
      name: pool.name,
      processRef: processId,
    });
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

  const hasPoolsWithLanes = diagram.pools.some((p) => p.lanes && p.lanes.length > 0);
  const needsCollaboration = diagram.pools.length > 0 && hasPoolsWithLanes;

  if (needsCollaboration) {
    return buildCollaborationXml(processes, participants, [], flows);
  }
  const firstProcess = processes.size > 0 ? Array.from(processes.values())[0] : null;
  if (firstProcess) {
    return buildXml(firstProcess.elements, flows, firstProcess);
  }
  return buildXml([], flows, null);
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
          xml += ` name="${escapeXml(flow.condition)}">\n`;
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
  /** Для пересчёта dc:Bounds пула/дорожек после финальной раскладки узлов */
  const participantDiMeta = [];
  /** Горизонтальный шаг узлов в дорожке (линейный порядок); меньше — компактнее диаграмма */
  const LANE_FLOW_STEP_X = 120;
  /** Колонки после шлюза: чуть длиннее обычного шага, чтобы ветви читались, но без раздувания */
  const COLUMN_SPACING = 172;

  /** @param {string} [attrs] - optional attributes for BPMNShape, e.g. ' isHorizontal="true"' */
  function pushShape(id, bpmnElement, x, y, w, h, attrs = '') {
    planeShapes.push(
      `      <bpmndi:BPMNShape id="Shape_${id}" bpmnElement="${bpmnElement}"${attrs}>\n` +
        `        <dc:Bounds x="${x}" y="${y}" width="${w}" height="${h}"/>\n` +
        `      </bpmndi:BPMNShape>\n`
    );
  }

  function edgeLabelXml(labelText, waypointsOrStartEnd) {
    if (!labelText || !String(labelText).trim()) return '';
    const w = Math.max(20, Math.min(120, String(labelText).length * 8));
    const h = 14;
    const LABEL_GAP = 8;
    let x;
    let y;
    if (Array.isArray(waypointsOrStartEnd) && waypointsOrStartEnd.length >= 3) {
      const wp = waypointsOrStartEnd;
      const p0 = wp[0];
      const p1 = wp[1];
      const p2 = wp[2];
      // Вертикаль → горизонталь (выход из шлюза к задаче): подпись над горизонтальным участком, не на линии
      if (Math.abs(p0.x - p1.x) < 0.5 && Math.abs(p1.y - p2.y) < 0.5) {
        x = (p1.x + p2.x) / 2 - w / 2;
        y = p1.y - h - LABEL_GAP;
      } else if (Math.abs(p0.y - p1.y) < 0.5 && Math.abs(p1.x - p2.x) < 0.5) {
        x = (p0.x + p1.x) / 2 - w / 2;
        y = p0.y - h - LABEL_GAP;
      } else {
        const mid = Math.floor(wp.length / 2);
        const pa = wp[mid - 1];
        const pb = wp[mid];
        x = (pa.x + pb.x) / 2 - w / 2;
        y = (pa.y + pb.y) / 2 - h / 2;
      }
    } else if (Array.isArray(waypointsOrStartEnd) && waypointsOrStartEnd.length >= 2) {
      const mid = Math.floor(waypointsOrStartEnd.length / 2);
      const p0 = waypointsOrStartEnd[mid - 1];
      const p1 = waypointsOrStartEnd[mid];
      x = (p0.x + p1.x) / 2 - w / 2;
      y = (p0.y + p1.y) / 2 - h / 2;
    } else if (waypointsOrStartEnd && waypointsOrStartEnd.start && waypointsOrStartEnd.end) {
      x = (waypointsOrStartEnd.start.x + waypointsOrStartEnd.end.x) / 2 - w / 2;
      y = (waypointsOrStartEnd.start.y + waypointsOrStartEnd.end.y) / 2 - h / 2;
    } else {
      return '';
    }
    return `\n      <bpmndi:BPMNLabel>\n        <dc:Bounds x="${Math.round(x)}" y="${Math.round(y)}" width="${w}" height="${h}"/>\n      </bpmndi:BPMNLabel>`;
  }

  function pushEdge(id, bpmnElement, srcPos, tgtPos, labelText) {
    if (!srcPos || !tgtPos) return;
    const pts = `      <di:waypoint x="${srcPos.x}" y="${srcPos.y}"/>\n      <di:waypoint x="${tgtPos.x}" y="${tgtPos.y}"/>`;
    const label = edgeLabelXml(labelText, { start: srcPos, end: tgtPos });
    planeEdges.push(
      `      <bpmndi:BPMNEdge id="Edge_${id}" bpmnElement="${bpmnElement}">\n${pts}${label}\n      </bpmndi:BPMNEdge>\n`
    );
  }

  function pushEdgeOrthogonal(id, bpmnElement, waypoints, labelText) {
    if (!waypoints || waypoints.length < 2) return;
    const pts = waypoints.map((p) => `      <di:waypoint x="${p.x}" y="${p.y}"/>`).join('\n');
    const label = edgeLabelXml(labelText, waypoints);
    planeEdges.push(
      `      <bpmndi:BPMNEdge id="Edge_${id}" bpmnElement="${bpmnElement}">\n${pts}${label}\n      </bpmndi:BPMNEdge>\n`
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

    // Pre-calc lane heights based on element count (учитываем branch.laneId через laneElementMap)
    const laneHeightsLocal = [];
    const laneElementsPerLane = [];
    lanes.forEach((lane) => {
      const laneElements = processInfo.laneElementMap?.get(lane.id) || [];
      laneElementsPerLane.push(laneElements);
      const height = Math.max(160, 40 + laneElements.length * 70);
      laneHeightsLocal.push(height);
      laneHeights.set(lane.id, height);
    });
    // If no lanes, default height
    if (lanes.length === 0) {
      laneHeightsLocal.push(160);
    }

    const totalLaneHeight = laneHeightsLocal.reduce((acc, h) => acc + h, 0);
    const participantHeight = Math.max(200, totalLaneHeight);
    const participantWidth = 880;
    const participantX = 0;
    const participantY = currentY;
    const laneMetaForParticipant = [];
    if (processInfo) {
      participantPosByProcess.set(processInfo.processId, {
        x: participantX,
        y: participantY,
        w: participantWidth,
        h: participantHeight,
      });
    }

    // Participant shape
    pushShape(`Participant_${participant.id}`, participant.id, participantX, participantY, participantWidth, participantHeight, ' isHorizontal="true"');

    if (lanes.length > 0) {
      let laneYAcc = participantY;
      lanes.forEach((lane, laneIndex) => {
        const laneElements = laneElementsPerLane[laneIndex] || [];
        const laneHeight = laneHeights.get(lane.id) || 160;
        const laneY = laneYAcc;
        const laneX = participantX + 40;
        const laneWidth = participantWidth - 40;
        pushShape(`Lane_${lane.id}`, lane.id, laneX, laneY, laneWidth, laneHeight, ' isHorizontal="true"');
        laneMetaForParticipant.push({ bpmnElement: lane.id, x: laneX, y: laneY, w: laneWidth, h: laneHeight });
        laneBounds.set(lane.id, { x: laneX, y: laneY, w: laneWidth, h: laneHeight });

        let elementToBranchIndex = processInfo?.elementToBranchIndex;
        if (!elementToBranchIndex) elementToBranchIndex = new Map();

        // Повторно заполняем карту «элемент → ветка» по структуре дорожки (на случай если при первом проходе не заполнилось)
        const currentLaneData = processInfo?.pool?.lanes?.find((l) => l.id === lane.id);
        if (currentLaneData?.elements) {
          function fillBranchIndexMap(elements, laneId, branchIndex) {
            if (!elements) return;
            elements.forEach((el) => {
              if (!el.id) return;
              if (branchIndex !== undefined) {
                elementToBranchIndex.set(el.id, branchIndex);
              }
              if (el.branches) {
                el.branches.forEach((branch, idx) => {
                  const targetLaneId = branch.laneId || laneId;
                  if (branch.path?.length) {
                    fillBranchIndexMap(branch.path, targetLaneId, idx);
                  }
                });
              }
            });
          }
          fillBranchIndexMap(currentLaneData.elements, lane.id);
        }

        const branchIndicesInLane = new Set(
          (laneElements || []).map((id) => elementToBranchIndex?.get(id)).filter((v) => v !== undefined)
        );
        const sameLaneMultipleBranches = branchIndicesInLane.size >= 2;
        const sortedBranchIndices = [...branchIndicesInLane].sort((a, b) => a - b);
        const nBranchRows = sortedBranchIndices.length;
        const laneIdSet = new Set(laneElements);

        laneElements.forEach((elemId, idx) => {
          laneIdByElement.set(elemId, lane.id);
          const x = laneX + 100 + idx * LANE_FLOW_STEP_X;
          let y;
          if (sameLaneMultipleBranches && nBranchRows >= 2) {
            const branchIndex = elementToBranchIndex?.get(elemId);
            if (branchIndex === undefined) {
              y = laneY + laneHeight / 2;
            } else {
              const rowIndex = sortedBranchIndices.indexOf(branchIndex);
              const fraction = (rowIndex + 1) / (nBranchRows + 1);
              y = laneY + laneHeight * fraction;
            }
            const minY = laneY + 30;
            const maxY = laneY + laneHeight - 30;
            if (y < minY) y = minY;
            if (y > maxY) y = maxY;
          } else if (laneElements.length <= 4) {
            y = laneY + laneHeight / 2;
          } else {
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

        // Разведение веток в одной дорожке по sequenceFlows (не зависит от processInfo.pool)
        const outFromLane = sequenceFlows.filter((f) => laneIdSet.has(f.sourceRef));
        const gatewayIdsWithMultipleOut = new Set();
        outFromLane.forEach((f) => {
          const src = f.sourceRef;
          const sameLaneOut = sequenceFlows.filter(
            (o) => o.sourceRef === src && laneIdSet.has(o.targetRef)
          );
          if (sameLaneOut.length >= 2) gatewayIdsWithMultipleOut.add(src);
        });
        gatewayIdsWithMultipleOut.forEach((gatewayId) => {
          const sameLaneTargets = sequenceFlows
            .filter((f) => f.sourceRef === gatewayId && laneIdSet.has(f.targetRef))
            .map((f) => f.targetRef);
          if (sameLaneTargets.length < 2) return;
          const elementToRow = new Map();
          sameLaneTargets.forEach((targetId, outIndex) => {
            const row = outIndex;
            const stack = [targetId];
            const visited = new Set();
            while (stack.length) {
              const id = stack.pop();
              if (visited.has(id)) continue;
              visited.add(id);
              elementToRow.set(id, row);
              sequenceFlows
                .filter((f) => f.sourceRef === id && laneIdSet.has(f.targetRef))
                .forEach((f) => stack.push(f.targetRef));
            }
          });
          const nRows = new Set(elementToRow.values()).size;
          if (nRows < 2) return;
          elementToRow.forEach((row, elemId) => {
            const fraction = (row + 1) / (nRows + 1);
            let newY = laneY + laneHeight * fraction;
            const minY = laneY + 30;
            const maxY = laneY + laneHeight - 30;
            if (newY < minY) newY = minY;
            if (newY > maxY) newY = maxY;
            const pos = elementPositionMap.get(elemId);
            if (pos) elementPositionMap.set(elemId, { x: pos.x, y: newY });
          });
        });

        laneYAcc += laneHeight;
      });
    } else {
      const laneHeight = participantHeight;
      const laneY = participantY;
      const laneX = participantX + 40;
      const laneWidth = participantWidth - 40;
      pushShape(`Lane_${participant.id}_default`, participant.id, laneX, laneY, laneWidth, laneHeight, ' isHorizontal="true"');
      laneMetaForParticipant.push({ bpmnElement: participant.id, x: laneX, y: laneY, w: laneWidth, h: laneHeight });
      const processElements = processInfo?.elements || [];
      processElements.forEach((el, idx) => {
        const x = laneX + 70 + idx * Math.round(LANE_FLOW_STEP_X * 0.78);
        const y = laneY + laneHeight / 2;
        elementPositionMap.set(el.id, { x, y });
      });
    }

    participantDiMeta.push({
      participantId: participant.id,
      processId: processInfo?.processId,
      participantX,
      participantY,
      initialWidth: participantWidth,
      initialHeight: participantHeight,
      lanes: laneMetaForParticipant,
    });

    currentY += participantHeight + 60;
  });

  // Карта «элемент → { laneId, row, nRows, gatewayId, depth }» для разведения веток по Y и выравнивания X по колонкам
  const elementToBranchRow = new Map();
  const gatewaysWithSameLaneBranches = new Set();
  sequenceFlows.forEach((flow) => {
    const gatewayId = flow.sourceRef;
    if (gatewaysWithSameLaneBranches.has(gatewayId)) return;
    const srcLane = laneIdByElement.get(gatewayId);
    const tgtLane = laneIdByElement.get(flow.targetRef);
    if (!srcLane || !tgtLane || srcLane !== tgtLane) return;
    const sameLaneOut = sequenceFlows.filter(
      (f) => f.sourceRef === gatewayId && laneIdByElement.get(f.targetRef) === srcLane
    );
    if (sameLaneOut.length < 2) return;
    gatewaysWithSameLaneBranches.add(gatewayId);
    const sameLaneTargets = sameLaneOut.map((f) => f.targetRef);
    const rowsByLane = new Map();
    sameLaneTargets.forEach((targetId, outIndex) => {
      const row = outIndex;
      const queue = [{ id: targetId, depth: 0 }];
      const visited = new Set();
      while (queue.length) {
        const { id, depth } = queue.shift();
        if (visited.has(id)) continue;
        visited.add(id);
        const laneId = laneIdByElement.get(id);
        if (laneId !== srcLane) continue;
        elementToBranchRow.set(id, { laneId: srcLane, row, gatewayId, depth });
        let rowSet = rowsByLane.get(srcLane);
        if (!rowSet) {
          rowSet = new Set();
          rowsByLane.set(srcLane, rowSet);
        }
        rowSet.add(row);
        sequenceFlows
          .filter((f) => f.sourceRef === id && laneIdByElement.get(f.targetRef) === srcLane)
          .forEach((f) => queue.push({ id: f.targetRef, depth: depth + 1 }));
      }
    });
    const nRows = rowsByLane.get(srcLane)?.size ?? 0;
    if (nRows >= 2) {
      elementToBranchRow.forEach((data, elemId) => {
        if (data.laneId === srcLane) data.nRows = nRows;
      });
    }
  });
  // Нормализуем nRows для записей, где не выставили выше (одна ветка и т.п.)
  const laneMaxRow = new Map();
  elementToBranchRow.forEach((data) => {
    const laneId = data.laneId;
    const r = laneMaxRow.get(laneId);
    laneMaxRow.set(laneId, r == null ? data.row : Math.max(r, data.row));
  });
  elementToBranchRow.forEach((data) => {
    if (data.nRows == null) data.nRows = (laneMaxRow.get(data.laneId) ?? 0) + 1;
  });

  // Shapes for flow nodes (синтетический join *-join обрабатываем отдельно — его нет в laneElementMap)
  processes.forEach((processInfo) => {
    processInfo.elements.forEach((element) => {
      if (element.id && element.id.endsWith('-join')) {
        elementSizeMap.set(element.id, { w: 50, h: 50 });
        return;
      }
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
        const baseX = xs.length > 0 ? Math.max(...xs) + Math.round(LANE_FLOW_STEP_X * 0.75) : (laneBox ? laneBox.x + 120 : participantPos ? participantPos.x + 100 : 100);
        const baseY = laneBox ? laneBox.y + laneBox.h / 2 : participantPos ? participantPos.y + participantPos.h / 2 : 200;
        finalPos = { x: baseX, y: baseY };
        elementPositionMap.set(element.id, finalPos);
        fallbackIndexByProcess.set(processInfo.processId, (fallbackIndexByProcess.get(processInfo.processId) || 0) + 1);
      }
      const isGateway = element.type && element.type.includes('Gateway');
      const w = isGateway ? 50 : (element.type === 'task' ? 100 : 36);
      const h = isGateway ? 50 : (element.type === 'task' ? 80 : 36);
      let x = finalPos.x - w / 2;
      let y = finalPos.y - h / 2;
      const elLaneId = laneIdByElement.get(element.id);
      const elLaneBox = elLaneId ? laneBounds.get(elLaneId) : null;
      // Жёстко задаём Y и X по ряду/колонке ветки, если элемент в одной дорожке с двумя+ ветками (два ряда с общими колонками)
      const branchData = elementToBranchRow.get(element.id);
      if (branchData && elLaneBox && branchData.nRows >= 2 && branchData.gatewayId != null) {
        const gatewayPos = elementPositionMap.get(branchData.gatewayId);
        const fraction = (branchData.row + 1) / (branchData.nRows + 1);
        const centerY = Math.round((elLaneBox.y + elLaneBox.h * fraction) * 10) / 10;
        y = centerY - h / 2;
        let centerX = finalPos.x;
        if (gatewayPos && typeof gatewayPos.x === 'number') {
          centerX = Math.round((gatewayPos.x + (branchData.depth + 1) * COLUMN_SPACING) * 10) / 10;
          x = centerX - w / 2;
        }
        elementPositionMap.set(element.id, { x: centerX, y: centerY });
      }
      if (elLaneBox) {
        const minY = elLaneBox.y + 5;
        const maxY = elLaneBox.y + elLaneBox.h - h - 5;
        if (y < minY) y = minY;
        if (y > maxY) y = maxY;
      }
      if (y < 0) y = 0;
      elementSizeMap.set(element.id, { w, h });
      const nodeAttrs = isGateway ? ' isMarkerVisible="true"' : '';
      pushShape(`Node_${element.id}`, element.id, x, y, w, h, nodeAttrs);
    });
  });

  function fmtDi(n) {
    if (typeof n !== 'number' || Number.isNaN(n)) return 0;
    return Math.round(n * 10) / 10;
  }

  function replaceBpmnShapeBounds(planeShapes, bpmnElementId, x, y, w, h) {
    const bounds = `<dc:Bounds x="${fmtDi(x)}" y="${fmtDi(y)}" width="${fmtDi(w)}" height="${fmtDi(h)}"/>`;
    for (let i = 0; i < planeShapes.length; i++) {
      if (!planeShapes[i].includes(`bpmnElement="${bpmnElementId}"`)) continue;
      planeShapes[i] = planeShapes[i].replace(/<dc:Bounds x="[^"]*" y="[^"]*" width="[^"]*" height="[^"]*"\/>/, bounds);
      break;
    }
  }

  // Join-шлюз: вторая колонка на том же шаге, что и fork→ветка (2×COLUMN_SPACING от центра fork), чтобы горизонтальные сегменты были ровными
  const JOIN_GAP = 52;
  processes.forEach((processInfo) => {
    processInfo.elements.forEach((element) => {
      if (!element.id || !element.id.endsWith('-join')) return;
      const forkId = element.id.slice(0, -'-join'.length);
      const forkPos = elementPositionMap.get(forkId);
      if (!forkPos) return;
      const incoming = sequenceFlows.filter((f) => f.targetRef === element.id);
      let maxRight = forkPos.x + 25;
      incoming.forEach((f) => {
        const srcPos = elementPositionMap.get(f.sourceRef);
        const srcSize = elementSizeMap.get(f.sourceRef);
        if (!srcPos || !srcSize) return;
        const right = srcPos.x + srcSize.w / 2;
        if (right > maxRight) maxRight = right;
      });
      const joinW = 50;
      // Горизонталь fork→задача: от центра fork до левого края задачи = COLUMN_SPACING − w_task/2;
      // такой же отрезок справа от задачи до join: joinCenter = fork + 2×COLUMN_SPACING + joinW/2
      const symmetricJoinCenterX = forkPos.x + 2 * COLUMN_SPACING + joinW / 2;
      const joinCenterXFromContent = maxRight + JOIN_GAP + joinW / 2;
      const joinCenterX = Math.max(symmetricJoinCenterX, joinCenterXFromContent);
      const joinCenterY = forkPos.y;
      elementPositionMap.set(element.id, { x: joinCenterX, y: joinCenterY });
      const laneId = laneIdByElement.get(forkId);
      if (laneId) laneIdByElement.set(element.id, laneId);
    });
  });

  // Линейный хвост после join (join → задача → … → конец): те же шаги по центрам, что и на основной линии (LANE_FLOW_STEP_X)
  processes.forEach((processInfo) => {
    const processElementIds = new Set(processInfo.elements.map((e) => e.id));
    processInfo.elements.forEach((element) => {
      if (!element.id || !element.id.endsWith('-join')) return;
      const joinPos = elementPositionMap.get(element.id);
      if (!joinPos) return;
      const outFlows = sequenceFlows.filter(
        (f) => f.sourceRef === element.id && processElementIds.has(f.targetRef)
      );
      if (outFlows.length !== 1) return;
      const laneId = laneIdByElement.get(element.id);
      const laneBox = laneId ? laneBounds.get(laneId) : null;
      const laneMidY = laneBox ? laneBox.y + laneBox.h / 2 : joinPos.y;

      let prevCenterX = joinPos.x;
      let curId = outFlows[0].targetRef;
      const visited = new Set();
      while (curId && !visited.has(curId)) {
        visited.add(curId);
        const el = processInfo.elements.find((e) => e.id === curId);
        if (!el) break;
        if (el.id.endsWith('-join')) break;
        prevCenterX += LANE_FLOW_STEP_X;
        const isGateway = el.type && el.type.includes('Gateway');
        const w = isGateway ? 50 : (el.type === 'task' ? 100 : 36);
        const h = isGateway ? 50 : (el.type === 'task' ? 80 : 36);
        const centerY = laneMidY;
        elementPositionMap.set(curId, { x: prevCenterX, y: centerY });
        elementSizeMap.set(curId, { w, h });
        let x = prevCenterX - w / 2;
        let y = centerY - h / 2;
        const elLaneId = laneIdByElement.get(curId);
        const elLaneBox = elLaneId ? laneBounds.get(elLaneId) : null;
        if (elLaneBox) {
          const minY = elLaneBox.y + 5;
          const maxY = elLaneBox.y + elLaneBox.h - h - 5;
          if (y < minY) y = minY;
          if (y > maxY) y = maxY;
        }
        if (y < 0) y = 0;
        replaceBpmnShapeBounds(planeShapes, curId, x, y, w, h);

        const nextFlows = sequenceFlows.filter(
          (f) => f.sourceRef === curId && processElementIds.has(f.targetRef)
        );
        if (nextFlows.length !== 1) break;
        curId = nextFlows[0].targetRef;
      }
    });
  });

  processes.forEach((processInfo) => {
    processInfo.elements.forEach((element) => {
      if (!element.id || !element.id.endsWith('-join')) return;
      const pos = elementPositionMap.get(element.id);
      if (!pos) return;
      const w = 50;
      const h = 50;
      let x = pos.x - w / 2;
      let y = pos.y - h / 2;
      const elLaneId = laneIdByElement.get(element.id);
      const elLaneBox = elLaneId ? laneBounds.get(elLaneId) : null;
      if (elLaneBox) {
        const minY = elLaneBox.y + 5;
        const maxY = elLaneBox.y + elLaneBox.h - h - 5;
        if (y < minY) y = minY;
        if (y > maxY) y = maxY;
      }
      if (y < 0) y = 0;
      pushShape(`Node_${element.id}`, element.id, x, y, w, h, ' isMarkerVisible="true"');
    });
  });

  const POOL_CONTENT_PAD = 40;
  participantDiMeta.forEach((meta) => {
    if (!meta.processId) return;
    const processInfo = [...processes.values()].find((p) => p.processId === meta.processId);
    if (!processInfo) return;
    let maxX = -Infinity;
    let maxY = -Infinity;
    processInfo.elements.forEach((el) => {
      const pos = elementPositionMap.get(el.id);
      const size = elementSizeMap.get(el.id);
      if (!pos || !size) return;
      const right = pos.x + size.w / 2;
      const bottom = pos.y + size.h / 2;
      if (right > maxX) maxX = right;
      if (bottom > maxY) maxY = bottom;
    });
    if (!Number.isFinite(maxX)) return;

    const newW = Math.max(meta.initialWidth, maxX - meta.participantX + POOL_CONTENT_PAD);
    const newH = Math.max(meta.initialHeight, maxY - meta.participantY + POOL_CONTENT_PAD);
    const deltaH = newH - meta.initialHeight;

    replaceBpmnShapeBounds(planeShapes, meta.participantId, meta.participantX, meta.participantY, newW, newH);
    participantPosByProcess.set(meta.processId, {
      x: meta.participantX,
      y: meta.participantY,
      w: newW,
      h: newH,
    });

    if (meta.lanes.length === 0) return;
    const laneW = newW - 40;
    if (meta.lanes.length === 1) {
      const lm = meta.lanes[0];
      replaceBpmnShapeBounds(planeShapes, lm.bpmnElement, lm.x, lm.y, laneW, newH);
    } else {
      meta.lanes.forEach((lm, idx) => {
        const isLast = idx === meta.lanes.length - 1;
        const h = isLast ? lm.h + deltaH : lm.h;
        replaceBpmnShapeBounds(planeShapes, lm.bpmnElement, lm.x, lm.y, laneW, h);
      });
    }
  });

  // Порядок исходящих потоков у шлюзов (для ортогональной маршрутизации по BPMN)
  const gatewayOutgoing = new Map();
  processes.forEach((processInfo) => {
    processInfo.elements.forEach((el) => {
      if (el.type && (el.type === 'exclusiveGateway' || el.type === 'inclusiveGateway' || el.type === 'parallelGateway') && el.outgoing && el.outgoing.length > 1) {
        gatewayOutgoing.set(el.id, el.outgoing);
      }
    });
  });

  // Edges for sequence flows
  sequenceFlows.forEach((flow) => {
    const src = elementPositionMap.get(flow.sourceRef);
    const tgt = elementPositionMap.get(flow.targetRef);
    if (!src || !tgt) return;
    const srcSize = elementSizeMap.get(flow.sourceRef) || { w: 36, h: 36 };
    const tgtSize = elementSizeMap.get(flow.targetRef) || { w: 36, h: 36 };
    const outList = gatewayOutgoing.get(flow.sourceRef);
    const isFromGatewayWithBranches = outList && outList.length > 1;

    if (isFromGatewayWithBranches) {
      const outIndex = outList.indexOf(flow.id);
      const nOut = outList.length;
      // Выход из верхней/нижней (и промежуточных при 3+) точек ромба по вертикали, не с правого центра —
      // при двух ветках: сверху и снизу шлюза.
      const exitX = src.x;
      const exitY =
        nOut <= 1 ? src.y : src.y - srcSize.h / 2 + (outIndex / (nOut - 1)) * srcSize.h;
      const tgtCenterY = tgt.y;
      const tgtLeft = tgt.x - tgtSize.w / 2;
      const waypoints = [
        { x: exitX, y: exitY },
        { x: exitX, y: tgtCenterY },
        { x: tgtLeft, y: tgtCenterY },
      ];
      pushEdgeOrthogonal(flow.id, flow.id, waypoints, flow.condition);
    } else {
      const srcLane = laneIdByElement.get(flow.sourceRef);
      const tgtLane = laneIdByElement.get(flow.targetRef);
      const crossLane = srcLane && tgtLane && srcLane !== tgtLane;
      if (crossLane) {
        // Переход между дорожками: ортогональная ломаная. Источник выше цели — стрелка вниз (низ источника → верх цели), иначе вверх (верх источника → низ цели).
        const srcTopY = src.y - srcSize.h / 2;
        const srcBottomY = src.y + srcSize.h / 2;
        const tgtTopY = tgt.y - tgtSize.h / 2;
        const tgtBottomY = tgt.y + tgtSize.h / 2;
        const flowDown = src.y < tgt.y;
        const startY = flowDown ? srcBottomY : srcTopY;
        const endY = flowDown ? tgtTopY : tgtBottomY;
        const waypoints =
          Math.abs(src.x - tgt.x) < 1
            ? [
                { x: src.x, y: startY },
                { x: src.x, y: endY },
              ]
            : [
                { x: src.x, y: startY },
                { x: src.x, y: endY },
                { x: tgt.x, y: endY },
              ];
        pushEdgeOrthogonal(flow.id, flow.id, waypoints, flow.condition);
      } else {
        const srcRight = src.x + srcSize.w / 2;
        const tgtLeft = tgt.x - tgtSize.w / 2;
        const sameLane = srcLane && tgtLane && srcLane === tgtLane;
        const yDiff = Math.abs(src.y - tgt.y);

        // Вход в join: горизонталь до колонки центра, затем вертикаль к верхней/нижней границе ромба (как bpmn-io, не к центру)
        if (flow.targetRef.endsWith('-join')) {
          let waypoints;
          if (yDiff < 1) {
            waypoints = [
              { x: srcRight, y: src.y },
              { x: tgtLeft, y: tgt.y },
            ];
          } else if (src.y < tgt.y) {
            const joinTopY = tgt.y - tgtSize.h / 2;
            waypoints = [
              { x: srcRight, y: src.y },
              { x: tgt.x, y: src.y },
              { x: tgt.x, y: joinTopY },
            ];
          } else {
            const joinBottomY = tgt.y + tgtSize.h / 2;
            waypoints = [
              { x: srcRight, y: src.y },
              { x: tgt.x, y: src.y },
              { x: tgt.x, y: joinBottomY },
            ];
          }
          pushEdgeOrthogonal(flow.id, flow.id, waypoints, flow.condition);
        } else if (flow.sourceRef.endsWith('-join')) {
          const exitR = src.x + srcSize.w / 2;
          const tgtL = tgt.x - tgtSize.w / 2;
          let waypoints;
          if (yDiff < 2) {
            waypoints = [
              { x: exitR, y: src.y },
              { x: tgtL, y: tgt.y },
            ];
          } else {
            waypoints = [
              { x: exitR, y: src.y },
              { x: exitR, y: tgt.y },
              { x: tgtL, y: tgt.y },
            ];
          }
          pushEdgeOrthogonal(flow.id, flow.id, waypoints, flow.condition);
        } else if (sameLane && yDiff > 2) {
          // Одна дорожка, разный Y (например после задач веток, не join): L-образная ломаная
          const waypoints =
            tgtLeft >= srcRight - 1
              ? [
                  { x: srcRight, y: src.y },
                  { x: tgtLeft, y: src.y },
                  { x: tgtLeft, y: tgt.y },
                ]
              : [
                  { x: srcRight, y: src.y },
                  { x: srcRight, y: tgt.y },
                  { x: tgtLeft, y: tgt.y },
                ];
          pushEdgeOrthogonal(flow.id, flow.id, waypoints, flow.condition);
        } else {
          const start = { x: srcRight, y: src.y };
          const end = { x: tgtLeft, y: tgt.y };
          pushEdge(flow.id, flow.id, start, end, flow.condition);
        }
      }
    }
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

