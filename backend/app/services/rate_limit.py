"""Generic in-memory sliding-window request counter, keyed by an arbitrary
string. Used by token_rate_limit.py (4th feature round, Welle 2) to cap
requests/minute per API token.

Deliberately NOT used to reimplement login_rate_limit.py on top of this --
that module counts only *failed* login attempts (a lockout), while this
counts *every* request regardless of outcome (a throughput cap). Different
semantics, and login_rate_limit.py is a small, already-shipped, thoroughly
exercised piece of the auth path; refactoring working security code onto a
shared abstraction it doesn't actually need would add risk for no real
benefit. This module exists so the genuinely new counting logic isn't
written twice as this feature round adds a second, differently-shaped
limiter.
"""

import time
from threading import Lock


class SlidingWindowCounter:
    def __init__(self, window_seconds: int):
        self._window_seconds = window_seconds
        self._lock = Lock()
        self._hits: dict[str, list[float]] = {}

    def _prune(self, key: str, now: float) -> list[float]:
        cutoff = now - self._window_seconds
        return [t for t in self._hits.get(key, []) if t > cutoff]

    def hit(self, key: str, limit: int) -> tuple[bool, int]:
        """Records one request for `key` and returns (allowed, retry_after).
        `limit <= 0` means unlimited -- always allowed, nothing recorded
        (no reason to grow the in-memory dict for a key that can never be
        rejected). retry_after is only meaningful when allowed is False."""
        if limit <= 0:
            return True, 0
        now = time.time()
        with self._lock:
            recent = self._prune(key, now)
            if len(recent) >= limit:
                retry_after = int(recent[0] + self._window_seconds - now) + 1
                return False, max(retry_after, 1)
            recent.append(now)
            self._hits[key] = recent
            return True, 0
