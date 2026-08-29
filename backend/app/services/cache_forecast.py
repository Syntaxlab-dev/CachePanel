"""Cache-fill forecast: given the traffic already seen in the parsed
access-log tail, estimate how fast the cache disk is growing and how long
until it fills up.

Growth is estimated from MISS bytes only, not total traffic -- a cache HIT
serves an already-cached response and writes nothing new to disk; only a
MISS downloads fresh data and stores it (see log_parser.py's HIT/MISS
split). The rate is computed over the actual span the parsed log sample
covers (oldest to newest timestamp in it), not an assumed fixed window --
iter_access_entries() reads a bounded tail of the file, so on a quiet cache
that span can be much shorter than any dashboard time-range selector, and
on a busy one the tail can fill up with even less wall-clock time. Using
the sample's own real span keeps the rate honest either way, rather than
silently pretending a fixed 24h/7d/30d window was actually observed.
"""

from dataclasses import dataclass

from app.services.cache_manager import CacheManagerError, get_disk_usage
from app.services.log_parser import AccessEntry

# Below this, a rate computed from the sample is too noisy to trust (a
# five-minute burst of downloads would otherwise imply a wildly wrong
# daily rate) -- report "not enough data" instead of a misleading number.
_MIN_SAMPLE_SECONDS = 3600


@dataclass
class CacheForecast:
    available: bool
    # "not_enough_data" | "not_growing" | "disk_usage_unavailable" | None (only when available)
    reason: str | None
    total_bytes: int | None
    used_bytes: int | None
    percent_used: float | None
    growth_bytes_per_day: float | None
    hours_until_full: float | None


def _unavailable(reason: str, disk_totals: tuple[int, int, float] | None = None) -> CacheForecast:
    total, used, percent = disk_totals if disk_totals else (None, None, None)
    return CacheForecast(
        available=False,
        reason=reason,
        total_bytes=total,
        used_bytes=used,
        percent_used=percent,
        growth_bytes_per_day=None,
        hours_until_full=None,
    )


def compute_forecast(entries: list[AccessEntry]) -> CacheForecast:
    if not entries:
        return _unavailable("not_enough_data")

    oldest = min(e.timestamp for e in entries)
    newest = max(e.timestamp for e in entries)
    span_seconds = (newest - oldest).total_seconds()
    if span_seconds < _MIN_SAMPLE_SECONDS:
        return _unavailable("not_enough_data")

    miss_bytes = sum(e.bytes for e in entries if e.cache_status != "HIT")
    growth_bytes_per_second = miss_bytes / span_seconds

    # Disk usage requires a docker exec into the lancache container (see
    # cache_manager.get_disk_usage()) -- fail soft here too, same as the
    # existing disk-warning scheduler job, rather than letting a Docker
    # hiccup take down the whole forecast (or the dashboard tile it feeds).
    try:
        disk = get_disk_usage()
    except CacheManagerError:
        return _unavailable("disk_usage_unavailable")

    if growth_bytes_per_second <= 0:
        return _unavailable("not_growing", (disk.total_bytes, disk.used_bytes, disk.percent_used))

    remaining_bytes = max(0, disk.total_bytes - disk.used_bytes)
    hours_until_full = remaining_bytes / growth_bytes_per_second / 3600

    return CacheForecast(
        available=True,
        reason=None,
        total_bytes=disk.total_bytes,
        used_bytes=disk.used_bytes,
        percent_used=disk.percent_used,
        growth_bytes_per_day=growth_bytes_per_second * 86400,
        hours_until_full=hours_until_full,
    )
