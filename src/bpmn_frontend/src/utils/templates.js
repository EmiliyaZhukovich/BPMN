/**
 * BPMN Process Templates
 * Pre-built templates for common BPMN patterns
 */

import { SIMPLE_CONDITION_DIAGRAM } from './templateSimpleCondition.js';

export const templates = {
  simpleCondition: {
    name: 'Простое условие',
    description:
      '',
    diagram: SIMPLE_CONDITION_DIAGRAM,
  },

  multipleConditions: {
    name: 'Множественные условия',
    description: 'Несколько условных ветвей с логикой И',
    process: [
      {
        id: 'start_1',
        type: 'startEvent',
        label: 'Отправка заказа',
      },
      {
        id: 'task_1',
        type: 'task',
        label: 'Проверка оплаты и наличия товара',
      },
      {
        id: 'gateway_1',
        type: 'inclusiveGateway',
        label: '',
        branches: [
          {
            condition: 'Оплата подтверждена И товар есть в наличии',
            path: [
              {
                id: 'task_2',
                type: 'task',
                label: 'Организовать доставку',
              },
            ],
            isDefault: false,
          },
          {
            condition: 'Оплата подтверждена, но товар отсутствует на складе.',
            path: [
              {
                id: 'task_3',
                type: 'task',
                label: 'Уведомить клиента',
              },
            ],
            isDefault: false,
          },
          {
            condition: 'Платеж не подтвержден',
            path: [
              {
                id: 'task_4',
                type: 'task',
                label: 'Отменить заказ',
              },
            ],
            isDefault: false,
          },
        ],
      },
      {
        id: 'end_1',
        type: 'endEvent',
        label: 'Заказ обработан / Отменен',
      },
    ],
  },

  parallelProcesses: {
    name: 'Параллельные процессы',
    description: 'Подготовка нового сотрудника: параллельно HR и IT',
    /** Полная диаграмма (пул, дорожки HR/IT, объект данных «Договор») — эквивалент эталонного BPMN XML. */
    diagram: {
      pools: [
        {
          id: 'pool_1778279456098_0.4668799290186003',
          name: 'Подготовка нового сотрудника к первому рабочему дню',
          lanes: [
            {
              id: 'lane_1778279456098_0.43330816583362475',
              name: 'HR-специалист',
              elements: [
                {
                  id: 'element_1778279459921_0.12448634235333866',
                  type: 'startEvent',
                  label: 'Новый сотрудник принят на работу',
                },
                {
                  id: 'element_1778279465189_0.9986977176473057',
                  type: 'task',
                  label: 'Внести сотрудника в систему учета персонала',
                },
                {
                  id: 'element_1778279470837_0.9565168521680284',
                  type: 'parallelGateway',
                  label: '',
                  branches: [
                    {
                      condition: '',
                      path: [
                        {
                          id: 'element_1778279475711_0.217395933119644',
                          type: 'task',
                          label: 'Подготовить документы и договор',
                        },
                        {
                          id: 'DataObjectReference_1paa0tb',
                          type: 'dataObjectReference',
                          label: 'Договор',
                        },
                      ],
                      isDefault: false,
                    },
                    {
                      condition: '',
                      path: [
                        {
                          id: 'element_1778279482999_0.9205581726880107',
                          type: 'task',
                          label: 'Настроить компьютер',
                        },
                        {
                          id: 'element_1778279485789_0.7000639406552076',
                          type: 'task',
                          label: 'Создать доступы к системам',
                        },
                      ],
                      isDefault: false,
                      laneId: 'lane_1778279457718_0.9609733565869626',
                    },
                  ],
                },
                {
                  id: 'element_1778279491551_0.9784666201797482',
                  type: 'task',
                  label: 'Уведомить сотрудника, что все готово',
                },
                {
                  id: 'element_1778279495265_0.5692476968152547',
                  type: 'endEvent',
                  label: 'Подготовка завершена',
                },
              ],
            },
            {
              id: 'lane_1778279457718_0.9609733565869626',
              name: 'IT-специалист',
              elements: [],
            },
          ],
        },
      ],
      associations: [
        {
          id: 'assoc_template_onboarding_contract',
          sourceRef: 'element_1778279475711_0.217395933119644',
          targetRef: 'DataObjectReference_1paa0tb',
          label: '',
          direction: 'none',
        },
      ],
      artifacts: [],
    },
  },

  loop: {
    name: 'Цикл (Повторение)',
    description: 'Процесс с циклом/повторением',
    process: [
      {
        id: 'start_1',
        type: 'startEvent',
        label: 'Проверка качества продукции',
      },
      {
        id: 'task_1',
        type: 'task',
        label: 'Тестирование',
      },
      {
        id: 'gateway_1',
        type: 'exclusiveGateway',
        label: '',
        branches: [
          {
            condition: 'Тест пройден',
            path: [
              {
                id: 'task_2',
                type: 'task',
                label: 'Упаковка',
              },
            ],
            isDefault: false,
          },
          {
            condition: 'Тест не пройден',
            path: [
              {
                id: 'task_3',
                type: 'task',
                label: 'Переработка',
              },
              {
                id: 'task_4',
                type: 'task',
                label: 'Повторное тестирование',
              },
            ],
            isDefault: false,
          },
        ],
      },
      {
        id: 'end_1',
        type: 'endEvent',
        label: 'Товар готов к продаже',
      },
    ],
  },

};

export function getTemplate(name) {
  const t = templates[name];
  if (!t) return null;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const pools = t.diagram?.pools;
  if (Array.isArray(pools) && pools.length > 0) {
    return clone(t.diagram);
  }
  if (Array.isArray(t.process)) {
    return clone(t.process);
  }
  return null;
}

export function getAllTemplates() {
  return Object.keys(templates).map((key) => ({
    key,
    ...templates[key],
  }));
}

