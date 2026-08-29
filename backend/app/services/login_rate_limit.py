"""In-memory rate limiting for the panel login endpoint. Deliberately no
external dependency (e.g. slowapi) -- this is a single-process app
(uvicorn runs without --workers, see the Dockerfile CMD), so a plain
in-memory dict behind a Lock is enough and avoids pulling in a library
for a handful of lines of real logic. State resets on container restart,
an acceptable tradeoff for a self-hosted single-user panel rather than an
internet-facing multi-tenant service.

Tracks failed attempts by client IP (request.client.host -- the direct
TCP peer, not X-Forwarded-For). Deliberately not trusting a client-supplied
header here: this app is meant to sit on a trusted LAN or behind a reverse
proxy the operator controls, and trusting X-Forwarded-For without knowing
the proxy is actually there would let an attacker bypass the whole limit
just by sending that header themselves.
"""

import time
from threading import Lock

_MAX_ATTEMPTS = 5
_WINDOW_SECONDS = 5 * 60

_lock = Lock()
_attempts: dict[str, list[float]] = {}


def _prune(ip: str, now: float) -> list[float]:
    cutoff = now - _WINDOW_SECONDS
    return [t for t in _attempts.get(ip, []) if t > cutoff]


def is_locked_out(ip: str) -> tuple[bool, int]:
    """Returns (locked_out, seconds_until_retry). Also opportunistically
    prunes expired attempts for this IP, so a caller doesn't need a
    separate cleanup pass."""
    now = time.time()
    with _lock:
        recent = _prune(ip, now)
        _attempts[ip] = recent
        if len(recent) < _MAX_ATTEMPTS:
            return False, 0
        retry_after = int(recent[0] + _WINDOW_SECONDS - now) + 1
        return True, max(retry_after, 1)


def record_failure(ip: str) -> None:
    now = time.time()
    with _lock:
        recent = _prune(ip, now)
        recent.append(now)
        _attempts[ip] = recent


def record_success(ip: str) -> None:
    """Clears this IP's history on a correct login -- a legitimate user
    who mistypes their password a few times shouldn't stay flagged after
    getting it right."""
    with _lock:
        _attempts.pop(ip, None)
