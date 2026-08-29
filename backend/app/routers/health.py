from fastapi import APIRouter

from app.services.health import get_core_health, run_diagnostics

router = APIRouter(prefix="/api/health", tags=["health"])


@router.get("", summary="Core container health", description="Status + uptime of the core lancache/lancache-dns containers.")
def health():
    results = get_core_health()
    return {
        "containers": [
            {"name": c.name, "status": c.status, "uptime_seconds": c.uptime_seconds} for c in results
        ]
    }


@router.get(
    "/diagnostics",
    summary="Why isn't caching working?",
    description="Ordered checks (containers running, DNS resolves to this server, cache reachable over HTTP) "
    "that together explain why a client might not be getting served from cache.",
)
def diagnostics():
    return {"checks": [{"id": c.id, "status": c.status, "message": c.message} for c in run_diagnostics()]}
