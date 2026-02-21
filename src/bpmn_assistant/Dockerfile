FROM python:3.12-slim

WORKDIR /app

# Install Node.js and npm
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy pyproject.toml and uv.lock for dependency management
COPY pyproject.toml /app/

# Install uv
RUN pip install --no-cache-dir uv

# Copy the source code early to ensure folder structure exists for uv sync
COPY ./src/bpmn_assistant /app/src/bpmn_assistant

# Install Node.js dependencies for bpmn-auto-layout
WORKDIR /app/src/bpmn_assistant/services
RUN npm init -y && \
    npm install bpmn-auto-layout@^0.4.0

WORKDIR /app

# Install Python dependencies
RUN uv sync --no-dev

# Install bpmn_assistant package
RUN uv pip install --no-cache-dir -e .

EXPOSE 8000

CMD ["sh", "-c", "uv run uvicorn src.bpmn_assistant.app:app --host 0.0.0.0 --port ${PORT:-8000}"]
