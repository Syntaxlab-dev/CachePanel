"""Per-service prefill schedule configuration -- multiple time windows per
service (4th feature round, Welle 5), each with its own hour/minute and a
selectable subset of weekdays (0=Monday..6=Sunday, matching APScheduler's
own CronTrigger day_of_week convention already used elsewhere in this
project, e.g. scheduler_service.py's report_weekday/auto_backup_weekday).
Persisted the same way as the other /data JSON stores (with an optional
Postgres-backed path behind DATABASE_URL, see db.py). This is CachePanel's
OWN scheduler config -- see scheduler_service.py for what actually reads
this and schedules jobs from it. Not to be confused with the fixed
02:00/23:00 loops baked into steam-prefill/battlenet-prefill/
epic-prefill's own docker-compose.yml files, which are separate,
pre-existing infrastructure this store knows nothing about.

Migration from the pre-Welle-5 single-hour/minute-per-service shape:
- File path: an entry with "hour"/"minute" keys directly and no "windows"
  key is the OLD format -- read_time synthesizes a single window covering
  all 7 days from it. Once anything is saved via update_schedule(), the
  entry always carries a "windows" key from then on (even an explicitly
  emptied `[]`), so the presence of that key alone distinguishes "already
  on the new format" from "never touched since the upgrade" -- no separate
  migrated-flag needed for the file path.
- DB path: the `schedule` table's hour/minute columns can't represent that
  same "key present or not" distinction (they're NOT NULL columns), so a
  sentinel is used instead: update_schedule() sets hour=-1 there the first
  time a service's windows are saved through the new API. On read, hour=-1
  means "already migrated" (use whatever's in schedule_windows, even if
  empty) instead of re-synthesizing the old value forever.
"""

import json
import os
import tempfile
from pathlib import Path
from threading import Lock

from app.services import db

_STORE_PATH = Path(os.environ.get("SCHEDULE_CONFIG_PATH", "/data/schedule.json"))
_lock = Lock()

_SERVICES = ("steam", "battlenet", "epic")
_ALL_DAYS = list(range(7))

# Sentinel written to the legacy `schedule.hour` column once a service's
# windows have been saved through the new API -- see module docstring.
_MIGRATED_SENTINEL_HOUR = -1

_DEFAULTS = {service: {"enabled": False, "windows": []} for service in _SERVICES}


def _normalize_window(raw: dict, next_id: int) -> dict | None:
    if not isinstance(raw, dict):
        return None
    try:
        hour = int(raw.get("hour", 2))
        minute = int(raw.get("minute", 0))
    except (TypeError, ValueError):
        return None
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None
    days_raw = raw.get("days")
    if isinstance(days_raw, list) and days_raw:
        days = sorted({int(d) for d in days_raw if isinstance(d, int) and 0 <= d <= 6})
    else:
        days = list(_ALL_DAYS)
    if not days:
        days = list(_ALL_DAYS)
    window_id = raw.get("id")
    if not isinstance(window_id, int):
        window_id = next_id
    return {"id": window_id, "hour": hour, "minute": minute, "days": days}


def _normalize_windows(raw_windows: list) -> list[dict]:
    windows = []
    for i, raw in enumerate(raw_windows, start=1):
        normalized = _normalize_window(raw, i)
        if normalized is not None:
            windows.append(normalized)
    return windows


def _read_raw_file() -> dict:
    if not _STORE_PATH.exists():
        return {k: {"enabled": v["enabled"], "windows": []} for k, v in _DEFAULTS.items()}
    try:
        data = json.loads(_STORE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, OSError):
        return {k: {"enabled": v["enabled"], "windows": []} for k, v in _DEFAULTS.items()}

    merged = {k: {"enabled": False, "windows": []} for k in _SERVICES}
    for service in _SERVICES:
        entry = data.get(service)
        if not isinstance(entry, dict):
            continue
        enabled = bool(entry.get("enabled", False))
        if "windows" in entry and isinstance(entry["windows"], list):
            merged[service] = {"enabled": enabled, "windows": _normalize_windows(entry["windows"])}
        elif "hour" in entry or "minute" in entry:
            # Pre-Welle-5 single-window format -- synthesize one window
            # covering every weekday, matching the old behavior exactly.
            legacy_window = _normalize_window(
                {"hour": entry.get("hour", 2), "minute": entry.get("minute", 0), "days": _ALL_DAYS}, 1
            )
            merged[service] = {"enabled": enabled, "windows": [legacy_window] if legacy_window else []}
        else:
            merged[service] = {"enabled": enabled, "windows": []}
    return merged


def _read_raw_db() -> dict:
    merged = {k: {"enabled": False, "windows": []} for k in _SERVICES}
    with db.get_connection() as conn:
        rows = conn.execute("SELECT service, enabled, hour, minute FROM schedule").fetchall()
        window_rows = conn.execute(
            "SELECT id, service, hour, minute, days FROM schedule_windows ORDER BY id"
        ).fetchall()

    legacy_by_service = {service: (enabled, hour, minute) for service, enabled, hour, minute in rows}
    windows_by_service: dict[str, list[dict]] = {s: [] for s in _SERVICES}
    for window_id, service, hour, minute, days_str in window_rows:
        if service not in windows_by_service:
            continue
        days = sorted({int(d) for d in days_str.split(",") if d.strip().isdigit()}) or list(_ALL_DAYS)
        windows_by_service[service].append({"id": window_id, "hour": hour, "minute": minute, "days": days})

    for service in _SERVICES:
        legacy = legacy_by_service.get(service)
        enabled = bool(legacy[0]) if legacy else False
        db_windows = windows_by_service[service]
        if db_windows:
            merged[service] = {"enabled": enabled, "windows": db_windows}
        elif legacy and legacy[1] == _MIGRATED_SENTINEL_HOUR:
            # Migrated already, just currently has zero windows.
            merged[service] = {"enabled": enabled, "windows": []}
        elif legacy:
            # Never migrated -- synthesize from the legacy single hour/minute.
            legacy_window = _normalize_window(
                {"hour": legacy[1], "minute": legacy[2], "days": _ALL_DAYS}, 1
            )
            merged[service] = {"enabled": enabled, "windows": [legacy_window] if legacy_window else []}
        else:
            merged[service] = {"enabled": False, "windows": []}
    return merged


def _read_raw() -> dict:
    return _read_raw_db() if db.is_enabled() else _read_raw_file()


def get_schedule() -> dict:
    with _lock:
        return _read_raw()


def update_schedule(partial: dict) -> dict:
    """partial: {service: {enabled?, windows?}, ...} -- only the
    services/fields present are updated, everything else keeps its
    current value. `windows` (when present) always REPLACES the entire
    list for that service, same "partial at the service level, full
    replace at the window-list level" contract the frontend's editor
    expects (it always submits its complete, current window list)."""
    with _lock:
        current = _read_raw()
        for service, entry in partial.items():
            if service not in _SERVICES or not isinstance(entry, dict):
                continue
            if "enabled" in entry:
                current[service]["enabled"] = bool(entry["enabled"])
            if "windows" in entry and isinstance(entry["windows"], list):
                current[service]["windows"] = _normalize_windows(entry["windows"])

        if db.is_enabled():
            with db.get_connection() as conn:
                for service, entry in current.items():
                    windows_touched = service in partial and "windows" in partial[service]
                    hour_value = _MIGRATED_SENTINEL_HOUR if windows_touched else None
                    if hour_value is not None:
                        conn.execute(
                            "INSERT INTO schedule (service, enabled, hour, minute) VALUES (%s, %s, %s, %s) "
                            "ON CONFLICT (service) DO UPDATE SET enabled = EXCLUDED.enabled, "
                            "hour = EXCLUDED.hour, minute = EXCLUDED.minute",
                            (service, entry["enabled"], _MIGRATED_SENTINEL_HOUR, 0),
                        )
                        conn.execute("DELETE FROM schedule_windows WHERE service = %s", (service,))
                        for window in entry["windows"]:
                            conn.execute(
                                "INSERT INTO schedule_windows (service, hour, minute, days) VALUES (%s, %s, %s, %s)",
                                (service, window["hour"], window["minute"], ",".join(str(d) for d in window["days"])),
                            )
                    elif service in partial:
                        # Only `enabled` changed -- don't touch hour/minute
                        # (still carries the migration sentinel, or a
                        # not-yet-migrated legacy value) or schedule_windows.
                        conn.execute(
                            "UPDATE schedule SET enabled = %s WHERE service = %s", (entry["enabled"], service)
                        )
                        if conn.execute("SELECT 1 FROM schedule WHERE service = %s", (service,)).fetchone() is None:
                            conn.execute(
                                "INSERT INTO schedule (service, enabled, hour, minute) VALUES (%s, %s, %s, %s)",
                                (service, entry["enabled"], 2, 0),
                            )
            return _read_raw_db()

        _STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(dir=_STORE_PATH.parent, prefix=".schedule-", suffix=".json")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(current, f, indent=2)
            os.replace(tmp_path, _STORE_PATH)
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

        return current
