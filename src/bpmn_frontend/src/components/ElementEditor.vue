<template>
  <div class="element-editor" :class="{ 'is-gateway': isGateway, 'is-nested': isNested }">
    <div class="element-header" @click="toggleExpanded" v-if="isGateway">
      <v-icon :icon="expanded ? 'mdi-chevron-down' : 'mdi-chevron-right'" size="small" />
      <v-icon :icon="getElementIcon(element)" size="small" class="element-type-icon" />
      <span class="element-type-label">{{ getElementTypeLabel(element) }}</span>
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
      <v-icon :icon="getElementIcon(element)" size="small" class="element-type-icon" />
      <input
        v-model="localLabel"
        @input="updateLabel"
        :placeholder="getPlaceholder(element.type)"
        class="element-label-input"
        :class="{ 'has-error': hasError }"
        :aria-label="`${getElementTypeLabel(element)} label`"
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

    <!-- Переход к элементу (в т.ч. другая дорожка или элемент вне текущей ветки); не шлюз и не конец -->
    <div
      v-if="canHaveNextElement && nextElementOptions.length > 0"
      class="next-element-row"
    >
      <span class="next-element-label">Переход к:</span>
      <v-select
        :model-value="element.nextElementId || ''"
        :items="nextElementOptions"
        item-title="title"
        item-value="value"
        density="compact"
        hide-details
        clearable
        placeholder="Следующий в дорожке"
        class="next-element-select"
        @update:model-value="updateNextElement"
      />
    </div>

    <div v-if="isGateway && expanded" class="gateway-content">
      <div class="branches-container">
        <div
          v-for="(branch, branchIndex) in (element.branches || [])"
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
            <div class="branch-lane-row">
              <span class="branch-lane-label">Дорожка:</span>
              <v-select
                :model-value="branch.laneId ? String(branch.laneId) : '__same_lane__'"
                :items="lanesForBranch"
                item-title="title"
                item-value="value"
                density="compact"
                hide-details
                class="branch-lane-select lane-v-select"
                min-width="200"
                no-data-text="Нет дорожек"
                @update:model-value="updateBranchLane(branchIndex, $event)"
              >
                <template #selection="{ item }">
                  <span>{{ (!branch.laneId || String(branch.laneId) === '__same_lane__') ? 'Выберите дорожку' : ((item?.raw?.title ?? item?.title) || getLaneTitle(branch.laneId)) }}</span>
                </template>
              </v-select>
            </div>
            <v-checkbox
              v-if="element.type === 'inclusiveGateway' || element.type === 'complexGateway'"
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
              v-for="(pathElement, pathIndex) in (branch.path || [])"
              :key="`branch-${branchIndex}-path-${pathIndex}-${pathElement.id || pathIndex}`"
              :element="pathElement"
              :is-nested="true"
              :pool="pool"
              :lanes="lanes"
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
              <v-list density="compact">
                <template v-for="group in bpmnPaletteGroupsForAddAfter" :key="group.title">
                  <v-list-subheader>{{ group.title }}</v-list-subheader>
                  <v-list-item
                    v-for="item in group.items"
                    :key="item.type"
                    @click="addPathElement(branchIndex, item.type)"
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

    <div v-if="showTaskTypeSelect" class="task-options">
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

    <div v-if="showEventDefinitionSelect" class="task-options">
      <v-select
        :model-value="eventDefinitionValue"
        :items="eventDefinitionItems"
        label="Тип события (BPMN)"
        density="compact"
        hide-details
        @update:model-value="updateEventDefinition"
        class="task-type-select"
      />
    </div>
  </div>
</template>

<script>
import { ref, computed, watch, inject } from 'vue';
import { BPMN_PALETTE_GROUPS, isGatewayType } from '../utils/bpmnPalette.js';

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
    /** Список дорожек пула (для выбора дорожки ветки шлюза) */
    lanes: {
      type: Array,
      default: () => [],
    },
    /** Пул (для реактивного чтения lanes; приоритетнее чем lanes) */
    pool: {
      type: Object,
      default: null,
    },
  },
  emits: ['update', 'delete'],
  setup(props, { emit }) {
    const expanded = ref(true);
    const localLabel = ref(props.element.label || '');
    const poolLanes = inject('poolLanes', ref([]));
    const diagram = inject('diagram', ref(null));
    const getLanes = inject('getLanes', () => []);

    const isGateway = computed(() => isGatewayType(props.element.type));

    const bpmnPaletteGroupsForAddAfter = computed(() =>
      BPMN_PALETTE_GROUPS.map((g) => ({
        title: g.title,
        items: g.items.filter((i) => i.addAfter !== false),
      })).filter((g) => g.items.length > 0)
    );

    const taskOnlyTypes = new Set([
      'task',
      'userTask',
      'serviceTask',
      'scriptTask',
      'businessRuleTask',
      'sendTask',
      'receiveTask',
      'manualTask',
    ]);

    const showTaskTypeSelect = computed(
      () => !isGateway.value && taskOnlyTypes.has(props.element.type)
    );

    const eventDefinitionEligibleTypes = new Set([
      'startEvent',
      'endEvent',
      'intermediateCatchEvent',
      'intermediateThrowEvent',
    ]);

    const showEventDefinitionSelect = computed(
      () => !isGateway.value && eventDefinitionEligibleTypes.has(props.element.type)
    );

    const eventDefinitionItems = [
      { title: 'Простое (без определения)', value: 'none' },
      { title: 'Сообщение', value: 'message' },
      { title: 'Таймер', value: 'timer' },
      { title: 'Сигнал', value: 'signal' },
      { title: 'Ссылка (link throw / link catch)', value: 'link' },
    ];

    const eventDefinitionValue = computed(() => props.element.eventDefinition || 'none');

    const hasError = computed(() => {
      if (!isGateway.value && !localLabel.value.trim()) {
        const optional = new Set([
          'startEvent',
          'endEvent',
          'intermediateCatchEvent',
          'intermediateThrowEvent',
        ]);
        return !optional.has(props.element.type);
      }
      return false;
    });

    /** Элемент может иметь явный переход на другой элемент (в т.ч. на другой дорожке): не шлюз и не конец */
    const canHaveNextElement = computed(
      () =>
        !isGateway.value &&
        props.element.type !== 'endEvent'
    );

    /** Все узлы пула (дорожки + вложенные ветки шлюзов), кроме текущего — для «Переход к» */
    const nextElementOptions = computed(() => {
      const poolData = props.pool && props.pool.lanes ? props.pool : null;
      const lanes = poolData ? poolData.lanes : Array.isArray(props.lanes) ? props.lanes : [];
      const options = [];
      const selfId = props.element.id;

      function pushOptions(el, laneName, pathSuffix) {
        if (!el || !el.id || el.id === selfId) return;
        const label = (el.label && String(el.label).trim()) || getElementTypeLabel(el || {});
        const title = pathSuffix
          ? `${label} — ${laneName} · ${pathSuffix}`
          : `${label} — ${laneName}`;
        options.push({ value: el.id, title });
        if (el.branches) {
          el.branches.forEach((branch, idx) => {
            const cond = branch.condition && String(branch.condition).trim();
            const seg = cond || `ветка ${idx + 1}`;
            const nextSuffix = pathSuffix ? `${pathSuffix} › ${seg}` : seg;
            (branch.path || []).forEach((child) => {
              pushOptions(child, laneName, nextSuffix);
            });
          });
        }
      }

      lanes.forEach((lane) => {
        const laneName = lane.name || lane.id || 'Дорожка';
        (lane.elements || []).forEach((el) => pushOptions(el, laneName, ''));
      });
      return options;
    });

    function updateNextElement(value) {
      const updatedElement = JSON.parse(JSON.stringify(props.element));
      updatedElement.nextElementId = (value && String(value).trim()) || undefined;
      emit('update', updatedElement);
    }

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

    function updateEventDefinition(value) {
      const updatedElement = JSON.parse(JSON.stringify(props.element));
      if (!value || value === 'none') {
        delete updatedElement.eventDefinition;
      } else {
        updatedElement.eventDefinition = value;
      }
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

    /** Дорожки для выпадающего списка. Используем inject poolLanes первым (реактивный computed), чтобы список обновлялся при добавлении дорожек. */
    const lanesForBranch = computed(() => {
      const fromInject = poolLanes.value != null && Array.isArray(poolLanes.value) ? poolLanes.value : [];
      const fromProps = Array.isArray(props.lanes) ? props.lanes : [];
      const fromPool =
        props.pool && Array.isArray(props.pool.lanes) ? props.pool.lanes : [];
      const fromGetLanes = (() => {
        try {
          const lanes = getLanes();
          return Array.isArray(lanes) ? lanes : [];
        } catch {
          return [];
        }
      })();
      const d = diagram.value;
      const fromDiagram =
        d && d.pools && d.pools[0] && Array.isArray(d.pools[0].lanes) ? d.pools[0].lanes : [];
      const list =
        fromInject.length > 0
          ? fromInject
          : fromProps.length > 0
            ? fromProps
            : fromPool.length > 0
              ? fromPool
              : fromGetLanes.length > 0
                ? fromGetLanes
                : fromDiagram.length > 0
                  ? fromDiagram
                  : [];
      const laneItems = (list || [])
        .filter((l) => l && (String(l.id ?? l.value ?? '') !== ''))
        .map((l) => ({
          title: String(l.name ?? l.title ?? l.id ?? l.value ?? ''),
          value: String(l.id ?? l.value ?? ''),
        }));
      return laneItems;
    });

    function updateBranchLane(branchIndex, laneId) {
      if (!props.element.branches || !props.element.branches[branchIndex]) return;
      const updatedElement = JSON.parse(JSON.stringify(props.element));
      const normalized = (laneId && String(laneId).trim()) || '';
      updatedElement.branches[branchIndex].laneId = (normalized && normalized !== '__same_lane__') ? normalized : undefined;
      emit('update', updatedElement);
    }

    function getLaneTitle(laneId) {
      const list = lanesForBranch.value;
      const found = list.find((opt) => opt.value === String(laneId));
      return found?.title ?? String(laneId);
    }

    function addBranch() {
      // Create a deep copy to avoid reference issues
      const updatedElement = JSON.parse(JSON.stringify(props.element));

      if (!updatedElement.branches) {
        updatedElement.branches = [];
      }
      // For exclusive gateway, default to "Да" and "Нет" for first two branches
      let defaultCondition = '';
      if (updatedElement.type === 'exclusiveGateway' || updatedElement.type === 'eventBasedGateway') {
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
      if (isGatewayType(elementType)) {
        if (elementType === 'exclusiveGateway' || elementType === 'eventBasedGateway') {
          newElement.branches = [
            { condition: 'Да', path: [], isDefault: false },
            { condition: 'Нет', path: [], isDefault: false },
          ];
        } else {
          newElement.branches = [{ condition: '', path: [], isDefault: false }];
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

    /** Принимает тип (строка) или объект элемента — для link рисуем разные стрелки как в BPMN. */
    function getElementIcon(typeOrEl) {
      const el = typeOrEl && typeof typeOrEl === 'object' ? typeOrEl : null;
      const type = el ? el.type : typeOrEl;
      if (el?.eventDefinition === 'link') {
        if (type === 'intermediateThrowEvent') return 'mdi-arrow-right-bold-circle';
        if (type === 'intermediateCatchEvent') return 'mdi-arrow-right-circle-outline';
      }
      const icons = {
        startEvent: 'mdi-play-circle',
        endEvent: 'mdi-stop-circle',
        intermediateCatchEvent: 'mdi-circle-outline',
        intermediateThrowEvent: 'mdi-arrow-right-circle-outline',
        task: 'mdi-checkbox-marked-circle',
        userTask: 'mdi-account-circle',
        serviceTask: 'mdi-cog',
        scriptTask: 'mdi-code-tags',
        businessRuleTask: 'mdi-gavel',
        sendTask: 'mdi-send',
        receiveTask: 'mdi-download',
        manualTask: 'mdi-hand-pointing-right',
        subProcess: 'mdi-file-tree',
        callActivity: 'mdi-phone-in-talk',
        exclusiveGateway: 'mdi-source-branch',
        inclusiveGateway: 'mdi-source-branch',
        parallelGateway: 'mdi-source-merge',
        eventBasedGateway: 'mdi-ray-start-arrow',
        complexGateway: 'mdi-vector-polyline',
      };
      return icons[type] || 'mdi-circle';
    }

    function getElementTypeLabel(typeOrEl) {
      const el = typeOrEl && typeof typeOrEl === 'object' ? typeOrEl : null;
      const type = el ? el.type : typeOrEl;
      if (el?.eventDefinition === 'link') {
        if (type === 'intermediateCatchEvent') return 'Событие-ссылка (catch)';
        if (type === 'intermediateThrowEvent') return 'Событие-ссылка (throw)';
      }
      const labels = {
        startEvent: 'Событие начала',
        endEvent: 'Событие конца',
        intermediateCatchEvent: 'Промежуточное (ожидание)',
        intermediateThrowEvent: 'Промежуточное (инициирование)',
        task: 'Задача',
        userTask: 'Пользовательская задача',
        serviceTask: 'Сервисная задача',
        scriptTask: 'Скриптовая задача',
        businessRuleTask: 'Задача бизнес-правила',
        sendTask: 'Задача отправки',
        receiveTask: 'Задача получения',
        manualTask: 'Ручная задача',
        subProcess: 'Подпроцесс',
        callActivity: 'Вызов процесса',
        exclusiveGateway: 'Условие (Если)',
        inclusiveGateway: 'Множественные условия',
        parallelGateway: 'Параллельные процессы',
        eventBasedGateway: 'Шлюз по событиям',
        complexGateway: 'Комплексный шлюз',
      };
      return labels[type] || type;
    }

    function getPlaceholder(type) {
      if (
        props.element?.eventDefinition === 'link' &&
        (type === 'intermediateCatchEvent' || type === 'intermediateThrowEvent')
      ) {
        return 'Имя связи (одинаковое у пары catch и throw)';
      }
      const placeholders = {
        startEvent: 'Название события начала (например, Получение заявки)',
        endEvent: 'Название события конца (например, Заявка зарегистрирована)',
        intermediateCatchEvent: 'Название или пояснение ожидания',
        intermediateThrowEvent: 'Название или пояснение инициирования',
        task: 'Название задачи',
        userTask: 'Название пользовательской задачи',
        serviceTask: 'Название сервисной задачи',
        scriptTask: 'Название скриптовой задачи',
        businessRuleTask: 'Название задачи бизнес-правила',
        sendTask: 'Название задачи отправки',
        receiveTask: 'Название задачи получения',
        manualTask: 'Название ручной задачи',
        subProcess: 'Название подпроцесса',
        callActivity: 'Название вызываемого процесса',
      };
      return placeholders[type] || 'Введите название';
    }

    function getGatewayPlaceholder(type) {
      if (type === 'exclusiveGateway') {
        return 'Вопрос условия (например, Есть ли продукты для заказа?)';
      }
      if (type === 'inclusiveGateway') {
        return 'Вопрос множественного условия';
      }
      if (type === 'parallelGateway') {
        return 'Название параллельного процесса';
      }
      if (type === 'eventBasedGateway') {
        return 'Описание разветвления по событиям';
      }
      if (type === 'complexGateway') {
        return 'Описание комплексной логики шлюза';
      }
      return 'Введите вопрос';
    }

    function getBranchPlaceholder(gatewayType, branchIndex) {
      if (gatewayType === 'exclusiveGateway' || gatewayType === 'eventBasedGateway') {
        if (branchIndex === 0) {
          return 'Да (или укажите условие / событие)';
        }
        return 'Нет (или укажите условие / событие)';
      }
      if (gatewayType === 'inclusiveGateway' || gatewayType === 'complexGateway') {
        return 'Условие ветви';
      }
      if (gatewayType === 'parallelGateway') {
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
      bpmnPaletteGroupsForAddAfter,
      showTaskTypeSelect,
      showEventDefinitionSelect,
      eventDefinitionItems,
      eventDefinitionValue,
      updateEventDefinition,
      hasError,
      canHaveNextElement,
      nextElementOptions,
      updateNextElement,
      taskTypes,
      taskTypeValue,
      toggleExpanded,
      updateLabel,
      updateTaskType,
      updateBranch,
      updateBranchCondition,
      updateBranchLane,
      lanesForBranch,
      getLaneTitle,
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

.next-element-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid #eee;
  background: #fafafa;
}

.next-element-label {
  font-size: 0.85rem;
  color: #616161;
  flex-shrink: 0;
}

.next-element-select {
  flex: 1;
  min-width: 0;
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
  flex-wrap: wrap;
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

.branch-lane-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 200px;
  max-width: 100%;
}
.branch-lane-label {
  font-size: 0.8rem;
  color: #616161;
  white-space: nowrap;
  flex-shrink: 0;
}
.branch-lane-select {
  flex: 1;
  min-width: 140px;
  max-width: 240px;
}

.lane-v-select {
  font-size: 0.9rem;
}

/* Выпадающий список дорожек — минимальная ширина задаётся через menu-props; доп. стили для пунктов */
.lane-v-select :deep(.v-list-item) {
  min-height: 40px;
  padding: 8px 16px;
}
.lane-v-select :deep(.v-list-item-title) {
  white-space: normal;
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

