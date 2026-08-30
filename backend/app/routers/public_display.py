"""Public, unauthenticated data feed for the LAN-party display (`/display`
on the frontend, see frontend/src/pages/PublicDisplay.tsx).

Mounted at /display-data -- deliberately WITHOUT an /api/ prefix, exactly
like routers/metrics.py's /metrics endpoint. AuthGuardMiddleware only
inspects paths starting with "/api/" (see auth_guard.py), so mounting here
keeps this endpoint reachable with no session cookie without touching that
middleware at all -- the same reasoning metrics.py already documents.

This is meant to run on a screen at a LAN party that anyone in the room can
see, so the contract is strict and one-directional: read-only (GET only,
nothing here ever changes state), and the response is hand-picked aggregate
numbers only. It deliberately does NOT reuse routers/dashboard.py's
get_stats() return shape wholesale -- that response includes top_clients
(client IP addresses), which has no business being broadcast to a public,
unauthenticated screen. Every field below is chosen individually; if you're
adding a field, ask whether a stranger in the room seeing it is fine.

Also fails closed: unless an admin has explicitly turned
`public_display_enabled` on in Settings, this returns a plain 404 -- same
response whether the feature is off or the path is simply wrong, so an
unauthenticated prober learns nothing about the panel's configuration
either way.
"""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.services import app_settings_store, prefill_selection
from app.services.cache_forecast import compute_forecast
from app.services.cache_manager import CacheManagerError, get_disk_usage
from app.services.log_parser import TRAFFIC_WINDOWS, aggregate_service_stats, iter_access_entries, traffic_timeline
from app.settings import settings

router = APIRouter(tags=["public-display"])

_NOT_FOUND = JSONResponse({"detail": "not_found"}, status_code=404)


@router.get(
    "/display-data",
    summary="LAN-party display feed (public, unauthenticated)",
    description="Aggregate cache/traffic numbers for the public /display screen. Returns 404 unless an admin "
    "has enabled `public_display_enabled` in Settings. Intentionally unauthenticated (outside /api/) so a "
    "browser on the LAN can load it with no session cookie -- see this module's docstring for exactly which "
    "fields are (and are deliberately not) exposed here.",
)
def get_display_data():
    cfg = app_settings_store.get_settings()
    if not cfg.get("public_display_enabled"):
        return _NOT_FOUND

    access_path = settings.lancache_log_dir / "access.log"
    entries = iter_access_entries(access_path, max_lines=100_000)

    stats_by_service = aggregate_service_stats(entries)
    total_hit_bytes = sum(s.hit_bytes for s in stats_by_service.values())
    total_miss_bytes = sum(s.miss_bytes for s in stats_by_service.values())
    total_hit_count = sum(s.hit_count for s in stats_by_service.values())
    total_miss_count = sum(s.miss_count for s in stats_by_service.values())
    total_requests = total_hit_count + total_miss_count

    services = sorted(
        (
            {"service": s.service, "hit_bytes": s.hit_bytes, "miss_bytes": s.miss_bytes}
            for s in stats_by_service.values()
        ),
        key=lambda x: x["hit_bytes"] + x["miss_bytes"],
        reverse=True,
    )

    # Fixed 24h/15-min window, not caller-selectable -- a public endpoint
    # must not accept a query parameter that widens what it returns.
    bucket_minutes, bucket_limit = TRAFFIC_WINDOWS["24h"]
    timeline = traffic_timeline(entries, bucket_minutes=bucket_minutes, limit=bucket_limit)

    # Read independently of compute_forecast() below (which also calls
    # get_disk_usage() internally when the cache is growing) so this number
    # still shows up even in forecast reasons that skip the disk read
    # (not_enough_data) -- a second docker exec on a ~20s poll is cheap,
    # and each stat degrading independently (rather than one Docker hiccup
    # blanking the whole response) is worth it on a screen meant to just
    # keep working during a party.
    try:
        percent_used = get_disk_usage().percent_used
    except CacheManagerError:
        percent_used = None

    forecast = compute_forecast(entries)

    # Only a per-service COUNT of what's queued for prefill, never names --
    # names would mean this open, unauthenticated endpoint triggering a
    # live Steam Web API call (using the admin's own stored key) on every
    # poll from anyone in the room, which is both a needless external-API
    # cost and an unnecessary use of that key from an unauthenticated path.
    ready_counts = {
        "steam": len(prefill_selection.read_selection(settings.steam_prefill_config_dir)),
        "battlenet": len(prefill_selection.read_selection(settings.battlenet_prefill_config_dir)),
        "epic": len(prefill_selection.read_selection(settings.epic_prefill_config_dir)),
    }

    return {
        "overall": {
            "total_requests": total_requests,
            "hit_ratio": round(total_hit_count / total_requests, 4) if total_requests else 0.0,
            "bandwidth_saved_bytes": total_hit_bytes,
            "hit_bytes": total_hit_bytes,
            "miss_bytes": total_miss_bytes,
        },
        "services": services,
        "timeline": timeline,
        "percent_used": percent_used,
        "forecast": {
            "available": forecast.available,
            "reason": forecast.reason,
            "hours_until_full": forecast.hours_until_full,
            "growth_bytes_per_day": forecast.growth_bytes_per_day,
        },
        "ready_counts": ready_counts,
    }
