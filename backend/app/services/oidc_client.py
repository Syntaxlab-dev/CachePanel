"""Generic OIDC Authorization Code Flow (with PKCE) for panel SSO login --
NOT hardcoded to Authentik, even though that's what this instance runs
against: everything needed (authorize/token/jwks endpoints) is read from
the provider's own `{OIDC_ISSUER_URL}/.well-known/openid-configuration`
discovery document rather than assumed, so any standard OIDC provider
works.

Configuration lives in Settings (backend/app/settings.py), i.e. plain
environment variables -- deliberately NOT app_settings_store.py's
GUI-editable, Fernet-encrypted settings. That store requires an
authenticated admin session to change (see routers/settings.py), which is
exactly the chicken-and-egg problem this feature exists to solve: on a
fresh instance with no account yet, nobody could reach those settings to
turn OIDC on in the first place. Same reasoning as STEAM_API_KEY/
LANCACHE_IP already living in Settings rather than app_settings_store.py.

is_enabled() -- and therefore whether the login button appears at all --
requires all three of issuer/client_id/client_secret to be non-empty, the
same "blank = feature off, never attempted" contract as Discord webhooks,
ntfy, SteamGridDB etc. elsewhere in this project.

Discovery + JWKS are fetched fresh on every login attempt rather than
cached: this only runs on an actual human login (at most a few times a
day), so the extra round-trip is not a perf concern, and it sidesteps an
entire class of "provider rotated its signing key / added a signing key
for the first time and our cached copy is now stale" bugs for free --
exactly the kind of issue that bit a NEIGHBORING project's own OIDC setup
in this same homelab (a provider whose JWKS started returning zero keys
until a signing key was configured on its side, and a client that had
already cached the pre-fix, key-less discovery document).
"""

import base64
import hashlib
import secrets
from urllib.parse import urlencode

import requests
from joserfc import jwt
from joserfc.jwk import KeySet

from app.settings import settings

_HTTP_TIMEOUT = 10


class OidcError(RuntimeError):
    pass


def is_enabled() -> bool:
    return bool(settings.oidc_issuer_url and settings.oidc_client_id and settings.oidc_client_secret)


def provider_name() -> str:
    return settings.oidc_provider_name or "SSO"


def _discovery_document() -> dict:
    url = settings.oidc_issuer_url.rstrip("/") + "/.well-known/openid-configuration"
    try:
        resp = requests.get(url, timeout=_HTTP_TIMEOUT)
        resp.raise_for_status()
        return resp.json()
    except (requests.RequestException, ValueError) as exc:
        raise OidcError(f"Could not fetch the identity provider's discovery document: {exc}") from exc


def build_authorization_request(redirect_uri: str) -> dict:
    """Returns everything needed to redirect the browser AND everything the
    caller must stash server-side (in the pre-login session, the same
    pattern routers/auth.py already uses for `pending_totp_username`) to
    validate the callback later: `url`, `state`, `nonce`, `code_verifier`."""
    if not is_enabled():
        raise OidcError("OIDC is not configured.")

    discovery = _discovery_document()
    authorization_endpoint = discovery.get("authorization_endpoint")
    if not authorization_endpoint:
        raise OidcError("The identity provider's discovery document has no authorization_endpoint.")

    state = secrets.token_urlsafe(24)
    nonce = secrets.token_urlsafe(24)
    code_verifier = secrets.token_urlsafe(48)
    code_challenge = base64.urlsafe_b64encode(hashlib.sha256(code_verifier.encode("ascii")).digest()).decode("ascii").rstrip("=")

    params = {
        "response_type": "code",
        "client_id": settings.oidc_client_id,
        "redirect_uri": redirect_uri,
        "scope": "openid profile email",
        "state": state,
        "nonce": nonce,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    return {
        "url": f"{authorization_endpoint}?{urlencode(params)}",
        "state": state,
        "nonce": nonce,
        "code_verifier": code_verifier,
    }


def _exchange_code(discovery: dict, code: str, redirect_uri: str, code_verifier: str) -> dict:
    token_endpoint = discovery.get("token_endpoint")
    if not token_endpoint:
        raise OidcError("The identity provider's discovery document has no token_endpoint.")

    resp = requests.post(
        token_endpoint,
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": settings.oidc_client_id,
            "client_secret": settings.oidc_client_secret,
            "code_verifier": code_verifier,
        },
        timeout=_HTTP_TIMEOUT,
    )
    if resp.status_code != 200:
        raise OidcError(f"Token exchange failed (HTTP {resp.status_code}): {resp.text[:300]}")
    data = resp.json()
    if "id_token" not in data:
        raise OidcError("The identity provider's token response has no id_token.")
    return data


def _validate_id_token(discovery: dict, id_token: str, nonce: str) -> dict:
    jwks_uri = discovery.get("jwks_uri")
    if not jwks_uri:
        raise OidcError("The identity provider's discovery document has no jwks_uri.")

    try:
        jwks_resp = requests.get(jwks_uri, timeout=_HTTP_TIMEOUT)
        jwks_resp.raise_for_status()
        jwks_raw = jwks_resp.json()
    except (requests.RequestException, ValueError) as exc:
        raise OidcError(f"Could not fetch the identity provider's signing keys: {exc}") from exc

    if not jwks_raw.get("keys"):
        # The exact failure mode this module's own docstring warns about --
        # give a clear, actionable message instead of a cryptic KeyError
        # deep inside the JWT library.
        raise OidcError(
            "The identity provider's JWKS endpoint returned no signing keys -- it likely needs an RS256 "
            "signing key/certificate configured on the provider side before OIDC clients can validate its "
            "tokens."
        )

    key_set = KeySet.import_key_set(jwks_raw)

    try:
        # Explicit algorithms allowlist -- RS256 only, never "none" or an
        # HMAC algorithm the client_secret could be (ab)used as the key
        # for. A token signed with anything else is rejected before its
        # signature is even checked.
        token = jwt.decode(id_token, key_set, algorithms=["RS256"])
    except Exception as exc:
        raise OidcError(f"ID token signature validation failed: {exc}") from exc

    claims_registry = jwt.JWTClaimsRegistry(
        aud={"essential": True, "value": settings.oidc_client_id},
        exp={"essential": True},
    )
    try:
        claims_registry.validate(token.claims)
    except Exception as exc:
        raise OidcError(f"ID token claims validation failed: {exc}") from exc

    # `iss` checked separately, trailing-slash-normalized on both sides --
    # settings.oidc_issuer_url is stored without one (see settings.py), but
    # a real provider's own issuer often has one (e.g. Authentik's
    # per-provider issuer is always "{base}/application/o/{slug}/"), so a
    # strict ClaimsRegistry value match would reject every real token.
    actual_issuer = str(token.claims.get("iss") or "").rstrip("/")
    if actual_issuer != settings.oidc_issuer_url.rstrip("/"):
        raise OidcError(f"ID token issuer mismatch: expected {settings.oidc_issuer_url!r}, got {actual_issuer!r}.")

    if token.claims.get("nonce") != nonce:
        raise OidcError("ID token nonce mismatch -- possible replay of an old login attempt.")

    return token.claims


def complete_login(code: str, redirect_uri: str, code_verifier: str, nonce: str) -> dict:
    """Full callback-side flow: exchange the code, validate the ID token,
    and return its claims. Raises OidcError with a human-readable reason on
    any failure -- callers should treat that as an outright login failure,
    never fall back to anything less strict."""
    if not is_enabled():
        raise OidcError("OIDC is not configured.")
    discovery = _discovery_document()
    tokens = _exchange_code(discovery, code, redirect_uri, code_verifier)
    return _validate_id_token(discovery, tokens["id_token"], nonce)


def username_from_claims(claims: dict) -> str | None:
    """CachePanel accounts are keyed by a single username string (see
    auth_credentials_store.py); OIDC claims don't have one canonical field
    for that, so try the standard ones in order of how login-friendly they
    are, and skip past ones that are blank."""
    for key in ("preferred_username", "email", "sub"):
        value = claims.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None
