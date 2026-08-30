"""VAPID key pair for Web Push (see webpush_notifier.py) -- generated once
on first use and persisted to disk, same generate-once-and-reuse pattern as
session_secret.py's session-signing key. This one matters even more to get
right: the browser ties every push subscription to the VAPID *public* key
it was created with (via PushManager.subscribe()'s applicationServerKey) --
if this file were regenerated on every restart, every existing device's
subscription would silently stop working (push sends would fail against a
key the browser never agreed to), and each device would have to
re-subscribe.

Uses py_vapid (a pywebpush dependency, so no extra requirements.txt entry)
for the actual key generation/PEM round-trip -- letting it own that format
rather than hand-rolling EC key serialization keeps it byte-for-byte
compatible with what pywebpush.webpush() expects when handed a Vapid01
instance directly (see webpush_notifier.py).
"""

import base64
import os
from pathlib import Path
from threading import Lock

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid01

_KEY_PATH = Path(os.environ.get("VAPID_PRIVATE_KEY_PATH", "/data/.vapid_private_key.pem"))
_lock = Lock()
_cached: Vapid01 | None = None


def _load_or_create() -> Vapid01:
    global _cached
    if _cached is not None:
        return _cached
    with _lock:
        if _cached is not None:
            return _cached
        _KEY_PATH.parent.mkdir(parents=True, exist_ok=True)
        if _KEY_PATH.exists():
            vapid = Vapid01.from_file(str(_KEY_PATH))
        else:
            vapid = Vapid01()
            vapid.generate_keys()
            vapid.save_key(str(_KEY_PATH))
            os.chmod(_KEY_PATH, 0o600)
        _cached = vapid
        return vapid


def get_vapid() -> Vapid01:
    """The loaded/generated Vapid01 instance itself -- passed straight into
    pywebpush.webpush()'s vapid_private_key argument (it accepts a Vapid01
    instance directly, avoiding any ambiguity about which raw string
    format it'd otherwise expect)."""
    return _load_or_create()


def get_public_key_b64() -> str:
    """Base64url-encoded, unpadded public key in the raw uncompressed-point
    format the browser's PushManager.subscribe({applicationServerKey})
    expects -- NOT the same encoding as the PEM file on disk."""
    vapid = _load_or_create()
    raw = vapid.public_key.public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
