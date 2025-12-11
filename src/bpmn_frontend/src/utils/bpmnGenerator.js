/**
 * BPMN XML Generator
 * Converts hierarchical process structure to BPMN XML format
 */

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
 * @param {Array} process - Array of process elements
 * @returns {string} BPMN XML string
 */
export function generateBpmnXml(process) {
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
  function transformProcess(processElements, parentNextId = null) {
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
              pendingConnections.push({
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

  // Transform the process
  const transformedElements = transformProcess(process);

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

  // Process main process and all nested branches
  connectDuplicateEndEventsRecursive(process);

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

  // Build incoming/outgoing arrays
  flows.forEach((flow) => {
    const source = elementMap.get(flow.sourceRef);
    const target = elementMap.get(flow.targetRef);
    if (source) source.outgoing.push(flow.id);
    if (target) target.incoming.push(flow.id);
  });

  // Generate XML
  return buildXml(transformedElements, flows);
}

function buildXml(elements, flows) {
  const xmlns = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
  const bpmndi = 'http://www.omg.org/spec/BPMN/20100524/DI';
  const dc = 'http://www.omg.org/spec/DD/20100524/DC';
  const di = 'http://www.omg.org/spec/DD/20100524/DI';

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<definitions xmlns="${xmlns}" xmlns:bpmndi="${bpmndi}" xmlns:dc="${dc}" xmlns:di="${di}" id="definitions_1">\n`;
  xml += `  <process id="Process_1" isExecutable="false">\n`;

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

