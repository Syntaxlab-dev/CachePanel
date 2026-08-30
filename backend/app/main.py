from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from app.auth_guard import AuthGuardMiddleware
from app.security_headers import SecurityHeadersMiddleware
from app.routers import (
    api_tokens,
    auth,
    backup,
    battlenet,
    cache,
    client_labels,
    dashboard,
    epic,
    export_import,
    ha,
    health,
    metrics,
    prefill,
    public_display,
    schedule,
    settings,
    steam,
    steam_size,
    users,
)
from app.services import db, scheduler_service, session_secret


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.init_schema()  # no-op unless DATABASE_URL is set
    scheduler_service.start_and_reload()
    yield
    scheduler_service.shutdown()


app = FastAPI(
    title="CachePanel API",
    description="Self-hosted web UI for a LanCache setup: cache/traffic dashboard, Steam/Battle.net/Epic "
    "prefill selection and scheduling, and a Prometheus /metrics endpoint for external monitoring. "
    "Interactive docs at /docs, machine-readable schema at /openapi.json.",
    lifespan=lifespan,
)

# Middleware order matters here: Starlette wraps the LAST-added middleware
# as the OUTERMOST layer (it runs first on the way in). SessionMiddleware
# must run before AuthGuardMiddleware so `request.session` is already
# populated by the time the guard reads it -- so AuthGuardMiddleware is
# added first (innermost), SessionMiddleware second. SecurityHeadersMiddleware
# is added last (outermost) on purpose: AuthGuardMiddleware short-circuits
# with an early JSONResponse for blocked/unauthenticated requests instead of
# calling call_next -- for those responses to still get security headers,
# SecurityHeadersMiddleware has to wrap AROUND it, not be wrapped BY it.
app.add_middleware(AuthGuardMiddleware)
app.add_middleware(
    SessionMiddleware,
    secret_key=session_secret.get_or_create_secret(),
    max_age=30 * 24 * 3600,
    same_site="lax",
    https_only=False,  # this typically sits behind a LAN reverse proxy or is hit directly over plain HTTP
)
app.add_middleware(SecurityHeadersMiddleware)

app.include_router(dashboard.router)
app.include_router(steam.router)
app.include_router(steam_size.router)
app.include_router(battlenet.router)
app.include_router(epic.router)
app.include_router(prefill.router)
app.include_router(settings.router)
app.include_router(auth.router)
app.include_router(health.router)
app.include_router(cache.router)
app.include_router(export_import.router)
app.include_router(schedule.router)
app.include_router(metrics.router)
app.include_router(backup.router)
app.include_router(users.router)
app.include_router(public_display.router)
app.include_router(api_tokens.router)
app.include_router(client_labels.router)
app.include_router(ha.router)

FRONTEND_DIST = Path(__file__).resolve().parent.parent / "static"

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")
