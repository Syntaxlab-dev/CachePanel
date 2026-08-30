"""Manage read-only API tokens for third-party integrations (see
services/api_token_store.py for the storage/hashing rationale).

Every endpoint here requires a real admin *session* -- explicitly checked
below, on top of (not instead of) AuthGuardMiddleware's existing
authenticated/viewer gate. Two reasons this isn't left to the guard alone:
1. A "viewer" session is already blocked from POST/DELETE by the guard's
   existing role check, but GET here (listing tokens) would otherwise be
   allowed for a viewer like any other read -- token labels aren't secret,
   but token *management* as a whole is admin territory, so this router
   opts out of that default rather than relying on it being fine.
2. auth_guard.py deliberately never accepts a Bearer token for paths under
   this router's prefix at all (see its own comment) -- but that only
   stops a *token* from reaching here, not a "viewer" *session*, which
   still needs its own explicit block below.
"""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.services import api_token_store

router = APIRouter(prefix="/api/tokens", tags=["tokens"])


def _require_admin(request: Request) -> None:
    if request.session.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Nur für Admin-Zugänge.")


class NewToken(BaseModel):
    label: str


@router.get("", summary="List API tokens", description="id, label, and creation date only -- never the token value or its hash.")
def list_tokens(request: Request):
    _require_admin(request)
    return {"tokens": api_token_store.list_tokens()}


@router.post(
    "",
    summary="Create an API token",
    description="Returns the raw token exactly once, in this response -- it is never stored or shown again, "
    "only its hash is persisted. Every token is read-only (GET/HEAD/OPTIONS), unconditionally.",
)
def create_token(body: NewToken, request: Request):
    _require_admin(request)
    label = body.label.strip()
    if not label:
        raise HTTPException(status_code=400, detail="Bitte einen Namen für den Token vergeben.")
    raw_token = api_token_store.create_token(label)
    return {"token": raw_token}


@router.delete("/{token_id}", summary="Revoke an API token")
def delete_token(token_id: int, request: Request):
    _require_admin(request)
    api_token_store.delete_token(token_id)
    return {"ok": True}
