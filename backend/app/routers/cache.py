from fastapi import APIRouter, HTTPException

from app.services.cache_manager import CacheManagerError, clear_entire_cache

router = APIRouter(prefix="/api/cache", tags=["cache"])


@router.post("/clear")
def clear_cache():
    try:
        message = clear_entire_cache()
    except CacheManagerError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"message": message}
