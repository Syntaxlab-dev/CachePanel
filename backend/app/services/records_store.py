"""Two honestly-scoped "record" snapshots -- most bandwidth cached in a
single day, highest hit ratio in a single day -- NOT a full historical
database. There is no day-by-day time-series store in this project (that
would be a separate, much bigger feature); instead a daily scheduler job
(see scheduler_service.py's _run_daily_records_snapshot) reads whatever
the current log tail covers once a day and updates a record here only if
that day's total is a new high.

Same file+Postgres double pattern as client_labels_store.py, but a single
fixed-shape row (like app_settings_store.py's table) rather than an
open-ended key space -- there are exactly two records, not an arbitrary
set of them.

Caveat worth knowing before trusting these numbers too far: the daily
snapshot only sees whatever the log tail currently covers (bounded by
max_lines, see log_parser.py) -- on a very high-traffic day where the
tail's line cap is reached before the day is over, the recorded total can
undercount that day's real traffic. Fine for a fun LAN-party stat, not a
precision metric.
"""

import json
import os
import tempfile
from pathlib import Path
from threading import Lock

from app.services import db

_STORE_PATH = Path(os.environ.get("RECORDS_PATH", "/data/records.json"))
_lock = Lock()

_DEFAULTS = {
    "most_bandwidth_saved_bytes": 0,
    "most_bandwidth_saved_date": None,
    "highest_hit_ratio": 0.0,
    "highest_hit_ratio_date": None,
    # 4th feature round, Welle 5 -- most total requests (hits+misses) seen
    # in a single day, and the best 7-day average of bandwidth saved (see
    # scheduler_service.py's snapshot job for how both are computed).
    "most_requests_in_day": 0,
    "most_requests_in_day_date": None,
    "best_week_avg_bandwidth_bytes": 0.0,
    "best_week_avg_start_date": None,
    "best_week_avg_end_date": None,
}


def _read_raw_file() -> dict:
    if not _STORE_PATH.exists():
        return dict(_DEFAULTS)
    try:
        data = json.loads(_STORE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, OSError):
        return dict(_DEFAULTS)
    if not isinstance(data, dict):
        return dict(_DEFAULTS)
    merged = dict(_DEFAULTS)
    merged.update({k: v for k, v in data.items() if k in _DEFAULTS})
    return merged


def _write_raw_file(records: dict) -> None:
    _STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=_STORE_PATH.parent, prefix=".records-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(records, f)
        os.replace(tmp_path, _STORE_PATH)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def _read_raw_db() -> dict:
    with db.get_connection() as conn:
        row = conn.execute(
            "SELECT most_bandwidth_saved_bytes, most_bandwidth_saved_date, "
            "highest_hit_ratio, highest_hit_ratio_date, most_requests_in_day, "
            "most_requests_in_day_date, best_week_avg_bandwidth_bytes, "
            "best_week_avg_start_date, best_week_avg_end_date FROM records WHERE id = 1"
        ).fetchone()
    if row is None:
        return dict(_DEFAULTS)
    return {
        "most_bandwidth_saved_bytes": row[0],
        "most_bandwidth_saved_date": row[1],
        "highest_hit_ratio": row[2],
        "highest_hit_ratio_date": row[3],
        "most_requests_in_day": row[4],
        "most_requests_in_day_date": row[5],
        "best_week_avg_bandwidth_bytes": row[6],
        "best_week_avg_start_date": row[7],
        "best_week_avg_end_date": row[8],
    }


def _write_raw_db(records: dict) -> None:
    with db.get_connection() as conn:
        conn.execute(
            "INSERT INTO records (id, most_bandwidth_saved_bytes, most_bandwidth_saved_date, "
            "highest_hit_ratio, highest_hit_ratio_date, most_requests_in_day, "
            "most_requests_in_day_date, best_week_avg_bandwidth_bytes, "
            "best_week_avg_start_date, best_week_avg_end_date) VALUES (1, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
            "ON CONFLICT (id) DO UPDATE SET "
            "most_bandwidth_saved_bytes = EXCLUDED.most_bandwidth_saved_bytes, "
            "most_bandwidth_saved_date = EXCLUDED.most_bandwidth_saved_date, "
            "highest_hit_ratio = EXCLUDED.highest_hit_ratio, "
            "highest_hit_ratio_date = EXCLUDED.highest_hit_ratio_date, "
            "most_requests_in_day = EXCLUDED.most_requests_in_day, "
            "most_requests_in_day_date = EXCLUDED.most_requests_in_day_date, "
            "best_week_avg_bandwidth_bytes = EXCLUDED.best_week_avg_bandwidth_bytes, "
            "best_week_avg_start_date = EXCLUDED.best_week_avg_start_date, "
            "best_week_avg_end_date = EXCLUDED.best_week_avg_end_date",
            (
                records["most_bandwidth_saved_bytes"],
                records["most_bandwidth_saved_date"],
                records["highest_hit_ratio"],
                records["highest_hit_ratio_date"],
                records["most_requests_in_day"],
                records["most_requests_in_day_date"],
                records["best_week_avg_bandwidth_bytes"],
                records["best_week_avg_start_date"],
                records["best_week_avg_end_date"],
            ),
        )


def get_records() -> dict:
    with _lock:
        return _read_raw_db() if db.is_enabled() else _read_raw_file()


def record_bandwidth_saved(day_bytes: int, date_str: str) -> bool:
    """Updates the record only if day_bytes is a new high. Returns whether
    it actually changed anything."""
    with _lock:
        current = _read_raw_db() if db.is_enabled() else _read_raw_file()
        if day_bytes <= current["most_bandwidth_saved_bytes"]:
            return False
        current["most_bandwidth_saved_bytes"] = day_bytes
        current["most_bandwidth_saved_date"] = date_str
        if db.is_enabled():
            _write_raw_db(current)
        else:
            _write_raw_file(current)
        return True


def record_hit_ratio(day_ratio: float, date_str: str) -> bool:
    """Updates the record only if day_ratio is a new high. Returns whether
    it actually changed anything."""
    with _lock:
        current = _read_raw_db() if db.is_enabled() else _read_raw_file()
        if day_ratio <= current["highest_hit_ratio"]:
            return False
        current["highest_hit_ratio"] = day_ratio
        current["highest_hit_ratio_date"] = date_str
        if db.is_enabled():
            _write_raw_db(current)
        else:
            _write_raw_file(current)
        return True


def record_most_requests(day_requests: int, date_str: str) -> bool:
    """Updates the record only if day_requests is a new high. Returns
    whether it actually changed anything."""
    with _lock:
        current = _read_raw_db() if db.is_enabled() else _read_raw_file()
        if day_requests <= current["most_requests_in_day"]:
            return False
        current["most_requests_in_day"] = day_requests
        current["most_requests_in_day_date"] = date_str
        if db.is_enabled():
            _write_raw_db(current)
        else:
            _write_raw_file(current)
        return True


def record_best_week_avg(avg_bytes: float, start_date: str, end_date: str) -> bool:
    """Updates the record only if avg_bytes is a new high. Returns whether
    it actually changed anything."""
    with _lock:
        current = _read_raw_db() if db.is_enabled() else _read_raw_file()
        if avg_bytes <= current["best_week_avg_bandwidth_bytes"]:
            return False
        current["best_week_avg_bandwidth_bytes"] = avg_bytes
        current["best_week_avg_start_date"] = start_date
        current["best_week_avg_end_date"] = end_date
        if db.is_enabled():
            _write_raw_db(current)
        else:
            _write_raw_file(current)
        return True
