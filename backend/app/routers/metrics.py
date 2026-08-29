"""Prometheus metrics endpoint.

Deliberately mounted at /metrics (no /api/ prefix), NOT because auth_guard
was edited to special-case it, but because AuthGuardMiddleware only guards
paths starting with "/api/" (see auth_guard.py) -- mounting outside that
prefix keeps this endpoint reachable by an external Prometheus scraper
(which never sends the panel's session cookie) without touching the guard
at all. This also matches Prometheus's own convention of scraping a
top-level /metrics path.

Values are recomputed fresh from the same sources routers/dashboard.py and
routers/health.py already read on every scrape (log tail, run_history.json,
docker.sock) -- the backend process has no durable in-memory event stream
of its own, so a CollectorRegistry built per-request with Gauges (not
module-level Counters) is the correct shape here: each scrape reflects
current reality, nothing is double-counted across restarts.
"""

from datetime import datetime

from fastapi import APIRouter
from fastapi.responses import Response
from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Gauge, generate_latest

from app.services import health as health_service
from app.services.log_parser import aggregate_service_stats, iter_access_entries
from app.services.run_history_store import get_history
from app.settings import settings

router = APIRouter(tags=["metrics"])


@router.get(
    "/metrics",
    summary="Prometheus metrics",
    description="Cache hit/miss bytes and requests per service, core-container health, and the most recent "
    "prefill run per service, in Prometheus text exposition format. Intentionally unauthenticated "
    "(outside /api/) so an external scraper can reach it without a session cookie.",
)
def get_metrics():
    registry = CollectorRegistry()

    hit_bytes = Gauge(
        "cachepanel_hit_bytes_total", "Bytes served from cache, per service", ["service"], registry=registry
    )
    miss_bytes = Gauge(
        "cachepanel_miss_bytes_total", "Bytes newly downloaded (cache miss), per service", ["service"], registry=registry
    )
    hit_requests = Gauge(
        "cachepanel_hit_requests_total", "Requests served from cache, per service", ["service"], registry=registry
    )
    miss_requests = Gauge(
        "cachepanel_miss_requests_total", "Requests that missed the cache, per service", ["service"], registry=registry
    )
    hit_ratio = Gauge(
        "cachepanel_hit_ratio", "Cache hit ratio (0-1), per service", ["service"], registry=registry
    )

    access_path = settings.lancache_log_dir / "access.log"
    entries = iter_access_entries(access_path, max_lines=100_000)
    for s in aggregate_service_stats(entries).values():
        hit_bytes.labels(service=s.service).set(s.hit_bytes)
        miss_bytes.labels(service=s.service).set(s.miss_bytes)
        hit_requests.labels(service=s.service).set(s.hit_count)
        miss_requests.labels(service=s.service).set(s.miss_count)
        hit_ratio.labels(service=s.service).set(s.hit_ratio)

    container_up = Gauge(
        "cachepanel_container_up",
        "1 if the core LanCache container is running, else 0",
        ["container"],
        registry=registry,
    )
    for c in health_service.get_core_health():
        container_up.labels(container=c.name).set(1 if c.status == "running" else 0)

    last_run_exit_code = Gauge(
        "cachepanel_last_run_exit_code",
        "Exit code of the most recent prefill run, per service (0 = success)",
        ["service"],
        registry=registry,
    )
    last_run_duration = Gauge(
        "cachepanel_last_run_duration_seconds",
        "Duration of the most recent prefill run, per service",
        ["service"],
        registry=registry,
    )
    last_run_timestamp = Gauge(
        "cachepanel_last_run_timestamp_seconds",
        "Unix timestamp of the most recent prefill run, per service",
        ["service"],
        registry=registry,
    )

    seen_services: set[str] = set()
    for run in get_history():  # newest-first, so first occurrence per service is the latest run
        service = run.get("service")
        if not service or service in seen_services:
            continue
        seen_services.add(service)
        last_run_exit_code.labels(service=service).set(run.get("exit_code", -1))
        last_run_duration.labels(service=service).set(run.get("duration_seconds", 0))
        try:
            last_run_timestamp.labels(service=service).set(datetime.fromisoformat(run["started_at"]).timestamp())
        except (KeyError, ValueError):
            pass

    return Response(content=generate_latest(registry), media_type=CONTENT_TYPE_LATEST)
