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

# Bundled Grafana dashboard JSON, read at runtime by
# app/services/grafana_import.py's one-click import feature (4th feature
# round, Welle 5) -- previously only present in the repo for manual
# download, now needs to actually be inside the image.
COPY grafana ./grafana

EXPOSE 8000

# Reuses the existing unauthenticated /metrics endpoint rather than adding
# a dedicated one -- it already exercises the log parser + Docker client,
# so a healthy response means more than just "the HTTP server is up".
# python3, not curl: this image doesn't otherwise need curl installed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/metrics', timeout=3)" || exit 1

# --proxy-headers: trust X-Forwarded-Proto/X-Forwarded-For from upstream
# (NPM is the only thing that ever talks to this container directly, over
# the Docker-internal network) so request.base_url/request.url.scheme
# reflect the real public https:// URL instead of the plain-http one this
# container actually sees. Without it, anything building an absolute
# callback URL from the request (Steam OpenID's return_to/realm, OIDC
# SSO's redirect_uri) generates an http:// URL that a strict redirect_uri
# check -- like an OIDC provider's -- will reject outright.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]
