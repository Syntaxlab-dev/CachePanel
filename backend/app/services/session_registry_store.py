"""Server-side overlay for panel login sessions (4th feature round, Welle 2)
-- see auth_guard.py's module docstring for why this exists at all:
Starlette's SessionMiddleware is a stateless signed cookie with no
server-side record of which sessions exist, so there was previously no way
to view or individually revoke an issued login. This store is that record.

Same file+Postgres double pattern as client_labels_store.py. Not routed
through app_settings_store.py -- this isn't a setting, and none of these
fields (a random session id, an IP, a user-agent string) need Fernet
encryption at rest the way a secret does.

last_seen_at is deliberately NOT updated on every single request that
touches a session (see auth_guard.py's caller) -- with the file-backed
store that would mean a disk write on every dashboard poll (every 10-30s
per open tab). touch() below is a no-op unless the previous value is more
than _TOUCH_THROTTLE_SECONDS old, which keeps the "last active" timestamp
useful (accurate to within a few minutes) without turning routine reads
into routine writes.
"""

import json
import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock

from app.services import db

_STORE_PATH = Path(os.environ.get("SESSIONS_PATH", "/data/sessions.json"))
_lock = Lock()

_TOUCH_THROTTLE_SECONDS = 5 * 60


def _read_all_file() -> list[dict]:
    if not _STORE_PATH.exists():
        return []
    try:
        data = json.loads(_STORE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, OSError):
        return []
    if not isinstance(data, dict) or "sessions" not in data:
        return []
    required = {"session_id", "username", "created_at", "last_seen_at", "client_ip", "user_agent"}
    return [s for s in data["sessions"] if isinstance(s, dict) and required.issubset(s)]


def _write_all_file(sessions: list[dict]) -> None:
    _STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=_STORE_PATH.parent, prefix=".sessions-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump({"sessions": sessions}, f)
        os.chmod(tmp_path, 0o600)
        os.replace(tmp_path, _STORE_PATH)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def _read_all_db(conn) -> list[dict]:
    rows = conn.execute(
        "SELECT session_id, username, created_at, last_seen_at, client_ip, user_agent FROM sessions"
    ).fetchall()
    return [
        {
            "session_id": r[0],
            "username": r[1],
            "created_at": r[2],
            "last_seen_at": r[3],
            "client_ip": r[4],
            "user_agent": r[5],
        }
        for r in rows
    ]


def create(session_id: str, username: str, client_ip: str, user_agent: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                conn.execute(
                    "INSERT INTO sessions (session_id, username, created_at, last_seen_at, client_ip, user_agent) "
                    "VALUES (%s, %s, %s, %s, %s, %s)",
                    (session_id, username, now, now, client_ip, user_agent),
                )
            return
        sessions = _read_all_file()
        sessions.append(
            {
                "session_id": session_id,
                "username": username,
                "created_at": now,
                "last_seen_at": now,
                "client_ip": client_ip,
                "user_agent": user_agent,
            }
        )
        _write_all_file(sessions)


def exists(session_id: str) -> bool:
    """Whether this session_id is still a live, non-revoked session --
    called on every authenticated request via auth_guard.py, so this is
    intentionally the cheapest possible read on both storage backends."""
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                row = conn.execute("SELECT 1 FROM sessions WHERE session_id = %s", (session_id,)).fetchone()
            return row is not None
        sessions = _read_all_file()
    return any(s["session_id"] == session_id for s in sessions)


def touch(session_id: str, client_ip: str, user_agent: str) -> None:
    """Updates last_seen_at/client_ip/user_agent, but only if the stored
    last_seen_at is older than _TOUCH_THROTTLE_SECONDS -- see module
    docstring for why. Silently does nothing if the session was deleted
    concurrently (e.g. revoked from another tab between the exists() check
    in auth_guard.py and this call) rather than recreating it."""
    now = datetime.now(timezone.utc)
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                row = conn.execute(
                    "SELECT last_seen_at FROM sessions WHERE session_id = %s", (session_id,)
                ).fetchone()
                if row is None:
                    return
                last_seen = datetime.fromisoformat(row[0])
                if now - last_seen < timedelta(seconds=_TOUCH_THROTTLE_SECONDS):
                    return
                conn.execute(
                    "UPDATE sessions SET last_seen_at = %s, client_ip = %s, user_agent = %s WHERE session_id = %s",
                    (now.isoformat(), client_ip, user_agent, session_id),
                )
            return

        sessions = _read_all_file()
        changed = False
        for s in sessions:
            if s["session_id"] != session_id:
                continue
            last_seen = datetime.fromisoformat(s["last_seen_at"])
            if now - last_seen < timedelta(seconds=_TOUCH_THROTTLE_SECONDS):
                return
            s["last_seen_at"] = now.isoformat()
            s["client_ip"] = client_ip
            s["user_agent"] = user_agent
            changed = True
        if changed:
            _write_all_file(sessions)


def list_for_user(username: str) -> list[dict]:
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                sessions = _read_all_db(conn)
        else:
            sessions = _read_all_file()
    return sorted((s for s in sessions if s["username"] == username), key=lambda s: s["last_seen_at"], reverse=True)


def revoke(session_id: str, username: str) -> bool:
    """Deletes one session, scoped to `username` so one account's session
    list endpoint can never be used to revoke another account's session by
    guessing/enumerating session ids. Returns whether anything was
    deleted."""
    with _lock:
        if db.is_enabled():
            with db.get_connection() as conn:
                result = conn.execute(
                    "DELETE FROM sessions WHERE session_id = %s AND username = %s", (session_id, username)
                )
            return result.rowcount > 0
        sessions = _read_all_file()
        remaining = [s for s in sessions if not (s["session_id"] == session_id and s["username"] == username)]
        if len(remaining) == len(sessions):
            return False
        _write_all_file(remaining)
        return True
