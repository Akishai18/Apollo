"""The FastAPI app — the authoritative brain (REST to submit/fetch, WebSocket to
stream progress). It holds no business rules beyond transport and orchestration;
the engine, gate, and sandbox do the work.

Endpoints:
  GET  /healthz          liveness
  POST /runs             submit a strategy + config → {id, state}
  GET  /runs/{id}        current state, progress, and verdict when done
  WS   /runs/{id}/ws     live snapshots: queued → per-window progress → verdict
"""

from __future__ import annotations

from fastapi import APIRouter, FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from green.api.jobs import JobRunner
from green.api.models import RunRequest, RunResponse

router = APIRouter()


def _runner(request: Request) -> JobRunner:
    return request.app.state.runner  # type: ignore[no-any-return]


@router.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/runs", response_model=RunResponse, status_code=202)
async def submit_run(request: Request, body: RunRequest) -> RunResponse:
    # async so the job is scheduled on the running event loop (submit calls
    # asyncio.create_task, which needs a loop in this thread).
    runner = _runner(request)
    run_id = runner.submit(body)
    snapshot = runner.get(run_id)
    assert snapshot is not None  # just created
    return snapshot


@router.get("/runs/{run_id}", response_model=RunResponse)
def get_run(request: Request, run_id: str) -> RunResponse | JSONResponse:
    snapshot = _runner(request).get(run_id)
    if snapshot is None:
        return JSONResponse({"detail": "run not found"}, status_code=404)
    return snapshot


@router.websocket("/runs/{run_id}/ws")
async def stream_run(websocket: WebSocket, run_id: str) -> None:
    await websocket.accept()
    runner: JobRunner = websocket.app.state.runner
    stream = await runner.stream(run_id)
    if stream is None:
        await websocket.send_json({"detail": "run not found"})
        await websocket.close(code=4404)
        return
    try:
        async for snapshot in stream:
            await websocket.send_json(snapshot.model_dump(mode="json"))
        await websocket.close()
    except WebSocketDisconnect:
        pass  # client went away mid-stream — expected, not an error
    finally:
        # Drop the subscriber now rather than at GC time, even on disconnect.
        await stream.aclose()


def create_app() -> FastAPI:
    app = FastAPI(title="green — strategy validation API", version="0.1.0")
    app.state.runner = JobRunner()
    app.include_router(router)
    return app


app = create_app()
