from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.routers import auth, battlenet, dashboard, epic, prefill, settings, steam

app = FastAPI(title="CachePanel API")

app.include_router(dashboard.router)
app.include_router(steam.router)
app.include_router(battlenet.router)
app.include_router(epic.router)
app.include_router(prefill.router)
app.include_router(settings.router)
app.include_router(auth.router)

FRONTEND_DIST = Path(__file__).resolve().parent.parent / "static"

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")
