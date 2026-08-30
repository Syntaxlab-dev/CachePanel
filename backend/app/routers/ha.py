"""A flat, Home-Assistant-REST-sensor-friendly summary of cache/traffic
state -- an alternative to the existing Prometheus /metrics endpoint for
users who'd rather add a couple of `platform: rest` sensors in their
`configuration.yaml` than run a Prometheus+HA-integration stack just for
this. See frontend Settings.tsx's "Home Assistant" card for the generated
YAML snippet that reads from here.

A normal /api/ route, same as any other GET -- reachable either via a
session cookie or a read-only Bearer API token (see
services/api_token_store.py / auth_guard.py), no special-casing needed.
The response is intentionally flat (no nesting) since HA's `value_template`
against `json_attributes` reads a flat dict most naturally.

Reuses the same aggregation functions routers/dashboard.py and
routers/public_display.py already use -- no new log-parsing logic.
"""

from fastapi import APIRouter

from app.services.cache_forecast import compute_forecast
from app.services.cache_manager import CacheManagerError, get_disk_usage
from app.services.log_parser import aggregate_service_stats, iter_access_entries
from app.settings import settings

router = APIRouter(prefix="/api/ha", tags=["home-assistant"])


@router.get(
    "/sensors",
    summary="Home Assistant REST sensor feed",
    description="Flat JSON summary of hit ratio, bandwidth saved, request counts, disk usage, and cache-fill "
    "forecast -- meant to be read by Home Assistant's `platform: rest` sensor (see the ready-made YAML in "
    "Settings). Same read-only Bearer-token auth as every other /api/ route.",
)
def get_sensors():
    access_path = settings.lancache_log_dir / "access.log"
    entries = iter_access_entries(access_path, max_lines=100_000)

    stats_by_service = aggregate_service_stats(entries)
    total_hit_bytes = sum(s.hit_bytes for s in stats_by_service.values())
    total_hit_count = sum(s.hit_count for s in stats_by_service.values())
    total_miss_count = sum(s.miss_count for s in stats_by_service.values())
    total_requests = total_hit_count + total_miss_count

    # Read independently of compute_forecast() below (same reasoning as
    # public_display.py): a forecast reason like "not_enough_data" skips
    # its own disk read entirely, but disk_percent_used should still show
    # up here regardless of whether a forecast could be computed.
    try:
        percent_used = get_disk_usage().percent_used
    except CacheManagerError:
        percent_used = None

    forecast = compute_forecast(entries)

    return {
        "hit_ratio_percent": round(total_hit_count / total_requests * 100, 1) if total_requests else 0.0,
        "bandwidth_saved_gb": round(total_hit_bytes / (1024**3), 2),
        "total_requests": total_requests,
        "disk_percent_used": percent_used,
        "forecast_available": forecast.available,
        "hours_until_full": forecast.hours_until_full,
    }
