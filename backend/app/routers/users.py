"""Manage additional panel accounts (Welle 4 multi-user support).

Deliberately its own router at /api/users rather than living under
/api/auth/ -- AuthGuardMiddleware exempts the entire /api/auth/ prefix
unconditionally (it has to, since /api/auth/login etc. must be reachable
*before* anyone is logged in), and these endpoints need the opposite: they
must require an existing session, same as every other real /api/ route.
Putting them at a different prefix gets that protection for free from the
guard's existing "everything under /api/ except /api/auth/*" rule, with no
change to auth_guard.py needed.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import auth_credentials_store

router = APIRouter(prefix="/api/users", tags=["users"])


class NewUser(BaseModel):
    username: str
    password: str


@router.get("", summary="List panel accounts", description="Usernames only, never password hashes.")
def list_users():
    return {"users": auth_credentials_store.list_users()}


@router.post("", summary="Add a panel account")
def add_user(body: NewUser):
    username = body.username.strip()
    if not username or len(body.password) < 8:
        raise HTTPException(
            status_code=400, detail="Benutzername darf nicht leer sein, Passwort braucht mindestens 8 Zeichen."
        )
    try:
        auth_credentials_store.add_user(username, body.password)
    except ValueError:
        raise HTTPException(status_code=409, detail="Dieser Benutzername ist bereits vergeben.")
    return {"ok": True}


@router.delete("/{username}", summary="Remove a panel account")
def remove_user(username: str):
    try:
        auth_credentials_store.remove_user(username)
    except ValueError as exc:
        if str(exc) == "last_user":
            raise HTTPException(
                status_code=400, detail="Der letzte verbleibende Zugang kann nicht entfernt werden."
            )
        raise HTTPException(status_code=404, detail="Unbekannter Benutzer.")
    return {"ok": True}
