"""Per-service prefill schedule configuration (enabled + a single daily
time), persisted the same way as the other /data JSON stores (with an
optional Postgres-backed path behind DATABASE_URL, see db.py). This is
CachePanel's OWN scheduler config -- see scheduler_service.py for what
actually reads this and schedules jobs from it. Not to be confused with
the fixed 02:00/23:00 loops baked into steam-prefill/battlenet-prefill/
epic-prefill's own docker-compose.yml files, which are separate,
pre-existing infrastructure this store knows nothing about.
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

_DEFAULTS = {service: {"enabled": False, "hour": 2, "minute": 0} for service in _SERVICES}


def _read_raw_file() -> dict:
    if not _STORE_PATH.exists():
        return {k: dict(v) for k, v in _DEFAULTS.items()}
    try:
        data = json.loads(_STORE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, OSError):
        return {k: dict(v) for k, v in _DEFAULTS.items()}

    merged = {k: dict(v) for k, v in _DEFAULTS.items()}
    for service in _SERVICES:
        entry = data.get(service)
        if isinstance(entry, dict):
            merged[service].update(
                {
                    k: v
                    for k, v in entry.items()
                    if k in ("enabled", "hour", "minute")
                }
            )
    return merged


def _read_raw_db() -> dict:
    merged = {k: dict(v) for k, v in _DEFAULTS.items()}
    with db.get_connection() as conn:
        rows = conn.execute("SELECT service, enabled, hour, minute FROM schedule").fetchall()
    for service, enabled, hour, minute in rows:
        if service in merged:
            merged[service] = {"enabled": enabled, "hour": hour, "minute": minute}
    return merged


def _read_raw() -> dict:
    return _read_raw_db() if db.is_enabled() else _read_raw_file()


def get_schedule() -> dict:
    with _lock:
        return _read_raw()


def update_schedule(partial: dict) -> dict:
    """partial: {service: {enabled?, hour?, minute?}, ...} -- only the
    services/fields present are updated, everything else keeps its
    current value."""
    with _lock:
        current = _read_raw()
        for service, entry in partial.items():
            if service not in _SERVICES or not isinstance(entry, dict):
                continue
            current[service].update({k: v for k, v in entry.items() if k in ("enabled", "hour", "minute")})

        if db.is_enabled():
            with db.get_connection() as conn:
                for service, entry in current.items():
                    conn.execute(
                        "INSERT INTO schedule (service, enabled, hour, minute) VALUES (%s, %s, %s, %s) "
                        "ON CONFLICT (service) DO UPDATE SET enabled = EXCLUDED.enabled, "
                        "hour = EXCLUDED.hour, minute = EXCLUDED.minute",
                        (service, entry["enabled"], entry["hour"], entry["minute"]),
                    )
            return current

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
