"""Sets standard security-hardening response headers on every response,
frontend routes included -- this one FastAPI process serves both the API
and the built SPA (see main.py's serve_spa catch-all).

CSP is intentionally not maximally strict: React sets inline `style`
attributes directly (e.g. the accent-color swatches in Settings.tsx,
`style={{ background: ... }}`), which a CSP without 'unsafe-inline' in
style-src would block outright -- confirmed by reading the built frontend
before writing this, not assumed. Scripts, by contrast, are all external
Vite-bundled modules (checked frontend/index.html and the dist output --
no inline <script> content anywhere), so script-src stays strict.
img-src is left at a broad `https:` rather than an allowlist of
SteamGridDB's exact CDN hostname -- getting that domain wrong would
silently break the (optional, already-shipped) cover art feature for
anyone who's set an API key, which is a worse failure mode than a
slightly looser img-src.
"""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

_CSP = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: https:; "
    "font-src 'self' data:; "
    "connect-src 'self'; "
    "frame-ancestors 'none'; "
    "base-uri 'self'; "
    "form-action 'self'"
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Content-Security-Policy"] = _CSP
        return response
