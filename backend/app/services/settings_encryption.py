"""Encryption key handling for the settings store.

Threat model, to be honest about what this actually buys you: this
protects the *settings.json* file from being useful on its own if it
leaks in isolation -- e.g. it ends up in a misconfigured backup, gets
synced somewhere it shouldn't, or is copied out of the `data/` volume by
accident. It does NOT protect against someone who already has root /
filesystem access to the host CachePanel runs on: that person can also
just read the key file sitting right next to it. For a single-container,
self-hosted app there is no realistic way to clear that bar without an
external secrets manager, which is out of scope for what this tool is.
This is defense against accidental partial exposure, not a defense
against a compromised host.
"""

import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

_KEY_ENV_VAR = "SETTINGS_ENCRYPTION_KEY"
_KEY_FILE_PATH = Path(os.environ.get("SETTINGS_ENCRYPTION_KEY_PATH", "/data/.encryption_key"))


def _get_or_create_key() -> bytes:
    env_key = os.environ.get(_KEY_ENV_VAR)
    if env_key:
        return env_key.encode("utf-8")

    if _KEY_FILE_PATH.exists():
        return _KEY_FILE_PATH.read_bytes().strip()

    key = Fernet.generate_key()
    _KEY_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)
    _KEY_FILE_PATH.write_bytes(key)
    os.chmod(_KEY_FILE_PATH, 0o600)
    return key


def get_fernet() -> Fernet:
    return Fernet(_get_or_create_key())


def encrypt(plaintext: bytes) -> bytes:
    return get_fernet().encrypt(plaintext)


def decrypt(ciphertext: bytes) -> bytes:
    """Raises cryptography.fernet.InvalidToken if the data isn't valid
    ciphertext for the current key (wrong/missing key, or the data was
    never encrypted in the first place -- callers should catch this and
    fall back rather than crash)."""
    return get_fernet().decrypt(ciphertext)


__all__ = ["encrypt", "decrypt", "get_fernet", "InvalidToken"]
