"""Append-only log of security-relevant and administrative actions (login
success/failure, settings changes, prefill triggers, cache clears, token
and user management, backup/restore) -- for admins to answer "who did what,
when" after the fact. Read-only from the UI's point of view: there is no
edit or delete endpoint, only the automatic cap below.

Same file+Postgres double pattern as run_history_store.py, and the same
"newest N kept, oldest silently dropped" cap -- but here the cap is fixed,
not user-configurable (see run_history_limit in app_settings_store.py for
the contrast). A security audit trail losing its oldest entries under a
size cap is an accepted trade-off (unbounded growth is worse -- this file
is read on every list_entries() call), but letting a user turn the cap up
or down like a UI convenience setting would undersell how much history is
actually guaranteed to exist; a fixed, documented number is a clearer
promise.

log() never raises: every call site is inside an action (a login, a
settings save, a cache clear) that must still succeed even if the audit
write itself fails (disk full, corrupt store, etc.) -- the action not being
logged is a lesser problem than the action itself failing because of a
logging bug.
"""

import json
import logging
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

from app.services import db

logger = logging.getLogger("cachepanel.audit")

_STORE_PATH = Path(os.environ.get("AUDIT_LOG_PATH", "/data/audit_log.json"))
_lock = Lock()
_MAX_ENTRIES = 5000


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_all_file() -> list[dict]:
    if not _STORE_PATH.exists():
        return []
    try:
        data = json.loads(_STORE_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, UnicodeDecodeError, OSError):
        return []


def _write_all_file(entries: list[dict]) -> None:
    _STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=_STORE_PATH.parent, prefix=".audit-log-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(entries, f)
        os.replace(tmp_path, _STORE_PATH)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def log(action: str, username: str | None, detail: str, client_ip: str) -> None:
    """Appends one entry. Deliberately swallows every exception (see module
    docstring) -- a failed audit write must never turn the action being
    logged into a 500."""
    entry = {
        "timestamp": _now_iso(),
        "action": action,
        "username": username or "-",
        "detail": detail,
        "client_ip": client_ip or "unknown",
    }
    try:
        with _lock:
            if db.is_enabled():
                with db.get_connection() as conn:
                    conn.execute(
                        "INSERT INTO audit_log (timestamp, action, username, detail, client_ip) "
                        "VALUES (%s, %s, %s, %s, %s)",
                        (entry["timestamp"], entry["action"], entry["username"], entry["detail"], entry["client_ip"]),
                    )
                    conn.execute(
                        "DELETE FROM audit_log WHERE id NOT IN "
                        "(SELECT id FROM audit_log ORDER BY id DESC LIMIT %s)",
                        (_MAX_ENTRIES,),
                    )
            else:
                entries = _read_all_file()
                entries.insert(0, entry)
                entries = entries[:_MAX_ENTRIES]
                _write_all_file(entries)
    except Exception:
        logger.exception("Failed to write audit log entry (action=%s)", action)


def list_entries(
    action: str | None = None,
    username: str | None = None,
    q: str | None = None,
    since: str | None = None,
    until: str | None = None,
    limit: int = 200,
) -> list[dict]:
    """Newest first. Filters are applied in Python even in the DB path
    (rather than building a dynamic WHERE clause) -- this table is at most
    _MAX_ENTRIES rows, so a full scan per request is cheap, and it keeps
    the filtering logic identical (and identically testable) regardless of
    which storage backend is active."""
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                rows = conn.execute(
                    "SELECT timestamp, action, username, detail, client_ip FROM audit_log ORDER BY id DESC"
                ).fetchall()
            entries = [
                {"timestamp": r[0], "action": r[1], "username": r[2], "detail": r[3], "client_ip": r[4]}
                for r in rows
            ]
        else:
            entries = _read_all_file()

    if action:
        entries = [e for e in entries if e["action"] == action]
    if username:
        needle = username.lower()
        entries = [e for e in entries if needle in e["username"].lower()]
    if q:
        needle = q.lower()
        entries = [
            e
            for e in entries
            if needle in e["detail"].lower() or needle in e["action"].lower() or needle in e["client_ip"].lower()
        ]
    if since:
        entries = [e for e in entries if e["timestamp"] >= since]
    if until:
        entries = [e for e in entries if e["timestamp"] <= until]

    return entries[: max(1, min(limit, _MAX_ENTRIES))]


def list_actions() -> list[str]:
    """Distinct action names currently present, for the filter dropdown --
    computed from whatever's actually in the log rather than a hardcoded
    list, so it never drifts from reality as new call sites are added."""
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                rows = conn.execute("SELECT DISTINCT action FROM audit_log ORDER BY action").fetchall()
            return [r[0] for r in rows]
        entries = _read_all_file()
    return sorted({e["action"] for e in entries})
