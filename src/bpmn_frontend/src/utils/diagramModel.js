/**
 * BPMN Diagram Data Model
 * Handles pools, lanes, and elements structure
 */

/**
 * Create an empty diagram structure
 */
export function createEmptyDiagram() {
  return {
    pools: [],
    messageFlows: [],
    associations: [],
    artifacts: [],
  };
}

/**
 * Migrate old flat process structure to new pool/lane structure
 * For backward compatibility
 */
export function migrateToDiagramModel(oldProcess) {
  if (!oldProcess || !Array.isArray(oldProcess)) {
    return createEmptyDiagram();
  }

  // Check if already in new format
  if (oldProcess.pools || oldProcess.messageFlows !== undefined) {
    return oldProcess;
  }

  // Create default pool with one lane containing all elements
  const defaultPool = {
    id: `pool_${Date.now()}`,
    name: 'Основной процесс',
    isExternal: false,
    isCollapsed: false,
    lanes: [
      {
        id: `lane_${Date.now()}`,
        name: 'Основная дорожка',
        elements: oldProcess,
      },
    ],
  };

  return {
    pools: [defaultPool],
    messageFlows: [],
    associations: [],
    artifacts: [],
  };
}

/**
 * Convert diagram model back to flat structure (for backward compatibility with templates)
 */
export function diagramToFlatProcess(diagram) {
  if (!diagram || !diagram.pools || diagram.pools.length === 0) {
    return [];
  }

  // If only one pool with one lane, return its elements
  if (diagram.pools.length === 1 && diagram.pools[0].lanes.length === 1) {
    return diagram.pools[0].lanes[0].elements || [];
  }

  // Otherwise return empty array (multi-pool structures can't be flattened)
  return [];
}

/**
 * Create a new pool
 */
export function createPool(name = 'Новый пул') {
  return {
    id: `pool_${Date.now()}_${Math.random()}`,
    name,
    isExternal: false,
    isCollapsed: false,
    lanes: [
      {
        id: `lane_${Date.now()}_${Math.random()}`,
        name: 'Дорожка 1',
        elements: [],
      },
    ],
  };
}

/**
 * Create a new lane
 */
export function createLane(name = 'Новая дорожка') {
  return {
    id: `lane_${Date.now()}_${Math.random()}`,
    name,
    elements: [],
  };
}

/**
 * Create a new element
 */
export function createElement(type, label = '') {
  const element = {
    id: `element_${Date.now()}_${Math.random()}`,
    type,
    label,
  };

  // Initialize gateway branches
  if (
    type === 'exclusiveGateway' ||
    type === 'inclusiveGateway' ||
    type === 'parallelGateway'
  ) {
    if (type === 'exclusiveGateway') {
      element.branches = [
        { condition: 'Да', path: [], isDefault: false },
        { condition: 'Нет', path: [], isDefault: false },
      ];
    } else {
      element.branches = [{ condition: '', path: [], isDefault: false }];
    }
  }

  return element;
}

/**
 * Get all elements from diagram (flattened for validation)
 */
export function getAllElements(diagram) {
  const elements = [];
  if (!diagram || !diagram.pools) return elements;

  diagram.pools.forEach((pool) => {
    if (!pool.isExternal && pool.lanes) {
      pool.lanes.forEach((lane) => {
        if (lane.elements) {
          elements.push(...lane.elements);
        }
      });
    }
  });

  return elements;
}

/**
 * Find pool and lane by element id
 */
export function findElementLocation(diagram, elementId) {
  if (!diagram || !diagram.pools) return null;

  for (const pool of diagram.pools) {
    if (pool.lanes) {
      for (const lane of pool.lanes) {
        if (lane.elements) {
          const index = lane.elements.findIndex((e) => e.id === elementId);
          if (index !== -1) {
            return { pool, lane, index };
          }
        }
      }
    }
  }

  return null;
}

