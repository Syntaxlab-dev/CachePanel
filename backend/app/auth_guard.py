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
"""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.services import api_token_store, auth_credentials_store

_EXEMPT_PREFIX = "/api/auth/"
_SETUP_EXEMPT_PATHS = {"/api/backup/restore"}
_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
_TOKEN_MGMT_PREFIX = "/api/tokens"


class AuthGuardMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        if not path.startswith("/api/"):
            return await call_next(request)

        if path.startswith(_EXEMPT_PREFIX):
            return await call_next(request)

        if not path.startswith(_TOKEN_MGMT_PREFIX):
            auth_header = request.headers.get("authorization", "")
            if auth_header.startswith("Bearer "):
                raw_token = auth_header.removeprefix("Bearer ").strip()
                if raw_token and api_token_store.verify_token(raw_token):
                    if request.method not in _SAFE_METHODS:
                        return JSONResponse({"detail": "read_only"}, status_code=403)
                    return await call_next(request)

        if not auth_credentials_store.is_configured():
            if path in _SETUP_EXEMPT_PATHS:
                return await call_next(request)
            return JSONResponse({"detail": "setup_required"}, status_code=401)

        if not request.session.get("authenticated"):
            return JSONResponse({"detail": "not_authenticated"}, status_code=401)

        if request.session.get("role") == "viewer" and request.method not in _SAFE_METHODS:
            return JSONResponse({"detail": "read_only"}, status_code=403)

        return await call_next(request)
