/**
 * BPMN Process Templates
 * Pre-built templates for common BPMN patterns
 */

export const templates = {
  simpleCondition: {
    name: 'Простое условие',
    description: 'Базовый поток с условием если/иначе',
    process: [
      {
        id: 'start_1',
        type: 'startEvent',
        label: 'Receiving Application',
      },
      {
        id: 'task_1',
        type: 'task',
        label: 'Check Data Correctness',
      },
      {
        id: 'gateway_1',
        type: 'exclusiveGateway',
        label: '',
        branches: [
          {
            condition: 'Data correct',
            path: [
              {
                id: 'task_2',
                type: 'task',
                label: 'Register Application',
              },
            ],
            isDefault: false,
          },
          {
            condition: 'Data incorrect',
            path: [
              {
                id: 'task_3',
                type: 'task',
                label: 'Request Clarifications',
              },
            ],
            isDefault: false,
          },
        ],
      },
      {
        id: 'end_1',
        type: 'endEvent',
        label: 'Application Registered / Denied',
      },
    ],
  },

  multipleConditions: {
    name: 'Множественные условия',
    description: 'Несколько условных ветвей с логикой И',
    process: [
      {
        id: 'start_1',
        type: 'startEvent',
        label: 'Receiving Order',
      },
      {
        id: 'task_1',
        type: 'task',
        label: 'Check Payment and Stock',
      },
      {
        id: 'gateway_1',
        type: 'inclusiveGateway',
        label: '',
        branches: [
          {
            condition: 'Payment confirmed AND Item in stock',
            path: [
              {
                id: 'task_2',
                type: 'task',
                label: 'Arrange Delivery',
              },
            ],
            isDefault: false,
          },
          {
            condition: 'Payment confirmed AND Item out of stock',
            path: [
              {
                id: 'task_3',
                type: 'task',
                label: 'Notify Client',
              },
            ],
            isDefault: false,
          },
          {
            condition: 'Payment not confirmed',
            path: [
              {
                id: 'task_4',
                type: 'task',
                label: 'Cancel Order',
              },
            ],
            isDefault: false,
          },
        ],
      },
      {
        id: 'end_1',
        type: 'endEvent',
        label: 'Order Processed / Canceled',
      },
    ],
  },

  parallelProcesses: {
    name: 'Параллельные процессы',
    description: 'Несколько процессов, выполняющихся параллельно',
    process: [
      {
        id: 'start_1',
        type: 'startEvent',
        label: 'Project Launch',
      },
      {
        id: 'gateway_1',
        type: 'parallelGateway',
        label: '',
        branches: [
          {
            condition: '',
            path: [
              {
                id: 'task_1',
                type: 'task',
                label: 'Prepare Technical Specification',
              },
            ],
            isDefault: false,
          },
          {
            condition: '',
            path: [
              {
                id: 'task_2',
                type: 'task',
                label: 'Form Budget',
              },
            ],
            isDefault: false,
          },
        ],
      },
      {
        id: 'gateway_2',
        type: 'exclusiveGateway',
        label: '',
        branches: [
          {
            condition: 'Spec ready AND Budget approved',
            path: [
              {
                id: 'task_3',
                type: 'task',
                label: 'Start Implementation',
              },
            ],
            isDefault: false,
          },
          {
            condition: 'At least one not done',
            path: [
              {
                id: 'task_4',
                type: 'task',
                label: 'Rework',
              },
            ],
            isDefault: false,
          },
        ],
      },
      {
        id: 'end_1',
        type: 'endEvent',
        label: 'Project Launched',
      },
    ],
  },

  loop: {
    name: 'Цикл (Повторение)',
    description: 'Процесс с циклом/повторением',
    process: [
      {
        id: 'start_1',
        type: 'startEvent',
        label: 'Product Quality Check',
      },
      {
        id: 'task_1',
        type: 'task',
        label: 'Testing',
      },
      {
        id: 'gateway_1',
        type: 'exclusiveGateway',
        label: '',
        branches: [
          {
            condition: 'Test passed',
            path: [
              {
                id: 'task_2',
                type: 'task',
                label: 'Packaging',
              },
            ],
            isDefault: false,
          },
          {
            condition: 'Test failed',
            path: [
              {
                id: 'task_3',
                type: 'task',
                label: 'Rework',
              },
              {
                id: 'task_4',
                type: 'task',
                label: 'Retest',
              },
            ],
            isDefault: false,
          },
        ],
      },
      {
        id: 'end_1',
        type: 'endEvent',
        label: 'Product Ready for Sale',
      },
    ],
  },

  nestedConditions: {
    name: 'Вложенные условия',
    description: 'Условия, вложенные в другие условия',
    process: [
      {
        id: 'start_1',
        type: 'startEvent',
        label: 'User Online Registration',
      },
      {
        id: 'task_1',
        type: 'task',
        label: 'Check Email',
      },
      {
        id: 'gateway_1',
        type: 'exclusiveGateway',
        label: '',
        branches: [
          {
            condition: 'Email confirmed',
            path: [
              {
                id: 'gateway_2',
                type: 'exclusiveGateway',
                label: '',
                branches: [
                  {
                    condition: 'Age ≥ 18',
                    path: [
                      {
                        id: 'task_2',
                        type: 'task',
                        label: 'Create Account',
                      },
                    ],
                    isDefault: false,
                  },
                  {
                    condition: 'Age < 18',
                    path: [
                      {
                        id: 'task_3',
                        type: 'task',
                        label: 'Deny Registration',
                      },
                    ],
                    isDefault: false,
                  },
                ],
              },
            ],
            isDefault: false,
          },
          {
            condition: 'Email not confirmed',
            path: [
              {
                id: 'task_4',
                type: 'task',
                label: 'Reminder',
              },
            ],
            isDefault: false,
          },
        ],
      },
      {
        id: 'end_1',
        type: 'endEvent',
        label: 'Registration Complete / Denied',
      },
    ],
  },

  withPools: {
    name: 'Процесс с пулами',
    description: 'Пример процесса с несколькими пулами и дорожками',
    diagram: {
      pools: [
        {
          id: 'pool_1',
          name: 'Компания',
          isExternal: false,
          isCollapsed: false,
          lanes: [
            {
              id: 'lane_1',
              name: 'Отдел продаж',
              elements: [
                {
                  id: 'start_1',
                  type: 'startEvent',
                  label: 'Получение заявки',
                },
                {
                  id: 'task_1',
                  type: 'task',
                  label: 'Обработка заявки',
                },
                {
                  id: 'end_1',
                  type: 'endEvent',
                  label: 'Заявка обработана',
                },
              ],
            },
            {
              id: 'lane_2',
              name: 'Отдел доставки',
              elements: [
                {
                  id: 'task_2',
                  type: 'task',
                  label: 'Подготовка к доставке',
                },
                {
                  id: 'task_3',
                  type: 'task',
                  label: 'Доставка товара',
                },
              ],
            },
          ],
        },
        {
          id: 'pool_2',
          name: 'Клиент',
          isExternal: true,
          isCollapsed: false,
          lanes: [],
        },
      ],
      messageFlows: [],
      associations: [],
      artifacts: [],
    },
  },
};

export function getTemplate(name) {
  // Check if it's a diagram template (with pools) or process template (legacy)
  if (templates[name] && templates[name].diagram) {
    return JSON.parse(JSON.stringify(templates[name].diagram));
  }
  return templates[name] ? JSON.parse(JSON.stringify(templates[name].process)) : null;
}

export function getAllTemplates() {
  return Object.keys(templates).map((key) => ({
    key,
    ...templates[key],
  }));
}

