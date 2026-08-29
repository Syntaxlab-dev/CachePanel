from fastapi import APIRouter, HTTPException

from app.services.cache_manager import (
    CacheManagerError,
    clean_corrupted_files,
    clear_entire_cache,
    scan_for_corruption,
)

router = APIRouter(prefix="/api/cache", tags=["cache"])


@router.post("/clear", summary="Clear the entire LanCache cache", description="Wipes cached content for ALL services at once (targeted per-service purge isn't safely possible -- see cache_manager.py) and restarts the lancache container.")
def clear_cache():
    try:
        message = clear_entire_cache()
    except CacheManagerError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"message": message}


@router.get(
    "/scan",
    summary="Scan for corrupted cache files",
    description="Counts 0-byte files in the cache directory (the only corruption signal that can be detected "
    "without risking false positives -- see cache_manager.py for why). Can take a few seconds on large caches.",
)
def scan_cache():
    try:
        result = scan_for_corruption()
    except CacheManagerError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "corrupt_file_count": result.corrupt_file_count,
        "sample_paths": result.sample_paths,
        "truncated": result.truncated,
    }


@router.post(
    "/clean-corrupted",
    summary="Delete detected 0-byte cache files",
    description="Deletes exactly the files the scan would find (recomputed server-side, not client-supplied "
    "paths) and restarts lancache so its cache index stays consistent.",
)
def clean_corrupted():
    try:
        message = clean_corrupted_files()
    except CacheManagerError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"message": message}
