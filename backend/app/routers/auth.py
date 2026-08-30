import pyotp
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.services import app_settings_store, auth_credentials_store, login_rate_limit, steam_openid

router = APIRouter(prefix="/api/auth", tags=["auth"])


class Credentials(BaseModel):
    username: str
    password: str


class TotpCode(BaseModel):
    code: str


class TotpDisableRequest(BaseModel):
    password: str


def _start_session(request: Request, username: str, role: str) -> None:
    request.session["authenticated"] = True
    request.session["username"] = username
    request.session["role"] = role


@router.get("/status", summary="Panel auth status", description="Whether first-run setup is still required, and whether the current session is authenticated. Reachable without a session, unlike everything else under /api/.")
def auth_status(request: Request):
    """Unauthenticated-reachable status check the frontend polls on load to
    decide whether to show the setup screen, the login screen, or the app.
    Also carries the current session's own role and 2FA status -- both are
    about the caller's own account, never anyone else's, so exposing them
    here (rather than only via /api/users, which deliberately never
    returns TOTP state for anyone) is fine."""
    if not auth_credentials_store.is_configured():
        return {"setup_required": True, "authenticated": False, "role": None, "totp_enabled": False}

    authenticated = bool(request.session.get("authenticated"))
    totp_enabled = False
    if authenticated:
        user = auth_credentials_store.get_user(request.session.get("username", ""))
        totp_enabled = bool(user and user["totp_enabled"])

    return {
        "setup_required": False,
        "authenticated": authenticated,
        "role": request.session.get("role") if authenticated else None,
        "totp_enabled": totp_enabled,
    }


@router.post("/setup", summary="First-run credential setup")
def auth_setup(body: Credentials, request: Request):
    """First-run only: sets the initial panel credentials. Refuses if
    credentials already exist -- changing an existing login isn't this
    endpoint's job, and shouldn't be reachable without already being
    authenticated anyway (see auth_guard.py, which lets this specific
    route through unauthenticated only because it needs to be reachable
    *before* any credentials exist). Always creates an "admin" account --
    see auth_credentials_store.set_credentials()."""
    if auth_credentials_store.is_configured():
        raise HTTPException(status_code=409, detail="Es sind bereits Zugangsdaten eingerichtet.")
    if not body.username.strip() or len(body.password) < 8:
        raise HTTPException(
            status_code=400, detail="Benutzername darf nicht leer sein, Passwort braucht mindestens 8 Zeichen."
        )
    auth_credentials_store.set_credentials(body.username.strip(), body.password)
    _start_session(request, body.username.strip(), "admin")
    return {"ok": True}


@router.post(
    "/login",
    summary="Panel login",
    description="Rate-limited to 5 attempts per 5 minutes per client IP -- returns 429 with a Retry-After "
    "header once exceeded, resets on a successful login. If the account has two-factor authentication "
    "enabled, this only verifies the password and returns `totp_required: true` -- the session isn't "
    "authenticated yet, call POST /api/auth/login/totp with the 6-digit code to finish.",
)
def auth_login(body: Credentials, request: Request):
    client_ip = request.client.host if request.client else "unknown"
    username = body.username.strip()

    locked_out, retry_after = login_rate_limit.is_locked_out(client_ip)
    if locked_out:
        raise HTTPException(
            status_code=429,
            detail=f"Zu viele Fehlversuche. Bitte in {retry_after} Sekunden erneut versuchen.",
            headers={"Retry-After": str(retry_after)},
        )

    user = auth_credentials_store.get_user(username)
    if user is None or not auth_credentials_store.verify_credentials(username, body.password):
        login_rate_limit.record_failure(client_ip)
        raise HTTPException(status_code=401, detail="Benutzername oder Passwort falsch.")

    if user["totp_enabled"]:
        # Password verified, but the session stays unauthenticated until the
        # second factor also checks out -- record_success() is deliberately
        # NOT called yet, so a correct password doesn't reset the rate
        # limit before the TOTP step has also passed (see auth_login_totp()
        # below, which shares the same IP-keyed limiter for the code step).
        request.session["pending_totp_username"] = username
        return {"ok": True, "totp_required": True}

    login_rate_limit.record_success(client_ip)
    _start_session(request, username, user["role"])
    return {"ok": True, "totp_required": False}


@router.post(
    "/login/totp",
    summary="Complete a two-factor login",
    description="Second step after POST /api/auth/login returned `totp_required: true`. Shares the same "
    "per-IP rate limit as the password step, so guessing codes is limited exactly like guessing passwords.",
)
def auth_login_totp(body: TotpCode, request: Request):
    client_ip = request.client.host if request.client else "unknown"
    username = request.session.get("pending_totp_username")
    if not username:
        raise HTTPException(status_code=400, detail="Kein ausstehender Login-Vorgang.")

    locked_out, retry_after = login_rate_limit.is_locked_out(client_ip)
    if locked_out:
        raise HTTPException(
            status_code=429,
            detail=f"Zu viele Fehlversuche. Bitte in {retry_after} Sekunden erneut versuchen.",
            headers={"Retry-After": str(retry_after)},
        )

    user = auth_credentials_store.get_user(username)
    if user is None or not user["totp_enabled"] or not user["totp_secret"]:
        # Account was removed or 2FA disabled mid-flow -- fail closed.
        request.session.pop("pending_totp_username", None)
        login_rate_limit.record_failure(client_ip)
        raise HTTPException(status_code=401, detail="Anmeldung fehlgeschlagen.")

    if not pyotp.TOTP(user["totp_secret"]).verify(body.code.strip()):
        login_rate_limit.record_failure(client_ip)
        raise HTTPException(status_code=401, detail="Code ungültig.")

    login_rate_limit.record_success(client_ip)
    request.session.pop("pending_totp_username", None)
    _start_session(request, username, user["role"])
    return {"ok": True}


@router.post("/logout", summary="Panel logout")
def auth_logout(request: Request):
    request.session.clear()
    return {"ok": True}


@router.post(
    "/totp/setup",
    summary="Start enabling two-factor authentication",
    description="Generates a new TOTP secret for the current session's account and stashes it in the "
    "session (nothing is persisted yet). Returns the secret plus an otpauth:// URI to enter into an "
    "authenticator app -- confirm with POST /api/auth/totp/confirm to actually enable it.",
)
def totp_setup(request: Request):
    username = request.session.get("username")
    if not username:
        raise HTTPException(status_code=401, detail="Nicht angemeldet.")
    secret = pyotp.random_base32()
    request.session["totp_pending_secret"] = secret
    uri = pyotp.TOTP(secret).provisioning_uri(name=username, issuer_name="CachePanel")
    return {"secret": secret, "uri": uri}


@router.post(
    "/totp/confirm",
    summary="Confirm and enable two-factor authentication",
    description="Verifies the 6-digit code against the secret generated by POST /api/auth/totp/setup -- "
    "only on success is the secret actually persisted and 2FA turned on for this account.",
)
def totp_confirm(body: TotpCode, request: Request):
    username = request.session.get("username")
    if not username:
        raise HTTPException(status_code=401, detail="Nicht angemeldet.")
    secret = request.session.get("totp_pending_secret")
    if not secret:
        raise HTTPException(status_code=400, detail="Keine ausstehende Einrichtung. Bitte erneut starten.")
    if not pyotp.TOTP(secret).verify(body.code.strip()):
        raise HTTPException(status_code=400, detail="Code ungültig.")

    try:
        auth_credentials_store.set_totp(username, secret)
    except ValueError:
        raise HTTPException(status_code=404, detail="Zugang nicht gefunden.")
    request.session.pop("totp_pending_secret", None)
    return {"ok": True}


@router.post(
    "/totp/disable",
    summary="Disable two-factor authentication",
    description="Requires the current password again as a safety re-prompt before turning 2FA off.",
)
def totp_disable(body: TotpDisableRequest, request: Request):
    username = request.session.get("username")
    if not username:
        raise HTTPException(status_code=401, detail="Nicht angemeldet.")
    if not auth_credentials_store.verify_credentials(username, body.password):
        raise HTTPException(status_code=401, detail="Passwort falsch.")

    try:
        auth_credentials_store.disable_totp(username)
    except ValueError:
        raise HTTPException(status_code=404, detail="Zugang nicht gefunden.")
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
