"""Per-API-token request rate limiting (4th feature round, Welle 2) -- see
api_token_store.py, which every Bearer-token request already goes through
in auth_guard.py. Before this, a valid token had no request cap at all.

Keyed by the token's own id (see api_token_store.identify_token()), not its
raw value or hash -- the id is already what list_tokens()/delete_token()
use to identify a token in the UI, and it's stable for the token's whole
lifetime, unlike re-hashing the raw value on every single request for no
reason. Limit itself is one global setting (app_settings_store's
api_token_rate_limit_per_minute), not per-token -- see that field's own
comment for why 0 is kept as an explicit "unbounded" opt-out here, unlike
every other numeric setting in that file.
"""

from app.services.rate_limit import SlidingWindowCounter

_WINDOW_SECONDS = 60
_counter = SlidingWindowCounter(_WINDOW_SECONDS)


def check(token_id: int, limit_per_minute: int) -> tuple[bool, int]:
    """Returns (allowed, retry_after_seconds)."""
    return _counter.hit(str(token_id), limit_per_minute)
