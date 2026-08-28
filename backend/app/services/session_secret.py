"""Secret key for signing the session cookie (Starlette SessionMiddleware).
Same generate-once-and-persist pattern as settings_encryption.py's Fernet
key -- an env var override for deployments that prefer that, otherwise an
auto-generated file under /data so it survives container restarts (if this
rotated on every restart, every logged-in user would be logged out each
time the container restarted).
"""

import os
import secrets
from pathlib import Path

_KEY_ENV_VAR = "SESSION_SECRET_KEY"
_KEY_FILE_PATH = Path(os.environ.get("SESSION_SECRET_KEY_PATH", "/data/.session_secret"))


def get_or_create_secret() -> str:
    env_key = os.environ.get(_KEY_ENV_VAR)
    if env_key:
        return env_key

    if _KEY_FILE_PATH.exists():
        return _KEY_FILE_PATH.read_text(encoding="utf-8").strip()

    key = secrets.token_urlsafe(48)
    _KEY_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)
    _KEY_FILE_PATH.write_text(key, encoding="utf-8")
    os.chmod(_KEY_FILE_PATH, 0o600)
    return key
