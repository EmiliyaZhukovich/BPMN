<template>
  <div class="constructor-panel">
    <div class="panel-header">
      <div class="header-content">
        <v-icon icon="mdi-chart-timeline-variant" color="primary" size="large" class="mr-2" />
        <h2 class="panel-title">Конструктор BPMN</h2>
      </div>
      <div class="header-actions">
        <v-menu>
          <template v-slot:activator="{ props }">
            <v-btn
              v-bind="props"
              icon="mdi-file-document-multiple"
              variant="text"
              size="small"
              color="primary"
            />
          </template>
          <v-list>
            <v-list-subheader>Шаблоны</v-list-subheader>
            <v-list-item
              v-for="template in templates"
              :key="template.key"
              @click="loadTemplate(template.key)"
            >
              <v-list-item-title>{{ template.name }}</v-list-item-title>
              <v-list-item-subtitle>{{ template.description }}</v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </v-menu>
        <v-tooltip text="Добавить пул" location="bottom">
          <template v-slot:activator="{ props }">
            <v-btn
              v-bind="props"
              icon="mdi-plus-box"
              variant="text"
              size="small"
              color="primary"
              @click="addPool"
            />
          </template>
        </v-tooltip>
        <v-tooltip text="Отменить" location="bottom">
          <template v-slot:activator="{ props }">
            <v-btn
              v-bind="props"
              icon="mdi-undo"
              variant="text"
              size="small"
              :disabled="!canUndo"
              @click="undo"
              color="primary"
            />
          </template>
        </v-tooltip>
        <v-tooltip text="Повторить" location="bottom">
          <template v-slot:activator="{ props }">
            <v-btn
              v-bind="props"
              icon="mdi-redo"
              variant="text"
              size="small"
              :disabled="!canRedo"
              @click="redo"
              color="primary"
            />
          </template>
        </v-tooltip>
        <v-tooltip text="Очистить всё" location="bottom">
          <template v-slot:activator="{ props }">
            <v-btn
              v-bind="props"
              icon="mdi-delete-sweep"
              variant="text"
              size="small"
              :disabled="!hasElements"
              @click="clearAll"
              color="error"
            />
          </template>
        </v-tooltip>
      </div>
    </div>

    <div class="panel-content">
      <div v-if="!hasElements && diagram.pools.length === 0" class="empty-state" role="status" aria-live="polite">
        <v-icon icon="mdi-chart-timeline-variant" size="64" color="grey-lighten-1" aria-hidden="true" />
        <p class="empty-state-text">Начните построение BPMN диаграммы</p>
        <p class="empty-state-hint">Добавьте пул и элементы для создания процесса</p>
      </div>

      <div v-else class="process-container">
        <!-- Pools and Lanes Structure -->
        <div v-for="(pool, poolIndex) in diagram.pools" :key="pool.id" class="pool-container">
          <div class="pool-header">
            <div class="pool-title-section">
              <v-icon icon="mdi-swim" size="small" class="mr-2" />
              <input
                v-model="pool.name"
                @input="saveToHistory"
                class="pool-name-input"
                :placeholder="pool.isExternal ? 'Внешний участник' : 'Название пула'"
              />
              <v-chip v-if="pool.isExternal" size="x-small" color="secondary" variant="flat" class="ml-2">
                Внешний
              </v-chip>
            </div>
            <div class="pool-actions">
              <v-btn
                v-if="!pool.isExternal"
                icon="mdi-plus"
                size="x-small"
                variant="text"
                color="primary"
                @click="addLane(poolIndex)"
                :title="'Добавить дорожку'"
              />
              <v-btn
                v-if="diagram.pools.length > 1"
                icon="mdi-delete"
                size="x-small"
                variant="text"
                color="error"
                @click="deletePool(poolIndex)"
                :title="'Удалить пул'"
              />
            </div>
          </div>

          <!-- Lanes -->
          <div v-if="!pool.isExternal && pool.lanes" class="lanes-container">
            <div
              v-for="(lane, laneIndex) in pool.lanes"
              :key="lane.id"
              class="lane-container"
              :class="{ 'selected-lane': selectedPoolIndex === poolIndex && selectedLaneIndex === laneIndex }"
              @click="selectedPoolIndex = poolIndex; selectedLaneIndex = laneIndex"
            >
              <div class="lane-header">
                <div class="lane-title-section">
                  <v-icon icon="mdi-view-column" size="small" class="mr-2" />
                  <input
                    v-model="lane.name"
                    @input="saveToHistory"
                    class="lane-name-input"
                    placeholder="Название дорожки"
                    @click.stop
                  />
                </div>
                <div class="lane-actions">
                  <v-btn
                    v-if="pool.lanes.length > 1"
                    icon="mdi-delete"
                    size="x-small"
                    variant="text"
                    color="error"
                    @click.stop="deleteLane(poolIndex, laneIndex)"
                    :title="'Удалить дорожку'"
                  />
                </div>
              </div>

              <!-- Elements in lane -->
              <div class="lane-elements">
                <div
                  v-for="(element, elementIndex) in lane.elements"
                  :key="element.id || elementIndex"
                  class="element-wrapper"
                  :class="{
                    'drag-over': dragOverIndex && typeof dragOverIndex === 'object' &&
                                dragOverIndex.poolIndex === poolIndex &&
                                dragOverIndex.laneIndex === laneIndex &&
                                dragOverIndex.elementIndex === elementIndex
                  }"
                  :draggable="true"
                  @dragstart="handleDragStart(poolIndex, laneIndex, elementIndex, $event)"
                  @dragover.prevent
                  @drop="handleDrop(poolIndex, laneIndex, elementIndex, $event)"
                  @dragenter.prevent="handleDragEnter(poolIndex, laneIndex, elementIndex, $event)"
                  @dragleave="handleDragLeave"
                >
                  <ElementEditor
                    :element="element"
                    @update="updateElement(poolIndex, laneIndex, elementIndex, $event)"
                    @delete="deleteElement(poolIndex, laneIndex, elementIndex)"
                  />
                  <div class="add-after-section">
                    <v-menu>
                      <template v-slot:activator="{ props }">
                        <v-btn
                          v-bind="props"
                          size="x-small"
                          variant="text"
                          color="primary"
                          class="add-after-btn"
                        >
                          <v-icon icon="mdi-plus" size="small" />
                          Добавить после
                        </v-btn>
                      </template>
                      <v-list>
                        <v-list-item @click="addElementAfter(poolIndex, laneIndex, elementIndex, 'task')">
                          <v-list-item-title>
                            <v-icon icon="mdi-checkbox-marked-circle" size="small" class="mr-2" />
                            Задача
                          </v-list-item-title>
                        </v-list-item>
                        <v-list-item @click="addElementAfter(poolIndex, laneIndex, elementIndex, 'exclusiveGateway')">
                          <v-list-item-title>
                            <v-icon icon="mdi-source-branch" size="small" class="mr-2" />
                            Условие (Если)
                          </v-list-item-title>
                        </v-list-item>
                        <v-list-item @click="addElementAfter(poolIndex, laneIndex, elementIndex, 'endEvent')">
                          <v-list-item-title>
                            <v-icon icon="mdi-stop-circle" size="small" class="mr-2" />
                            Событие конца
                          </v-list-item-title>
                        </v-list-item>
                      </v-list>
                    </v-menu>
                  </div>
                </div>

                <!-- Add element button for lane -->
                <div class="add-element-section">
                  <v-menu>
                    <template v-slot:activator="{ props }">
                      <v-btn
                        v-bind="props"
                        color="primary"
                        variant="outlined"
                        size="small"
                        class="add-element-btn"
                      >
                        <v-icon icon="mdi-plus" size="small" class="mr-1" />
                        Добавить элемент
                      </v-btn>
                    </template>
                    <v-list>
                      <v-list-item @click="selectedPoolIndex = poolIndex; selectedLaneIndex = laneIndex; addElement('startEvent')">
                        <v-list-item-title>
                          <v-icon icon="mdi-play-circle" size="small" class="mr-2" />
                          Событие начала
                        </v-list-item-title>
                      </v-list-item>
                      <v-list-item @click="selectedPoolIndex = poolIndex; selectedLaneIndex = laneIndex; addElement('endEvent')">
                        <v-list-item-title>
                          <v-icon icon="mdi-stop-circle" size="small" class="mr-2" />
                          Событие конца
                        </v-list-item-title>
                      </v-list-item>
                      <v-list-item @click="selectedPoolIndex = poolIndex; selectedLaneIndex = laneIndex; addElement('task')">
                        <v-list-item-title>
                          <v-icon icon="mdi-checkbox-marked-circle" size="small" class="mr-2" />
                          Задача
                        </v-list-item-title>
                      </v-list-item>
                      <v-list-item @click="selectedPoolIndex = poolIndex; selectedLaneIndex = laneIndex; addElement('exclusiveGateway')">
                        <v-list-item-title>
                          <v-icon icon="mdi-source-branch" size="small" class="mr-2" />
                          Условие (Если)
                        </v-list-item-title>
                      </v-list-item>
                      <v-list-item @click="selectedPoolIndex = poolIndex; selectedLaneIndex = laneIndex; addElement('inclusiveGateway')">
                        <v-list-item-title>
                          <v-icon icon="mdi-source-branch" size="small" class="mr-2" />
                          Множественные условия
                        </v-list-item-title>
                      </v-list-item>
                      <v-list-item @click="selectedPoolIndex = poolIndex; selectedLaneIndex = laneIndex; addElement('parallelGateway')">
                        <v-list-item-title>
                          <v-icon icon="mdi-source-merge" size="small" class="mr-2" />
                          Параллельные процессы
                        </v-list-item-title>
                      </v-list-item>
                    </v-list>
                  </v-menu>
                </div>
              </div>
            </div>
          </div>

          <!-- External pool (no lanes/elements) -->
          <div v-if="pool.isExternal" class="external-pool-note">
            <v-icon icon="mdi-information-outline" size="small" class="mr-2" />
            <span>Внешний участник - элементы добавляются в других пулах</span>
          </div>
        </div>
      </div>

      <v-alert
        v-if="validation.errors.length > 0"
        type="error"
        density="compact"
        class="validation-alert"
        role="alert"
        aria-live="assertive"
      >
        <div class="validation-errors">
          <div v-for="(error, index) in validation.errors" :key="index" class="error-item">
            {{ error }}
          </div>
        </div>
      </v-alert>

      <v-alert
        v-else-if="hasElements"
        type="success"
        density="compact"
        class="validation-alert"
        role="status"
        aria-live="polite"
      >
        Структура процесса валидна
      </v-alert>
    </div>

    <div class="panel-footer">
      <v-btn
        @click="buildDiagram"
        :disabled="!validation.isValid || !hasElements"
        color="primary"
        variant="elevated"
        class="build-btn"
        size="large"
      >
        <v-icon icon="mdi-chart-timeline-variant" class="mr-2" />
        Построить диаграмму
      </v-btn>
      <v-btn
        @click="exportBpmn"
        :disabled="!validation.isValid || !hasElements || !diagramBuilt"
        color="secondary"
        variant="outlined"
        class="export-btn"
      >
        <v-icon icon="mdi-download" class="mr-2" />
        Экспорт BPMN XML
      </v-btn>
      <v-menu>
        <template v-slot:activator="{ props }">
          <v-btn
            v-bind="props"
            :disabled="!validation.isValid || !hasElements || !diagramBuilt"
            color="secondary"
            variant="outlined"
            class="export-btn"
          >
            <v-icon icon="mdi-download" class="mr-2" />
            Экспорт
          </v-btn>
        </template>
        <v-list>
          <v-list-item @click="exportPng">
            <v-list-item-title>PNG изображение</v-list-item-title>
          </v-list-item>
          <v-list-item @click="exportSvg">
            <v-list-item-title>SVG изображение</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>
    </div>
  </div>
</template>

<script>
import { ref, computed, watch, onMounted } from 'vue';
import ElementEditor from './ElementEditor.vue';
import { generateBpmnXml, validateProcess } from '../utils/bpmnGenerator';
import { getTemplate, getAllTemplates } from '../utils/templates';
import {
  createEmptyDiagram,
  migrateToDiagramModel,
  diagramToFlatProcess,
  createPool,
  createLane,
  createElement,
  getAllElements,
} from '../utils/diagramModel';

export default {
  name: 'ConstructorPanel',
  components: {
    ElementEditor,
  },
  emits: ['bpmn-xml-updated'],
  setup(props, { emit }) {
    // New diagram structure with pools/lanes
    const diagram = ref(createEmptyDiagram());
    // For backward compatibility - keep process ref but sync with diagram
    const process = computed({
      get: () => {
        // Return first lane's elements if only one pool with one lane
        if (diagram.value.pools.length === 1 && diagram.value.pools[0].lanes.length === 1) {
          return diagram.value.pools[0].lanes[0].elements || [];
        }
        return [];
      },
      set: (value) => {
        // Migrate old flat structure to diagram
        if (Array.isArray(value) && value.length > 0 && !value.pools) {
          diagram.value = migrateToDiagramModel(value);
        }
      },
    });

    const history = ref([createEmptyDiagram()]);
    const historyIndex = ref(0);
    const templates = getAllTemplates();
    const diagramBuilt = ref(false);
    const draggedIndex = ref(null);
    const dragOverIndex = ref(null);

    // Track selected pool/lane for adding elements
    const selectedPoolIndex = ref(0);
    const selectedLaneIndex = ref(0);

    const canUndo = computed(() => historyIndex.value > 0);
    const canRedo = computed(() => historyIndex.value < history.value.length - 1);

    const validation = computed(() => {
      // Get all elements from all pools/lanes
      const allElements = getAllElements(diagram.value);
      const result = validateProcess(allElements, true);
      // Debug: log process structure for troubleshooting
      if (result.errors.length > 0) {
        console.log('Validation errors:', result.errors);
        console.log('Diagram structure:', JSON.stringify(diagram.value, null, 2));
        console.log('Has startEvent:', allElements.some((e) => e.type === 'startEvent'));
        console.log('Has endEvent:', allElements.some((e) => e.type === 'endEvent'));
      }
      return result;
    });

    const hasElements = computed(() => {
      return getAllElements(diagram.value).length > 0;
    });

    // Don't auto-update diagram, wait for build button
    watch(
      diagram,
      () => {
        diagramBuilt.value = false;
        emit('bpmn-xml-updated', '');
      },
      { deep: true }
    );

    // Initialize with default pool if empty
    onMounted(() => {
      if (diagram.value.pools.length === 0) {
        diagram.value.pools.push(createPool('Основной процесс'));
        saveToHistory();
      }
    });

    function saveToHistory() {
      // Remove any history after current index
      history.value = history.value.slice(0, historyIndex.value + 1);
      // Add new state (save diagram, not process)
      history.value.push(JSON.parse(JSON.stringify(diagram.value)));
      historyIndex.value = history.value.length - 1;
      // Limit history size
      if (history.value.length > 50) {
        history.value.shift();
        historyIndex.value--;
      }
    }

    function getCurrentPool() {
      if (diagram.value.pools.length === 0) {
        diagram.value.pools.push(createPool('Основной процесс'));
      }
      if (selectedPoolIndex.value >= diagram.value.pools.length) {
        selectedPoolIndex.value = 0;
      }
      return diagram.value.pools[selectedPoolIndex.value];
    }

    function getCurrentLane() {
      const pool = getCurrentPool();
      if (!pool.isExternal && pool.lanes.length === 0) {
        pool.lanes.push(createLane('Дорожка 1'));
      }
      if (selectedLaneIndex.value >= pool.lanes.length) {
        selectedLaneIndex.value = 0;
      }
      return pool.lanes[selectedLaneIndex.value];
    }

    function addElement(type) {
      const lane = getCurrentLane();
      if (!lane.elements) {
        lane.elements = [];
      }
      const element = createElement(type, '');
      lane.elements.push(element);
      saveToHistory();
    }

    function addPool() {
      diagram.value.pools.push(createPool(`Пул ${diagram.value.pools.length + 1}`));
      selectedPoolIndex.value = diagram.value.pools.length - 1;
      selectedLaneIndex.value = 0;
      saveToHistory();
    }

    function addLane(poolIndex) {
      const pool = diagram.value.pools[poolIndex];
      if (!pool.isExternal) {
        if (!pool.lanes) {
          pool.lanes = [];
        }
        pool.lanes.push(createLane(`Дорожка ${pool.lanes.length + 1}`));
        saveToHistory();
      }
    }

    function deletePool(poolIndex) {
      if (diagram.value.pools.length > 1) {
        diagram.value.pools.splice(poolIndex, 1);
        if (selectedPoolIndex.value >= diagram.value.pools.length) {
          selectedPoolIndex.value = Math.max(0, diagram.value.pools.length - 1);
        }
        saveToHistory();
      }
    }

    function deleteLane(poolIndex, laneIndex) {
      const pool = diagram.value.pools[poolIndex];
      if (pool.lanes.length > 1) {
        pool.lanes.splice(laneIndex, 1);
        if (selectedLaneIndex.value >= pool.lanes.length) {
          selectedLaneIndex.value = Math.max(0, pool.lanes.length - 1);
        }
        saveToHistory();
      }
    }

    function updateElement(poolIndex, laneIndex, elementIndex, updatedElement) {
      const pool = diagram.value.pools[poolIndex];
      const lane = pool.lanes[laneIndex];
      if (lane.elements && lane.elements[elementIndex]) {
        lane.elements[elementIndex] = updatedElement;
        saveToHistory();
      }
    }

    // Legacy method for backward compatibility (when single pool/lane)
    function updateElementLegacy(index, updatedElement) {
      const lane = getCurrentLane();
      if (lane.elements && lane.elements[index]) {
        lane.elements[index] = updatedElement;
        saveToHistory();
      }
    }

    function deleteElement(poolIndex, laneIndex, elementIndex) {
      const pool = diagram.value.pools[poolIndex];
      const lane = pool.lanes[laneIndex];
      if (lane.elements) {
        lane.elements.splice(elementIndex, 1);
        saveToHistory();
      }
    }

    // Legacy method for backward compatibility
    function deleteElementLegacy(index) {
      const lane = getCurrentLane();
      if (lane.elements) {
        lane.elements.splice(index, 1);
        saveToHistory();
      }
    }

    function clearAll() {
      if (confirm('Вы уверены, что хотите очистить все элементы?')) {
        diagram.value = createEmptyDiagram();
        diagram.value.pools.push(createPool('Основной процесс'));
        diagramBuilt.value = false;
        saveToHistory();
      }
    }

    function buildDiagram() {
      if (!validation.value.isValid) {
        return;
      }

      try {
        console.log('Building diagram from structure:', JSON.stringify(diagram.value, null, 2));
        const bpmnXml = generateBpmnXml(diagram.value);
        console.log('Generated BPMN XML:', bpmnXml.substring(0, 500));

        if (!bpmnXml || bpmnXml.trim() === '') {
          throw new Error('Сгенерированный BPMN XML пуст');
        }

        emit('bpmn-xml-updated', bpmnXml);
        diagramBuilt.value = true;
      } catch (error) {
        console.error('Ошибка генерации BPMN XML:', error);
        alert(`Ошибка при построении диаграммы: ${error.message}. Проверьте структуру процесса.`);
        diagramBuilt.value = false;
      }
    }

    function undo() {
      if (canUndo.value) {
        historyIndex.value--;
        diagram.value = JSON.parse(JSON.stringify(history.value[historyIndex.value]));
      }
    }

    function redo() {
      if (canRedo.value) {
        historyIndex.value++;
        diagram.value = JSON.parse(JSON.stringify(history.value[historyIndex.value]));
      }
    }

    function exportBpmn() {
      if (!validation.value.isValid) return;

      try {
        const bpmnXml = generateBpmnXml(diagram.value);
        const blob = new Blob([bpmnXml], { type: 'application/xml' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'diagram.bpmn';
        a.click();
        window.URL.revokeObjectURL(url);
      } catch (error) {
        console.error('Error exporting BPMN:', error);
        alert('Error exporting BPMN file');
      }
    }

    function exportPng() {
      emit('export-png');
    }

    function exportSvg() {
      emit('export-svg');
    }

    function loadTemplate(templateKey) {
      if (hasElements.value) {
        if (!confirm('Загрузка шаблона заменит текущий процесс. Продолжить?')) {
          return;
        }
      }
      const template = getTemplate(templateKey);
      if (template) {
        // Check if template is diagram (new format) or process (legacy format)
        if (template.pools) {
          // New format - use directly
          diagram.value = template;
        } else {
          // Legacy format - migrate to diagram model
          diagram.value = migrateToDiagramModel(template);
        }
        diagramBuilt.value = false;
        saveToHistory();
      }
    }

    function addElementAfter(poolIndex, laneIndex, elementIndex, type) {
      const pool = diagram.value.pools[poolIndex];
      const lane = pool.lanes[laneIndex];
      if (!lane.elements) {
        lane.elements = [];
      }
      const element = createElement(type, '');
      lane.elements.splice(elementIndex + 1, 0, element);
      saveToHistory();
    }

    // Legacy method for backward compatibility
    function addElementAfterLegacy(index, type) {
      const lane = getCurrentLane();
      if (!lane.elements) {
        lane.elements = [];
      }
      const element = createElement(type, '');
      lane.elements.splice(index + 1, 0, element);
      saveToHistory();
    }

    function handleDragStart(poolIndex, laneIndex, elementIndex, event) {
      draggedIndex.value = { poolIndex, laneIndex, elementIndex };
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/html', event.target);
    }

    // Legacy method for backward compatibility
    function handleDragStartLegacy(index, event) {
      const pool = getCurrentPool();
      const lane = getCurrentLane();
      handleDragStart(selectedPoolIndex.value, selectedLaneIndex.value, index, event);
    }

    function handleDragEnter(poolIndex, laneIndex, elementIndex, event) {
      dragOverIndex.value = { poolIndex, laneIndex, elementIndex };
      event.preventDefault();
    }

    // Legacy method
    function handleDragEnterLegacy(index, event) {
      handleDragEnter(selectedPoolIndex.value, selectedLaneIndex.value, index, event);
    }

    function handleDragLeave() {
      dragOverIndex.value = null;
    }

    function handleDrop(poolIndex, laneIndex, dropIndex, event) {
      event.preventDefault();
      if (!draggedIndex.value ||
          (draggedIndex.value.poolIndex === poolIndex &&
           draggedIndex.value.laneIndex === laneIndex &&
           draggedIndex.value.elementIndex === dropIndex)) {
        draggedIndex.value = null;
        dragOverIndex.value = null;
        return;
      }

      const pool = diagram.value.pools[poolIndex];
      const lane = pool.lanes[laneIndex];
      const sourcePool = diagram.value.pools[draggedIndex.value.poolIndex];
      const sourceLane = sourcePool.lanes[draggedIndex.value.laneIndex];

      const draggedElement = sourceLane.elements[draggedIndex.value.elementIndex];
      sourceLane.elements.splice(draggedIndex.value.elementIndex, 1);

      if (!lane.elements) {
        lane.elements = [];
      }

      // Adjust drop index if dragging from before drop position within same lane
      const adjustedDropIndex =
        (draggedIndex.value.poolIndex === poolIndex &&
         draggedIndex.value.laneIndex === laneIndex &&
         draggedIndex.value.elementIndex < dropIndex)
          ? dropIndex - 1
          : dropIndex;

      lane.elements.splice(adjustedDropIndex, 0, draggedElement);

      draggedIndex.value = null;
      dragOverIndex.value = null;
      saveToHistory();
    }

    // Legacy method
    function handleDropLegacy(dropIndex, event) {
      handleDrop(selectedPoolIndex.value, selectedLaneIndex.value, dropIndex, event);
    }

    return {
      templates,
      diagram,
      process,
      validation,
      hasElements,
      canUndo,
      canRedo,
      addElement,
      addPool,
      addLane,
      deletePool,
      deleteLane,
      updateElement: updateElementLegacy,
      deleteElement: deleteElementLegacy,
      clearAll,
      undo,
      redo,
      exportBpmn,
      exportPng,
      exportSvg,
      loadTemplate,
      buildDiagram,
      diagramBuilt,
      addElementAfter: addElementAfterLegacy,
      handleDragStart: handleDragStartLegacy,
      handleDragEnter: handleDragEnterLegacy,
      handleDragLeave,
      handleDrop: handleDropLegacy,
      dragOverIndex: computed(() => {
        if (!dragOverIndex.value || typeof dragOverIndex.value === 'number') {
          return dragOverIndex.value;
        }
        // Convert to number for legacy compatibility
        return dragOverIndex.value.elementIndex;
      }),
      selectedPoolIndex,
      selectedLaneIndex,
      // Expose methods for pool/lane operations
      updateElement,
      deleteElement,
      addElementAfter,
      handleDragStart,
      handleDragEnter,
      handleDrop,
    };
  },
};
</script>

<style scoped>
.constructor-panel {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #ffffff;
  border-right: 1px solid #e0e0e0;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid #e0e0e0;
  background: #fafafa;
}

.header-content {
  display: flex;
  align-items: center;
}

.panel-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #424242;
  margin: 0;
}

.header-actions {
  display: flex;
  gap: 4px;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  padding: 32px;
}

.empty-state-text {
  font-size: 1.1rem;
  font-weight: 500;
  color: #424242;
  margin: 16px 0 8px 0;
}

.empty-state-hint {
  font-size: 0.9rem;
  color: #757575;
}

.process-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.process-elements {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.element-wrapper {
  position: relative;
  transition: all 0.2s ease;
}

.element-wrapper[draggable='true'] {
  cursor: move;
}

.element-wrapper.drag-over {
  border: 2px dashed #2196f3;
  border-radius: 8px;
  padding: 4px;
  margin: -4px;
}

.add-after-section {
  display: flex;
  justify-content: center;
  padding: 8px 0;
  opacity: 0;
  transition: opacity 0.2s;
}

.element-wrapper:hover .add-after-section {
  opacity: 1;
}

.add-after-btn {
  font-size: 0.75rem;
}

.add-element-section {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #e0e0e0;
}

.add-element-btn {
  width: 100%;
}

.validation-alert {
  margin-top: 16px;
}

.validation-errors {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.error-item {
  font-size: 0.85rem;
}

.panel-footer {
  padding: 16px;
  border-top: 1px solid #e0e0e0;
  background: #fafafa;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.build-btn {
  width: 100%;
}

.export-btn {
  flex: 1;
}

.pool-container {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  margin-bottom: 16px;
  background: #fafafa;
}

.pool-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  background: #eeeeee;
  border-bottom: 1px solid #e0e0e0;
  border-radius: 8px 8px 0 0;
}

.pool-title-section {
  display: flex;
  align-items: center;
  flex: 1;
}

.pool-name-input {
  flex: 1;
  border: none;
  background: transparent;
  font-weight: 600;
  font-size: 0.95rem;
  padding: 4px 8px;
  border-radius: 4px;
  min-width: 150px;
}

.pool-name-input:focus {
  outline: 2px solid #2196f3;
  background: white;
}

.pool-actions {
  display: flex;
  gap: 4px;
}

.lanes-container {
  padding: 8px;
}

.lane-container {
  margin-bottom: 12px;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  background: white;
  transition: border-color 0.2s;
}

.lane-container.selected-lane {
  border-color: #2196f3;
  border-width: 2px;
}

.lane-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: #f5f5f5;
  border-bottom: 1px solid #e0e0e0;
  border-radius: 6px 6px 0 0;
}

.lane-title-section {
  display: flex;
  align-items: center;
  flex: 1;
}

.lane-name-input {
  flex: 1;
  border: none;
  background: transparent;
  font-size: 0.85rem;
  padding: 4px 8px;
  border-radius: 4px;
  min-width: 120px;
}

.lane-name-input:focus {
  outline: 2px solid #2196f3;
  background: white;
}

.lane-actions {
  display: flex;
  gap: 4px;
}

.lane-elements {
  padding: 12px;
  min-height: 60px;
}

.external-pool-note {
  padding: 16px;
  display: flex;
  align-items: center;
  color: #757575;
  font-size: 0.85rem;
  font-style: italic;
}
</style>

