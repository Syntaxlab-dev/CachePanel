from fastapi import APIRouter

from app.services.cache_forecast import compute_forecast
from app.services.health import get_core_health, run_diagnostics
from app.services.log_parser import iter_access_entries
from app.settings import settings

router = APIRouter(prefix="/api/health", tags=["health"])


@router.get("", summary="Core container health", description="Status + uptime of the core lancache/lancache-dns containers.")
def health():
    results = get_core_health()
    return {
        "containers": [
            {"name": c.name, "status": c.status, "uptime_seconds": c.uptime_seconds} for c in results
        ]
    }


@router.get(
    "/diagnostics",
    summary="Why isn't caching working?",
    description="Ordered checks (containers running, DNS resolves to this server, cache reachable over HTTP) "
    "that together explain why a client might not be getting served from cache.",
)
def diagnostics():
    return {"checks": [{"id": c.id, "status": c.status, "message": c.message} for c in run_diagnostics()]}


@router.get(
    "/forecast",
    summary="Cache-fill forecast",
    description="Estimates how long until the cache disk fills up at the current download rate (MISS bytes "
    "over the span of log data actually available), combined with live disk usage read from the lancache "
    "container. `available: false` means no forecast could be computed -- see `reason` (not_enough_data, "
    "not_growing, or disk_usage_unavailable), not an error.",
)
def forecast():
    access_path = settings.lancache_log_dir / "access.log"
    entries = iter_access_entries(access_path, max_lines=100_000)
    result = compute_forecast(entries)
    return {
        "available": result.available,
        "reason": result.reason,
        "total_bytes": result.total_bytes,
        "used_bytes": result.used_bytes,
        "percent_used": result.percent_used,
        "growth_bytes_per_day": result.growth_bytes_per_day,
        "hours_until_full": result.hours_until_full,
    }
