"""Steam's "Sign in through Steam" flow (OpenID 2.0), used only to let a
user discover their own SteamID64 without having to look it up manually on
a third-party site. This never grants access to anything beyond the numeric
SteamID64 itself — a Steam Web API key is still a separate, self-service
step (OpenID has no concept of API keys).

https://steamcommunity.com/dev (see "Steam Web API Documentation" -> OpenID)
"""

import re

import requests

STEAM_OPENID_URL = "https://steamcommunity.com/openid/login"
CLAIMED_ID_RE = re.compile(r"^https://steamcommunity\.com/openid/id/(\d+)$")


def build_login_url(return_to: str, realm: str) -> str:
    params = {
        "openid.ns": "http://specs.openid.net/auth/2.0",
        "openid.mode": "checkid_setup",
        "openid.return_to": return_to,
        "openid.realm": realm,
        "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
        "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    }
    query = "&".join(f"{k}={requests.utils.quote(v, safe='')}" for k, v in params.items())
    return f"{STEAM_OPENID_URL}?{query}"


class SteamOpenIdError(RuntimeError):
    pass


def verify_and_extract_steam_id(query_params: dict[str, str]) -> str:
    """Verifies the OpenID response with Steam itself (never trust the
    claimed_id without this round-trip — anyone could otherwise forge the
    callback params) and returns the SteamID64 on success."""
    claimed_id = query_params.get("openid.claimed_id", "")
    match = CLAIMED_ID_RE.match(claimed_id)
    if not match:
        raise SteamOpenIdError("Keine gültige Steam-Identität in der Antwort enthalten")

    verify_params = dict(query_params)
    verify_params["openid.mode"] = "check_authentication"

    resp = requests.post(STEAM_OPENID_URL, data=verify_params, timeout=10)
    if resp.status_code != 200 or "is_valid:true" not in resp.text:
        raise SteamOpenIdError("Steam konnte die Anmeldung nicht bestätigen")

    return match.group(1)
