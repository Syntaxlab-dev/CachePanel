from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import app_settings_store, prefill_selection, steam_api
from app.settings import settings

router = APIRouter(prefix="/api/steam", tags=["steam"])


class SelectionUpdate(BaseModel):
    app_ids: list[int]


def _credentials() -> tuple[str, str]:
    """Steam credentials entered in the Settings page take priority; the
    STEAM_API_KEY / STEAM_ID64 env vars are only a fallback for deployments
    that prefer to configure this at the container level."""
    stored = app_settings_store.get_settings()
    api_key = stored.get("steam_api_key") or settings.steam_api_key
    steam_id64 = stored.get("steam_id64") or settings.steam_id64
    return api_key, steam_id64


@router.get("/library")
def get_library():
    api_key, steam_id64 = _credentials()
    if not api_key or not steam_id64:
        raise HTTPException(
            status_code=400,
            detail="Steam API Key und SteamID64 sind noch nicht hinterlegt. Bitte unter Einstellungen eintragen.",
        )
    try:
        games = steam_api.get_owned_games(api_key, steam_id64)
    except steam_api.SteamApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    selected = set(prefill_selection.read_selection(settings.steam_prefill_config_dir))
    for game in games:
        game["selected"] = game["app_id"] in selected

    return {"games": sorted(games, key=lambda g: g["name"].lower())}


@router.get("/selection")
def get_selection():
    return {"app_ids": prefill_selection.read_selection(settings.steam_prefill_config_dir)}


@router.post("/selection")
def update_selection(body: SelectionUpdate):
    prefill_selection.write_selection(settings.steam_prefill_config_dir, body.app_ids)
    return {"app_ids": body.app_ids}
