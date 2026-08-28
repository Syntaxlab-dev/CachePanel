from fastapi import APIRouter

from app.services.health import get_core_health

router = APIRouter(prefix="/api/health", tags=["health"])


@router.get("")
def health():
    results = get_core_health()
    return {
        "containers": [
            {"name": c.name, "status": c.status, "uptime_seconds": c.uptime_seconds} for c in results
        ]
    }
