# ---- 1. build the React UI ---------------------------------------------------
FROM node:22-alpine AS ui
WORKDIR /ui
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- 2. runtime: FastAPI + the sitecrawl CLI ----------------------------------
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    STATIC_DIR=/app/frontend/dist CLI_DIR=/app/cli PORT=7860

# unprivileged user (Hugging Face Spaces runs as uid 1000)
RUN useradd -m -u 1000 app
WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt

COPY --chown=app:app cli/ cli/
COPY --chown=app:app backend/ backend/
COPY --from=ui --chown=app:app /ui/dist frontend/dist

USER app
WORKDIR /app/backend
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:7860/api/health')"
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*' --timeout-graceful-shutdown 5"]
