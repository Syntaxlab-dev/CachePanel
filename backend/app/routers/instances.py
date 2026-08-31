"""The "master" side of the master-slave instance system (4th feature
round, Welle 4) -- register other CachePanel instances as slaves (name +
base URL + the instance token THAT instance generated for itself, see
routers/instance_tokens.py), view their live status in one place, and
trigger a real prefill run on any of them remotely.

Every endpoint here requires a real admin *session*, same reasoning as
routers/api_tokens.py's own docstring -- this is deliberately stricter than
letting a "viewer" session read the registered slave list: even without
tokens, the list reveals internal network topology (names + base URLs of
other infrastructure this admin runs), which fits the same "narrower trust
boundary" reasoning /api/tokens and /api/settings already get. Also
excluded from Bearer-token access entirely (see auth_guard.py's
_BEARER_EXEMPT_PREFIXES) for the same reason.
"""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.services import audit_log_store, remote_instance_client, slave_instance_store
from app.services.remote_instance_client import RemoteInstanceError

router = APIRouter(prefix="/api/instances", tags=["instances"])


def _require_admin(request: Request) -> None:
    if request.session.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Nur für Admin-Zugänge.")


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


class NewInstance(BaseModel):
    name: str
    base_url: str
    token: str


@router.get(
    "",
    summary="List registered slave instances",
    description="id, name, base_url, and creation date only -- never the stored instance token.",
)
def list_instances(request: Request):
    _require_admin(request)
    return {"instances": slave_instance_store.list_instances()}


@router.post(
    "",
    summary="Register a slave instance",
    description="`token` is the instance token the SLAVE instance generated for itself (see "
    "/api/instance-tokens on that other instance) -- stored encrypted at rest here, the same way other "
    "secrets in Settings are (see services/settings_encryption.py).",
)
def add_instance(body: NewInstance, request: Request):
    _require_admin(request)
    name = body.name.strip()
    base_url = body.base_url.strip()
    token = body.token.strip()
    if not name or not base_url or not token:
        raise HTTPException(status_code=400, detail="Name, Basis-URL und Token werden benötigt.")
    if not (base_url.startswith("http://") or base_url.startswith("https://")):
        raise HTTPException(status_code=400, detail="Die Basis-URL muss mit http:// oder https:// beginnen.")
    instance_id = slave_instance_store.add_instance(name, base_url, token)
    audit_log_store.log(
        "slave_instance_added", request.session.get("username"), f"name={name} url={base_url}", _client_ip(request)
    )
    return {"id": instance_id}


@router.delete("/{instance_id}", summary="Remove a registered slave instance")
def delete_instance(instance_id: int, request: Request):
    _require_admin(request)
    slave_instance_store.delete_instance(instance_id)
    audit_log_store.log(
        "slave_instance_removed", request.session.get("username"), f"instance_id={instance_id}", _client_ip(request)
    )
    return {"ok": True}


@router.get(
    "/summary",
    summary="Live status of every registered slave instance",
    description="Polls each registered slave's own read-only status endpoint in turn. An unreachable or "
    "erroring slave is reported as its own entry with `error` set, rather than failing the whole request -- "
    "one bad instance never blanks out the others.",
)
def get_summary(request: Request):
    _require_admin(request)
    results = []
    for instance in slave_instance_store.list_instances():
        full = slave_instance_store.get_instance(instance["id"])
        entry = {"id": instance["id"], "name": instance["name"], "base_url": instance["base_url"]}
        try:
            entry["status"] = remote_instance_client.fetch_remote_status(full)
            entry["error"] = None
        except RemoteInstanceError as exc:
            entry["status"] = None
            entry["error"] = str(exc)
        results.append(entry)
    return {"instances": results}


@router.post(
    "/{instance_id}/prefill/{service}",
    summary="Trigger a prefill run on a slave instance",
    description="Blocks until the remote run finishes (same contract as the local POST "
    "/api/prefill/{service}/run) -- can take several minutes for a large game.",
)
def trigger_prefill(instance_id: int, service: str, request: Request):
    _require_admin(request)
    full = slave_instance_store.get_instance(instance_id)
    if full is None:
        raise HTTPException(status_code=404, detail="Unbekannte Instanz.")
    audit_log_store.log(
        "remote_prefill_triggered",
        request.session.get("username"),
        f"instance={full['name']} service={service}",
        _client_ip(request),
    )
    try:
        return remote_instance_client.trigger_remote_prefill(full, service)
    except RemoteInstanceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
