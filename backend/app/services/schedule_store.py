"""Per-service prefill schedule configuration (enabled + a single daily
time), persisted the same way as the other /data JSON stores. This is
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

_STORE_PATH = Path(os.environ.get("SCHEDULE_CONFIG_PATH", "/data/schedule.json"))
_lock = Lock()

_SERVICES = ("steam", "battlenet", "epic")

_DEFAULTS = {service: {"enabled": False, "hour": 2, "minute": 0} for service in _SERVICES}


def _read_raw() -> dict:
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
