"""Builds the numbers for the weekly Discord cache-summary report -- shared
by scheduler_service.py's scheduled job and routers/settings.py's "send
now" test endpoint, so there is exactly one place that assembles report
numbers rather than the scheduled job and the test button silently
drifting apart from each other over time.

Deliberately re-reads and re-aggregates the log tail itself (same
iter_access_entries()/aggregate_service_stats() calls dashboard.py's
/api/dashboard/stats uses) rather than depending on any browser-held
state -- this runs from a background scheduler job with no request/session
behind it.
"""

from app.services.cache_forecast import compute_forecast
from app.services.log_parser import aggregate_service_stats, iter_access_entries
from app.settings import settings


def build_report() -> dict:
    access_path = settings.lancache_log_dir / "access.log"
    entries = iter_access_entries(access_path, max_lines=100_000)

    stats_by_service = aggregate_service_stats(entries)
    hit_bytes = sum(s.hit_bytes for s in stats_by_service.values())
    hit_count = sum(s.hit_count for s in stats_by_service.values())
    miss_count = sum(s.miss_count for s in stats_by_service.values())
    total_requests = hit_count + miss_count

    forecast = compute_forecast(entries)

    return {
        "total_requests": total_requests,
        "hit_ratio": round(hit_count / total_requests, 4) if total_requests else 0.0,
        # Same definition as dashboard.py's overall.bandwidth_saved_bytes --
        # bytes served from cache instead of being downloaded again.
        "bandwidth_saved_bytes": hit_bytes,
        "percent_used": forecast.percent_used,
        "hours_until_full": forecast.hours_until_full if forecast.available else None,
    }
