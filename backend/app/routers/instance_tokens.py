"""Manage this instance's own write-scoped instance tokens -- the "slave"
side of the master-slave system (see services/instance_token_store.py for
the storage/hashing rationale, and auth_guard.py for the fixed scope every
instance token gets: read-only status + prefill-trigger, nothing else).

The raw token created here is meant to be copy-pasted into a DIFFERENT
CachePanel instance's "add slave" form (see routers/instances.py on that
other instance) -- generating one does nothing to THIS instance's own
behavior beyond making it acceptable as a Bearer credential going forward.

Every endpoint here requires a real admin *session*, same reasoning as
routers/api_tokens.py's own docstring: token management as a whole is
admin territory, and auth_guard.py never accepts ANY Bearer token
(instance or plain API) for paths under this prefix at all (see its own
_BEARER_EXEMPT_PREFIXES) -- but that only stops a *token* from reaching
here, not a "viewer" *session*, which still needs its own explicit block.
"""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.services import audit_log_store, instance_token_store

router = APIRouter(prefix="/api/instance-tokens", tags=["instance-tokens"])


def _require_admin(request: Request) -> None:
    if request.session.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Nur für Admin-Zugänge.")


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


class NewInstanceToken(BaseModel):
    label: str


@router.get(
    "",
    summary="List instance tokens",
    description="id, label, and creation date only -- never the token value or its hash.",
)
def list_instance_tokens(request: Request):
    _require_admin(request)
    return {"tokens": instance_token_store.list_tokens()}


@router.post(
    "",
    summary="Create an instance token",
    description="Returns the raw token exactly once, in this response -- copy it into another CachePanel "
    "instance's 'add slave' form to let that instance remote-control this one within the fixed instance-token "
    "scope (read-only status + prefill-trigger, see auth_guard.py). Never stored or shown again here.",
)
def create_instance_token(body: NewInstanceToken, request: Request):
    _require_admin(request)
    label = body.label.strip()
    if not label:
        raise HTTPException(status_code=400, detail="Bitte einen Namen für den Token vergeben.")
    raw_token = instance_token_store.create_token(label)
    audit_log_store.log("instance_token_created", request.session.get("username"), f"label={label}", _client_ip(request))
    return {"token": raw_token}


@router.delete("/{token_id}", summary="Revoke an instance token")
def delete_instance_token(token_id: int, request: Request):
    _require_admin(request)
    instance_token_store.delete_token(token_id)
    audit_log_store.log(
        "instance_token_revoked", request.session.get("username"), f"token_id={token_id}", _client_ip(request)
    )
    return {"ok": True}
