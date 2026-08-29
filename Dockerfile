FROM node:22-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app

# Populated by the GHCR publish workflow via --build-arg (see
# .github/workflows/docker-publish.yml); stays empty for a plain local
# `docker compose build`, where the About section falls back to showing
# "local build" instead of a commit SHA.
ARG GIT_SHA=
ENV GIT_SHA=$GIT_SHA

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY --from=frontend-build /app/frontend/dist ./static

EXPOSE 8000

# Reuses the existing unauthenticated /metrics endpoint rather than adding
# a dedicated one -- it already exercises the log parser + Docker client,
# so a healthy response means more than just "the HTTP server is up".
# python3, not curl: this image doesn't otherwise need curl installed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/metrics', timeout=3)" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
