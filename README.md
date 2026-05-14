# BPMN Assistant

Веб-приложение для работы с диаграммами **BPMN 2.0**: визуальный конструктор процессов, предпросмотр на базе [bpmn-js](https://bpmn.io/toolkit/bpmn-js/), импорт и экспорт XML, а также серверные операции над BPMN через REST API.

Проект оформлен в рамках выпускной квалификационной работы (автор: Жукович Эмилия).

## Возможности

- **Конструктор процессов** — сборка структуры из событий, задач, шлюзов (XOR, OR, параллель), вложенных ветвлений, валидация, отмена/повтор действий.
- **Редактор и просмотр** — отображение и правка диаграммы в браузере.
- **Экспорт** — BPMN XML, а также растровый/векторный вывод (PNG, SVG) на стороне клиента.
- **Шаблоны** — готовые заготовки типовых схем.
- **Бэкенд** — преобразование BPMN XML в JSON (`POST /bpmn_to_json`) и автоматическая расстановка элементов (`POST /process-bpmn`) с использованием Node.js и библиотеки `bpmn-auto-layout`.

## Структура репозитория

| Путь | Назначение |
|------|------------|
| `src/bpmn_frontend` | Клиент: Vue 3, Vite, Vuetify, Vue Router |
| `src/bpmn_assistant` | Сервер: FastAPI, генераторы BPMN, сервис разметки |
| `docs` | Диаграммы (PlantUML, SVG): компоненты, развёртывание, сценарии |
| `tests` | Pytest-тесты сервисов и фикстуры BPMN |

Подробное руководство по конструктору: [src/bpmn_frontend/README_CONSTRUCTOR.md](src/bpmn_frontend/README_CONSTRUCTOR.md).

## Требования

- **Python** ≥ 3.13 (см. `pyproject.toml`)
- **Node.js** и npm — для фронтенда и для локального запуска авторазметки на бэкенде
- **Poetry** или **uv** — для зависимостей Python (в Docker используется `uv`)

## Запуск через Docker

Из корня репозитория:

```sh
docker compose up --build
```

- API: [http://localhost:8000](http://localhost:8000) (проверка: `GET /`)
- Фронтенд: [http://localhost:8080](http://localhost:8080)

## Локальная разработка

### Бэкенд

Установите зависимости Python из корня проекта (пример с Poetry):

```sh
poetry install
```

Для работы эндпоинта авторазметки установите Node-зависимости рядом со скриптом разметки (как в `src/bpmn_assistant/Dockerfile`):

```sh
cd src/bpmn_assistant/services
npm init -y
npm install bpmn-auto-layout@^0.4.0
cd ../../..
```

Запуск API (пример; уточните модуль приложения под вашу установку пакета):

```sh
poetry run uvicorn bpmn_assistant.app:app --reload --host 127.0.0.1 --port 8000
```

Если приложение монтируется как `src.bpmn_assistant.app`, используйте соответствующий путь к модулю и `PYTHONPATH`, как в Docker-образе.

### Фронтенд

```sh
cd src/bpmn_frontend
npm install
npm run dev
```

По умолчанию Vite открывает порт **5173**. URL API задаётся переменной `VITE_API_BASE_URL` (см. [src/bpmn_frontend/src/config.js](src/bpmn_frontend/src/config.js)); при отсутствии используется `http://localhost:8000`.

## Тесты

```sh
poetry run pytest
```

(запуск из корня, при необходимости после `poetry install`.)

## Лицензия и контакты

Версия и лицензия могут быть указаны отдельно в репозитории. Автор проекта указан в `pyproject.toml`.
