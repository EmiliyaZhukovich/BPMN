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
        label: 'Приём заявления',
      },
      {
        id: 'task_1',
        type: 'task',
        label: 'Проверьте правильность данных',
      },
      {
        id: 'gateway_1',
        type: 'exclusiveGateway',
        label: '',
        branches: [
          {
            condition: 'Данные корректны',
            path: [
              {
                id: 'task_2',
                type: 'task',
                label: 'Зарегистрировать заявку',
              },
            ],
            isDefault: false,
          },
          {
            condition: 'Данные некорректны',
            path: [
              {
                id: 'task_3',
                type: 'task',
                label: 'Запрос на проверку информации',
              },
            ],
            isDefault: false,
          },
        ],
      },
      {
        id: 'end_1',
        type: 'endEvent',
        label: 'Заявка зарегистрирована / Отклонена',
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
    description: 'Несколько процессов, выполняющихся параллельно',
    process: [
      {
        id: 'start_1',
        type: 'startEvent',
        label: 'Запуск проекта',
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
                label: 'Подготовка технической спецификации',
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
                label: 'Форма бюджета',
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
            condition: 'Технические характеристики готовы, и бюджет утвержден.',
            path: [
              {
                id: 'task_3',
                type: 'task',
                label: 'Начало реализации',
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
                label: 'Переработка',
              },
            ],
            isDefault: false,
          },
        ],
      },
      {
        id: 'end_1',
        type: 'endEvent',
        label: 'Проект запущен',
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

  nestedConditions: {
    name: 'Вложенные условия',
    description: 'Условия, вложенные в другие условия',
    process: [
      {
        id: 'start_1',
        type: 'startEvent',
        label: 'Онлайн-регистрация пользователя',
      },
      {
        id: 'task_1',
        type: 'task',
        label: 'Проверьте электронную почту',
      },
      {
        id: 'gateway_1',
        type: 'exclusiveGateway',
        label: '',
        branches: [
          {
            condition: 'Электронное письмо подтверждено.',
            path: [
              {
                id: 'gateway_2',
                type: 'exclusiveGateway',
                label: '',
                branches: [
                  {
                    condition: 'Возраст ≥ 18',
                    path: [
                      {
                        id: 'task_2',
                        type: 'task',
                        label: 'Зарегистрироваться',
                      },
                    ],
                    isDefault: false,
                  },
                  {
                    condition: 'Возраст < 18',
                    path: [
                      {
                        id: 'task_3',
                        type: 'task',
                        label: 'Отказать в регистрации',
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
            condition: 'Адрес электронной почты не подтвержден',
            path: [
              {
                id: 'task_4',
                type: 'task',
                label: 'Напоминание',
              },
            ],
            isDefault: false,
          },
        ],
      },
      {
        id: 'end_1',
        type: 'endEvent',
        label: 'Регистрация завершена / Отклонено',
      },
    ],
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

