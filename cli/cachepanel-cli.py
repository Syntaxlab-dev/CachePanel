#!/usr/bin/env python3
"""Standalone CLI companion for CachePanel -- talks to the same REST API
the web UI uses. Not bundled into the Docker image or the backend/frontend
build; a separate, self-contained script. Pure standard library (urllib,
json, argparse, getpass) so it runs anywhere Python 3 is available with no
`pip install` step.

Two auth modes, matching what the API actually allows -- see
backend/app/services/api_token_store.py and backend/app/auth_guard.py:

- Read commands (status, history) accept a read-only API token
  (--token / CACHEPANEL_TOKEN env var, see the "API-Tokens" card in
  Settings). Every API token is unconditionally read-only, so this tool
  never tries to use one for anything else.
- Write commands (prefill, clear-cache) need a real admin session -- this
  tool logs itself in with a username + password and holds the resulting
  session cookie only in memory for the lifetime of this process. The
  password is never accepted as a command-line flag (that would land in
  shell history); it's read via an interactive getpass prompt or the
  CACHEPANEL_PASSWORD environment variable. Accounts with two-factor
  authentication enabled are not supported here -- the login endpoint
  would ask for a second step this tool doesn't implement; use the web UI
  for those accounts instead.

Usage examples:
    CACHEPANEL_URL=http://10.0.0.160:8090 CACHEPANEL_TOKEN=xxx \\
        python3 cachepanel-cli.py status

    CACHEPANEL_URL=http://10.0.0.160:8090 \\
        python3 cachepanel-cli.py prefill steam --username admin
"""

from __future__ import annotations

import argparse
import getpass
import http.cookiejar
import json
import os
import sys
import urllib.error
import urllib.request


class ApiError(Exception):
    pass


class Client:
    def __init__(self, base_url: str, token: str | None):
        self.base_url = base_url.rstrip("/")
        self.token = token
        jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
        self._logged_in = False

    def _request(self, method: str, path: str, body: dict | None = None, timeout: float = 15) -> dict:
        url = f"{self.base_url}{path}"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if self.token:
            req.add_header("Authorization", f"Bearer {self.token}")
        try:
            with self.opener.open(req, timeout=timeout) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as exc:
            detail = ""
            try:
                detail = json.loads(exc.read()).get("detail", "")
            except (json.JSONDecodeError, UnicodeDecodeError, AttributeError):
                pass
            if exc.code == 401:
                raise ApiError(f"Nicht angemeldet oder Zugangsdaten falsch. {detail}".strip()) from exc
            if exc.code == 403:
                raise ApiError(f"Keine Berechtigung fuer diese Aktion. {detail}".strip()) from exc
            raise ApiError(f"HTTP {exc.code}: {detail or exc.reason}") from exc
        except TimeoutError as exc:
            raise ApiError(
                f"Zeitueberschreitung beim Warten auf {self.base_url} (nach {timeout:.0f}s)."
            ) from exc
        except urllib.error.URLError as exc:
            raise ApiError(f"Verbindung zu {self.base_url} fehlgeschlagen: {exc.reason}") from exc

    def ensure_login(self, username: str | None) -> None:
        if self._logged_in:
            return
        if not username:
            username = input("Benutzername: ")
        password = os.environ.get("CACHEPANEL_PASSWORD") or getpass.getpass("Passwort: ")
        result = self._request("POST", "/api/auth/login", {"username": username, "password": password})
        if result.get("totp_required"):
            raise ApiError(
                "Dieser Account hat Zwei-Faktor-Authentifizierung aktiv -- das CLI-Tool unterstuetzt das "
                "nicht. Bitte ueber die Web-Oberflaeche anmelden oder einen Account ohne 2FA verwenden."
            )
        self._logged_in = True

    def status(self) -> dict:
        return self._request("GET", "/api/ha/sensors")

    def history(self) -> dict:
        return self._request("GET", "/api/prefill/history")

    # A real prefill run blocks on the server until the whole download
    # finishes (the endpoint isn't backed by a background job with its own
    # status polling) -- possibly minutes for a large game, so the default
    # 15s read timeout used everywhere else would abort a perfectly normal
    # run. Cache-clear is quick in practice but shares the same generous
    # budget since it also restarts the lancache container server-side.
    _LONG_RUNNING_TIMEOUT = 1800  # 30 minutes

    def prefill(self, service: str, username: str | None) -> dict:
        self.ensure_login(username)
        return self._request("POST", f"/api/prefill/{service}/run", timeout=self._LONG_RUNNING_TIMEOUT)

    def clear_cache(self, username: str | None) -> dict:
        self.ensure_login(username)
        return self._request("POST", "/api/cache/clear", timeout=self._LONG_RUNNING_TIMEOUT)


def cmd_status(client: Client, _args: argparse.Namespace) -> int:
    data = client.status()
    print(f"Trefferquote:        {data['hit_ratio_percent']:.1f} %")
    print(f"Gesparte Bandbreite: {data['bandwidth_saved_gb']:.2f} GB")
    print(f"Anfragen gesamt:     {data['total_requests']}")
    if data.get("disk_percent_used") is not None:
        print(f"Speicherauslastung:  {data['disk_percent_used']:.1f} %")
    if data.get("forecast_available") and data.get("hours_until_full") is not None:
        print(f"Voll in ca.:         {data['hours_until_full']:.0f} Stunden")
    return 0


def cmd_history(client: Client, _args: argparse.Namespace) -> int:
    data = client.history()
    runs = data.get("runs", [])
    if not runs:
        print("Kein Verlauf vorhanden.")
        return 0
    for run in runs:
        status = "OK" if run.get("exit_code") == 0 else f"Exit {run.get('exit_code')}"
        print(
            f"{run.get('started_at', '?'):25s} {run.get('service', '?'):10s} "
            f"{status:8s} {run.get('duration_seconds', 0):.1f}s"
        )
    return 0


def cmd_prefill(client: Client, args: argparse.Namespace) -> int:
    result = client.prefill(args.service, args.username)
    print(f"{args.service}: Exit-Code {result.get('exit_code')}")
    if result.get("output"):
        print(result["output"])
    return 0 if result.get("exit_code") == 0 else 1


def cmd_clear_cache(client: Client, args: argparse.Namespace) -> int:
    if not args.yes:
        answer = input("Wirklich den GESAMTEN Cache leeren? [y/N] ")
        if answer.strip().lower() != "y":
            print("Abgebrochen.")
            return 1
    result = client.clear_cache(args.username)
    print(result.get("message", "OK"))
    return 0


def main() -> int:
    # --url/--token/--username live on this shared parent parser, attached
    # to every SUB-parser below (not the top-level parser) -- deliberately
    # not both: argparse re-parses each level's own arguments into the
    # same Namespace dest, so an option declared on both the top-level
    # parser and a sub-parser gets silently reset to the sub-parser's
    # default the moment the subcommand doesn't repeat it (a real, easy to
    # hit argparse footgun). Attaching it only to the sub-parsers means
    # these flags always go after the subcommand -- matching every usage
    # example in this file's own module docstring -- with no override risk.
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument(
        "--url", default=os.environ.get("CACHEPANEL_URL"),
        help="Basis-URL, z.B. http://10.0.0.160:8090 (oder CACHEPANEL_URL)",
    )
    common.add_argument(
        "--token", default=os.environ.get("CACHEPANEL_TOKEN"),
        help="Read-only API-Token fuer lesende Befehle (oder CACHEPANEL_TOKEN)",
    )
    common.add_argument(
        "--username", help="Benutzername fuer schreibende Befehle (interaktiv abgefragt falls leer)",
    )

    parser = argparse.ArgumentParser(description="CachePanel CLI-Begleitwerkzeug")

    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status", help="Aktuelle Statistiken anzeigen", parents=[common])
    sub.add_parser("history", help="Letzte Prefill-Laeufe anzeigen", parents=[common])
    p_prefill = sub.add_parser(
        "prefill", help="Prefill fuer einen Dienst jetzt ausloesen (braucht Admin-Login)", parents=[common]
    )
    p_prefill.add_argument("service", choices=["steam", "battlenet", "epic"])
    p_clear = sub.add_parser(
        "clear-cache", help="Gesamten Cache leeren -- destruktiv, braucht Admin-Login", parents=[common]
    )
    p_clear.add_argument("-y", "--yes", action="store_true", help="Ohne Rueckfrage bestaetigen")

    args = parser.parse_args()

    if not args.url:
        print("Fehler: --url oder CACHEPANEL_URL muss gesetzt sein.", file=sys.stderr)
        return 2

    client = Client(args.url, args.token)
    handlers = {
        "status": cmd_status,
        "history": cmd_history,
        "prefill": cmd_prefill,
        "clear-cache": cmd_clear_cache,
    }
    try:
        return handlers[args.command](client, args)
    except ApiError as exc:
        print(f"Fehler: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print()
        return 130


if __name__ == "__main__":
    sys.exit(main())
