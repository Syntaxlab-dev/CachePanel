"""Middleware that requires a logged-in session for API access, with a
narrow set of exemptions -- everything under /api/auth/ (status, setup,
login, logout, AND the two Steam OpenID routes, which conveniently share
the same prefix and are Steam's own login flow, unrelated to the panel's
own auth) plus anything outside /api/ entirely (static assets and the SPA
shell, which the frontend itself gates by checking auth status client-side
and showing a login/setup screen instead of the real app).

While no credentials have been set up yet (first run, or the ./data volume
was lost and recreated), every /api/ route other than /api/auth/* is
blocked -- this forces whoever opens the panel first to go through setup
(or a restore) before anything else works, rather than leaving it wide open
indefinitely just because nobody happened to set a password yet.

POST /api/backup/restore is exempted from that block specifically -- it's
the same trust model as /api/auth/setup itself (whoever gets there first on
an unconfigured instance claims it), and backup.py's own restore feature is
documented as existing precisely for the "./data got wiped, container got
recreated" case. Without this exemption that recovery path is impossible:
restoring the account that used to exist would require already being
logged in as it. Once an account exists, this path goes back to requiring
normal auth like any other -- restoring over a live, already-configured
panel still needs a valid session, so an unauthenticated caller can't use
this to hijack or wipe someone else's panel.

Since the 3rd feature round, an authenticated session also carries a
`role` ("admin" | "viewer", set at login/setup -- see routers/auth.py).
A "viewer" session is blocked from every non-read /api/ request with a 403,
enforced centrally here rather than per-route: the whole point of a
read-only role is that it's safe by construction, not dependent on every
current and future router remembering to add its own check. GET/HEAD/OPTIONS
requests are the only methods that pass through for a viewer -- everything
that mutates state (POST/PUT/PATCH/DELETE) is blocked regardless of path.
/api/auth/* stays fully exempt as before (a viewer must still be able to
log out, and the /totp/* endpoints there do their own session check).

Also since the 3rd feature round (Welle 2): a request carrying a valid
`Authorization: Bearer <token>` header (see services/api_token_store.py)
is treated as authenticated with an implicit "viewer" role, WITHOUT a
session cookie -- this is the read-only path third-party integrations
(Home Assistant, personal scripts) use. It's additive, not a replacement:
checked first, but only takes over the request if the token actually
verifies; anything else (no header, or a header that doesn't match a
stored token) falls straight through to the existing session-cookie logic
below unchanged. Deliberately excluded from /api/tokens/* itself -- token
*management* must only ever be reachable via a real admin session (see
routers/api_tokens.py's own docstring), otherwise a leaked read-only token
could mint itself more tokens.

Also excluded (4th feature round, Welle 2, found during that round's own
review rather than requested up front): /api/settings/* itself. GET
/api/settings returns every setting including decrypted secrets (Steam API
key, Discord webhook URL, ntfy topic, ...) -- fine for a real admin/viewer
*session* (a second logged-in human with the read-only role is trusted
with the whole account), but a generated API token is documented and
handed out for narrow machine-to-machine integrations (see the
Home-Assistant sensor YAML Settings itself generates) that never need
those secrets. Without this exclusion, a token pasted into a Home
Assistant config -- exactly the workflow this feature ships -- would also
be a valid credential for reading every stored secret. Same "narrower
trust boundary than a plain viewer session" reasoning as /api/tokens/*
above, just for confidentiality instead of write access.

Since the 4th feature round (Welle 2), three more checks live here:

1. Per-token rate limiting (see services/token_rate_limit.py): a verified
   Bearer token is now also checked against a requests/minute cap before
   the request is let through, returning 429+Retry-After the same way the
   login endpoint already does for repeated failed passwords. This sits
   INSIDE the "did the token verify" branch -- an invalid token was never
   going to be let through anyway, so there's nothing to rate-limit there.

2. An IP/CIDR allowlist (see services/ip_allowlist.py) for the panel's own
   session-cookie login and every session-authenticated request --
   deliberately NOT applied to a verified Bearer-token request, which is
   its own separate trust boundary (e.g. Home Assistant living on a
   different VLAN than the admin's own browser is expected and fine). It
   IS applied to /api/auth/* (login, setup, TOTP, Steam's OpenID
   callback) despite that prefix's own unconditional exemption below --
   otherwise the allowlist would block everything AFTER login but let an
   outside IP hammer the login form itself, missing the point of an
   access allowlist. The Steam OpenID callback is safe to include here:
   it's Steam's own redirect landing back in the ADMIN's browser, i.e. the
   same client IP as whoever is running the login flow, not a
   server-to-server call from Steam's own infrastructure.

3. A server-side session registry check (see
   services/session_registry_store.py), layered on top of (not instead
   of) the existing `request.session.get("authenticated")` check --
   see that module's docstring for why one is needed at all (the session
   cookie itself is a stateless signed blob with no server-side concept
   of "this one was revoked"). A session whose id was deleted from the
   registry (user logged it out from Settings' "active sessions" list, or
   via /api/auth/logout) is treated exactly like `not_authenticated`, even
   though the cookie's own signature still checks out.
"""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.services import api_token_store, app_settings_store, auth_credentials_store, ip_allowlist, session_registry_store, token_rate_limit

_EXEMPT_PREFIX = "/api/auth/"
_SETUP_EXEMPT_PATHS = {"/api/backup/restore"}
_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
_BEARER_EXEMPT_PREFIXES = ("/api/tokens", "/api/settings")


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


class AuthGuardMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        if not path.startswith("/api/"):
            return await call_next(request)

        if not path.startswith(_BEARER_EXEMPT_PREFIXES):
            auth_header = request.headers.get("authorization", "")
            if auth_header.startswith("Bearer "):
                raw_token = auth_header.removeprefix("Bearer ").strip()
                token_id = api_token_store.identify_token(raw_token) if raw_token else None
                if token_id is not None:
                    limit = app_settings_store.get_settings()["api_token_rate_limit_per_minute"]
                    allowed, retry_after = token_rate_limit.check(token_id, limit)
                    if not allowed:
                        return JSONResponse(
                            {"detail": "rate_limited"}, status_code=429, headers={"Retry-After": str(retry_after)}
                        )
                    if request.method not in _SAFE_METHODS:
                        return JSONResponse({"detail": "read_only"}, status_code=403)
                    return await call_next(request)

        allowlist = app_settings_store.get_settings()["ip_allowlist"]
        if not ip_allowlist.is_allowed(_client_ip(request), allowlist):
            return JSONResponse({"detail": "ip_not_allowed"}, status_code=403)

        if path.startswith(_EXEMPT_PREFIX):
            return await call_next(request)

        if not auth_credentials_store.is_configured():
            if path in _SETUP_EXEMPT_PATHS:
                return await call_next(request)
            return JSONResponse({"detail": "setup_required"}, status_code=401)

        if not request.session.get("authenticated"):
            return JSONResponse({"detail": "not_authenticated"}, status_code=401)

        session_id = request.session.get("session_id")
        if not session_id or not session_registry_store.exists(session_id):
            return JSONResponse({"detail": "not_authenticated"}, status_code=401)
        session_registry_store.touch(session_id, _client_ip(request), request.headers.get("user-agent", ""))

        if request.session.get("role") == "viewer" and request.method not in _SAFE_METHODS:
            return JSONResponse({"detail": "read_only"}, status_code=403)

        return await call_next(request)
