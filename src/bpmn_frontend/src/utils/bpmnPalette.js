/**
 * Палитра элементов BPMN 2.0 для конструктора (меню добавления).
 * Группы: события, задачи, составные действия, шлюзы.
 */

/** Типы шлюзов с ветвлениями (кроме параллельного — у него отдельная логика) */
export const GATEWAY_DIVERGING_TYPES = new Set([
  'exclusiveGateway',
  'inclusiveGateway',
  'eventBasedGateway',
  'complexGateway',
]);

export const PARALLEL_GATEWAY_TYPE = 'parallelGateway';

export const ALL_GATEWAY_TYPES = new Set([
  ...GATEWAY_DIVERGING_TYPES,
  PARALLEL_GATEWAY_TYPE,
]);

/** Активности с размерами как у задачи (не круг события) */
export const TASK_LIKE_TYPES = new Set([
  'task',
  'userTask',
  'serviceTask',
  'scriptTask',
  'businessRuleTask',
  'sendTask',
  'receiveTask',
  'manualTask',
  'subProcess',
  'callActivity',
]);

export function isGatewayType(type) {
  return Boolean(type && ALL_GATEWAY_TYPES.has(type));
}

export function isParallelGatewayType(type) {
  return type === PARALLEL_GATEWAY_TYPE;
}

/** Шлюз с ветками через handleGateway (не parallel) */
export function isDivergingGatewayType(type) {
  return GATEWAY_DIVERGING_TYPES.has(type);
}

/**
 * Группы для меню «Добавить элемент».
 * addAfter: показывать в меню «Добавить после» (у процесса обычно одно начальное событие).
 */
export const BPMN_PALETTE_GROUPS = [
  {
    title: 'События',
    items: [
      { type: 'startEvent', title: 'Начальное событие', icon: 'mdi-play-circle', addAfter: false },
      { type: 'endEvent', title: 'Конечное событие', icon: 'mdi-stop-circle', addAfter: true },
      {
        type: 'intermediateCatchEvent',
        title: 'Промежуточное (ожидание)',
        icon: 'mdi-circle-outline',
        addAfter: true,
      },
      {
        type: 'intermediateThrowEvent',
        title: 'Промежуточное (инициирование)',
        icon: 'mdi-arrow-right-circle-outline',
        addAfter: true,
      },
      {
        paletteId: 'intermediateCatchEvent__link',
        type: 'intermediateCatchEvent',
        title: 'Событие-ссылка (catch)',
        icon: 'mdi-arrow-right-circle-outline',
        addAfter: true,
        eventDefinition: 'link',
      },
      {
        paletteId: 'intermediateThrowEvent__link',
        type: 'intermediateThrowEvent',
        title: 'Событие-ссылка (throw)',
        icon: 'mdi-arrow-right-bold-circle',
        addAfter: true,
        eventDefinition: 'link',
      },
    ],
  },
  {
    title: 'Задачи',
    items: [
      { type: 'task', title: 'Абстрактная задача', icon: 'mdi-checkbox-marked-circle', addAfter: true },
      { type: 'userTask', title: 'Пользовательская задача', icon: 'mdi-account-circle', addAfter: true },
      { type: 'serviceTask', title: 'Сервисная задача', icon: 'mdi-cog', addAfter: true },
      { type: 'scriptTask', title: 'Скриптовая задача', icon: 'mdi-code-tags', addAfter: true },
      { type: 'businessRuleTask', title: 'Задача бизнес-правила', icon: 'mdi-gavel', addAfter: true },
      { type: 'sendTask', title: 'Задача отправки сообщения', icon: 'mdi-send', addAfter: true },
      { type: 'receiveTask', title: 'Задача получения сообщения', icon: 'mdi-download', addAfter: true },
      { type: 'manualTask', title: 'Ручная задача', icon: 'mdi-hand-pointing-right', addAfter: true },
    ],
  },
  {
    title: 'Составные действия',
    items: [
      { type: 'subProcess', title: 'Подпроцесс', icon: 'mdi-file-tree', addAfter: true },
      { type: 'callActivity', title: 'Вызов процесса (Call Activity)', icon: 'mdi-phone-in-talk', addAfter: true },
    ],
  },
  {
    title: 'Шлюзы',
    items: [
      { type: 'exclusiveGateway', title: 'Исключающий (XOR)', icon: 'mdi-source-branch', addAfter: true },
      { type: 'inclusiveGateway', title: 'Включающий (OR)', icon: 'mdi-source-branch', addAfter: true },
      { type: 'parallelGateway', title: 'Параллельный (AND)', icon: 'mdi-source-merge', addAfter: true },
      {
        type: 'eventBasedGateway',
        title: 'По событиям',
        icon: 'mdi-ray-start-arrow',
        addAfter: true,
      },
      { type: 'complexGateway', title: 'Комплексный', icon: 'mdi-vector-polyline', addAfter: true },
    ],
  },
];

export function flatPaletteItems() {
  return BPMN_PALETTE_GROUPS.flatMap((g) => g.items);
}

export function paletteItemsForAddAfter() {
  return flatPaletteItems().filter((i) => i.addAfter !== false);
}
