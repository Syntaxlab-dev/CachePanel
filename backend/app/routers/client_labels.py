"""Assign human-readable names to client IPs (see services/client_labels_store.py).
A normal /api/ route -- no special handling in auth_guard.py needed, the
existing viewer-role block already covers POST/DELETE here the same way it
covers every other mutating route.
"""

from fastapi import APIRouter
from pydantic import BaseModel

from app.services import client_labels_store

router = APIRouter(prefix="/api/client-labels", tags=["client-labels"])


class ClientLabel(BaseModel):
    ip: str
    label: str


@router.get("", summary="List client IP labels")
def list_labels():
    return {"labels": client_labels_store.get_labels()}


@router.post("", summary="Set a client IP label", description="Creates or overwrites the label for the given IP.")
def set_label(body: ClientLabel):
    ip = body.ip.strip()
    label = body.label.strip()
    if not ip or not label:
        return {"labels": client_labels_store.get_labels()}
    return {"labels": client_labels_store.set_label(ip, label)}


@router.delete("/{ip}", summary="Remove a client IP label")
def delete_label(ip: str):
    return {"labels": client_labels_store.delete_label(ip)}
