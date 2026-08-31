"""Day-by-day traffic history, for the dashboard's long-term trends chart
(GET /api/dashboard/trends). Unlike most stores in this project (a fixed
set of settings, or an open {key: value} map), this one is a genuinely
growing time series -- one row per calendar day, appended to daily by
scheduler_service.py's existing 23:55 job (the same one records_store.py's
daily snapshot already uses -- see that job's docstring) rather than a
second job re-reading the log tail.

There is no retroactive history: a day only gets a row once this job has
actually run on or after that day, so a fresh install's trends chart starts
empty and fills in from here on, not backfilled from before this feature
existed. See dashboard.py's /trends endpoint and TrendsChart.tsx for the
honest "data collection just started" empty state this implies.

File+Postgres double pattern like client_labels_store.py, but a list that
grows over time rather than a flat map -- record_day() is an upsert (same
day written twice, e.g. after a same-day restart re-runs the snapshot,
replaces rather than duplicates) keyed on the ISO date string.
"""

import json
import os
import tempfile
from datetime import date
from pathlib import Path
from threading import Lock

from app.services import db

_DEFAULT_STREAK_THRESHOLD = 0.8

_STORE_PATH = Path(os.environ.get("DAILY_STATS_PATH", "/data/daily_stats.json"))
_lock = Lock()


def _read_all_file() -> list[dict]:
    if not _STORE_PATH.exists():
        return []
    try:
        data = json.loads(_STORE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, OSError):
        return []
    if not isinstance(data, dict) or not isinstance(data.get("days"), list):
        return []
    return [
        d
        for d in data["days"]
        if isinstance(d, dict) and {"date", "hit_bytes", "miss_bytes", "total_requests"} <= d.keys()
    ]


def _write_all_file(days: list[dict]) -> None:
    _STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=_STORE_PATH.parent, prefix=".daily-stats-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump({"days": days}, f)
        os.replace(tmp_path, _STORE_PATH)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def record_day(date_str: str, hit_bytes: int, miss_bytes: int, total_requests: int) -> None:
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                conn.execute(
                    "INSERT INTO daily_stats (date, hit_bytes, miss_bytes, total_requests) VALUES (%s, %s, %s, %s) "
                    "ON CONFLICT (date) DO UPDATE SET "
                    "hit_bytes = EXCLUDED.hit_bytes, miss_bytes = EXCLUDED.miss_bytes, "
                    "total_requests = EXCLUDED.total_requests",
                    (date_str, hit_bytes, miss_bytes, total_requests),
                )
            return

        days = _read_all_file()
        days = [d for d in days if d["date"] != date_str]
        days.append(
            {"date": date_str, "hit_bytes": hit_bytes, "miss_bytes": miss_bytes, "total_requests": total_requests}
        )
        _write_all_file(days)


def get_range(days: int) -> list[dict]:
    """The most recent `days` calendar days that have a recorded row,
    oldest first (chart-ready order) -- may return fewer than `days`
    entries if data collection hasn't been running that long yet."""
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                rows = conn.execute(
                    "SELECT date, hit_bytes, miss_bytes, total_requests FROM daily_stats "
                    "ORDER BY date DESC LIMIT %s",
                    (days,),
                ).fetchall()
            result = [
                {"date": r[0], "hit_bytes": r[1], "miss_bytes": r[2], "total_requests": r[3]} for r in rows
            ]
        else:
            all_days = sorted(_read_all_file(), key=lambda d: d["date"], reverse=True)
            result = all_days[:days]
    return list(reversed(result))


def get_month_total(month: str) -> dict:
    """Sums every recorded day whose date starts with `month` (a "YYYY-MM"
    string) -- the monthly-budget feature's source of truth for "how much
    traffic this calendar month", deliberately NOT log_parser.py's
    aggregate_service_stats()/traffic_timeline(): those read a *bounded*
    tail of the access log (max_lines, see log_parser.py), which a busy
    LanCache can blow through in well under a month, silently undercounting
    everything before that point. This store's rows are a real one-per-day
    running total instead, with no such window.

    Returns zeros (not an error) for a month with no recorded days yet --
    same "empty state is honest, not broken" contract as get_range()'s own
    "fewer days than requested" case."""
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                row = conn.execute(
                    "SELECT COALESCE(SUM(hit_bytes), 0), COALESCE(SUM(miss_bytes), 0), "
                    "COALESCE(SUM(total_requests), 0) FROM daily_stats WHERE date LIKE %s",
                    (f"{month}%",),
                ).fetchone()
            hit_bytes, miss_bytes, total_requests = row if row else (0, 0, 0)
        else:
            days = [d for d in _read_all_file() if d["date"].startswith(month)]
            hit_bytes = sum(d["hit_bytes"] for d in days)
            miss_bytes = sum(d["miss_bytes"] for d in days)
            total_requests = sum(d["total_requests"] for d in days)
    return {"hit_bytes": hit_bytes, "miss_bytes": miss_bytes, "total_requests": total_requests}


def compute_current_hit_ratio_streak(threshold: float = _DEFAULT_STREAK_THRESHOLD) -> int:
    """How many days in a row, ending at the most recently RECORDED day
    (not necessarily today -- see below), had a hit ratio of at least
    `threshold`. Byte-based (hit_bytes / (hit_bytes + miss_bytes)), NOT the
    request-count-based ratio records_store.py's highest_hit_ratio uses --
    this store only ever kept hit/miss BYTE totals per day, never a
    separate hit/miss request COUNT, so a request-based streak isn't
    derivable from it. Computed fresh on every call rather than persisted:
    it's a live "how's it going right now" number, not a historical record,
    so there's no stale cached value that could ever need invalidating.

    A gap in the calendar (the panel was offline, or a day never got a
    snapshot) breaks the streak at that point rather than skipping over
    it -- checked via real date arithmetic on the `date` column, not just
    "the next row in the list", so two rows that are adjacent in storage
    but not on the calendar don't count as consecutive."""
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                rows = conn.execute(
                    "SELECT date, hit_bytes, miss_bytes FROM daily_stats ORDER BY date DESC"
                ).fetchall()
            days = [{"date": r[0], "hit_bytes": r[1], "miss_bytes": r[2]} for r in rows]
        else:
            days = sorted(_read_all_file(), key=lambda d: d["date"], reverse=True)

    streak = 0
    previous_date: date | None = None
    for day in days:
        total = day["hit_bytes"] + day["miss_bytes"]
        ratio = day["hit_bytes"] / total if total else 0.0
        if ratio < threshold:
            break
        current_date = date.fromisoformat(day["date"])
        if previous_date is not None and (previous_date - current_date).days != 1:
            break
        streak += 1
        previous_date = current_date
    return streak
