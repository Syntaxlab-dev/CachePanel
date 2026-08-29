from fastapi import APIRouter
from pydantic import BaseModel

from app.services import app_settings_store

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SettingsUpdate(BaseModel):
    steam_api_key: str | None = None
    steam_id64: str | None = None


@router.get("", summary="Current app settings", description="Steam API key + SteamID64, as stored (encrypted at rest) on this instance. Never shared with anyone else.")
def get_settings():
    return app_settings_store.get_settings()


@router.post("", summary="Update app settings", description="Partial update -- only non-null fields in the body are changed.")
def update_settings(body: SettingsUpdate):
    partial = {k: v for k, v in body.model_dump().items() if v is not None}
    return app_settings_store.update_settings(partial)
