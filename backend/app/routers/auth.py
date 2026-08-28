from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse

from app.services import app_settings_store, steam_openid

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/steam/login")
def steam_login(request: Request):
    base = str(request.base_url)  # e.g. http://10.0.0.160:8090/
    return_to = f"{base}api/auth/steam/callback"
    login_url = steam_openid.build_login_url(return_to=return_to, realm=base)
    return RedirectResponse(login_url)


@router.get("/steam/callback")
def steam_callback(request: Request):
    try:
        steam_id64 = steam_openid.verify_and_extract_steam_id(dict(request.query_params))
        app_settings_store.update_settings({"steam_id64": steam_id64})
        return RedirectResponse("/settings?steam_login=success")
    except steam_openid.SteamOpenIdError:
        return RedirectResponse("/settings?steam_login=failed")
