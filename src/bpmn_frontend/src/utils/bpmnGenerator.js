/**
 * BPMN XML Generator
 * Converts hierarchical process structure to BPMN XML format
 */

import { migrateToDiagramModel, createEmptyDiagram, getAllElements } from './diagramModel.js';
import {
  isGatewayType,
  isParallelGatewayType,
  isDivergingGatewayType,
  TASK_LIKE_TYPES,
} from './bpmnPalette.js';

/** Не участвуют в sequence flow (только dataOutputAssociation / association в XML). */
const BPMN_FLOW_ARTIFACT_TYPES = new Set(['dataObjectReference', 'dataStoreReference', 'textAnnotation']);

function lastFlowNodeInPath(path) {
  if (!path || path.length === 0) return null;
  for (let k = path.length - 1; k >= 0; k--) {
    const el = path[k];
    if (el && !BPMN_FLOW_ARTIFACT_TYPES.has(el.type)) return el;
  }
  return null;
}

/** Все ветки сходятся в nextElementId без отдельного join-шлюза (как XOR → задача с двумя входами). */
function branchesMergeAtNextWithoutJoin(gatewayElement, nextElementId) {
  if (!nextElementId || isParallelGatewayType(gatewayElement.type)) return false;
  const branches = gatewayElement.branches;
  if (!Array.isArray(branches) || branches.length === 0) return false;
  for (const branch of branches) {
    if (!branch.path || branch.path.length === 0) {
      const targetRef = branch.next || nextElementId;
      if (targetRef !== nextElementId) return false;
    } else {
      const tail = lastFlowNodeInPath(branch.path);
      if (tail?.type === 'endEvent') return false;
    }
  }
  return true;
}

function nextFlowNodeIdAfterIndex(processElements, fromIndex, parentNextId) {
  for (let j = fromIndex + 1; j < processElements.length; j++) {
    const el = processElements[j];
    if (el && !BPMN_FLOW_ARTIFACT_TYPES.has(el.type)) return el.id;
  }
  return parentNextId ?? null;
}

let elementIdCounter = 1;
let flowIdCounter = 1;

function generateId(prefix = 'element') {
  return `${prefix}_${elementIdCounter++}`;
}

function generateFlowId(source, target) {
  return `flow_${flowIdCounter++}`;
}

/** Размеры фигуры в BPMNDI (в elementPositionMap хранится центр узла). */
function diShapeSizeForLayout(type) {
  if (type && String(type).includes('Gateway')) return { w: 50, h: 50 };
  if (TASK_LIKE_TYPES.has(type)) return { w: 100, h: 80 };
  return { w: 36, h: 36 };
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
  const ARTIFACT_TYPES = BPMN_FLOW_ARTIFACT_TYPES;

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
      if (ARTIFACT_TYPES.has(element.type)) {
        continue;
      }

      const nextElementId = nextFlowNodeIdAfterIndex(processElements, i, parentNextId);

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
      if (isDivergingGatewayType(element.type)) {
        handleGateway(element, transformedElement, nextElementId, transformedElements);
      } else if (isParallelGatewayType(element.type)) {
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

    const needJoinGateway =
      Boolean(nextElementId) && !branchesMergeAtNextWithoutJoin(gatewayElement, nextElementId);

    if (needJoinGateway) {
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

      // Check if branch ends with end event (игнорируем артефакты в конце path)
      const lastPathElement = lastFlowNodeInPath(branch.path);
      const branchEndsWithEndEvent = lastPathElement?.type === 'endEvent';
      let isDuplicateEndEventInBranch = false;
      let mergedEndEventIdInBranch = null;

        // Transform branch path - don't pass joinGatewayId if branch ends with end event
        const branchTargetId = branchEndsWithEndEvent ? null : joinGatewayId || nextElementId;
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
                label: lastPathElement?.label
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
        const tail = lastFlowNodeInPath(branch.path);
        return tail?.type === 'endEvent';
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
  const associations = Array.isArray(diagram.associations) ? diagram.associations : [];

  // Объекты данных / хранилища / аннотации в корне дорожки и внутри branch.path
  const artifacts = [];
  function collectArtifactsRecursive(elements) {
    if (!elements) return;
    elements.forEach((el) => {
      if (!el) return;
      if (ARTIFACT_TYPES.has(el.type)) {
        artifacts.push(el);
        return;
      }
      if (el.branches) {
        el.branches.forEach((b) => collectArtifactsRecursive(b.path || []));
      }
    });
  }
  diagram?.pools?.forEach((pool) => {
    pool?.lanes?.forEach((lane) => collectArtifactsRecursive(lane.elements || []));
  });

  // Ensure ids for artifacts/associations
  artifacts.forEach((a) => {
    if (a && !a.id) a.id = generateId(a.type || 'artifact');
  });
  associations.forEach((a) => {
    if (a && !a.id) a.id = generateId('association');
  });

  diagram.pools.forEach((pool) => {
    const processId = `Process_${pool.id}`;
    const poolElements = [];
    const poolEndEventMap = new Map();
    const poolPendingConnections = [];
    const laneElementMap = new Map();

    pool.lanes?.forEach((lane) => {
      const laneElements = (lane.elements || []).filter((e) => e && !ARTIFACT_TYPES.has(e.type));
      if (laneElements.length > 0) {
        laneElements.forEach((elem) => {
          if (!elem.id) {
            elem.id = generateId(elem.type);
          }
        });
        const transformedLaneElements = transformProcess(laneElements, null, poolEndEventMap, poolPendingConnections);
        poolElements.push(...transformedLaneElements);
      }
    });

    // Явные переходы nextElementId (в т.ч. на другую дорожку): верхний уровень дорожек и вложенные ветки шлюзов
    const isGatewayTypeCheck = (t) => isGatewayType(t);
    function addFlowsFromNextElementIdTree(elements) {
      if (!elements) return;
      elements.forEach((el) => {
        if (
          el.nextElementId &&
          el.id &&
          !isGatewayTypeCheck(el.type) &&
          el.type !== 'endEvent' &&
          elementMap.has(el.nextElementId)
        ) {
          addFlow(el.id, el.nextElementId);
        }
        if (el.branches) {
          el.branches.forEach((branch) => {
            addFlowsFromNextElementIdTree(branch.path);
          });
        }
      });
    }
    pool.lanes?.forEach((lane) => {
      const laneElements = (lane.elements || []).filter((e) => e && !ARTIFACT_TYPES.has(e.type));
      addFlowsFromNextElementIdTree(laneElements);
    });

    /**
     * Гарантирует поток из шлюза слияния (forkId-join) в следующий элемент того же линейного списка
     * (верхний уровень дорожки или path ветки). Узел join в модели конструктора не редактируется отдельно —
     * связь должна появляться, когда после шлюза в том же массиве идёт продолжение процесса.
     */
    function ensureJoinFlowToLaneSuccessor(elements) {
      if (!elements || !Array.isArray(elements) || elements.length < 2) {
        return;
      }
      for (let i = 0; i < elements.length - 1; i++) {
        const cur = elements[i];
        const nxt = elements[i + 1];
        if (cur?.id && nxt?.id && isGatewayType(cur.type)) {
          const joinId = `${cur.id}-join`;
          if (elementMap.has(joinId) && elementMap.has(nxt.id)) {
            const hasFlow = flows.some(
              (f) => f.sourceRef === joinId && f.targetRef === nxt.id
            );
            if (!hasFlow) {
              addFlow(joinId, nxt.id);
            }
          }
        }
        if (cur?.branches) {
          cur.branches.forEach((branch) => {
            ensureJoinFlowToLaneSuccessor(branch.path || []);
          });
        }
      }
      const last = elements[elements.length - 1];
      if (last?.branches) {
        last.branches.forEach((branch) => {
          ensureJoinFlowToLaneSuccessor(branch.path || []);
        });
      }
    }

    pool.lanes?.forEach((lane) => {
      const laneElements = (lane.elements || []).filter((e) => e && !ARTIFACT_TYPES.has(e.type));
      ensureJoinFlowToLaneSuccessor(laneElements);
    });

    // Карта: элемент (id) → индекс ветки (0, 1, …) для элементов внутри gateway.branches[].path в одной дорожке
    const elementToBranchIndex = new Map();
    // Распределяем элементы по дорожкам: основной поток — в свою дорожку; ветки шлюза — в branch.laneId или в дорожку шлюза
    function collectElementIdsByLane(elements, laneId, map, branchIndex) {
      if (!elements) return;
      elements.forEach((el) => {
        if (el && ARTIFACT_TYPES.has(el.type)) return;
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
      const laneElements = (lane.elements || []).filter((e) => e && !ARTIFACT_TYPES.has(e.type));
      if (laneElements.length > 0) {
        collectElementIdsByLane(laneElements, lane.id, laneElementMap);
      }
    });

    processes.set(pool.id, {
      processId,
      pool,
      elements: poolElements,
      lanes: pool.lanes || [],
      laneElementMap,
      elementToBranchIndex,
      artifacts,
      associations,
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
              if (isGatewayType(prevElement.type)) {
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
    xml += buildFlowNodeXml(element, '    ', null);
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

/**
 * Узел join (*-join) создаётся в process elements, но не попадает в дерево дорожки при collectElementIdsByLane —
 * в laneElementMap его не было. Тогда «Уведомить» шло в массиве сразу после задачи ветви, и realign
 * привязывал его к HR-задаче, а не к join слева → элементы оказывались в неправильном порядке по X.
 */
function injectJoinNodesIntoLaneElementMaps(processes, sequenceFlows) {
  processes.forEach((processInfo) => {
    const laneElementMap = processInfo.laneElementMap;
    if (!laneElementMap || !processInfo.elements?.length) return;

    const elementToLane = new Map();
    laneElementMap.forEach((ids, laneId) => {
      ids.forEach((id) => elementToLane.set(id, laneId));
    });

    processInfo.elements.forEach((el) => {
      if (!el?.id || !el.id.endsWith('-join')) return;
      const joinId = el.id;
      if (elementToLane.has(joinId)) return;

      const forkId = joinId.slice(0, -'-join'.length);
      const forkLaneId = elementToLane.get(forkId);
      if (!forkLaneId) return;

      const arr = laneElementMap.get(forkLaneId);
      if (!arr || arr.includes(joinId)) return;

      const incomingToJoin = sequenceFlows.filter((f) => f.targetRef === joinId);
      let insertAfter = -1;
      incomingToJoin.forEach((f) => {
        const srcLane = elementToLane.get(f.sourceRef);
        if (srcLane === forkLaneId) {
          const idx = arr.indexOf(f.sourceRef);
          if (idx > insertAfter) insertAfter = idx;
        }
      });

      if (insertAfter < 0) {
        const fi = arr.indexOf(forkId);
        if (fi >= 0) arr.splice(fi + 1, 0, joinId);
        else arr.push(joinId);
      } else {
        arr.splice(insertAfter + 1, 0, joinId);
      }
      elementToLane.set(joinId, forkLaneId);
    });
  });
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

  /** Уникальный id элемента &lt;dataOutputAssociation&gt; в XML (слабые ссылки на объекты из diagram.associations). */
  const dataOutputBpmnIdByAssocRef = new WeakMap();
  const usedDataOutputBpmnIds = new Set();
  let dataAssocGlobalSeq = 0;

  function allocateDataOutputBpmnId(assoc) {
    const raw =
      assoc && assoc.id != null && String(assoc.id).trim() !== ''
        ? String(assoc.id).replace(/[^a-zA-Z0-9_-]/g, '_')
        : `gen${dataAssocGlobalSeq}`;
    let bpmnId = `DataOutputAssociation_${raw}`;
    if (usedDataOutputBpmnIds.has(bpmnId)) {
      bpmnId = `DataOutputAssociation_${raw}_s${dataAssocGlobalSeq}`;
    }
    let bump = 0;
    while (usedDataOutputBpmnIds.has(bpmnId)) {
      bump += 1;
      bpmnId = `DataOutputAssociation_${raw}_s${dataAssocGlobalSeq}_${bump}`;
    }
    usedDataOutputBpmnIds.add(bpmnId);
    return bpmnId;
  }

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

    // --- Prepare data associations (dataInput/dataOutput) ---
    const typeById = new Map();
    processInfo.elements.forEach((el) => {
      if (el?.id && el.type) typeById.set(el.id, el.type);
    });
    (processInfo.artifacts || []).forEach((a) => {
      if (a?.id && a.type) typeById.set(a.id, a.type);
    });

    const dataAssociationsByElementId = new Map(); // elementId -> [{ id, kind, otherRef }]
    const dataAssocDi = []; // [{ id, sourceRef, targetRef, direction }]
    const dataObjectRefToObjectId = new Map(); // dataObjectReferenceId -> dataObjectId
    (processInfo.associations || []).forEach((a) => {
      if (!a?.sourceRef || !a.targetRef) return;
      const srcType = typeById.get(a.sourceRef);
      const tgtType = typeById.get(a.targetRef);
      const isData =
        srcType === 'dataObjectReference' || srcType === 'dataStoreReference' ||
        tgtType === 'dataObjectReference' || tgtType === 'dataStoreReference';
      const isTextAnn = srcType === 'textAnnotation' || tgtType === 'textAnnotation';
      if (!isData || isTextAnn) return;

      const dataId =
        (srcType === 'dataObjectReference' || srcType === 'dataStoreReference') ? a.sourceRef
          : (tgtType === 'dataObjectReference' || tgtType === 'dataStoreReference') ? a.targetRef
            : null;
      const otherId = dataId === a.sourceRef ? a.targetRef : a.sourceRef;
      if (!dataId || !otherId) return;

      dataAssocGlobalSeq += 1;
      const assocId = allocateDataOutputBpmnId(a);
      dataOutputBpmnIdByAssocRef.set(a, assocId);
      const kind = 'dataOutputAssociation';

      const arr = dataAssociationsByElementId.get(otherId) || [];
      arr.push({ id: assocId, kind, otherRef: dataId });
      dataAssociationsByElementId.set(otherId, arr);

      // for DI routing later
      const srcRef = otherId;
      const tgtRef = dataId;
      dataAssocDi.push({ id: assocId, sourceRef: srcRef, targetRef: tgtRef, direction: a.direction });
    });

    // Add elements (with embedded data associations if any)
    processInfo.elements.forEach((element) => {
      xml += buildFlowNodeXml(element, '    ', { dataAssociationsByElementId });
    });

    // Add artifacts / data objects (not flow nodes)
    const procArtifactIds = new Set((processInfo.artifacts || []).map((a) => a && a.id).filter(Boolean));
    const dataStoresWritten = new Set();
    (processInfo.artifacts || []).forEach((a) => {
      if (!a?.id || !a.type) return;
      if (a.type === 'textAnnotation') {
        xml += `    <textAnnotation id="${a.id}">\n`;
        const text = a.label != null ? escapeXml(String(a.label)) : '';
        xml += `      <text>${text}</text>\n`;
        xml += `    </textAnnotation>\n`;
        return;
      }
      if (a.type === 'dataObjectReference') {
        const objId = `DataObject_${a.id}`;
        dataObjectRefToObjectId.set(a.id, objId);
        const name = a.label != null && String(a.label).trim() !== '' ? ` name="${escapeXml(String(a.label))}"` : '';
        xml += `    <dataObjectReference id="${a.id}" dataObjectRef="${objId}"${name}/>\n`;
        xml += `    <dataObject id="${objId}"/>\n`;
        return;
      }
      if (a.type === 'dataStoreReference') {
        const storeId = `DataStore_${a.id}`;
        if (!dataStoresWritten.has(storeId)) {
          dataStoresWritten.add(storeId);
          xml += `    <dataStore id="${storeId}"/>\n`;
        }
        const name = a.label != null && String(a.label).trim() !== '' ? ` name="${escapeXml(String(a.label))}"` : '';
        xml += `    <dataStoreReference id="${a.id}" dataStoreRef="${storeId}"${name}/>\n`;
      }
    });

    // Add associations (for data / annotations)
    (processInfo.associations || []).forEach((a) => {
      if (!a?.id || !a.sourceRef || !a.targetRef) return;
      if (!procArtifactIds.has(a.sourceRef) && !procArtifactIds.has(a.targetRef)) {
        // allow associations from/to flow nodes too; just ensure refs exist somewhere in this process
      }
      let sourceRef = a.sourceRef;
      let targetRef = a.targetRef;
      const srcType = typeById.get(a.sourceRef);
      const tgtType = typeById.get(a.targetRef);
      const involvesTextAnnotation = srcType === 'textAnnotation' || tgtType === 'textAnnotation';
      const involvesData = srcType === 'dataObjectReference' || srcType === 'dataStoreReference' ||
        tgtType === 'dataObjectReference' || tgtType === 'dataStoreReference';

      // Normalize for textAnnotation: keep source as non-annotation, target as annotation (like bpmn-js exports)
      if (involvesTextAnnotation && srcType === 'textAnnotation' && tgtType !== 'textAnnotation') {
        sourceRef = a.targetRef;
        targetRef = a.sourceRef;
      }

      // Data associations are emitted as dataInputAssociation/dataOutputAssociation inside the flow node.
      if (involvesData) return;

      const dirAttr = 'None';
      const name = a.label != null && String(a.label).trim() !== '' ? ` name="${escapeXml(String(a.label))}"` : '';
      xml += `    <association id="${a.id}" sourceRef="${sourceRef}" targetRef="${targetRef}" associationDirection="${dirAttr}"${name}/>\n`;
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

  injectJoinNodesIntoLaneElementMaps(processes, sequenceFlows);

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
  /**
   * Равномерный зазор между соседними элементами в линейном потоке (правый край → левый край).
   * Раньше центры шли с шагом 120px при ширине задачи 100px → зазор 20px; у события 36px → 52px.
   */
  const LANE_FLOW_GAP_X = 52;
  /** Колонки после шлюза: расстояние между развилками (не линейный поток) */
  const COLUMN_SPACING = 172;

  /** @param {string} [attrs] - optional attributes for BPMNShape, e.g. ' isHorizontal="true"' */
  function pushShape(id, bpmnElement, x, y, w, h, attrs = '') {
    planeShapes.push(
      `      <bpmndi:BPMNShape id="Shape_${id}" bpmnElement="${bpmnElement}"${attrs}>\n` +
        `        <dc:Bounds x="${x}" y="${y}" width="${w}" height="${h}"/>\n` +
        `      </bpmndi:BPMNShape>\n`
    );
  }

  /**
   * Позиция dc:Bounds подписи потока.
   * bpmn-js пересчитывает bounds в TextRenderer.getExternalLabelBounds — ширину в XML не занижать.
   * Для выхода шлюза «вертикаль → горизонталь»: полоса слева от задачи часто уже ширины текста —
   * тогда держим подпись у линии по Y и сужаем width до полосы; иначе отступ по Y от задачи.
   *
   * @param {{ x: number; y: number; w: number; h: number } | null | undefined} targetEl — цель sequenceFlow (центр + размер).
   */
  function edgeLabelXml(labelText, waypointsOrStartEnd, targetEl) {
    if (!labelText || !String(labelText).trim()) return '';
    const text = String(labelText);
    const len = text.length;
    let w = Math.max(90, Math.min(300, Math.ceil(len * 10.5) + 40));
    const h = 20;
    const LABEL_GAP = 8;
    /** отступ подписи от линии потока (не на стрелке) */
    const LINE_PAD = 6;
    /** отступ от границ соседнего элемента */
    const PAD_ELEM = 8;

    /** @param {{x:number,y:number}} p0 @param {{x:number,y:number}} p1 */
    function labelTopLeftOffSegment(p0, p1) {
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      const midX = (p0.x + p1.x) / 2;
      const midY = (p0.y + p1.y) / 2;

      if (absDy < 0.5 && absDx > 0.5) {
        return { x: midX - w / 2, y: midY - h - LINE_PAD };
      }
      if (absDx < 0.5 && absDy > 0.5) {
        return { x: midX + LABEL_GAP, y: midY - h / 2 };
      }
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const off = h / 2 + LABEL_GAP;
      return { x: midX + nx * off - w / 2, y: midY + ny * off - h / 2 };
    }

    /** Самый длинный прямой участок ломаной — на нём удобнее читать подпись. */
    function longestSegment(wp) {
      let best = { i: 0, len: -1 };
      for (let i = 1; i < wp.length; i++) {
        const a = wp[i - 1];
        const b = wp[i];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len > best.len) best = { i, len, a, b };
      }
      return best.a && best.b ? { p0: best.a, p1: best.b } : null;
    }

    let x;
    let y;
    if (Array.isArray(waypointsOrStartEnd) && waypointsOrStartEnd.length >= 3) {
      const wp = waypointsOrStartEnd;
      const p0 = wp[0];
      const p1 = wp[1];
      const p2 = wp[2];
      // Вертикаль → горизонталь (выход из шлюза): подпись у горизонтального участка, не на углу и не на вертикали
      if (Math.abs(p0.x - p1.x) < 0.5 && Math.abs(p1.y - p2.y) < 0.5) {
        const midX = (p1.x + p2.x) / 2;
        const above = p0.y > p1.y;
        const cornerX = p1.x;
        const yNearLine = above ? p1.y - h - LINE_PAD : p1.y + LINE_PAD;

        if (targetEl) {
          const tgtLeft = targetEl.x - targetEl.w / 2;
          const xMin = cornerX + LABEL_GAP;
          const rightEdgeMax = tgtLeft - PAD_ELEM;
          const stripW = rightEdgeMax - xMin;
          const wFull = Math.max(90, Math.min(300, Math.ceil(len * 10.5) + 40));
          if (stripW < 90) {
            // Узкая полоса между вертикалью и целью: не сдвигаем подпись влево к другим задачам,
            // а сужаем width и держим у горизонтального участка (yNearLine), центрируя по midX.
            const wStrip = Math.max(0, tgtLeft - PAD_ELEM - xMin);
            w = Math.min(wFull, Math.max(1, wStrip));
            y = yNearLine;
            x = Math.max(xMin, Math.min(midX - w / 2, tgtLeft - PAD_ELEM - w));
          } else {
            w = Math.min(wFull, stripW);
            y = yNearLine;
            x = Math.max(xMin, Math.min(midX - w / 2, rightEdgeMax - w));
          }
        } else {
          y = yNearLine;
          const hx0 = Math.min(p1.x, p2.x);
          x = Math.max(hx0 + LABEL_GAP, midX - w / 2);
        }
      } else if (Math.abs(p0.y - p1.y) < 0.5 && Math.abs(p1.x - p2.x) < 0.5) {
        const seg = labelTopLeftOffSegment(p0, p1);
        x = seg.x;
        y = seg.y;
      } else {
        const seg = wp.length > 3 ? longestSegment(wp) : null;
        if (seg) {
          const t = labelTopLeftOffSegment(seg.p0, seg.p1);
          x = t.x;
          y = t.y;
        } else {
          const t = labelTopLeftOffSegment(p0, p1);
          x = t.x;
          y = t.y;
        }
      }
    } else if (Array.isArray(waypointsOrStartEnd) && waypointsOrStartEnd.length >= 2) {
      const mid = Math.floor(waypointsOrStartEnd.length / 2);
      const p0 = waypointsOrStartEnd[mid - 1];
      const p1 = waypointsOrStartEnd[mid];
      const t = labelTopLeftOffSegment(p0, p1);
      x = t.x;
      y = t.y;
    } else if (waypointsOrStartEnd && waypointsOrStartEnd.start && waypointsOrStartEnd.end) {
      const t = labelTopLeftOffSegment(waypointsOrStartEnd.start, waypointsOrStartEnd.end);
      x = t.x;
      y = t.y;
    } else {
      return '';
    }
    return `\n      <bpmndi:BPMNLabel>\n        <dc:Bounds x="${Math.round(x)}" y="${Math.round(y)}" width="${w}" height="${h}"/>\n      </bpmndi:BPMNLabel>`;
  }

  function pushEdge(id, bpmnElement, srcPos, tgtPos, labelText, targetForLabel) {
    if (!srcPos || !tgtPos) return;
    const pts = `      <di:waypoint x="${srcPos.x}" y="${srcPos.y}"/>\n      <di:waypoint x="${tgtPos.x}" y="${tgtPos.y}"/>`;
    const label = edgeLabelXml(labelText, { start: srcPos, end: tgtPos }, targetForLabel);
    planeEdges.push(
      `      <bpmndi:BPMNEdge id="Edge_${id}" bpmnElement="${bpmnElement}">\n${pts}${label}\n      </bpmndi:BPMNEdge>\n`
    );
  }

  function pushEdgeOrthogonal(id, bpmnElement, waypoints, labelText, targetForLabel) {
    if (!waypoints || waypoints.length < 2) return;
    const pts = waypoints.map((p) => `      <di:waypoint x="${p.x}" y="${p.y}"/>`).join('\n');
    const label = edgeLabelXml(labelText, waypoints, targetForLabel);
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

        const elementByIdForLayout = new Map((processInfo?.elements || []).map((e) => [e.id, e]));

        laneElements.forEach((elemId, idx) => {
          laneIdByElement.set(elemId, lane.id);
          const elMeta = elementByIdForLayout.get(elemId);
          const { w } = diShapeSizeForLayout(elMeta?.type);
          let x;
          if (idx === 0) {
            x = laneX + 100;
          } else {
            const prevId = laneElements[idx - 1];
            const prevPos = elementPositionMap.get(prevId);
            const prevMeta = elementByIdForLayout.get(prevId);
            const { w: pw } = diShapeSizeForLayout(prevMeta?.type);
            x = prevPos.x + pw / 2 + LANE_FLOW_GAP_X + w / 2;
          }
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
          } else {
            // Один линейный ряд по центру дорожки (любое число элементов — без «лесенки»)
            y = laneY + laneHeight / 2;
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
        const { w } = diShapeSizeForLayout(el.type);
        let x;
        if (idx === 0) {
          x = laneX + 70;
        } else {
          const prev = processElements[idx - 1];
          const prevPos = elementPositionMap.get(prev.id);
          const { w: pw } = diShapeSizeForLayout(prev.type);
          x = prevPos.x + pw / 2 + LANE_FLOW_GAP_X + w / 2;
        }
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
        const prevRow = elementToBranchRow.get(id);
        const next = { laneId: srcLane, row, gatewayId, depth };
        if (!prevRow) {
          elementToBranchRow.set(id, next);
        } else {
          // Узел слияния (две ветки в одну задачу): верхний ряд — меньший row (ветка «Да»); глубина — max по путям.
          const mergedRow = Math.min(prevRow.row, row);
          const mergedDepth = Math.max(prevRow.depth, depth);
          if (mergedRow !== prevRow.row || mergedDepth !== prevRow.depth) {
            elementToBranchRow.set(id, { ...prevRow, row: mergedRow, depth: mergedDepth });
          }
        }
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

  // После слияния row/depth у развилки: уточняем depth по цепочке (напр. конец после задачи с увеличенным depth).
  for (let iter = 0; iter < 40; iter++) {
    let changed = false;
    sequenceFlows.forEach((f) => {
      const src = elementToBranchRow.get(f.sourceRef);
      const tgt = elementToBranchRow.get(f.targetRef);
      if (!src || !tgt) return;
      if (src.gatewayId !== tgt.gatewayId) return;
      if (src.laneId !== tgt.laneId) return;
      if (src.row !== tgt.row) return;
      const nd = src.depth + 1;
      if (nd > tgt.depth) {
        tgt.depth = nd;
        changed = true;
      }
    });
    if (!changed) break;
  }

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
        let baseX;
        if (laneElems.length > 0) {
          let maxCenterX = -Infinity;
          let rightmostId = null;
          laneElems.forEach((id) => {
            const px = elementPositionMap.get(id)?.x;
            if (typeof px === 'number' && px > maxCenterX) {
              maxCenterX = px;
              rightmostId = id;
            }
          });
          if (rightmostId != null && Number.isFinite(maxCenterX)) {
            const lastInLane = processInfo.elements.find((e) => e.id === rightmostId);
            const { w: lw } = diShapeSizeForLayout(lastInLane?.type);
            const { w: cw } = diShapeSizeForLayout(element.type);
            baseX = maxCenterX + lw / 2 + LANE_FLOW_GAP_X + cw / 2;
          } else {
            baseX = laneBox ? laneBox.x + 120 : participantPos ? participantPos.x + 100 : 100;
          }
        } else {
          baseX = laneBox ? laneBox.x + 120 : participantPos ? participantPos.x + 100 : 100;
        }
        const baseY = laneBox ? laneBox.y + laneBox.h / 2 : participantPos ? participantPos.y + participantPos.h / 2 : 200;
        finalPos = { x: baseX, y: baseY };
        elementPositionMap.set(element.id, finalPos);
        fallbackIndexByProcess.set(processInfo.processId, (fallbackIndexByProcess.get(processInfo.processId) || 0) + 1);
      }
      const { w, h } = diShapeSizeForLayout(element.type);
      const isGateway = element.type && element.type.includes('Gateway');
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
      }
      if (elLaneBox) {
        const minY = elLaneBox.y + 5;
        const maxY = elLaneBox.y + elLaneBox.h - h - 5;
        if (y < minY) y = minY;
        if (y > maxY) y = maxY;
      }
      if (y < 0) y = 0;
      // Центры для рёбер BPMNEdge должны совпадать с dc:Bounds после clamp по дорожке
      elementPositionMap.set(element.id, { x: x + w / 2, y: y + h / 2 });
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

  /**
   * После финальных X веток (колонки): междорожечная цель по центру под источником.
   * nextElementId в дереве пула имеет приоритет над sequenceFlows. Y не трогаем — сохраняем ряды веток.
   */
  function applyCrossLaneHorizontalRealign(processInfo) {
    const lanes = processInfo?.lanes || [];
    if (lanes.length < 2 || !processInfo) return;
    const elementByIdAlign = new Map((processInfo.elements || []).map((e) => [e.id, e]));
    const processElIds = new Set((processInfo.elements || []).map((e) => e.id));
    const ppos = participantPosByProcess.get(processInfo.processId);
    const laneInnerLeft = (ppos?.x ?? 0) + 40;
    const fallbackY = ppos ? ppos.y + ppos.h / 2 : 200;

    const walkNextElementCrossLane = (elements, preferredCenterX) => {
      if (!elements) return;
      elements.forEach((el) => {
        if (
          el?.id &&
          el.nextElementId &&
          String(el.nextElementId).trim() &&
          processElIds.has(el.nextElementId)
        ) {
          const sl = laneIdByElement.get(el.id);
          const tl = laneIdByElement.get(el.nextElementId);
          if (sl && tl && sl !== tl) {
            const sp = elementPositionMap.get(el.id);
            if (sp && typeof sp.x === 'number') {
              preferredCenterX.set(el.nextElementId, sp.x);
            }
          }
        }
        el.branches?.forEach((b) => walkNextElementCrossLane(b.path, preferredCenterX));
      });
    };

    for (let pass = 0; pass < 2; pass++) {
      const preferredCenterX = new Map();
      processInfo.pool?.lanes?.forEach((lane) => walkNextElementCrossLane(lane.elements, preferredCenterX));

      sequenceFlows.forEach((f) => {
        if (!processElIds.has(f.sourceRef) || !processElIds.has(f.targetRef)) return;
        if (f.sourceRef.endsWith('-join') || f.targetRef.endsWith('-join')) return;
        const sl = laneIdByElement.get(f.sourceRef);
        const tl = laneIdByElement.get(f.targetRef);
        if (!sl || !tl || sl === tl) return;
        const sp = elementPositionMap.get(f.sourceRef);
        if (!sp || typeof sp.x !== 'number') return;
        if (!preferredCenterX.has(f.targetRef)) {
          preferredCenterX.set(f.targetRef, sp.x);
        }
      });

      // Параллельный шлюз: первая задача на «чужой» дорожке — в той же колонке, что и первая задача ветви в дорожке шлюза (как HR / IT на эталоне).
      processInfo.elements.forEach((el) => {
        if (!el?.id || !isParallelGatewayType(el.type)) return;
        const outs = sequenceFlows.filter(
          (f) =>
            processElIds.has(f.sourceRef) &&
            processElIds.has(f.targetRef) &&
            f.sourceRef === el.id
        );
        if (outs.length < 2) return;
        const forkLane = laneIdByElement.get(el.id);
        if (!forkLane) return;
        let anchorX = null;
        outs.forEach((f) => {
          if (laneIdByElement.get(f.targetRef) === forkLane) {
            const p = elementPositionMap.get(f.targetRef);
            if (p && typeof p.x === 'number') anchorX = p.x;
          }
        });
        if (anchorX == null) return;
        outs.forEach((f) => {
          const tl = laneIdByElement.get(f.targetRef);
          if (tl && tl !== forkLane) {
            preferredCenterX.set(f.targetRef, anchorX);
          }
        });
      });

      lanes.forEach((lane) => {
        const elems = processInfo.laneElementMap.get(lane.id) || [];
        const lb = laneBounds.get(lane.id);
        const centerY = lb ? lb.y + lb.h / 2 : fallbackY;
        elems.forEach((elemId, idx) => {
          if (elemId.endsWith('-join')) return;
          const el = elementByIdAlign.get(elemId);
          const { w } = diShapeSizeForLayout(el?.type);
          let cx;
          if (preferredCenterX.has(elemId)) {
            cx = preferredCenterX.get(elemId);
          } else if (idx === 0) {
            const cur = elementPositionMap.get(elemId);
            cx = typeof cur?.x === 'number' ? cur.x : laneInnerLeft + 100;
          } else {
            const prevId = elems[idx - 1];
            const prevP = elementPositionMap.get(prevId);
            const prevE = elementByIdAlign.get(prevId);
            const { w: pw } = diShapeSizeForLayout(prevE?.type);
            if (!prevP || typeof prevP.x !== 'number') {
              cx = laneInnerLeft + 100;
            } else {
              cx = prevP.x + pw / 2 + LANE_FLOW_GAP_X + w / 2;
            }
          }
          if (idx > 0) {
            const prevId = elems[idx - 1];
            const prevP = elementPositionMap.get(prevId);
            const prevE = elementByIdAlign.get(prevId);
            const { w: pw } = diShapeSizeForLayout(prevE?.type);
            if (prevP && typeof prevP.x === 'number') {
              const minCx = prevP.x + pw / 2 + LANE_FLOW_GAP_X + w / 2;
              if (cx < minCx) cx = minCx;
            }
          }
          const prevPos = elementPositionMap.get(elemId);
          const cy = prevPos && typeof prevPos.y === 'number' ? prevPos.y : centerY;
          elementPositionMap.set(elemId, { x: cx, y: cy });
        });
      });
    }
  }

  function syncShapesFromElementPositions(processInfo) {
    processInfo.elements.forEach((el) => {
      if (!el.id || el.id.endsWith('-join')) return;
      const pos = elementPositionMap.get(el.id);
      const size = elementSizeMap.get(el.id);
      if (!pos || !size) return;
      let x = pos.x - size.w / 2;
      let y = pos.y - size.h / 2;
      const elLaneId = laneIdByElement.get(el.id);
      const elLaneBox = elLaneId ? laneBounds.get(elLaneId) : null;
      if (elLaneBox) {
        const minY = elLaneBox.y + 5;
        const maxY = elLaneBox.y + elLaneBox.h - size.h - 5;
        if (y < minY) y = minY;
        if (y > maxY) y = maxY;
      }
      if (y < 0) y = 0;
      elementPositionMap.set(el.id, { x: x + size.w / 2, y: y + size.h / 2 });
      replaceBpmnShapeBounds(planeShapes, el.id, x, y, size.w, size.h);
    });
  }

  processes.forEach((processInfo) => {
    if ((processInfo.lanes || []).length >= 2) {
      applyCrossLaneHorizontalRealign(processInfo);
      syncShapesFromElementPositions(processInfo);
    }
  });

  // Join-шлюз: exclusive — как раньше (симметрия + правый край веток); parallel — по колонке самой правой завершающей задачи, иначе join уезжает вправо и ломает вертикаль с нижней дорожки.
  const JOIN_GAP = 52;
  processes.forEach((processInfo) => {
    processInfo.elements.forEach((element) => {
      if (!element.id || !element.id.endsWith('-join')) return;
      const forkId = element.id.slice(0, -'-join'.length);
      const forkPos = elementPositionMap.get(forkId);
      if (!forkPos) return;
      const incoming = sequenceFlows.filter((f) => f.targetRef === element.id);
      let maxRight = forkPos.x + 25;
      let maxIncomingCenterX = forkPos.x;
      incoming.forEach((f) => {
        const srcPos = elementPositionMap.get(f.sourceRef);
        const srcSize = elementSizeMap.get(f.sourceRef);
        if (!srcPos || !srcSize) return;
        const right = srcPos.x + srcSize.w / 2;
        if (right > maxRight) maxRight = right;
        maxIncomingCenterX = Math.max(maxIncomingCenterX, srcPos.x);
      });
      const joinW = 50;
      const forkEl = processInfo.elements.find((e) => e.id === forkId);
      const forkIsParallel = forkEl && isParallelGatewayType(forkEl.type);
      let joinCenterX;
      if (forkIsParallel) {
        const minJoinCenterX = forkPos.x + 50 + JOIN_GAP;
        joinCenterX = Math.max(maxIncomingCenterX, minJoinCenterX);
      } else {
        const symmetricJoinCenterX = forkPos.x + 2 * COLUMN_SPACING + joinW / 2;
        const joinCenterXFromContent = maxRight + JOIN_GAP + joinW / 2;
        joinCenterX = Math.max(symmetricJoinCenterX, joinCenterXFromContent);
      }
      const joinCenterY = forkPos.y;
      elementPositionMap.set(element.id, { x: joinCenterX, y: joinCenterY });
      const laneId = laneIdByElement.get(forkId);
      if (laneId) laneIdByElement.set(element.id, laneId);
    });
  });

  // Линейный хвост после join (join → задача → … → конец): тот же зазор LANE_FLOW_GAP_X между фигурами
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
      const joinLaneId = laneIdByElement.get(element.id);
      const joinLaneBox = joinLaneId ? laneBounds.get(joinLaneId) : null;
      const joinLaneMidY = joinLaneBox ? joinLaneBox.y + joinLaneBox.h / 2 : joinPos.y;

      let prevCenterX = joinPos.x;
      let prevW = 50;
      let prevId = element.id;
      let curId = outFlows[0].targetRef;
      const visited = new Set();
      while (curId && !visited.has(curId)) {
        visited.add(curId);
        const el = processInfo.elements.find((e) => e.id === curId);
        if (!el) break;
        if (el.id.endsWith('-join')) break;
        const { w, h } = diShapeSizeForLayout(el.type);
        const prevLane = laneIdByElement.get(prevId);
        const curLane = laneIdByElement.get(curId);
        const crossLaneFromPrev =
          prevLane &&
          curLane &&
          prevLane !== curLane &&
          sequenceFlows.some(
            (f) =>
              f.sourceRef === prevId &&
              f.targetRef === curId &&
              processElementIds.has(f.sourceRef) &&
              processElementIds.has(f.targetRef)
          );
        const prevPosForX = elementPositionMap.get(prevId);
        let centerX;
        if (crossLaneFromPrev && prevPosForX && typeof prevPosForX.x === 'number') {
          centerX = prevPosForX.x;
        } else {
          centerX = prevCenterX + prevW / 2 + LANE_FLOW_GAP_X + w / 2;
        }
        prevCenterX = centerX;
        prevW = w;
        prevId = curId;
        const curLaneId = laneIdByElement.get(curId);
        const curLaneBox = curLaneId ? laneBounds.get(curLaneId) : null;
        const centerY = curLaneBox ? curLaneBox.y + curLaneBox.h / 2 : joinLaneMidY;
        let x = centerX - w / 2;
        let y = centerY - h / 2;
        if (curLaneBox) {
          const minY = curLaneBox.y + 5;
          const maxY = curLaneBox.y + curLaneBox.h - h - 5;
          if (y < minY) y = minY;
          if (y > maxY) y = maxY;
        }
        if (y < 0) y = 0;
        const finalCenterY = y + h / 2;
        elementPositionMap.set(curId, { x: centerX, y: finalCenterY });
        elementSizeMap.set(curId, { w, h });
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
    if ((processInfo.lanes || []).length >= 2) {
      applyCrossLaneHorizontalRealign(processInfo);
      syncShapesFromElementPositions(processInfo);
    }
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
    const considerNodeForBounds = (nodeId, extra = null) => {
      if (!nodeId) return;
      const pos = elementPositionMap.get(nodeId);
      const size = elementSizeMap.get(nodeId);
      if (!pos || !size) return;
      const right = pos.x + size.w / 2;
      let bottom = pos.y + size.h / 2;
      if (extra && typeof extra.bottom === 'number') bottom += extra.bottom;
      if (extra && typeof extra.right === 'number') {
        const r2 = right + extra.right;
        if (r2 > maxX) maxX = r2;
      }
      if (right > maxX) maxX = right;
      if (bottom > maxY) maxY = bottom;
    };

    processInfo.elements.forEach((el) => {
      const pos = elementPositionMap.get(el.id);
      const size = elementSizeMap.get(el.id);
      if (!pos || !size) return;
      const right = pos.x + size.w / 2;
      const bottom = pos.y + size.h / 2;
      if (right > maxX) maxX = right;
      if (bottom > maxY) maxY = bottom;
    });

    // IMPORTANT: artifacts (data objects / annotations) also must fit inside lane/pool bounds.
    // bpmn-js renders external labels for data objects below the shape — account for that height.
    (processInfo.artifacts || []).forEach((a) => {
      if (!a?.id) return;
      const t = a.type;
      const hasLabel = a.label != null && String(a.label).trim() !== '';
      const labelPadBottom =
        hasLabel && (t === 'dataObjectReference' || t === 'dataStoreReference')
          ? 26
          : 0;
      considerNodeForBounds(a.id, { bottom: labelPadBottom });
    });
    if (!Number.isFinite(maxX)) return;

    const EXTRA_SAFETY_PAD = 18;
    const newW = Math.max(meta.initialWidth, maxX - meta.participantX + POOL_CONTENT_PAD + EXTRA_SAFETY_PAD);
    const newH = Math.max(meta.initialHeight, maxY - meta.participantY + POOL_CONTENT_PAD + EXTRA_SAFETY_PAD);
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
      if (el.type && isGatewayType(el.type) && el.outgoing && el.outgoing.length > 1) {
        gatewayOutgoing.set(el.id, el.outgoing);
      }
    });
  });

  const elementTypeById = new Map();
  processes.forEach((processInfo) => {
    processInfo.elements.forEach((el) => {
      if (el.id) elementTypeById.set(el.id, el.type);
    });
  });

  // --- Artifacts (data objects, data stores, text annotations) ---
  const allArtifacts = [];
  processes.forEach((processInfo) => {
    (processInfo.artifacts || []).forEach((a) => allArtifacts.push(a));
  });
  // Include artifacts in type lookup (needed for association routing)
  allArtifacts.forEach((a) => {
    if (a?.id && a.type) elementTypeById.set(a.id, a.type);
  });
  const assocList = [];
  processes.forEach((processInfo) => {
    (processInfo.associations || []).forEach((a) => assocList.push(a));
  });
  const artifactIds = new Set(allArtifacts.map((a) => a && a.id).filter(Boolean));
  const associationsForArtifact = new Map(); // artifactId -> [{ otherId, assoc }]
  assocList.forEach((a) => {
    if (!a?.sourceRef || !a.targetRef) return;
    if (artifactIds.has(a.sourceRef)) {
      const arr = associationsForArtifact.get(a.sourceRef) || [];
      arr.push({ otherId: a.targetRef, assoc: a });
      associationsForArtifact.set(a.sourceRef, arr);
    }
    if (artifactIds.has(a.targetRef)) {
      const arr = associationsForArtifact.get(a.targetRef) || [];
      arr.push({ otherId: a.sourceRef, assoc: a });
      associationsForArtifact.set(a.targetRef, arr);
    }
  });
  /** Левый край следующего слота в ряду под якорем (dataObject + dataStore — один ряд, без наложений). */
  const artifactBelowNextLeft = new Map();
  /** Левый край следующей аннотации в ряду над якорем (горизонтально). */
  const artifactAboveNextLeft = new Map();

  const BELOW_ROW_GAP = 14;
  const BELOW_FIRST_CENTER_X_BIAS = 14;
  const BELOW_ROW_Y_OFFSET = 34;

  const ANN_ROW_GAP = 12;
  const ANN_FIRST_LEFT_INSET = 14;
  const ANN_ROW_Y_CLEAR = 22;

  allArtifacts.forEach((a) => {
    if (!a?.id || !a.type) return;
    const links = associationsForArtifact.get(a.id) || [];
    const anchorId = links.length ? links[0].otherId : null;
    const anchorPos = anchorId ? elementPositionMap.get(anchorId) : null;
    const anchorSize = anchorId ? (elementSizeMap.get(anchorId) || { w: 36, h: 36 }) : { w: 36, h: 36 };

    function sizeForTextAnnotation(text) {
      const raw = text != null ? String(text) : '';
      const t = raw.trim();
      if (!t) return { w: 120, h: 44 };
      // Approx monospace-ish measurement: ~7px per char + padding, clamp to sane BPMN sizes
      const maxCharsPerLine = 26;
      const lines = Math.max(1, Math.ceil(t.length / maxCharsPerLine));
      const longest = Math.min(maxCharsPerLine, t.length);
      const w = Math.max(120, Math.min(260, 24 + longest * 7));
      const h = Math.max(44, Math.min(160, 26 + lines * 18));
      return { w, h };
    }

    const size =
      a.type === 'textAnnotation'
        ? sizeForTextAnnotation(a.label)
        : a.type === 'dataStoreReference'
          ? { w: 50, h: 50 }
          : { w: 36, h: 50 }; // dataObjectReference — как в bpmn-js
    elementSizeMap.set(a.id, size);

    let x = anchorPos ? anchorPos.x : 220;
    let y = anchorPos ? anchorPos.y : 220;

    if (anchorPos) {
      if (a.type === 'textAnnotation') {
        const aid = anchorId || 'none';
        let leftEdge = artifactAboveNextLeft.get(aid);
        if (leftEdge === undefined) {
          leftEdge = anchorPos.x + anchorSize.w / 2 + ANN_FIRST_LEFT_INSET;
        }
        x = leftEdge + size.w / 2;
        y = anchorPos.y - anchorSize.h / 2 - size.h / 2 - ANN_ROW_Y_CLEAR;
        artifactAboveNextLeft.set(aid, leftEdge + size.w + ANN_ROW_GAP);
      } else {
        // dataObjectReference и dataStoreReference — одна горизонтальная линия под элементом
        const aid = anchorId || 'none';
        let leftEdge = artifactBelowNextLeft.get(aid);
        if (leftEdge === undefined) {
          leftEdge = anchorPos.x + BELOW_FIRST_CENTER_X_BIAS - size.w / 2;
        }
        x = leftEdge + size.w / 2;
        y = anchorPos.y + anchorSize.h / 2 + size.h / 2 + BELOW_ROW_Y_OFFSET;
        artifactBelowNextLeft.set(aid, leftEdge + size.w + BELOW_ROW_GAP);
      }
    }

    elementPositionMap.set(a.id, { x, y });
    pushShape(a.id, a.id, x - size.w / 2, y - size.h / 2, size.w, size.h);
  });

  // After artifacts are positioned, ensure pools/lanes are large enough (including external labels).
  // bpmn-js renders external labels for data objects below the shape; expand lane/pool so they never overflow.
  const AFTER_ARTIFACT_PAD = 44;
  participantDiMeta.forEach((meta) => {
    if (!meta.processId) return;
    const processInfo = [...processes.values()].find((p) => p.processId === meta.processId);
    if (!processInfo) return;
    let maxX = -Infinity;
    let maxY = -Infinity;
    function consider(nodeId, extraBottom = 0) {
      if (!nodeId) return;
      const pos = elementPositionMap.get(nodeId);
      const size = elementSizeMap.get(nodeId);
      if (!pos || !size) return;
      const right = pos.x + size.w / 2;
      const bottom = pos.y + size.h / 2 + (extraBottom || 0);
      if (right > maxX) maxX = right;
      if (bottom > maxY) maxY = bottom;
    }
    processInfo.elements.forEach((el) => consider(el?.id, 0));
    (processInfo.artifacts || []).forEach((a) => {
      const t = a?.type;
      const hasLabel = a?.label != null && String(a.label).trim() !== '';
      const extraBottom =
        hasLabel && (t === 'dataObjectReference' || t === 'dataStoreReference') ? 34 : 0;
      consider(a?.id, extraBottom);
    });
    if (!Number.isFinite(maxX) || !Number.isFinite(maxY)) return;

    const newW = Math.max(meta.initialWidth, maxX - meta.participantX + POOL_CONTENT_PAD + AFTER_ARTIFACT_PAD);
    const newH = Math.max(meta.initialHeight, maxY - meta.participantY + POOL_CONTENT_PAD + AFTER_ARTIFACT_PAD);
    const deltaH = newH - meta.initialHeight;

    replaceBpmnShapeBounds(planeShapes, meta.participantId, meta.participantX, meta.participantY, newW, newH);
    participantPosByProcess.set(meta.processId, { x: meta.participantX, y: meta.participantY, w: newW, h: newH });

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

  // Edges for sequence flows
  sequenceFlows.forEach((flow) => {
    const src = elementPositionMap.get(flow.sourceRef);
    const tgt = elementPositionMap.get(flow.targetRef);
    if (!src || !tgt) return;
    const srcSize = elementSizeMap.get(flow.sourceRef) || { w: 36, h: 36 };
    const tgtSize = elementSizeMap.get(flow.targetRef) || { w: 36, h: 36 };
    const targetForLabel = { x: tgt.x, y: tgt.y, w: tgtSize.w, h: tgtSize.h };
    const outList = gatewayOutgoing.get(flow.sourceRef);
    const isFromGatewayWithBranches = outList && outList.length > 1;

    if (isFromGatewayWithBranches) {
      const outIndex = outList.indexOf(flow.id);
      const nOut = outList.length;
      const srcGwType = elementTypeById.get(flow.sourceRef);
      const isParallelSplit = Boolean(srcGwType && isParallelGatewayType(srcGwType));
      const srcLaneG = laneIdByElement.get(flow.sourceRef);
      const tgtLaneG = laneIdByElement.get(flow.targetRef);
      // Выход из верхней/нижней (и промежуточных при 3+) точек ромба по вертикали, не с правого центра —
      // при двух ветках: сверху и снизу шлюза.
      const exitX = src.x;
      const exitY =
        nOut <= 1 ? src.y : src.y - srcSize.h / 2 + (outIndex / (nOut - 1)) * srcSize.h;
      const tgtCenterY = tgt.y;
      const tgtLeft = tgt.x - tgtSize.w / 2;
      const tgtTopY = tgt.y - tgtSize.h / 2;
      /** На сколько поднять «коридор» верхней ветки над ромбом, чтобы не сливаться с горизонталью нижней. */
      const GATEWAY_TOP_BRANCH_UP = 52;

      let waypoints;
      const srcRightGw = src.x + srcSize.w / 2;
      // Параллельный шлюз: верхняя ветка в той же дорожке — горизонталь с правого ребра (bpmn-io), не через верхнюю вершину.
      if (
        nOut === 2 &&
        isParallelSplit &&
        outIndex === 0 &&
        srcLaneG &&
        tgtLaneG &&
        srcLaneG === tgtLaneG &&
        tgtLeft >= srcRightGw - 2
      ) {
        waypoints = [
          { x: srcRightGw, y: src.y },
          { x: tgtLeft, y: tgt.y },
        ];
      } else if (
        nOut === 2 &&
        isParallelSplit &&
        outIndex === 1 &&
        srcLaneG &&
        tgtLaneG &&
        srcLaneG !== tgtLaneG
      ) {
        const exitYBottom = src.y + srcSize.h / 2;
        waypoints = [
          { x: src.x, y: exitYBottom },
          { x: src.x, y: tgt.y },
          { x: tgtLeft, y: tgt.y },
        ];
      } else if (nOut === 2) {
        const exitYTop = src.y - srcSize.h / 2;
        const exitYBottom = src.y + srcSize.h / 2;
        if (outIndex === 0) {
          // Верхняя ветка к верху цели. Прямой вертикалью вниз от верхнего выхода часто пересекаем Y нижнего
          // выхода (там же начинается «Нет») — делаем обход вверх → направо → вниз, как на эталонной схеме.
          const straightDownCrossesLowerExit =
            exitYTop < exitYBottom && exitYBottom < tgtTopY;
          if (straightDownCrossesLowerExit && tgtLeft >= exitX - 2) {
            const srcLaneId = laneIdByElement.get(flow.sourceRef);
            const lb = srcLaneId ? laneBounds.get(srcLaneId) : null;
            const laneTopY = lb ? lb.y + 8 : 0;
            let yRidge = exitYTop - GATEWAY_TOP_BRANCH_UP;
            if (yRidge < laneTopY) yRidge = laneTopY;
            waypoints = [
              { x: exitX, y: exitY },
              { x: exitX, y: yRidge },
              { x: tgtLeft, y: yRidge },
              { x: tgtLeft, y: tgtTopY },
            ];
          } else if (tgtLeft < exitX - 2) {
            waypoints = [
              { x: exitX, y: exitY },
              { x: exitX, y: tgtCenterY },
              { x: tgtLeft, y: tgtCenterY },
            ];
          } else {
            // Две разные цели (шаблон «простое условие»): вход в левый центр задачи, не в верхнюю границу.
            waypoints = [
              { x: exitX, y: exitY },
              { x: exitX, y: tgtCenterY },
              { x: tgtLeft, y: tgtCenterY },
            ];
          }
        } else {
          // Нижняя ветка: вертикаль к Y центра цели, затем горизонталь (как до правок для split+join).
          waypoints = [
            { x: exitX, y: exitY },
            { x: exitX, y: tgtCenterY },
            { x: tgtLeft, y: tgtCenterY },
          ];
        }
      } else {
        // Три и более веток: верх/низ — из вершин ромба (exitX); промежуточные — с правого ребра (как в BPMN), не из центра.
        const srcRight = src.x + srcSize.w / 2;
        const atSideVertex = outIndex > 0 && outIndex < nOut - 1;
        const exitAttachX = atSideVertex ? srcRight : exitX;
        if (Math.abs(exitY - tgtCenterY) < 1) {
          waypoints = [
            { x: exitAttachX, y: exitY },
            { x: tgtLeft, y: tgtCenterY },
          ];
        } else {
          waypoints = [
            { x: exitAttachX, y: exitY },
            { x: exitAttachX, y: tgtCenterY },
            { x: tgtLeft, y: tgtCenterY },
          ];
        }
      }
      pushEdgeOrthogonal(flow.id, flow.id, waypoints, flow.condition, targetForLabel);
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
        pushEdgeOrthogonal(flow.id, flow.id, waypoints, flow.condition, targetForLabel);
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
            // Источник ниже join (напр. задача на нижней дорожке): сначала вертикаль по центру задачи, без длинной горизонтали на высоте midY.
            const joinBottomY = tgt.y + tgtSize.h / 2;
            const srcTopY = src.y - srcSize.h / 2;
            if (Math.abs(src.x - tgt.x) < 10) {
              waypoints = [
                { x: src.x, y: srcTopY },
                { x: tgt.x, y: joinBottomY },
              ];
            } else {
              waypoints = [
                { x: src.x, y: srcTopY },
                { x: src.x, y: joinBottomY },
                { x: tgt.x, y: joinBottomY },
              ];
            }
          }
          pushEdgeOrthogonal(flow.id, flow.id, waypoints, flow.condition, targetForLabel);
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
          pushEdgeOrthogonal(flow.id, flow.id, waypoints, flow.condition, targetForLabel);
        } else if (sameLane && yDiff > 2) {
          // Одна дорожка, разный Y (например после задач веток, не join): L-образная ломаная
          const tgtType = elementTypeById.get(flow.targetRef);
          const incomingToTgt = sequenceFlows.filter((f) => f.targetRef === flow.targetRef).length;
          const tgtBottomY = tgt.y + tgtSize.h / 2;
          // Слияние в задачу снизу (напр. «Ответ получен» → «Объяснить»): выход справа по центру, затем вправо к колонке цели, вход в нижний центр.
          if (
            tgtType &&
            TASK_LIKE_TYPES.has(tgtType) &&
            src.y > tgt.y &&
            incomingToTgt >= 2
          ) {
            const waypoints = [
              { x: srcRight, y: src.y },
              { x: tgt.x, y: src.y },
              { x: tgt.x, y: tgtBottomY },
            ];
            pushEdgeOrthogonal(flow.id, flow.id, waypoints, flow.condition, targetForLabel);
          } else {
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
            pushEdgeOrthogonal(flow.id, flow.id, waypoints, flow.condition, targetForLabel);
          }
        } else {
          const start = { x: srcRight, y: src.y };
          const end = { x: tgtLeft, y: tgt.y };
          pushEdge(flow.id, flow.id, start, end, flow.condition, targetForLabel);
        }
      }
    }
  });

  // Edges for associations (text annotations) and data associations (dataInput/dataOutput)
  assocList.forEach((a) => {
    if (!a?.sourceRef || !a.targetRef) return;

    const srcType = elementTypeById.get(a.sourceRef);
    const tgtType = elementTypeById.get(a.targetRef);
    const involvesTextAnnotation = srcType === 'textAnnotation' || tgtType === 'textAnnotation';
    const involvesData =
      srcType === 'dataObjectReference' || srcType === 'dataStoreReference' ||
      tgtType === 'dataObjectReference' || tgtType === 'dataStoreReference';

    // --- TextAnnotation: element(top center) -> annotation(bottom center)
    if (involvesTextAnnotation) {
      if (!a.id) return;
      let srcRef = a.sourceRef;
      let tgtRef = a.targetRef;
      if (srcType === 'textAnnotation' && tgtType !== 'textAnnotation') {
        srcRef = a.targetRef;
        tgtRef = a.sourceRef;
      }
      const src = elementPositionMap.get(srcRef);
      const tgt = elementPositionMap.get(tgtRef);
      if (!src || !tgt) return;
      const srcSize = elementSizeMap.get(srcRef) || { w: 36, h: 36 };
      const tgtSize = elementSizeMap.get(tgtRef) || { w: 120, h: 44 };
      const start = { x: src.x, y: src.y - srcSize.h / 2 };
      const end = { x: tgt.x, y: tgt.y + tgtSize.h / 2 };
      const targetForLabel = { x: tgt.x, y: tgt.y, w: tgtSize.w, h: tgtSize.h };
      pushEdge(a.id, a.id, start, end, '', targetForLabel);
      return;
    }

    // --- Data associations: bottom center of element -> top center of data, slightly to the right (orthogonal)
    if (involvesData) {
      const dataId =
        (srcType === 'dataObjectReference' || srcType === 'dataStoreReference') ? a.sourceRef
          : (tgtType === 'dataObjectReference' || tgtType === 'dataStoreReference') ? a.targetRef
            : null;
      const otherId = dataId === a.sourceRef ? a.targetRef : a.sourceRef;
      if (!dataId || !otherId) return;

      const assocElementId = dataOutputBpmnIdByAssocRef.get(a);
      if (!assocElementId) return;

      const srcRef = otherId;
      const tgtRef = dataId;

      const src = elementPositionMap.get(srcRef);
      const tgt = elementPositionMap.get(tgtRef);
      if (!src || !tgt) return;
      const srcSize = elementSizeMap.get(srcRef) || { w: 36, h: 36 };
      const tgtSize = elementSizeMap.get(tgtRef) || { w: 50, h: 50 };

      // Straight diagonal. Keep it short and outside shapes:
      // - Output (element -> data): element bottom -> data top
      // - Input  (data -> element): data top -> element bottom
      const srcIsData = elementTypeById.get(srcRef) === 'dataObjectReference' || elementTypeById.get(srcRef) === 'dataStoreReference';
      const tgtIsData = elementTypeById.get(tgtRef) === 'dataObjectReference' || elementTypeById.get(tgtRef) === 'dataStoreReference';

      const start = srcIsData
        ? {
            x: Math.round(src.x + srcSize.w * 0.10),
            y: Math.round(src.y - srcSize.h / 2),
          } // from top of data
        : {
            x: Math.round(src.x - srcSize.w * 0.10),
            y: Math.round(src.y + srcSize.h / 2),
          }; // from bottom of element

      const end = tgtIsData
        ? {
            x: Math.round(tgt.x + tgtSize.w * 0.10),
            y: Math.round(tgt.y - tgtSize.h / 2),
          } // to top of data
        : {
            x: Math.round(tgt.x - tgtSize.w * 0.10),
            y: Math.round(tgt.y + tgtSize.h / 2),
          }; // to bottom of element
      const targetForLabel = { x: tgt.x, y: tgt.y, w: tgtSize.w, h: tgtSize.h };
      pushEdge(assocElementId, assocElementId, start, end, '', targetForLabel);
      return;
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
    subProcess: 'subProcess',
    callActivity: 'callActivity',
    exclusiveGateway: 'exclusiveGateway',
    inclusiveGateway: 'inclusiveGateway',
    parallelGateway: 'parallelGateway',
    eventBasedGateway: 'eventBasedGateway',
    complexGateway: 'complexGateway',
    intermediateThrowEvent: 'intermediateThrowEvent',
    intermediateCatchEvent: 'intermediateCatchEvent',
    dataObjectReference: 'dataObjectReference',
    dataStoreReference: 'dataStoreReference',
    textAnnotation: 'textAnnotation',
  };
  return mapping[type] || 'task';
}

function isTaskLikeType(type) {
  return TASK_LIKE_TYPES.has(type);
}

/** Один flowNode в XML (подпроцесс — с минимальной внутренней диаграммой start→end). */
function buildFlowNodeXml(element, indent = '    ', opts = null) {
  const childIndent = `${indent}  `;
  if (element.type === 'subProcess') {
    const innerStart = `${element.id}_inner_start`;
    const innerEnd = `${element.id}_inner_end`;
    const innerFlow = `${element.id}_inner_sf`;
    let s = `${indent}<subProcess id="${element.id}"`;
    if (element.label) s += ` name="${escapeXml(element.label)}"`;
    s += `>\n`;
    element.incoming.forEach((flowId) => {
      s += `${childIndent}<incoming>${flowId}</incoming>\n`;
    });
    element.outgoing.forEach((flowId) => {
      s += `${childIndent}<outgoing>${flowId}</outgoing>\n`;
    });
    s += `${childIndent}<startEvent id="${innerStart}" name="${escapeXml('Начало подпроцесса')}"/>\n`;
    s += `${childIndent}<endEvent id="${innerEnd}" name="${escapeXml('Конец подпроцесса')}"/>\n`;
    s += `${childIndent}<sequenceFlow id="${innerFlow}" sourceRef="${innerStart}" targetRef="${innerEnd}"/>\n`;
    s += `${indent}</subProcess>\n`;
    return s;
  }

  const tagName = mapElementTypeToTag(element.type);
  let s = `${indent}<${tagName} id="${element.id}"`;
  if (element.label) {
    s += ` name="${escapeXml(element.label)}"`;
  }
  if (element.defaultFlow) {
    s += ` default="${element.defaultFlow}"`;
  }
  s += `>\n`;

  element.incoming.forEach((flowId) => {
    s += `${childIndent}<incoming>${flowId}</incoming>\n`;
  });

  element.outgoing.forEach((flowId) => {
    s += `${childIndent}<outgoing>${flowId}</outgoing>\n`;
  });

  const dataAssocs = opts?.dataAssociationsByElementId?.get(element.id) || [];
  dataAssocs.forEach((da) => {
    if (!da?.id || !da.kind || !da.otherRef) return;
    if (da.kind === 'dataInputAssociation') {
      s += `${childIndent}<dataInputAssociation id="${da.id}">\n`;
      s += `${childIndent}  <sourceRef>${da.otherRef}</sourceRef>\n`;
      s += `${childIndent}</dataInputAssociation>\n`;
    } else if (da.kind === 'dataOutputAssociation') {
      s += `${childIndent}<dataOutputAssociation id="${da.id}">\n`;
      s += `${childIndent}  <targetRef>${da.otherRef}</targetRef>\n`;
      s += `${childIndent}</dataOutputAssociation>\n`;
    }
  });

  if (element.eventDefinition && element.eventDefinition !== 'none') {
    const eventDefTag = mapEventDefinitionToTag(element.eventDefinition);
    if (eventDefTag === 'linkEventDefinition') {
      const linkName = element.label != null && String(element.label).trim() !== ''
        ? ` name="${escapeXml(String(element.label).trim())}"`
        : ' name=""';
      s += `${childIndent}<${eventDefTag} id="${eventDefTag}_${element.id}"${linkName}/>\n`;
    } else {
      s += `${childIndent}<${eventDefTag} id="${eventDefTag}_${element.id}"/>\n`;
    }
  }

  s += `${indent}</${tagName}>\n`;
  return s;
}

function mapEventDefinitionToTag(eventDef) {
  const mapping = {
    timer: 'timerEventDefinition',
    message: 'messageEventDefinition',
    signal: 'signalEventDefinition',
    link: 'linkEventDefinition',
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

function hasExplicitNextElementContinuation(el) {
  return el && el.nextElementId && String(el.nextElementId).trim().length > 0;
}

/**
 * Подсчёт количества входящих «стрелок» в события конца по структурной модели
 * (без генерации полного BPMN-графа).
 *
 * Правило: стилистически нежелательно сводить все завершения в одно событие конца —
 * вместо этого лучше явно моделировать разные варианты завершения.
 *
 * Здесь считаем «стрелками»:
 * - неявные переходы в пределах массива элементов (следующий элемент в дорожке/ветви);
 * - явные переходы через nextElementId;
 * - переходы от шлюза к первому элементу ветви, если он является событием конца;
 * - переходы от шлюза к явному целевому элементу branch.next, если он является событием конца.
 */
function incrementMapCounter(map, key) {
  if (!key) return;
  const prev = map.get(key) || 0;
  map.set(key, prev + 1);
}

function collectEndEventIncomingCountsInPath(elements, incomingCounts, elementById) {
  if (!elements || !Array.isArray(elements)) return;

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (!el || !el.type) continue;

    const nextInList = i + 1 < elements.length ? elements[i + 1] : null;

    // Шлюзы: считаем переходы от шлюза к первым элементам ветвей / branch.next
    if (isGatewayType(el.type)) {
      el.branches?.forEach((branch) => {
        const branchPath = branch?.path || [];

        if (!branchPath.length) {
          // Пустая ветвь: используем branch.next, если он указывает на событие конца
          const targetId = branch?.next;
          if (targetId && elementById.has(targetId)) {
            const targetEl = elementById.get(targetId);
            if (targetEl && targetEl.type === 'endEvent') {
              incrementMapCounter(incomingCounts, targetEl.id);
            }
          }
          return;
        }

        const firstBranchEl = branchPath[0];
        if (firstBranchEl && firstBranchEl.type === 'endEvent') {
          incrementMapCounter(incomingCounts, firstBranchEl.id);
        }

        // Рекурсивно обходим вложенный путь ветви
        collectEndEventIncomingCountsInPath(branchPath, incomingCounts, elementById);
      });

      // У самого шлюза стрелки до событий конца считаются через его ветви, поэтому
      // здесь не добавляем переход к nextInList.
      continue;
    }

    // Событие конца не имеет исходящих потоков
    if (el.type === 'endEvent') {
      continue;
    }

    // Явный переход «Переход к элементу»
    const explicitNextId = hasExplicitNextElementContinuation(el) ? el.nextElementId : null;
    if (explicitNextId && elementById.has(explicitNextId)) {
      const targetEl = elementById.get(explicitNextId);
      if (targetEl && targetEl.type === 'endEvent') {
        incrementMapCounter(incomingCounts, targetEl.id);
      }
    } else if (nextInList && nextInList.type === 'endEvent') {
      // Неявный переход к следующему элементу в массиве
      incrementMapCounter(incomingCounts, nextInList.id);
    }
  }
}

/**
 * Собирает карту { idСобытияКонца -> количество входящих переходов } по всей диаграмме.
 */
function collectEndEventIncomingCounts(diagram) {
  const incomingCounts = new Map();
  if (!diagram || !diagram.pools) return incomingCounts;

  const all = getAllElements(diagram);
  const elementById = new Map();
  all.forEach((el) => {
    if (el && el.id) {
      elementById.set(el.id, el);
    }
  });

  diagram.pools.forEach((pool) => {
    pool?.lanes?.forEach((lane) => {
      const els = lane?.elements || [];
      collectEndEventIncomingCountsInPath(els, incomingCounts, elementById);
    });
  });

  return incomingCounts;
}

/**
 * Для проверки связности: собираем количество входящих переходов для всех элементов диаграммы.
 * Используется, чтобы запретить «висящие» элементы без входа (кроме startEvent).
 */
function collectAllIncomingCountsInPath(elements, incomingCounts, elementById) {
  if (!elements || !Array.isArray(elements)) return;

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (!el || !el.type || !el.id) continue;

    const nextInList = i + 1 < elements.length ? elements[i + 1] : null;

    if (isGatewayType(el.type)) {
      el.branches?.forEach((branch) => {
        const branchPath = branch?.path || [];

        if (branchPath.length > 0) {
          const firstBranchEl = branchPath[0];
          if (firstBranchEl?.id) {
            incrementMapCounter(incomingCounts, firstBranchEl.id);
          }
          collectAllIncomingCountsInPath(branchPath, incomingCounts, elementById);
          return;
        }

        // Пустая ветвь: branch.next (если задан и существует)
        const targetId = branch?.next;
        if (targetId && elementById.has(targetId)) {
          incrementMapCounter(incomingCounts, targetId);
        }
      });

      // После разветвления шлюзом ветки сходятся в неявный join (`id-join`);
      // из него в генераторе идёт sequenceFlow к следующему узлу в том же линейном списке (если он есть).
      if (nextInList?.id && nextInList.type !== 'startEvent') {
        incrementMapCounter(incomingCounts, nextInList.id);
      }
      continue;
    }

    if (el.type === 'endEvent') continue;

    // Явный переход «Переход к элементу»
    const explicitNextId = hasExplicitNextElementContinuation(el) ? el.nextElementId : null;
    if (explicitNextId && elementById.has(explicitNextId)) {
      incrementMapCounter(incomingCounts, explicitNextId);
      continue;
    }

    // Неявный переход к следующему элементу в массиве
    if (nextInList?.id && nextInList.type !== 'startEvent') {
      incrementMapCounter(incomingCounts, nextInList.id);
    }
  }
}

function collectAllIncomingCounts(diagram) {
  const incomingCounts = new Map();
  if (!diagram || !diagram.pools) return incomingCounts;

  const all = getAllElements(diagram);
  const elementById = new Map();
  all.forEach((el) => {
    if (el?.id) elementById.set(el.id, el);
  });

  diagram.pools.forEach((pool) => {
    pool?.lanes?.forEach((lane) => {
      collectAllIncomingCountsInPath(lane?.elements || [], incomingCounts, elementById);
    });
  });

  return incomingCounts;
}

function collectAllOutgoingCountsInPath(elements, outgoingCounts, elementById) {
  if (!elements || !Array.isArray(elements)) return;

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (!el || !el.type || !el.id) continue;

    const nextInList = i + 1 < elements.length ? elements[i + 1] : null;

    if (isGatewayType(el.type)) {
      el.branches?.forEach((branch) => {
        const branchPath = branch?.path || [];

        if (branchPath.length > 0) {
          const firstBranchEl = branchPath[0];
          if (firstBranchEl?.id) {
            incrementMapCounter(outgoingCounts, el.id);
          }
          collectAllOutgoingCountsInPath(branchPath, outgoingCounts, elementById);
          return;
        }

        const targetId = branch?.next;
        if (targetId && elementById.has(targetId)) {
          incrementMapCounter(outgoingCounts, el.id);
        }
      });
      continue;
    }

    if (el.type === 'endEvent') continue;

    const explicitNextId = hasExplicitNextElementContinuation(el) ? el.nextElementId : null;
    if (explicitNextId && elementById.has(explicitNextId)) {
      incrementMapCounter(outgoingCounts, el.id);
      continue;
    }

    if (nextInList?.id && nextInList.type !== 'startEvent') {
      incrementMapCounter(outgoingCounts, el.id);
    }
  }
}

function collectAllOutgoingCounts(diagram) {
  const outgoingCounts = new Map();
  if (!diagram || !diagram.pools) return outgoingCounts;

  const all = getAllElements(diagram);
  const elementById = new Map();
  all.forEach((el) => {
    if (el?.id) elementById.set(el.id, el);
  });

  diagram.pools.forEach((pool) => {
    pool?.lanes?.forEach((lane) => {
      collectAllOutgoingCountsInPath(lane?.elements || [], outgoingCounts, elementById);
    });
  });

  return outgoingCounts;
}

/**
 * Хвост ветви шлюза: не «висящая» активность — либо конец, либо явный переход вне ветви,
 * либо вложенный шлюз с корректными хвостами, либо слияние в общий хвост дорожки после шлюза.
 *
 * @param {{ mergeAfterForkInLane?: boolean }} tailOpts — после шлюза в том же линейном массиве
 *   (дорожка / path) идёт следующий узел: ветки сходятся туда (как в конструкторе: задачи 3/4 → шлюз/задача 8).
 */
function collectGatewayBranchTailErrors(path, ctx, tailOpts = {}) {
  const mergeAfterForkInLane = Boolean(tailOpts.mergeAfterForkInLane);

  if (!path || path.length === 0) return [];
  const last = lastFlowNodeInPath(path);
  if (!last) return [];
  if (last.type === 'endEvent') return [];
  if (hasExplicitNextElementContinuation(last)) return [];
  if (last.type === 'startEvent') {
    return [
      `Ветвь «${ctx.branchLabel}» шлюза на позиции ${ctx.gatewayPosition}: в ветви не может быть события начала последним элементом.`,
    ];
  }
  if (isGatewayType(last.type)) {
    if (!last.branches || last.branches.length === 0) return [];
    const gwIdx = path.indexOf(last);
    const mergeAfterThisGwInPath = gwIdx >= 0 && gwIdx + 1 < path.length;
    const propagateMerge = mergeAfterForkInLane || mergeAfterThisGwInPath;
    const errs = [];
    last.branches.forEach((b, bi) => {
      const subLabel = b.condition?.trim() || `${bi + 1}`;
      errs.push(
        ...collectGatewayBranchTailErrors(
          b.path || [],
          {
            gatewayPosition: ctx.gatewayPosition,
            branchLabel: `${ctx.branchLabel} / ${subLabel}`,
          },
          { mergeAfterForkInLane: propagateMerge }
        )
      );
    });
    return errs;
  }
  if (mergeAfterForkInLane) return [];

  const label = last.label ? `«${last.label}»` : `(${last.type})`;
  return [
    `Ветвь «${ctx.branchLabel}» шлюза на позиции ${ctx.gatewayPosition}: последний элемент ${label} не завершён — добавьте событие конца или «Переход к элементу» (требование BPMN 2.0).`,
  ];
}

function diagramHasEndEventDeep(diagram) {
  function inTree(els) {
    if (!els || !Array.isArray(els)) return false;
    for (const element of els) {
      if (!element) continue;
      if (element.type === 'endEvent') return true;
      if (element.branches) {
        for (const branch of element.branches) {
          if (branch?.path && inTree(branch.path)) return true;
        }
      }
    }
    return false;
  }
  for (const pool of diagram?.pools || []) {
    for (const lane of pool.lanes || []) {
      if (inTree(lane.elements)) return true;
    }
  }
  return false;
}

/**
 * Линейный поток в одном списке (дорожка или path): активность не «висит» без следующего в списке и без «Переход к».
 * @param {{ implicitMergeAtEnd?: boolean }} opts — для ветви шлюза: после шлюза в том же массиве дорожки есть продолжение (слияние).
 */
function validateLinearFlowContinuity(elements, errors, contextPhrase, opts = {}) {
  if (!elements || !Array.isArray(elements)) return;
  const implicitMergeAtEnd = Boolean(opts.implicitMergeAtEnd);
  const prefix = contextPhrase ? `${contextPhrase} ` : '';
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (!el?.type) continue;
    if (el.type === 'endEvent') continue;
    if (el.type === 'startEvent') continue;
    if (el.type === 'dataObjectReference') continue;
    if (el.type === 'dataStoreReference') continue;
    if (el.type === 'textAnnotation') continue;
    if (isGatewayType(el.type)) continue;

    const isLast = i === elements.length - 1;
    if (i + 1 < elements.length || hasExplicitNextElementContinuation(el)) continue;
    if (implicitMergeAtEnd && isLast) continue;

    const label = el.label?.trim() ? `«${el.label}»` : `(${el.type})`;
    errors.push(
      `${prefix}Элемент ${label} (позиция ${i + 1}) не имеет продолжения потока — добавьте следующий элемент, событие конца или «Переход к элементу» (BPMN 2.0).`
    );
  }
}

function validateNestedBranchPath(path, errors, mergeAfterParentGateway) {
  if (!path || !Array.isArray(path)) return;
  validateLinearFlowContinuity(path, errors, '', {
    implicitMergeAtEnd: Boolean(mergeAfterParentGateway),
  });
  validateGatewaysInElementList(path, errors, mergeAfterParentGateway);
}

/**
 * @param {boolean} [mergeAfterParentForkInLane] — родительская ветка сходится к общему хвосту
 *   (после join внешнего шлюза есть продолжение). Нужно для path вида [вложенныйШлюз] без элементов
 *   после него в том же массиве: иначе mergeAfterForkInLane считался бы false и ветви ошибочно «висят».
 */
function validateGatewaysInElementList(elements, errors, mergeAfterParentForkInLane = false) {
  if (!elements || !Array.isArray(elements)) return;

  elements.forEach((element, index) => {
    if (!isGatewayType(element?.type)) return;

    if (!element.branches || element.branches.length === 0) {
      errors.push(`Шлюз на позиции ${index + 1} должен иметь хотя бы одну ветвь`);
    }

    if (isParallelGatewayType(element.type)) {
      element.branches?.forEach((branch, branchIndex) => {
        if (!branch.path || branch.path.length === 0) {
          errors.push(
            `Параллельный шлюз на позиции ${index + 1}, ветвь ${branchIndex + 1} не может быть пустой`
          );
        }
      });
    }

    const nextAfterGateway = elements[index + 1];
    const hasNextInPath = Boolean(
      nextAfterGateway && nextAfterGateway.type && nextAfterGateway.type !== 'startEvent'
    );
    const gatewayIsLastInList = index === elements.length - 1;
    const mergeAfterForkInLane =
      hasNextInPath || (gatewayIsLastInList && Boolean(mergeAfterParentForkInLane));

    element.branches?.forEach((branch, branchIndex) => {
      if (!branch.path || branch.path.length === 0) return;
      const branchLabel = branch.condition?.trim() || `ветвь ${branchIndex + 1}`;
      errors.push(
        ...collectGatewayBranchTailErrors(
          branch.path,
          {
            gatewayPosition: index + 1,
            branchLabel,
          },
          { mergeAfterForkInLane }
        )
      );
      validateNestedBranchPath(branch.path, errors, mergeAfterForkInLane);
    });
  });
}

/**
 * Валидация диаграммы с дорожками: слияние после шлюза только внутри той же дорожки (не через склейку getAllElements).
 * @param {Object} diagram - { pools: [{ lanes: [{ elements, name }] }] }
 */
export function validateDiagram(diagram) {
  const errors = [];
  const flat = getAllElements(diagram);

  if (flat.length === 0) {
    errors.push('Процесс должен содержать хотя бы один элемент');
    return { isValid: false, errors };
  }

  const hasStartEvent = flat.some((e) => e && e.type === 'startEvent');
  if (!hasStartEvent) {
    errors.push(
      'Процесс должен иметь событие начала. Добавьте элемент "Событие начала" через кнопку "Добавить элемент"'
    );
  }

  if (!diagramHasEndEventDeep(diagram)) {
    errors.push(
      'Процесс должен иметь хотя бы одно событие конца. Добавьте элемент "Событие конца" через кнопку "Добавить элемент"'
    );
  }

  const pool = diagram?.pools?.[0];
  const lanes = pool?.lanes || [];
  lanes.forEach((lane, laneIdx) => {
    const els = lane.elements || [];
    const laneName = lane.name?.trim() || `дорожка ${laneIdx + 1}`;
    validateLinearFlowContinuity(els, errors, `В дорожке «${laneName}»:`);
    validateGatewaysInElementList(els, errors);
  });

  // BPMN-корректность: «висящие» элементы без входящих переходов запрещены (кроме startEvent).
  // Этот кейс как раз ловит ситуации, когда несколько задач указывают nextElementId на конец,
  // но при этом сами не достижимы из события начала.
  const allIncoming = collectAllIncomingCounts(diagram);
  const allOutgoing = collectAllOutgoingCounts(diagram);
  flat.forEach((el) => {
    if (!el?.id || !el.type) return;
    if (el.type === 'startEvent') return;
    const inc = allIncoming.get(el.id) || 0;
    if (inc > 0) return;
    const label = el.label?.trim() ? `«${el.label}»` : `(${el.type})`;
    errors.push(`Элемент ${label} не имеет входящих переходов — он «висит» и не достижим из начала процесса.`);
  });

  // Правило моделирования: не больше одного исхода у задачи; несколько входов допустимы (слияние веток в одну активность — BPMN 2.0).
  flat.forEach((el) => {
    if (!el?.id || !el.type) return;
    if (!TASK_LIKE_TYPES.has(el.type)) return;
    const inc = allIncoming.get(el.id) || 0;
    const out = allOutgoing.get(el.id) || 0;
    if (out <= 1) return;
    const label = el.label?.trim() ? `«${el.label}»` : `(${el.type})`;
    errors.push(
      `Логическая ошибка BPMN: задача ${label} имеет несколько исходящих переходов (${out}). ` +
        'Для задач допускается только один выход.',
    );
  });

  // Стилевое правило: не сводить все варианты завершения в одно событие конца.
  // В одно событие конца допустимо не более трёх входящих переходов.
  const incomingCounts = collectEndEventIncomingCounts(diagram);
  incomingCounts.forEach((count, endEventId) => {
    if (count > 3) {
      const endElement = flat.find((e) => e && e.id === endEventId);
      const label = endElement?.label?.trim();
      const labelPart = label ? ` «${label}»` : '';
      errors.push(
        `Логическая ошибка BPMN: слишком много связей с конечным событием${labelPart} — ${count} входящих переходов. ` +
          'Разделите варианты завершения на несколько конечных событий (рекомендуется: не более 3 входящих переходов на одно событие).',
      );
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validate process structure (плоский список элементов одной последовательности, без склейки дорожек)
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

  if (isTopLevel) {
    const hasStartEvent = process.some((e) => e && e.type === 'startEvent');
    if (!hasStartEvent) {
      errors.push(
        'Процесс должен иметь событие начала. Добавьте элемент "Событие начала" через кнопку "Добавить элемент"'
      );
    }

    let hasEndEvent = process.some((e) => e && e.type === 'endEvent');
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
      errors.push(
        'Процесс должен иметь хотя бы одно событие конца. Добавьте элемент "Событие конца" через кнопку "Добавить элемент"'
      );
    }
  }

  validateLinearFlowContinuity(process, errors, '');
  validateGatewaysInElementList(process, errors);

  return {
    isValid: errors.length === 0,
    errors,
  };
}

