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
              :disabled="process.length === 0"
              @click="clearAll"
              color="error"
            />
          </template>
        </v-tooltip>
      </div>
    </div>

    <div class="panel-content">
      <div v-if="process.length === 0" class="empty-state" role="status" aria-live="polite">
        <v-icon icon="mdi-chart-timeline-variant" size="64" color="grey-lighten-1" aria-hidden="true" />
        <p class="empty-state-text">Начните построение BPMN диаграммы</p>
        <p class="empty-state-hint">Добавьте элементы для создания процесса</p>
      </div>

      <div v-else class="process-container">
        <div class="process-elements">
          <div
            v-for="(element, index) in process"
            :key="element.id || index"
            class="element-wrapper"
            :class="{ 'drag-over': dragOverIndex === index }"
            :draggable="true"
            @dragstart="handleDragStart(index, $event)"
            @dragover.prevent
            @drop="handleDrop(index, $event)"
            @dragenter.prevent="handleDragEnter(index, $event)"
            @dragleave="handleDragLeave"
          >
            <ElementEditor
              :element="element"
              @update="updateElement(index, $event)"
              @delete="deleteElement(index)"
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
                  <v-list-item @click="addElementAfter(index, 'task')">
                    <v-list-item-title>
                      <v-icon icon="mdi-checkbox-marked-circle" size="small" class="mr-2" />
                      Задача
                    </v-list-item-title>
                  </v-list-item>
                  <v-list-item @click="addElementAfter(index, 'exclusiveGateway')">
                    <v-list-item-title>
                      <v-icon icon="mdi-source-branch" size="small" class="mr-2" />
                      Условие (Если)
                    </v-list-item-title>
                  </v-list-item>
                  <v-list-item @click="addElementAfter(index, 'endEvent')">
                    <v-list-item-title>
                      <v-icon icon="mdi-stop-circle" size="small" class="mr-2" />
                      Событие конца
                    </v-list-item-title>
                  </v-list-item>
                </v-list>
              </v-menu>
            </div>
          </div>
        </div>

        <div class="add-element-section">
          <v-menu>
            <template v-slot:activator="{ props }">
              <v-btn v-bind="props" color="primary" variant="elevated" class="add-element-btn">
                <v-icon icon="mdi-plus" class="mr-2" />
                Добавить элемент
              </v-btn>
            </template>
            <v-list>
              <v-list-item @click="addElement('startEvent')">
                <v-list-item-title>
                  <v-icon icon="mdi-play-circle" size="small" class="mr-2" />
                  Событие начала
                </v-list-item-title>
              </v-list-item>
              <v-list-item @click="addElement('endEvent')">
                <v-list-item-title>
                  <v-icon icon="mdi-stop-circle" size="small" class="mr-2" />
                  Событие конца
                </v-list-item-title>
              </v-list-item>
              <v-list-item @click="addElement('task')">
                <v-list-item-title>
                  <v-icon icon="mdi-checkbox-marked-circle" size="small" class="mr-2" />
                  Задача
                </v-list-item-title>
              </v-list-item>
              <v-list-item @click="addElement('exclusiveGateway')">
                <v-list-item-title>
                  <v-icon icon="mdi-source-branch" size="small" class="mr-2" />
                  Условие (Если)
                </v-list-item-title>
              </v-list-item>
              <v-list-item @click="addElement('inclusiveGateway')">
                <v-list-item-title>
                  <v-icon icon="mdi-source-branch" size="small" class="mr-2" />
                  Множественные условия
                </v-list-item-title>
              </v-list-item>
              <v-list-item @click="addElement('parallelGateway')">
                <v-list-item-title>
                  <v-icon icon="mdi-source-merge" size="small" class="mr-2" />
                  Параллельные процессы
                </v-list-item-title>
              </v-list-item>
            </v-list>
          </v-menu>
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
        v-else-if="process.length > 0"
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
        :disabled="!validation.isValid || process.length === 0"
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
        :disabled="!validation.isValid || process.length === 0 || !diagramBuilt"
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
            :disabled="!validation.isValid || process.length === 0 || !diagramBuilt"
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
import { ref, computed, watch } from 'vue';
import ElementEditor from './ElementEditor.vue';
import { generateBpmnXml, validateProcess } from '../utils/bpmnGenerator';
import { getTemplate, getAllTemplates } from '../utils/templates';

export default {
  name: 'ConstructorPanel',
  components: {
    ElementEditor,
  },
  emits: ['bpmn-xml-updated'],
  setup(props, { emit }) {
    const process = ref([]);
    const history = ref([[]]);
    const historyIndex = ref(0);
    const templates = getAllTemplates();
    const diagramBuilt = ref(false);
    const draggedIndex = ref(null);
    const dragOverIndex = ref(null);

    const canUndo = computed(() => historyIndex.value > 0);
    const canRedo = computed(() => historyIndex.value < history.value.length - 1);

    const validation = computed(() => {
      const result = validateProcess(process.value, true);
      // Debug: log process structure for troubleshooting
      if (result.errors.length > 0) {
        console.log('Validation errors:', result.errors);
        console.log('Process structure:', JSON.stringify(process.value, null, 2));
        console.log('Has startEvent:', process.value.some((e) => e.type === 'startEvent'));
        console.log('Has endEvent:', process.value.some((e) => e.type === 'endEvent'));
      }
      return result;
    });

    // Don't auto-update diagram, wait for build button
    watch(
      process,
      () => {
        diagramBuilt.value = false;
        emit('bpmn-xml-updated', '');
      },
      { deep: true }
    );

    function saveToHistory() {
      // Remove any history after current index
      history.value = history.value.slice(0, historyIndex.value + 1);
      // Add new state
      history.value.push(JSON.parse(JSON.stringify(process.value)));
      historyIndex.value = history.value.length - 1;
      // Limit history size
      if (history.value.length > 50) {
        history.value.shift();
        historyIndex.value--;
      }
    }

    function addElement(type) {
      const element = {
        id: `element_${Date.now()}_${Math.random()}`,
        type,
        label: '',
      };

      if (
        type === 'exclusiveGateway' ||
        type === 'inclusiveGateway' ||
        type === 'parallelGateway'
      ) {
        // For exclusive gateway, create two branches by default (Да/Нет)
        if (type === 'exclusiveGateway') {
          element.branches = [
            {
              condition: 'Да',
              path: [],
              isDefault: false,
            },
            {
              condition: 'Нет',
              path: [],
              isDefault: false,
            },
          ];
        } else {
          element.branches = [
            {
              condition: '',
              path: [],
              isDefault: false,
            },
          ];
        }
      }

      process.value.push(element);
      saveToHistory();
    }

    function updateElement(index, updatedElement) {
      process.value[index] = updatedElement;
      saveToHistory();
    }

    function deleteElement(index) {
      process.value.splice(index, 1);
      saveToHistory();
    }

    function clearAll() {
      if (confirm('Вы уверены, что хотите очистить все элементы?')) {
        process.value = [];
        diagramBuilt.value = false;
        saveToHistory();
      }
    }

    function buildDiagram() {
      if (!validation.value.isValid) {
        return;
      }

      try {
        console.log('Building diagram from process:', JSON.stringify(process.value, null, 2));
        const bpmnXml = generateBpmnXml(process.value);
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
        process.value = JSON.parse(JSON.stringify(history.value[historyIndex.value]));
      }
    }

    function redo() {
      if (canRedo.value) {
        historyIndex.value++;
        process.value = JSON.parse(JSON.stringify(history.value[historyIndex.value]));
      }
    }

    function exportBpmn() {
      if (!validation.value.isValid) return;

      try {
        const bpmnXml = generateBpmnXml(process.value);
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
      if (process.value.length > 0) {
        if (!confirm('Загрузка шаблона заменит текущий процесс. Продолжить?')) {
          return;
        }
      }
      const templateProcess = getTemplate(templateKey);
      if (templateProcess) {
        process.value = templateProcess;
        diagramBuilt.value = false;
        saveToHistory();
      }
    }

    function addElementAfter(index, type) {
      const element = {
        id: `element_${Date.now()}_${Math.random()}`,
        type,
        label: '',
      };

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
          element.branches = [
            { condition: '', path: [], isDefault: false },
          ];
        }
      }

      process.value.splice(index + 1, 0, element);
      saveToHistory();
    }

    function handleDragStart(index, event) {
      draggedIndex.value = index;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/html', event.target);
    }

    function handleDragEnter(index, event) {
      dragOverIndex.value = index;
      event.preventDefault();
    }

    function handleDragLeave() {
      dragOverIndex.value = null;
    }

    function handleDrop(dropIndex, event) {
      event.preventDefault();
      if (draggedIndex.value === null || draggedIndex.value === dropIndex) {
        draggedIndex.value = null;
        dragOverIndex.value = null;
        return;
      }

      const draggedElement = process.value[draggedIndex.value];
      process.value.splice(draggedIndex.value, 1);

      // Adjust drop index if dragging from before drop position
      const adjustedDropIndex = draggedIndex.value < dropIndex ? dropIndex : dropIndex;
      process.value.splice(adjustedDropIndex, 0, draggedElement);

      draggedIndex.value = null;
      dragOverIndex.value = null;
      saveToHistory();
    }

    return {
      templates,
      process,
      validation,
      canUndo,
      canRedo,
      addElement,
      updateElement,
      deleteElement,
      clearAll,
      undo,
      redo,
      exportBpmn,
      exportPng,
      exportSvg,
      loadTemplate,
      buildDiagram,
      diagramBuilt,
      addElementAfter,
      handleDragStart,
      handleDragEnter,
      handleDragLeave,
      handleDrop,
      dragOverIndex,
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
</style>

