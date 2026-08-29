from fastapi import APIRouter, HTTPException

from app.services.cache_manager import CacheManagerError, clear_entire_cache

router = APIRouter(prefix="/api/cache", tags=["cache"])


@router.post("/clear", summary="Clear the entire LanCache cache", description="Wipes cached content for ALL services at once (targeted per-service purge isn't safely possible -- see cache_manager.py) and restarts the lancache container.")
def clear_cache():
    try:
        message = clear_entire_cache()
    except CacheManagerError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"message": message}
