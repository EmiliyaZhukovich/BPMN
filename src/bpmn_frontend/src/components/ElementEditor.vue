<template>
  <div class="element-editor" :class="{ 'is-gateway': isGateway, 'is-nested': isNested }">
    <div class="element-header" @click="toggleExpanded" v-if="isGateway">
      <v-icon :icon="expanded ? 'mdi-chevron-down' : 'mdi-chevron-right'" size="small" />
      <v-icon :icon="getElementIcon(element.type)" size="small" class="element-type-icon" />
      <span class="element-type-label">{{ getElementTypeLabel(element.type) }}</span>
      <v-chip size="x-small" color="primary" variant="flat" class="ml-2">
        {{ element.branches?.length || 0 }} {{ getBranchLabel(element.branches?.length || 0) }}
      </v-chip>
      <v-spacer />
      <v-btn
        icon="mdi-delete"
        size="x-small"
        variant="text"
        color="error"
        @click.stop="$emit('delete')"
        class="delete-btn"
      />
    </div>

    <div v-if="isGateway" class="gateway-question-section">
      <input
        v-model="localLabel"
        @input="updateLabel"
        :placeholder="getGatewayPlaceholder(element.type)"
        class="gateway-question-input"
        @click.stop
      />
    </div>

    <div v-else class="element-header-simple">
      <v-icon :icon="getElementIcon(element.type)" size="small" class="element-type-icon" />
      <input
        v-model="localLabel"
        @input="updateLabel"
        :placeholder="getPlaceholder(element.type)"
        class="element-label-input"
        :class="{ 'has-error': hasError }"
        :aria-label="`${getElementTypeLabel(element.type)} label`"
        :aria-invalid="hasError"
      />
      <v-btn
        icon="mdi-delete"
        size="x-small"
        variant="text"
        color="error"
        @click="$emit('delete')"
        class="delete-btn"
      />
    </div>

    <div v-if="isGateway && expanded" class="gateway-content">
      <div class="branches-container">
        <div
          v-for="(branch, branchIndex) in element.branches"
          :key="branchIndex"
          class="branch-item"
        >
          <div class="branch-header">
            <v-icon icon="mdi-source-branch" size="small" />
            <input
              :value="branch.condition"
              @input="(e) => updateBranchCondition(branchIndex, e.target.value)"
              :placeholder="getBranchPlaceholder(element.type, branchIndex)"
              class="branch-condition-input"
              aria-label="Branch condition"
            />
            <v-checkbox
              v-if="element.type === 'inclusiveGateway'"
              v-model="branch.isDefault"
              label="По умолчанию"
              density="compact"
              hide-details
              @update:model-value="updateBranch"
            />
            <v-btn
              icon="mdi-delete"
              size="x-small"
              variant="text"
              color="error"
              @click="deleteBranch(branchIndex)"
              class="delete-btn"
            />
          </div>
          <div class="branch-path">
            <ElementEditor
              v-for="(pathElement, pathIndex) in branch.path"
              :key="`branch-${branchIndex}-path-${pathIndex}-${pathElement.id || pathIndex}`"
              :element="pathElement"
              :is-nested="true"
              @update="handlePathUpdate(branchIndex, pathIndex, $event)"
              @delete="deletePathElement(branchIndex, pathIndex)"
            />
            <v-menu>
              <template v-slot:activator="{ props: menuProps }">
                <v-btn
                  v-bind="menuProps"
                  size="small"
                  variant="outlined"
                  color="primary"
                  class="add-path-element-btn"
                >
                  <v-icon icon="mdi-plus" size="small" class="mr-1" />
                  Добавить элемент
                </v-btn>
              </template>
              <v-list>
                <v-list-item @click="addPathElement(branchIndex, 'task')">
                  <v-list-item-title>
                    <v-icon icon="mdi-checkbox-marked-circle" size="small" class="mr-2" />
                    Задача
                  </v-list-item-title>
                </v-list-item>
                <v-list-item @click="addPathElement(branchIndex, 'exclusiveGateway')">
                  <v-list-item-title>
                    <v-icon icon="mdi-source-branch" size="small" class="mr-2" />
                    Условие (Если)
                  </v-list-item-title>
                </v-list-item>
                <v-list-item @click="addPathElement(branchIndex, 'endEvent')">
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
      <v-btn
        @click="addBranch"
        size="small"
        variant="outlined"
        color="primary"
        class="add-branch-btn"
      >
        <v-icon icon="mdi-plus" size="small" class="mr-1" />
        Добавить ветвь
      </v-btn>
    </div>

    <div v-if="!isGateway && (element.type === 'task' || element.type.startsWith('task'))" class="task-options">
      <v-select
        v-model="taskTypeValue"
        :items="taskTypes"
        label="Тип задачи"
        density="compact"
        hide-details
        @update:model-value="updateTaskType"
        class="task-type-select"
      />
    </div>
  </div>
</template>

<script>
import { ref, computed, watch } from 'vue';

export default {
  name: 'ElementEditor',
  props: {
    element: {
      type: Object,
      required: true,
    },
    isNested: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['update', 'delete'],
  setup(props, { emit }) {
    const expanded = ref(true);
    const localLabel = ref(props.element.label || '');

    const isGateway = computed(() => {
      return (
        props.element.type === 'exclusiveGateway' ||
        props.element.type === 'inclusiveGateway' ||
        props.element.type === 'parallelGateway'
      );
    });

    const hasError = computed(() => {
      if (!isGateway.value && !localLabel.value.trim()) {
        return props.element.type !== 'startEvent' && props.element.type !== 'endEvent';
      }
      return false;
    });

    const taskTypes = [
      { title: 'Задача', value: 'task' },
      { title: 'Пользовательская задача', value: 'userTask' },
      { title: 'Сервисная задача', value: 'serviceTask' },
      { title: 'Скриптовая задача', value: 'scriptTask' },
      { title: 'Задача бизнес-правила', value: 'businessRuleTask' },
      { title: 'Задача отправки', value: 'sendTask' },
      { title: 'Задача получения', value: 'receiveTask' },
      { title: 'Ручная задача', value: 'manualTask' },
    ];

    const taskTypeValue = computed({
      get: () => {
        const taskTypeMap = {
          task: 'task',
          userTask: 'userTask',
          serviceTask: 'serviceTask',
          scriptTask: 'scriptTask',
          businessRuleTask: 'businessRuleTask',
          sendTask: 'sendTask',
          receiveTask: 'receiveTask',
          manualTask: 'manualTask',
        };
        return taskTypeMap[props.element.type] || 'task';
      },
      set: (value) => {
        updateTaskType(value);
      },
    });

    watch(
      () => props.element.label,
      (newVal) => {
        localLabel.value = newVal || '';
      }
    );

    function toggleExpanded() {
      expanded.value = !expanded.value;
    }

    function updateLabel() {
      // Create a new object to avoid reference issues
      const updatedElement = JSON.parse(JSON.stringify(props.element));
      updatedElement.label = localLabel.value;
      emit('update', updatedElement);
    }

    function updateTaskType(newType) {
      // Create a new object to avoid reference issues
      const updatedElement = JSON.parse(JSON.stringify(props.element));
      updatedElement.type = newType || 'task';
      emit('update', updatedElement);
    }

    function updateBranch() {
      emit('update', { ...props.element });
    }

    function updateBranchCondition(branchIndex, value) {
      if (props.element.branches && props.element.branches[branchIndex]) {
        // Create a deep copy to avoid reference issues
        const updatedElement = JSON.parse(JSON.stringify(props.element));
        updatedElement.branches[branchIndex].condition = value;
        emit('update', updatedElement);
      }
    }

    function addBranch() {
      // Create a deep copy to avoid reference issues
      const updatedElement = JSON.parse(JSON.stringify(props.element));

      if (!updatedElement.branches) {
        updatedElement.branches = [];
      }
      // For exclusive gateway, default to "Да" and "Нет" for first two branches
      let defaultCondition = '';
      if (updatedElement.type === 'exclusiveGateway') {
        if (updatedElement.branches.length === 0) {
          defaultCondition = 'Да';
        } else if (updatedElement.branches.length === 1) {
          defaultCondition = 'Нет';
        }
      }
      updatedElement.branches.push({
        condition: defaultCondition,
        path: [],
        isDefault: false,
      });
      emit('update', updatedElement);
    }

    function deleteBranch(index) {
      // Create a deep copy to avoid reference issues
      const updatedElement = JSON.parse(JSON.stringify(props.element));
      updatedElement.branches.splice(index, 1);
      emit('update', updatedElement);
    }

    function addPathElement(branchIndex, elementType = 'task') {
      // Create a deep copy to avoid reference issues
      const updatedElement = JSON.parse(JSON.stringify(props.element));

      if (!updatedElement.branches[branchIndex].path) {
        updatedElement.branches[branchIndex].path = [];
      }
      const newElement = {
        id: `element_${Date.now()}_${Math.random()}`,
        type: elementType,
        label: '',
      };

      // If adding a gateway, initialize branches
      if (
        elementType === 'exclusiveGateway' ||
        elementType === 'inclusiveGateway' ||
        elementType === 'parallelGateway'
      ) {
        if (elementType === 'exclusiveGateway') {
          newElement.branches = [
            { condition: 'Да', path: [], isDefault: false },
            { condition: 'Нет', path: [], isDefault: false },
          ];
        } else {
          newElement.branches = [
            { condition: '', path: [], isDefault: false },
          ];
        }
      }

      updatedElement.branches[branchIndex].path.push(newElement);
      emit('update', updatedElement);
    }

    function deletePathElement(branchIndex, pathIndex) {
      // Create a deep copy to avoid reference issues
      const updatedElement = JSON.parse(JSON.stringify(props.element));
      updatedElement.branches[branchIndex].path.splice(pathIndex, 1);
      emit('update', updatedElement);
    }

    function handlePathUpdate(branchIndex, pathIndex, updatedElement) {
      if (props.element.branches && props.element.branches[branchIndex]) {
        const branch = props.element.branches[branchIndex];
        if (branch.path && branch.path[pathIndex]) {
          // Create a new object to avoid reference issues
          branch.path[pathIndex] = { ...updatedElement };
          emit('update', { ...props.element });
        }
      }
    }

    function getElementIcon(type) {
      const icons = {
        startEvent: 'mdi-play-circle',
        endEvent: 'mdi-stop-circle',
        task: 'mdi-checkbox-marked-circle',
        userTask: 'mdi-account-circle',
        serviceTask: 'mdi-cog',
        scriptTask: 'mdi-code-tags',
        businessRuleTask: 'mdi-gavel',
        sendTask: 'mdi-send',
        receiveTask: 'mdi-download',
        manualTask: 'mdi-hand-pointing-right',
        exclusiveGateway: 'mdi-source-branch',
        inclusiveGateway: 'mdi-source-branch',
        parallelGateway: 'mdi-source-merge',
      };
      return icons[type] || 'mdi-circle';
    }

    function getElementTypeLabel(type) {
      const labels = {
        startEvent: 'Событие начала',
        endEvent: 'Событие конца',
        task: 'Задача',
        userTask: 'Пользовательская задача',
        serviceTask: 'Сервисная задача',
        scriptTask: 'Скриптовая задача',
        businessRuleTask: 'Задача бизнес-правила',
        sendTask: 'Задача отправки',
        receiveTask: 'Задача получения',
        manualTask: 'Ручная задача',
        exclusiveGateway: 'Условие (Если)',
        inclusiveGateway: 'Множественные условия',
        parallelGateway: 'Параллельные процессы',
      };
      return labels[type] || type;
    }

    function getPlaceholder(type) {
      const placeholders = {
        startEvent: 'Название события начала (например, Получение заявки)',
        endEvent: 'Название события конца (например, Заявка зарегистрирована)',
        task: 'Название задачи',
        userTask: 'Название пользовательской задачи',
        serviceTask: 'Название сервисной задачи',
        scriptTask: 'Название скриптовой задачи',
        businessRuleTask: 'Название задачи бизнес-правила',
        sendTask: 'Название задачи отправки',
        receiveTask: 'Название задачи получения',
        manualTask: 'Название ручной задачи',
      };
      return placeholders[type] || 'Введите название';
    }

    function getGatewayPlaceholder(type) {
      if (type === 'exclusiveGateway') {
        return 'Вопрос условия (например, Есть ли продукты для заказа?)';
      } else if (type === 'inclusiveGateway') {
        return 'Вопрос множественного условия';
      } else if (type === 'parallelGateway') {
        return 'Название параллельного процесса';
      }
      return 'Введите вопрос';
    }

    function getBranchPlaceholder(gatewayType, branchIndex) {
      if (gatewayType === 'exclusiveGateway') {
        if (branchIndex === 0) {
          return 'Да (или укажите условие)';
        } else {
          return 'Нет (или укажите условие)';
        }
      } else if (gatewayType === 'inclusiveGateway') {
        return 'Условие ветви';
      } else if (gatewayType === 'parallelGateway') {
        return 'Название параллельной ветви';
      }
      return 'Условие';
    }

    function getBranchLabel(count) {
      if (count === 1) return 'ветвь';
      if (count >= 2 && count <= 4) return 'ветви';
      return 'ветвей';
    }

    return {
      expanded,
      localLabel,
      isGateway,
      hasError,
      taskTypes,
      taskTypeValue,
      toggleExpanded,
      updateLabel,
      updateTaskType,
      updateBranch,
      updateBranchCondition,
      addBranch,
      deleteBranch,
      addPathElement,
      deletePathElement,
      handlePathUpdate,
      getElementIcon,
      getElementTypeLabel,
      getPlaceholder,
      getBranchLabel,
      getGatewayPlaceholder,
      getBranchPlaceholder,
    };
  },
};
</script>

<style scoped>
.element-editor {
  margin-bottom: 8px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  background: #ffffff;
  transition: all 0.2s ease;
}

.element-editor.is-nested {
  margin-left: 24px;
  border-left: 3px solid #2196f3;
}

.element-editor.is-gateway {
  background: #f5f5f5;
}

.element-header,
.element-header-simple {
  display: flex;
  align-items: center;
  padding: 12px;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}

.element-header-simple {
  cursor: default;
}

.element-type-icon {
  color: #2196f3;
  flex-shrink: 0;
}

.element-type-label {
  font-weight: 600;
  color: #424242;
  font-size: 0.9rem;
}

.element-label-input {
  flex: 1;
  border: none;
  outline: none;
  padding: 4px 8px;
  font-size: 0.9rem;
  background: transparent;
  border-bottom: 2px solid transparent;
  transition: border-color 0.2s;
}

.element-label-input:focus {
  border-bottom-color: #2196f3;
}

.element-label-input.has-error {
  border-bottom-color: #f44336;
}

.element-label-input::placeholder {
  color: #9e9e9e;
}

.delete-btn {
  opacity: 0.6;
  transition: opacity 0.2s;
}

.delete-btn:hover {
  opacity: 1;
}

.gateway-question-section {
  padding: 8px 12px;
  border-top: 1px solid #e0e0e0;
  background: #ffffff;
}

.gateway-question-input {
  width: 100%;
  border: none;
  outline: none;
  padding: 8px;
  font-size: 0.95rem;
  font-weight: 500;
  background: #f5f5f5;
  border-radius: 4px;
  border: 2px solid transparent;
  transition: border-color 0.2s;
}

.gateway-question-input:focus {
  border-color: #2196f3;
  background: #ffffff;
}

.gateway-question-input::placeholder {
  color: #757575;
  font-weight: normal;
}

.gateway-content {
  padding: 12px;
  border-top: 1px solid #e0e0e0;
  background: #ffffff;
}

.branches-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 12px;
}

.branch-item {
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  padding: 8px;
  background: #fafafa;
}

.branch-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.branch-condition-input {
  flex: 1;
  border: none;
  outline: none;
  padding: 4px 8px;
  font-size: 0.85rem;
  background: #ffffff;
  border-radius: 4px;
  border: 1px solid #e0e0e0;
}

.branch-condition-input:focus {
  border-color: #2196f3;
}

.branch-path {
  margin-left: 16px;
  padding-left: 16px;
  border-left: 2px dashed #bdbdbd;
}

.add-path-element-btn,
.add-branch-btn {
  width: 100%;
  margin-top: 8px;
}

.task-options {
  padding: 8px 12px;
  border-top: 1px solid #e0e0e0;
}

.task-type-select {
  font-size: 0.85rem;
}
</style>

