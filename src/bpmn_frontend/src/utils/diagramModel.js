/**
 * BPMN Diagram Data Model
 * Диаграмма «Процесс» — один пул с дорожками (lanes) и элементами.
 */

import { isDivergingGatewayType, isParallelGatewayType } from './bpmnPalette.js';

export class DiagramModel {
  static _id(prefix) {
    return `${prefix}_${Date.now()}_${Math.random()}`;
  }

  /**
   * Create a new pool (один пул на диаграмму «Процесс»)
   */
  static createPool(name = 'Основной процесс') {
    return {
      id: DiagramModel._id('pool'),
      name,
      lanes: [
        {
          id: DiagramModel._id('lane'),
          name: 'Дорожка 1',
          elements: [],
        },
      ],
    };
  }

  /**
   * Create an empty diagram structure (один пул по умолчанию)
   */
  static createEmptyDiagram() {
    return {
      pools: [DiagramModel.createPool('Основной процесс')],
      associations: [],
      artifacts: [],
    };
  }

  /**
   * Migrate old flat process structure to new pool/lane structure
   * For backward compatibility
   */
  static migrateToDiagramModel(oldProcess) {
    if (!oldProcess || !Array.isArray(oldProcess)) {
      return DiagramModel.createEmptyDiagram();
    }

    // Check if already in new format
    if (oldProcess.pools || oldProcess.messageFlows !== undefined) {
      return oldProcess;
    }

    // Create default pool with one lane containing all elements
    const defaultPool = {
      id: `pool_${Date.now()}`,
      name: 'Основной процесс',
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
      associations: [],
      artifacts: [],
    };
  }

  /**
   * Convert diagram model back to flat structure (for backward compatibility with templates)
   */
  static diagramToFlatProcess(diagram) {
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
   * Create a new lane
   */
  static createLane(name = 'Новая дорожка') {
    return {
      id: DiagramModel._id('lane'),
      name,
      elements: [],
    };
  }

  /**
   * Create a new element
   * @param {string} type
   * @param {string} label
   * @param {{ eventDefinition?: string }} [options]
   */
  static createElement(type, label = '', options = {}) {
    const element = {
      id: DiagramModel._id('element'),
      type,
      label,
    };

    if (options.eventDefinition) {
      element.eventDefinition = options.eventDefinition;
    }

    // Initialize gateway branches
    if (isDivergingGatewayType(type)) {
      if (type === 'exclusiveGateway' || type === 'eventBasedGateway') {
        element.branches = [
          { condition: 'Да', path: [], isDefault: false },
          { condition: 'Нет', path: [], isDefault: false },
        ];
      } else {
        element.branches = [{ condition: '', path: [], isDefault: false }];
      }
    } else if (isParallelGatewayType(type)) {
      element.branches = [{ condition: '', path: [], isDefault: false }];
    }

    return element;
  }

  /**
   * Create a new artifact / data element (not a flow node).
   * Supported: textAnnotation, dataObjectReference, dataStoreReference
   * @param {string} type
   * @param {string} label
   */
  static createArtifact(type, label = '') {
    const artifact = {
      id: DiagramModel._id('artifact'),
      type,
      label,
    };
    return artifact;
  }

  /**
   * Create a new association (for data / annotations).
   * direction: 'none' | 'to' | 'from' (relative to sourceRef -> targetRef)
   */
  static createAssociation(sourceRef, targetRef, label = '', direction = 'none') {
    return {
      id: DiagramModel._id('assoc'),
      sourceRef,
      targetRef,
      label,
      direction,
    };
  }

  /**
   * Get all elements from diagram (flattened for validation)
   */
  static getAllElements(diagram) {
    const elements = [];
    if (!diagram || !diagram.pools) return elements;

    diagram.pools.forEach((pool) => {
      if (pool.lanes) {
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
  static findElementLocation(diagram, elementId) {
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
}

/**
 * Create a new pool (один пул на диаграмму «Процесс»)
 */
export function createPool(name = 'Основной процесс') {
  return DiagramModel.createPool(name);
}

/**
 * Create an empty diagram structure (один пул по умолчанию)
 */
export function createEmptyDiagram() {
  return DiagramModel.createEmptyDiagram();
}

/**
 * Migrate old flat process structure to new pool/lane structure
 * For backward compatibility
 */
export function migrateToDiagramModel(oldProcess) {
  return DiagramModel.migrateToDiagramModel(oldProcess);
}

/**
 * Convert diagram model back to flat structure (for backward compatibility with templates)
 */
export function diagramToFlatProcess(diagram) {
  return DiagramModel.diagramToFlatProcess(diagram);
}

/**
 * Create a new lane
 */
export function createLane(name = 'Новая дорожка') {
  return DiagramModel.createLane(name);
}

/**
 * Create a new element
 * @param {string} type
 * @param {string} label
 * @param {{ eventDefinition?: string }} [options]
 */
export function createElement(type, label = '', options = {}) {
  return DiagramModel.createElement(type, label, options);
}

export function createArtifact(type, label = '') {
  return DiagramModel.createArtifact(type, label);
}

export function createAssociation(sourceRef, targetRef, label = '', direction = 'none') {
  return DiagramModel.createAssociation(sourceRef, targetRef, label, direction);
}

/**
 * Get all elements from diagram (flattened for validation)
 */
export function getAllElements(diagram) {
  return DiagramModel.getAllElements(diagram);
}

/**
 * Find pool and lane by element id
 */
export function findElementLocation(diagram, elementId) {
  return DiagramModel.findElementLocation(diagram, elementId);
}

