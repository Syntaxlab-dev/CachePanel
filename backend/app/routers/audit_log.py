"""Read-only view of the security/admin action log (see
services/audit_log_store.py for what gets logged and why).

Admin-only, same reasoning as routers/api_tokens.py's own docstring: the
guard's existing viewer-role block only stops non-GET requests, but this
endpoint reveals every account's login attempts and IPs, which is a step
beyond what a read-only "viewer" role should see by default.
"""

from fastapi import APIRouter, HTTPException, Query, Request

from app.services import audit_log_store

router = APIRouter(prefix="/api/audit-log", tags=["audit-log"])


def _require_admin(request: Request) -> None:
    if request.session.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Nur für Admin-Zugänge.")


@router.get(
    "",
    summary="List audit log entries",
    description="Newest first, optionally filtered by action/username/free-text/time range. "
    "Admin-only -- see module docstring.",
)
def list_entries(
    request: Request,
    action: str | None = None,
    username: str | None = None,
    q: str | None = None,
    since: str | None = None,
    until: str | None = None,
    limit: int = Query(200, ge=1, le=1000),
):
    _require_admin(request)
    return {"entries": audit_log_store.list_entries(action, username, q, since, until, limit)}


@router.get("/actions", summary="Distinct action names currently present", description="For the filter dropdown.")
def list_actions(request: Request):
    _require_admin(request)
    return {"actions": audit_log_store.list_actions()}
