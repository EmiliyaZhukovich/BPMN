/**
 * Шаблон «Простое условие» — отдельный модуль, чтобы данные не терялись при правках templates.js.
 * BPMN: дорожка «Менеджер по работе с клиентами», XOR, слияние в «Объяснить решение», message start/catch.
 */
export const SIMPLE_CONDITION_DIAGRAM = {
  pools: [
    {
      id: 'pool_1778363480239_0.8786017102170013',
      name: 'Основной процесс',
      lanes: [
        {
          id: 'lane_1778363480239_0.25774849132333233',
          name: 'Менеджер по работе с клиентами',
          elements: [
            {
              id: 'element_1778363524746_0.5576327814888201',
              type: 'startEvent',
              label: 'У клиента возникла проблема',
              eventDefinition: 'message',
            },
            {
              id: 'element_1778363542795_0.3119194883028735',
              type: 'manualTask',
              label: 'Получить описание проблемы',
            },
            {
              id: 'element_1778363552954_0.6557885682106751',
              type: 'exclusiveGateway',
              label: 'Могу решить проблему сам?',
              branches: [
                {
                  condition: 'Да',
                  path: [],
                  next: 'element_1778363569260_0.9350820292785201',
                  isDefault: false,
                },
                {
                  condition: 'Нет',
                  path: [
                    {
                      id: 'element_1778363577504_0.40486414736134724',
                      type: 'manualTask',
                      label: 'Спросить у 1 линии техподдержки',
                    },
                    {
                      id: 'element_1778363596552_0.4625537405199509',
                      type: 'intermediateCatchEvent',
                      label: 'Ответ получен',
                      eventDefinition: 'message',
                    },
                  ],
                  isDefault: false,
                },
              ],
            },
            {
              id: 'element_1778363569260_0.9350820292785201',
              type: 'manualTask',
              label: 'Объяснить решение',
            },
            {
              id: 'element_1778363629096_0.16263858452455882',
              type: 'endEvent',
              label: '',
            },
          ],
        },
      ],
    },
  ],
  associations: [],
  artifacts: [],
};
