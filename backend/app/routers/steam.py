from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import prefill_selection, steam_api
from app.settings import settings

router = APIRouter(prefix="/api/steam", tags=["steam"])


class SelectionUpdate(BaseModel):
    app_ids: list[int]


@router.get("/library")
def get_library():
    try:
        games = steam_api.get_owned_games(settings.steam_api_key, settings.steam_id64)
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
