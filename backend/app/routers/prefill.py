from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.services import run_history_store
from app.services.prefill_runner import PrefillRunnerError, resolve_stream_target, stream_prefill, trigger_prefill

router = APIRouter(prefix="/api/prefill", tags=["prefill"])


@router.post("/{service}/run", summary="Run a prefill now", description="Triggers `steam|battlenet|epic-prefill` immediately (docker exec) instead of waiting for its schedule. Blocks until the run finishes.")
def run_prefill(service: str):
    try:
        result = trigger_prefill(service)
    except PrefillRunnerError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "service": result.service,
        "exit_code": result.exit_code,
        "output": result.output,
    }


@router.get(
    "/{service}/stream",
    summary="Live prefill output (SSE)",
    description="Server-Sent Events stream of a prefill run's live output, for the frontend's live-log view.",
)
def stream_prefill_run(service: str):
    """Server-Sent Events endpoint: streams prefill output live as it
    happens. GET (not POST) so the browser's native EventSource can consume
    it directly without extra client-side plumbing.

    Resolves the container *before* constructing the StreamingResponse, so
    an unknown service / missing container becomes a normal HTTP 400 here
    rather than a broken stream after a 200 has already gone out.
    """
    try:
        client, container, command = resolve_stream_target(service)
    except PrefillRunnerError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return StreamingResponse(
        stream_prefill(client, container, command, service), media_type="text/event-stream"
    )


@router.get("/history", summary="Recent prefill run history")
def get_history():
    return {"runs": run_history_store.get_history()}
