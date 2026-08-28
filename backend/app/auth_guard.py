"""Middleware that requires a logged-in session for API access, with a
narrow set of exemptions -- everything under /api/auth/ (status, setup,
login, logout, AND the two Steam OpenID routes, which conveniently share
the same prefix and are Steam's own login flow, unrelated to the panel's
own auth) plus anything outside /api/ entirely (static assets and the SPA
shell, which the frontend itself gates by checking auth status client-side
and showing a login/setup screen instead of the real app).

While no credentials have been set up yet (first run), every /api/ route
other than /api/auth/* is blocked -- this forces whoever opens the panel
first to go through setup before anything else works, rather than leaving
it wide open indefinitely just because nobody happened to set a password
yet.
"""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.services import auth_credentials_store

_EXEMPT_PREFIX = "/api/auth/"


class AuthGuardMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        if not path.startswith("/api/"):
            return await call_next(request)

        if path.startswith(_EXEMPT_PREFIX):
            return await call_next(request)

        if not auth_credentials_store.is_configured():
            return JSONResponse({"detail": "setup_required"}, status_code=401)

        if not request.session.get("authenticated"):
            return JSONResponse({"detail": "not_authenticated"}, status_code=401)

        return await call_next(request)
