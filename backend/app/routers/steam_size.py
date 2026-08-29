from fastapi import APIRouter, HTTPException

from app.services.steam_size_status import SteamSizeStatusError, get_size_status

router = APIRouter(prefix="/api/steam", tags=["steam"])


@router.get("/size-status", summary="Steam selection download sizes", description="Per-game download sizes for the current Steam selection, sourced from a real `select-apps status` run. On-demand only -- never call this automatically.")
def size_status():
    """On-demand only (real Steam login each call, ~10-15s) -- never call
    this automatically on page load, only from an explicit user action."""
    try:
        result = get_size_status()
    except SteamSizeStatusError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {
        "apps": [{"name": a.name, "size": a.size} for a in result.apps],
        "total_size": result.total_size,
    }
