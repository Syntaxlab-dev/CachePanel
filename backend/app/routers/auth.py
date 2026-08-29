from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.services import app_settings_store, auth_credentials_store, steam_openid

router = APIRouter(prefix="/api/auth", tags=["auth"])


class Credentials(BaseModel):
    username: str
    password: str


@router.get("/status", summary="Panel auth status", description="Whether first-run setup is still required, and whether the current session is authenticated. Reachable without a session, unlike everything else under /api/.")
def auth_status(request: Request):
    """Unauthenticated-reachable status check the frontend polls on load to
    decide whether to show the setup screen, the login screen, or the app."""
    if not auth_credentials_store.is_configured():
        return {"setup_required": True, "authenticated": False}
    return {"setup_required": False, "authenticated": bool(request.session.get("authenticated"))}


@router.post("/setup", summary="First-run credential setup")
def auth_setup(body: Credentials, request: Request):
    """First-run only: sets the initial panel credentials. Refuses if
    credentials already exist -- changing an existing login isn't this
    endpoint's job, and shouldn't be reachable without already being
    authenticated anyway (see auth_guard.py, which lets this specific
    route through unauthenticated only because it needs to be reachable
    *before* any credentials exist)."""
    if auth_credentials_store.is_configured():
        raise HTTPException(status_code=409, detail="Es sind bereits Zugangsdaten eingerichtet.")
    if not body.username.strip() or len(body.password) < 8:
        raise HTTPException(
            status_code=400, detail="Benutzername darf nicht leer sein, Passwort braucht mindestens 8 Zeichen."
        )
    auth_credentials_store.set_credentials(body.username.strip(), body.password)
    request.session["authenticated"] = True
    request.session["username"] = body.username.strip()
    return {"ok": True}


@router.post("/login", summary="Panel login")
def auth_login(body: Credentials, request: Request):
    if not auth_credentials_store.verify_credentials(body.username.strip(), body.password):
        raise HTTPException(status_code=401, detail="Benutzername oder Passwort falsch.")
    request.session["authenticated"] = True
    request.session["username"] = body.username.strip()
    return {"ok": True}


@router.post("/logout", summary="Panel logout")
def auth_logout(request: Request):
    request.session.clear()
    return {"ok": True}


@router.get("/steam/login", summary="Start Steam OpenID login", description="Redirects to Steam's own login page to auto-fill the SteamID64 in Settings -- unrelated to the panel's own login, and always exempt from AuthGuardMiddleware since it IS a login flow.")
def steam_login(request: Request):
    base = str(request.base_url)  # e.g. http://10.0.0.160:8090/
    return_to = f"{base}api/auth/steam/callback"
    login_url = steam_openid.build_login_url(return_to=return_to, realm=base)
    return RedirectResponse(login_url)


@router.get("/steam/callback", summary="Steam OpenID callback")
def steam_callback(request: Request):
    try:
        steam_id64 = steam_openid.verify_and_extract_steam_id(dict(request.query_params))
        app_settings_store.update_settings({"steam_id64": steam_id64})
        return RedirectResponse("/settings?steam_login=success")
    except steam_openid.SteamOpenIdError:
        return RedirectResponse("/settings?steam_login=failed")
