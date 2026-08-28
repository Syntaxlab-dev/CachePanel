from fastapi import APIRouter
from pydantic import BaseModel

from app.services import app_settings_store

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SettingsUpdate(BaseModel):
    steam_api_key: str | None = None
    steam_id64: str | None = None


@router.get("")
def get_settings():
    return app_settings_store.get_settings()


@router.post("")
def update_settings(body: SettingsUpdate):
    partial = {k: v for k, v in body.model_dump().items() if v is not None}
    return app_settings_store.update_settings(partial)
