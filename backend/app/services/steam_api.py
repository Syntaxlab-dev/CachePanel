"""Thin wrapper around the official Steam Web API for fetching a user's
owned games. Deliberately independent from SteamPrefill's own SteamKit2
based login flow — this only needs read access to a public/owned game list,
for which the lightweight documented Web API is the right tool.

https://developer.valvesoftware.com/wiki/Steam_Web_API#GetOwnedGames
"""

import requests

OWNED_GAMES_URL = "https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/"


class SteamApiError(RuntimeError):
    pass


def get_owned_games(api_key: str, steam_id64: str) -> list[dict]:
    if not api_key or not steam_id64:
        raise SteamApiError("Steam API key or SteamID64 not configured")

    params = {
        "key": api_key,
        "steamid": steam_id64,
        "format": "json",
        "include_appinfo": 1,
        "include_played_free_games": 1,
    }
    response = requests.get(OWNED_GAMES_URL, params=params, timeout=10)
    if response.status_code != 200:
        raise SteamApiError(f"Steam API returned HTTP {response.status_code}")

    payload = response.json().get("response", {})
    games = payload.get("games", [])
    return [
        {
            "app_id": g["appid"],
            "name": g.get("name", f"App {g['appid']}"),
            "playtime_minutes": g.get("playtime_forever", 0),
            "icon_url": (
                f"https://media.steampowered.com/steamcommunity/public/images/apps/"
                f"{g['appid']}/{g['img_icon_url']}.jpg"
                if g.get("img_icon_url")
                else None
            ),
        }
        for g in games
    ]
