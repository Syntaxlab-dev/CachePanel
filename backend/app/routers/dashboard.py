from fastapi import APIRouter, Query

from app.services.log_parser import (
    TRAFFIC_WINDOWS,
    aggregate_service_stats,
    client_stats,
    iter_access_entries,
    recent_activity,
    recent_entries,
    traffic_timeline,
)
from app.settings import settings

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get(
    "/stats",
    summary="Overall cache/traffic statistics",
    description="Aggregates the tail of the LanCache access log into overall + per-service hit/miss stats, "
    "a recent-activity feed, a traffic timeline (bucket size depends on `window`), and a per-client-IP top "
    "list. `window` is one of 24h/7d/30d (default 24h); wider windows use coarser buckets and may show less "
    "data than requested if the log tail read doesn't reach back that far.",
)
def get_stats(window: str = Query("24h", pattern="^(24h|7d|30d)$")):
    access_path = settings.lancache_log_dir / "access.log"
    entries = iter_access_entries(access_path, max_lines=100_000)
    bucket_minutes, bucket_limit = TRAFFIC_WINDOWS[window]

    stats_by_service = aggregate_service_stats(entries)

    total_hit_bytes = sum(s.hit_bytes for s in stats_by_service.values())
    total_miss_bytes = sum(s.miss_bytes for s in stats_by_service.values())
    total_hit_count = sum(s.hit_count for s in stats_by_service.values())
    total_miss_count = sum(s.miss_count for s in stats_by_service.values())
    total_requests = total_hit_count + total_miss_count

    services = sorted(
        (
            {
                "service": s.service,
                "hit_bytes": s.hit_bytes,
                "miss_bytes": s.miss_bytes,
                "total_bytes": s.total_bytes,
                "hit_ratio": s.hit_ratio,
                "last_seen": s.last_seen.isoformat() if s.last_seen else None,
            }
            for s in stats_by_service.values()
        ),
        key=lambda x: x["total_bytes"],
        reverse=True,
    )

    return {
        "overall": {
            "total_requests": total_requests,
            "hit_requests": total_hit_count,
            "miss_requests": total_miss_count,
            "hit_ratio": round(total_hit_count / total_requests, 4) if total_requests else 0.0,
            "hit_bytes": total_hit_bytes,
            "miss_bytes": total_miss_bytes,
            "bandwidth_saved_bytes": total_hit_bytes,
        },
        "services": services,
        "recent_activity": recent_activity(entries),
        "timeline": traffic_timeline(entries, bucket_minutes=bucket_minutes, limit=bucket_limit),
        "top_clients": client_stats(entries),
    }


@router.get(
    "/live-ticker",
    summary="Recent individual requests",
    description="The last ~20 individual completed requests, newest first -- a lighter, separate endpoint "
    "from /stats so a frequently-polling 'what's happening now' widget doesn't recompute the full heavier "
    "aggregation on every poll. Honest framing: LanCache logs one line per completed request, not per "
    "in-progress byte, so this is a pulse of recent activity, not a live download-progress bar.",
)
def get_live_ticker():
    access_path = settings.lancache_log_dir / "access.log"
    entries = iter_access_entries(access_path, max_lines=5_000)
    return {"entries": recent_entries(entries)}
