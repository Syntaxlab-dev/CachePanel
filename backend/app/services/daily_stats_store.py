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
from pathlib import Path
from threading import Lock

from app.services import db

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
