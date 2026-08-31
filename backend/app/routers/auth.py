import secrets

import pyotp
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.services import (
    app_settings_store,
    audit_log_store,
    auth_credentials_store,
    login_rate_limit,
    session_registry_store,
    steam_openid,
    webauthn_credential_store,
    webauthn_service,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class Credentials(BaseModel):
    username: str
    password: str


class TotpCode(BaseModel):
    code: str


class TotpDisableRequest(BaseModel):
    password: str


class WebauthnRegistrationComplete(BaseModel):
    credential: dict
    label: str


class WebauthnAuthenticationComplete(BaseModel):
    credential: dict


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _start_session(request: Request, username: str, role: str) -> None:
    session_id = secrets.token_urlsafe(24)
    request.session["authenticated"] = True
    request.session["username"] = username
    request.session["role"] = role
    request.session["session_id"] = session_id
    session_registry_store.create(session_id, username, _client_ip(request), request.headers.get("user-agent", ""))


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
    audit_log_store.log("setup", body.username.strip(), "Initial admin account created", _client_ip(request))
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
        audit_log_store.log("login_failed", username or None, "Password rejected", client_ip)
        raise HTTPException(status_code=401, detail="Benutzername oder Passwort falsch.")

    if user["totp_enabled"]:
        # Password verified, but the session stays unauthenticated until the
        # second factor also checks out -- record_success() is deliberately
        # NOT called yet, so a correct password doesn't reset the rate
        # limit before the TOTP step has also passed (see auth_login_totp()
        # below, which shares the same IP-keyed limiter for the code step).
        # Not logged as a login yet either, for the same reason -- only a
        # completed login (see auth_login_totp()) is a "login_success".
        request.session["pending_totp_username"] = username
        return {"ok": True, "totp_required": True}

    login_rate_limit.record_success(client_ip)
    _start_session(request, username, user["role"])
    audit_log_store.log("login_success", username, "Logged in", client_ip)
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
        audit_log_store.log("login_failed", username, "TOTP step failed: account/2FA no longer valid", client_ip)
        raise HTTPException(status_code=401, detail="Anmeldung fehlgeschlagen.")

    if not pyotp.TOTP(user["totp_secret"]).verify(body.code.strip()):
        login_rate_limit.record_failure(client_ip)
        audit_log_store.log("login_failed", username, "TOTP code rejected", client_ip)
        raise HTTPException(status_code=401, detail="Code ungültig.")

    login_rate_limit.record_success(client_ip)
    request.session.pop("pending_totp_username", None)
    _start_session(request, username, user["role"])
    audit_log_store.log("login_success", username, "Logged in (2FA)", client_ip)
    return {"ok": True}


@router.post("/logout", summary="Panel logout")
def auth_logout(request: Request):
    session_id = request.session.get("session_id")
    username = request.session.get("username")
    if session_id and username:
        session_registry_store.revoke(session_id, username)
    request.session.clear()
    return {"ok": True}


@router.get(
    "/sessions",
    summary="List the current account's active sessions",
    description="Every still-registered login for the current account (not just this browser's own), newest "
    "activity first, with `is_current` marking the one making this request.",
)
def list_sessions(request: Request):
    username = request.session.get("username")
    if not username:
        raise HTTPException(status_code=401, detail="Nicht angemeldet.")
    current_session_id = request.session.get("session_id")
    sessions = session_registry_store.list_for_user(username)
    return {
        "sessions": [
            {
                "session_id": s["session_id"],
                "created_at": s["created_at"],
                "last_seen_at": s["last_seen_at"],
                "client_ip": s["client_ip"],
                "user_agent": s["user_agent"],
                "is_current": s["session_id"] == current_session_id,
            }
            for s in sessions
        ]
    }


@router.delete(
    "/sessions/{session_id}",
    summary="Revoke one active session",
    description="Logs out that specific session immediately -- its next request will be rejected even though "
    "its session cookie is still cryptographically valid (see auth_guard.py). Scoped to the caller's own "
    "account: cannot be used to revoke another account's session.",
)
def revoke_session(session_id: str, request: Request):
    username = request.session.get("username")
    if not username:
        raise HTTPException(status_code=401, detail="Nicht angemeldet.")
    if not session_registry_store.revoke(session_id, username):
        raise HTTPException(status_code=404, detail="Sitzung nicht gefunden.")
    return {"ok": True}


@router.post(
    "/webauthn/register/begin",
    summary="Start registering a new passkey",
    description="Requires an existing authenticated session (passkeys are an additional login method added "
    "from Settings, not part of first-run setup). Returns the WebAuthn PublicKeyCredentialCreationOptions "
    "for the browser's navigator.credentials.create() call.",
)
def webauthn_register_begin(request: Request):
    username = request.session.get("username")
    if not username:
        raise HTTPException(status_code=401, detail="Nicht angemeldet.")
    return webauthn_service.begin_registration(request, username)


@router.post(
    "/webauthn/register/complete",
    summary="Finish registering a new passkey",
    description="Verifies the browser's attestation response against the challenge from /register/begin, and "
    "on success stores the credential under `label` for the current account.",
)
def webauthn_register_complete(body: WebauthnRegistrationComplete, request: Request):
    username = request.session.get("username")
    if not username:
        raise HTTPException(status_code=401, detail="Nicht angemeldet.")
    label = body.label.strip() or "Passkey"
    try:
        webauthn_service.complete_registration(request, body.credential, label)
    except webauthn_service.WebAuthnError:
        raise HTTPException(status_code=400, detail="Passkey konnte nicht registriert werden.")
    return {"ok": True}


@router.get(
    "/webauthn/credentials",
    summary="List the current account's registered passkeys",
    description="label, the hostname it was registered under, and creation date only -- never the public key.",
)
def webauthn_list_credentials(request: Request):
    username = request.session.get("username")
    if not username:
        raise HTTPException(status_code=401, detail="Nicht angemeldet.")
    creds = webauthn_credential_store.list_for_user(username)
    return {
        "credentials": [
            {
                "credential_id": c["credential_id"],
                "label": c["label"],
                "rp_id": c["rp_id"],
                "created_date": c["created_date"],
            }
            for c in creds
        ]
    }


@router.delete("/webauthn/credentials/{credential_id}", summary="Remove a registered passkey")
def webauthn_delete_credential(credential_id: str, request: Request):
    username = request.session.get("username")
    if not username:
        raise HTTPException(status_code=401, detail="Nicht angemeldet.")
    if not webauthn_credential_store.delete(credential_id, username):
        raise HTTPException(status_code=404, detail="Passkey nicht gefunden.")
    return {"ok": True}


@router.post(
    "/webauthn/login/begin",
    summary="Start a passkey login",
    description="No username needed -- the browser's own discoverable-credential picker offers a matching "
    "passkey for this panel. Reachable while unauthenticated, like the password login endpoint.",
)
def webauthn_login_begin(request: Request):
    return webauthn_service.begin_authentication(request)


@router.post(
    "/webauthn/login/complete",
    summary="Finish a passkey login",
    description="Verifies the assertion and, on success, starts a full session directly -- a passkey replaces "
    "both the password and TOTP steps in one, since possession of it plus the device's own unlock (biometric/PIN) "
    "is already a two-factor-equivalent proof. Shares the same per-IP rate limit as the password login path.",
)
def webauthn_login_complete(body: WebauthnAuthenticationComplete, request: Request):
    client_ip = _client_ip(request)
    locked_out, retry_after = login_rate_limit.is_locked_out(client_ip)
    if locked_out:
        raise HTTPException(
            status_code=429,
            detail=f"Zu viele Fehlversuche. Bitte in {retry_after} Sekunden erneut versuchen.",
            headers={"Retry-After": str(retry_after)},
        )

    try:
        username = webauthn_service.complete_authentication(request, body.credential)
    except webauthn_service.WebAuthnError:
        login_rate_limit.record_failure(client_ip)
        audit_log_store.log("login_failed", None, "Passkey login failed", client_ip)
        raise HTTPException(status_code=401, detail="Passkey-Anmeldung fehlgeschlagen.")

    user = auth_credentials_store.get_user(username)
    if user is None:
        # Credential's account was removed since it was registered -- fail closed.
        login_rate_limit.record_failure(client_ip)
        audit_log_store.log("login_failed", username, "Passkey login failed: account no longer exists", client_ip)
        raise HTTPException(status_code=401, detail="Passkey-Anmeldung fehlgeschlagen.")

    login_rate_limit.record_success(client_ip)
    _start_session(request, username, user["role"])
    audit_log_store.log("login_success", username, "Logged in (passkey)", client_ip)
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
