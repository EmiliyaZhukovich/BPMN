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
      <div v-if="!currentPool" class="empty-state" role="status" aria-live="polite">
        <v-icon icon="mdi-chart-timeline-variant" size="64" color="grey-lighten-1" aria-hidden="true" />
        <p class="empty-state-text">Загрузка конструктора…</p>
      </div>

      <div v-else class="process-container">
        <!-- Один пул (диаграмма «Процесс») и дорожки -->
        <div v-if="currentPool" class="pool-container">
          <div class="pool-header">
            <div class="pool-title-section">
              <v-icon icon="mdi-swim" size="small" class="mr-2" />
              <input
                v-model="currentPool.name"
                @input="saveToHistory"
                class="pool-name-input"
                placeholder="Название процесса"
              />
            </div>
            <div class="pool-actions">
              <v-btn
                icon="mdi-plus"
                size="x-small"
                variant="text"
                color="primary"
                @click="addLane()"
                :title="'Добавить дорожку'"
              />
            </div>
          </div>

          <!-- Lanes -->
          <div v-if="currentPool.lanes" class="lanes-container">
            <div
              v-for="(lane, laneIndex) in currentPool.lanes"
              :key="lane.id"
              class="lane-container"
              :class="{ 'selected-lane': selectedLaneIndex === laneIndex }"
              @click="selectedLaneIndex = laneIndex"
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
                    v-if="currentPool.lanes.length > 1"
                    icon="mdi-delete"
                    size="x-small"
                    variant="text"
                    color="error"
                    @click.stop="deleteLane(0, laneIndex)"
                    :title="'Удалить дорожку'"
                  />
                </div>
              </div>

              <!-- Elements in lane -->
              <div class="lane-elements">
                <p v-if="!lane.elements || lane.elements.length === 0" class="lane-empty-hint">
                  Нажмите «Добавить элемент» ниже, чтобы добавить событие начала, задачу, условие и др.
                </p>
                <div
                  v-for="(element, elementIndex) in lane.elements"
                  :key="element.id || elementIndex"
                  class="element-wrapper"
                  :class="{
                    'drag-over': dragOverIndex && typeof dragOverIndex === 'object' &&
                                dragOverIndex.laneIndex === laneIndex &&
                                dragOverIndex.elementIndex === elementIndex
                  }"
                  :draggable="true"
                  @dragstart="handleDragStart(0, laneIndex, elementIndex, $event)"
                  @dragover.prevent
                  @drop="handleDrop(0, laneIndex, elementIndex, $event)"
                  @dragenter.prevent="handleDragEnter(0, laneIndex, elementIndex, $event)"
                  @dragleave="handleDragLeave"
                >
                  <ElementEditor
                    :element="element"
                    :pool="currentPool"
                    :lanes="currentPool?.lanes || []"
                    @update="updateElement(0, laneIndex, elementIndex, $event)"
                    @delete="deleteElement(0, laneIndex, elementIndex)"
                    @associations:update="setAssociations($event)"
                    @annotation:add="addAnnotationForElement($event)"
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
                      <v-list density="compact">
                        <template v-for="group in bpmnPaletteGroupsForAddAfter" :key="group.title">
                          <v-list-subheader>{{ group.title }}</v-list-subheader>
                          <v-list-item
                            v-for="item in group.items"
                            :key="item.paletteId || item.type"
                            @click="addElementAfter(0, laneIndex, elementIndex, item)"
                          >
                            <v-list-item-title>
                              <v-icon :icon="item.icon" size="small" class="mr-2" />
                              {{ item.title }}
                            </v-list-item-title>
                          </v-list-item>
                        </template>
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
                    <v-list density="compact">
                      <template v-for="group in BPMN_PALETTE_GROUPS" :key="group.title">
                        <v-list-subheader>{{ group.title }}</v-list-subheader>
                        <v-list-item
                          v-for="item in group.items"
                          :key="item.paletteId || item.type"
                          @click="addElementToLane(0, laneIndex, item)"
                        >
                          <v-list-item-title>
                            <v-icon :icon="item.icon" size="small" class="mr-2" />
                            {{ item.title }}
                          </v-list-item-title>
                        </v-list-item>
                      </template>
                    </v-list>
                  </v-menu>
                </div>
              </div>
            </div>
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
        @click="saveDiagramToList"
        :disabled="!hasElements"
        color="success"
        variant="elevated"
        class="build-btn"
        size="large"
      >
        <v-icon icon="mdi-content-save" class="mr-2" />
        Сохранить диаграмму
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
import { ref, computed, watch, onMounted, provide } from 'vue';
import ElementEditor from './ElementEditor.vue';
import { generateBpmnXml, validateDiagram } from '../utils/bpmnGenerator';
import { getTemplate, getAllTemplates } from '../utils/templates';
import {
  createEmptyDiagram,
  migrateToDiagramModel,
  createLane,
  createElement,
  getAllElements,
  createAssociation,
  findElementTreeLocation,
} from '../utils/diagramModel';
import { BPMN_PALETTE_GROUPS } from '../utils/bpmnPalette.js';

export default {
  name: 'ConstructorPanel',
  components: {
    ElementEditor,
  },
  props: {
    initialSaveState: {
      type: Object,
      default: null,
    },
  },
  emits: ['bpmn-xml-updated', 'save-diagram'],
  setup(props, { emit }) {
    // New diagram structure with pools/lanes
    const diagram = ref(createEmptyDiagram());
    // For backward compatibility - keep process ref but sync with diagram
    const process = computed({
      get: () => {
        // Return first lane's elements if only one pool with one lane
        if (diagram.value.pools.length === 1 && diagram.value.pools[0].lanes?.length === 1) {
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

    // Один пул (диаграмма «Процесс»); выбранная дорожка для добавления элементов
    const selectedLaneIndex = ref(0);
    // Счётчик, чтобы выпадающий список дорожек в ElementEditor обновлялся при add/delete lane (ref не меняется при push)
    const lanesVersion = ref(0);

    const bpmnPaletteGroupsForAddAfter = computed(() =>
      BPMN_PALETTE_GROUPS.map((g) => ({
        title: g.title,
        items: g.items.filter((i) => i.addAfter !== false),
      })).filter((g) => g.items.length > 0)
    );

    const currentPool = computed(() =>
      diagram.value.pools && diagram.value.pools.length > 0 ? diagram.value.pools[0] : null
    );

    // Геттер дорожек — дочерние компоненты вызывают его и получают актуальный список (обход проблем inject ref)
    provide('getLanes', () => {
      const pool = diagram.value?.pools?.[0];
      return pool && Array.isArray(pool.lanes) ? pool.lanes : [];
    });
    provide('diagram', diagram);
    provide(
      'poolLanes',
      computed(() => {
        lanesVersion.value; // зависимость: при изменении списка дорожек инкрементируем lanesVersion
        const lanes = currentPool.value && currentPool.value.lanes ? currentPool.value.lanes : [];
        return lanes.length ? [...lanes] : []; // копия, чтобы дочерний computed видел обновления
      })
    );

    const canUndo = computed(() => historyIndex.value > 0);
    const canRedo = computed(() => historyIndex.value < history.value.length - 1);

    const validation = computed(() => {
      const allElements = getAllElements(diagram.value);
      const result = validateDiagram(diagram.value);
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

    // Не пересобираем превью автоматически: только сбрасываем флаг «построено».
    // Раньше здесь эмитился пустой XML — это гонялось с «Построить» (importXML) и ломало первый показ.
    watch(
      diagram,
      () => {
        diagramBuilt.value = false;
      },
      { deep: true }
    );

    const initialRev = computed(() => props.initialSaveState?._rev ?? null);

    function applyInitialSaveState(state) {
      if (!state?.diagram) return;
      diagram.value = JSON.parse(JSON.stringify(state.diagram));
      diagramBuilt.value = !!state.diagramBuilt;
      history.value = [JSON.parse(JSON.stringify(diagram.value))];
      historyIndex.value = 0;
      selectedLaneIndex.value = 0;
      lanesVersion.value++;

      let xml = state.bpmnXml || '';
      if (!xml && diagramBuilt.value) {
        try {
          xml = generateBpmnXml(diagram.value);
        } catch (e) {
          console.warn('applyInitialSaveState: regenerate XML failed', e);
        }
      }
      if (diagramBuilt.value && xml) {
        emit('bpmn-xml-updated', xml);
      } else {
        emit('bpmn-xml-updated', '');
      }
    }

    watch(
      initialRev,
      (rev) => {
        if (!rev || !props.initialSaveState?.diagram) return;
        applyInitialSaveState(props.initialSaveState);
      },
      { immediate: true }
    );

    onMounted(() => {
      if (props.initialSaveState?._rev) {
        return;
      }
      if (diagram.value.pools.length === 0) {
        diagram.value = createEmptyDiagram();
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
        diagram.value = createEmptyDiagram();
      }
      return diagram.value.pools[0];
    }

    function getCurrentLane() {
      const pool = getCurrentPool();
      if (!pool.lanes || pool.lanes.length === 0) {
        pool.lanes = [createLane('Дорожка 1')];
      }
      if (selectedLaneIndex.value >= pool.lanes.length) {
        selectedLaneIndex.value = 0;
      }
      return pool.lanes[selectedLaneIndex.value];
    }

    /** Принимает тип строкой или объект пункта палитры (type + опционально eventDefinition). */
    function elementFromPaletteRef(typeOrItem) {
      if (typeOrItem != null && typeof typeOrItem === 'object' && typeOrItem.type) {
        const { type, eventDefinition } = typeOrItem;
        return createElement(type, '', eventDefinition ? { eventDefinition } : {});
      }
      return createElement(typeOrItem, '');
    }

    function addElement(typeOrItem) {
      const lane = getCurrentLane();
      if (!lane.elements) {
        lane.elements = [];
      }
      const element = elementFromPaletteRef(typeOrItem);
      lane.elements.push(element);
      saveToHistory();
    }

    /** Добавить элемент в конкретную дорожку (для меню «Добавить элемент» — без зависимости от selectedLaneIndex) */
    function addElementToLane(poolIndex, laneIndex, typeOrItem) {
      const pool = diagram.value.pools[poolIndex];
      if (!pool?.lanes || laneIndex < 0 || laneIndex >= pool.lanes.length) return;
      const lane = pool.lanes[laneIndex];
      if (!lane.elements) lane.elements = [];
      const element = elementFromPaletteRef(typeOrItem);
      lane.elements.push(element);
      selectedLaneIndex.value = laneIndex;
      saveToHistory();
    }

    function setAssociations(nextAssociations) {
      const list = Array.isArray(nextAssociations) ? nextAssociations : [];
      const usedIds = new Set();
      diagram.value.associations = list
        .filter(Boolean)
        .map((a) => {
          const copy = { ...a };
          let aid = copy.id != null && String(copy.id).trim() !== '' ? String(copy.id) : null;
          if (!aid || usedIds.has(aid)) {
            aid = createAssociation(
              copy.sourceRef,
              copy.targetRef,
              copy.label || '',
              copy.direction === 'none' ? 'none' : 'to'
            ).id;
          }
          usedIds.add(aid);
          return { ...copy, id: aid };
        });
      saveToHistory();
    }

    function addAnnotationForElement(targetElementId) {
      if (!targetElementId) return;
      if (!diagram.value.associations) diagram.value.associations = [];
      const loc = findElementTreeLocation(diagram.value, targetElementId);
      if (!loc) return;
      const annotation = createElement('textAnnotation', '');
      loc.container.splice(loc.index + 1, 0, annotation);
      diagram.value.associations.push(createAssociation(targetElementId, annotation.id, '', 'none'));
      saveToHistory();
    }

    function addLane() {
      const pool = getCurrentPool();
      if (!pool.lanes) {
        pool.lanes = [];
      }
      pool.lanes.push(createLane(`Дорожка ${pool.lanes.length + 1}`));
      lanesVersion.value++;
      saveToHistory();
    }

    function deleteLane(poolIndex, laneIndex) {
      const pool = diagram.value.pools[poolIndex];
      if (pool.lanes.length > 1) {
        pool.lanes.splice(laneIndex, 1);
        lanesVersion.value++;
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
      if (!lane.elements) return;
      const removed = lane.elements[elementIndex];
      const removedId = removed?.id;
      lane.elements.splice(elementIndex, 1);
      if (removedId && Array.isArray(diagram.value.associations)) {
        diagram.value.associations = diagram.value.associations.filter(
          (a) => a && a.sourceRef !== removedId && a.targetRef !== removedId
        );
      }
      saveToHistory();
    }

    // Legacy method for backward compatibility
    function deleteElementLegacy(index) {
      const lane = getCurrentLane();
      if (!lane.elements) return;
      const removed = lane.elements[index];
      const removedId = removed?.id;
      lane.elements.splice(index, 1);
      if (removedId && Array.isArray(diagram.value.associations)) {
        diagram.value.associations = diagram.value.associations.filter(
          (a) => a && a.sourceRef !== removedId && a.targetRef !== removedId
        );
      }
      saveToHistory();
    }

    function clearAll() {
      diagram.value = createEmptyDiagram();
      diagramBuilt.value = false;
      saveToHistory();
      emit('bpmn-xml-updated', '');
    }

    function saveDiagramToList() {
      if (!hasElements.value) return;
      const pool = currentPool.value;
      const title = (pool?.name && String(pool.name).trim()) || 'Диаграмма';
      emit('save-diagram', {
        diagram: JSON.parse(JSON.stringify(diagram.value)),
        diagramBuilt: diagramBuilt.value,
        title,
      });
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
      const template = getTemplate(templateKey);
      if (template) {
        // Check if template is diagram (new format) or process (legacy format)
        if (template.pools && template.pools.length > 0) {
          diagram.value = template;
        } else {
          diagram.value = migrateToDiagramModel(template);
        }
        diagramBuilt.value = false;
        saveToHistory();
        emit('bpmn-xml-updated', '');
      }
    }

    function addElementAfter(poolIndex, laneIndex, elementIndex, typeOrItem) {
      const pool = diagram.value.pools[poolIndex];
      const lane = pool.lanes[laneIndex];
      if (!lane.elements) {
        lane.elements = [];
      }
      const element = elementFromPaletteRef(typeOrItem);
      lane.elements.splice(elementIndex + 1, 0, element);
      saveToHistory();
    }

    // Legacy method for backward compatibility
    function addElementAfterLegacy(index, typeOrItem) {
      const lane = getCurrentLane();
      if (!lane.elements) {
        lane.elements = [];
      }
      const element = elementFromPaletteRef(typeOrItem);
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
      handleDragStart(0, selectedLaneIndex.value, index, event);
    }

    function handleDragEnter(poolIndex, laneIndex, elementIndex, event) {
      dragOverIndex.value = { poolIndex, laneIndex, elementIndex };
      event.preventDefault();
    }

    // Legacy method
    function handleDragEnterLegacy(index, event) {
      handleDragEnter(0, selectedLaneIndex.value, index, event);
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
      handleDrop(0, selectedLaneIndex.value, dropIndex, event);
    }

    return {
      BPMN_PALETTE_GROUPS,
      bpmnPaletteGroupsForAddAfter,
      templates,
      diagram,
      process,
      validation,
      hasElements,
      canUndo,
      canRedo,
      addElement,
      addElementToLane,
      setAssociations,
      addAnnotationForElement,
      addLane,
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
      saveDiagramToList,
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
        return dragOverIndex.value.elementIndex;
      }),
      currentPool,
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
  height: 100%;
  min-height: 0;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  background: #ffffff;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 16px;
  border-bottom: 1px solid #e0e0e0;
  background: #fafafa;
  min-width: 0;
}

.header-content {
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1 1 auto;
}

.panel-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #424242;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-actions {
  display: flex;
  gap: 4px;
}

.panel-content {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow-x: hidden;
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
  min-width: 0;
  max-width: 100%;
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
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px;
  background: #eeeeee;
  border-bottom: 1px solid #e0e0e0;
  border-radius: 8px 8px 0 0;
  min-width: 0;
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
  min-width: 0;
  width: 100%;
  max-width: 100%;
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
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 12px;
  background: #f5f5f5;
  border-bottom: 1px solid #e0e0e0;
  border-radius: 6px 6px 0 0;
  min-width: 0;
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
  min-width: 0;
  width: 100%;
  max-width: 100%;
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
  min-width: 0;
  max-width: 100%;
}

.lane-empty-hint {
  margin: 0 0 12px 0;
  padding: 8px 12px;
  font-size: 0.875rem;
  color: #757575;
  background: #f5f5f5;
  border-radius: 6px;
  border: 1px dashed #e0e0e0;
}
</style>

