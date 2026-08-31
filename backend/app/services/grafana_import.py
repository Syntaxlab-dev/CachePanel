"""One-click import of grafana/cachepanel-dashboard.json into a user's own
Grafana instance (4th feature round, Welle 5) -- replaces "download the
JSON file and import it by hand" (still possible, the file stays in the
repo) with a direct call to Grafana's own HTTP API.

The dashboard JSON was built (3rd feature round, Welle 4) as a proper
Grafana "export for sharing externally" file: it carries a `__inputs`
block declaring one required input, `DS_PROMETHEUS` (a datasource
picker) -- Grafana's OWN `POST /api/dashboards/import` endpoint (not
`/api/dashboards/db`, which expects datasource UIDs already baked in) is
built specifically to consume this shape via an `inputs` array at import
time, substituting `${DS_PROMETHEUS}` throughout the dashboard for
whichever real datasource UID is supplied. This is the standard mechanism
Grafana's own "Export for sharing externally" / "Import" flow uses for any
community dashboard, not something invented here.

Since every user's Grafana has its own datasource UID for whatever they
named their Prometheus source, this module first asks Grafana which
Prometheus-type datasources exist (`GET /api/datasources`) rather than
requiring the admin to go find and paste an internal UID by hand:
- exactly one found -> used automatically
- zero found -> a clear error (add a Prometheus datasource in Grafana first)
- more than one -> returns the candidate list so the caller (routers/
  settings.py) can ask the admin to pick, rather than silently guessing
"""

import json
from pathlib import Path

import requests

_REQUEST_TIMEOUT = 15
_DASHBOARD_PATH = Path(__file__).resolve().parent.parent.parent / "grafana" / "cachepanel-dashboard.json"


class GrafanaImportError(RuntimeError):
    pass


class DatasourceAmbiguousError(GrafanaImportError):
    """Raised instead of a plain GrafanaImportError when more than one
    Prometheus datasource exists and no explicit choice was supplied --
    carries the candidate list so the caller can surface a picker instead
    of just failing."""

    def __init__(self, candidates: list[dict]):
        self.candidates = candidates
        super().__init__("Multiple Prometheus datasources found -- pick one.")


def _headers(api_key: str) -> dict:
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def list_prometheus_datasources(grafana_url: str, api_key: str) -> list[dict]:
    url = f"{grafana_url.rstrip('/')}/api/datasources"
    try:
        resp = requests.get(url, headers=_headers(api_key), timeout=_REQUEST_TIMEOUT)
        resp.raise_for_status()
    except requests.RequestException as exc:
        raise GrafanaImportError(f"Could not reach Grafana at {grafana_url}: {exc}") from exc
    try:
        datasources = resp.json()
    except ValueError as exc:
        raise GrafanaImportError("Grafana returned a non-JSON response while listing datasources.") from exc
    return [{"uid": ds["uid"], "name": ds["name"]} for ds in datasources if ds.get("type") == "prometheus"]


def import_dashboard(grafana_url: str, api_key: str, datasource_uid: str | None) -> dict:
    """Imports the bundled dashboard JSON into `grafana_url`, resolving
    `${DS_PROMETHEUS}` to `datasource_uid` -- or, if that's None, to the
    single Prometheus datasource found automatically (see module
    docstring). Returns Grafana's own import response (includes the
    dashboard's URL on that instance) on success."""
    if not _DASHBOARD_PATH.exists():
        raise GrafanaImportError("Bundled dashboard JSON not found in this image.")
    dashboard = json.loads(_DASHBOARD_PATH.read_text(encoding="utf-8"))
    # A dashboard `id` (as opposed to `uid`, which stays fixed) is
    # instance-specific and Grafana rejects an import that includes one --
    # always None here regardless of whether the bundled file happens to
    # carry a stale one from a previous export.
    dashboard["id"] = None

    if not datasource_uid:
        candidates = list_prometheus_datasources(grafana_url, api_key)
        if not candidates:
            raise GrafanaImportError(
                "No Prometheus datasource found in this Grafana instance -- add one first, then try again."
            )
        if len(candidates) > 1:
            raise DatasourceAmbiguousError(candidates)
        datasource_uid = candidates[0]["uid"]

    payload = {
        "dashboard": dashboard,
        "overwrite": True,
        "inputs": [
            {"name": "DS_PROMETHEUS", "type": "datasource", "pluginId": "prometheus", "value": datasource_uid}
        ],
    }
    url = f"{grafana_url.rstrip('/')}/api/dashboards/import"
    try:
        resp = requests.post(url, headers=_headers(api_key), json=payload, timeout=_REQUEST_TIMEOUT)
    except requests.RequestException as exc:
        raise GrafanaImportError(f"Could not reach Grafana at {grafana_url}: {exc}") from exc
    if resp.status_code >= 400:
        raise GrafanaImportError(f"Grafana rejected the import (HTTP {resp.status_code}): {resp.text[:300]}")
    try:
        return resp.json()
    except ValueError as exc:
        raise GrafanaImportError("Grafana returned a non-JSON response after import.") from exc
