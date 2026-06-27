"""The FastAPI app — the authoritative brain (REST to submit/fetch, WebSocket to
stream progress). It holds no business rules beyond transport, auth, and job
orchestration; the engine, gate, and sandbox do the work.

Auth: every request is resolved to a user. With a JWT secret configured, a
verified Supabase bearer token is required; without one (local/dev), requests
run as a fixed dev user. Runs are owned by the submitting user and reads are
scoped to the owner — a cross-user fetch is indistinguishable from "not found".

Endpoints:
  GET  /healthz          liveness
  POST /runs             submit a strategy + config → {id, state}
  POST /runs/{id}/validate
  GET  /runs             list the caller's runs
  GET  /runs/{id}        state, progress, and verdict when done (owner only)
  WS   /runs/{id}/ws     live snapshots: queued → per-window progress → verdict
"""

from __future__ import annotations

from fastapi import APIRouter, FastAPI, Header, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from green.api.auth import AuthError, verify_supabase_jwt
from green.api.jobs import JobRunner
from green.api.models import (
    GenerateRequest,
    RunKind,
    RunRequest,
    RunResponse,
    RunSummary,
    StrategyCreate,
    StrategyDetail,
    StrategyDraftCreate,
    StrategyDraftRecord,
    StrategyDraftUpdate,
    StrategyRecord,
    StrategySummary,
    StrategyVersionRecord,
)
from green.api.settings import Settings
from green.api.store import build_store
from green.api.templates import templates_payload

router = APIRouter()


def _settings(request_or_ws: Request | WebSocket) -> Settings:
    return request_or_ws.app.state.settings  # type: ignore[no-any-return]


def _runner(request_or_ws: Request | WebSocket) -> JobRunner:
    return request_or_ws.app.state.runner  # type: ignore[no-any-return]


def _resolve_user(settings: Settings, bearer: str | None) -> str:
    """Token → user id. Raises AuthError when auth is on and the token is bad."""
    if not settings.auth_enabled:
        return settings.dev_user_id
    if not bearer or not bearer.lower().startswith("bearer "):
        raise AuthError("missing bearer token")
    assert settings.jwt_secret is not None
    token = bearer.split(" ", 1)[1].strip()
    principal = verify_supabase_jwt(
        token, secret=settings.jwt_secret, audience=settings.jwt_audience
    )
    return principal.user_id


@router.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/templates")
def list_templates() -> list[dict[str, object]]:
    """Runnable strategy templates (real source + default config). Public — the
    frontend uses these as starting points until the NL generator lands."""
    return templates_payload()


@router.post("/strategies", response_model=StrategyRecord, status_code=201)
def create_strategy(
    request: Request, body: StrategyCreate, authorization: str | None = Header(default=None)
) -> StrategyRecord | JSONResponse:
    try:
        user_id = _resolve_user(_settings(request), authorization)
    except AuthError as exc:
        return JSONResponse({"detail": str(exc)}, status_code=401)
    return _runner(request).create_strategy(user_id, body)


@router.get("/strategies", response_model=list[StrategySummary])
def list_strategies(
    request: Request, authorization: str | None = Header(default=None)
) -> list[StrategySummary] | JSONResponse:
    try:
        user_id = _resolve_user(_settings(request), authorization)
    except AuthError as exc:
        return JSONResponse({"detail": str(exc)}, status_code=401)
    return _runner(request).list_strategies_for_user(user_id)


@router.get("/strategies/{strategy_id}", response_model=StrategyDetail)
def get_strategy(
    request: Request, strategy_id: str, authorization: str | None = Header(default=None)
) -> StrategyDetail | JSONResponse:
    try:
        user_id = _resolve_user(_settings(request), authorization)
    except AuthError as exc:
        return JSONResponse({"detail": str(exc)}, status_code=401)
    detail = _runner(request).get_strategy_detail(user_id, strategy_id)
    if detail is None:
        return JSONResponse({"detail": "strategy not found"}, status_code=404)
    return detail


@router.post(
    "/strategies/{strategy_id}/drafts",
    response_model=StrategyDraftRecord,
    status_code=201,
)
def create_draft(
    request: Request,
    strategy_id: str,
    body: StrategyDraftCreate,
    authorization: str | None = Header(default=None),
) -> StrategyDraftRecord | JSONResponse:
    try:
        user_id = _resolve_user(_settings(request), authorization)
    except AuthError as exc:
        return JSONResponse({"detail": str(exc)}, status_code=401)
    draft = _runner(request).create_draft(user_id, strategy_id, body)
    if draft is None:
        return JSONResponse({"detail": "strategy not found"}, status_code=404)
    return draft


@router.patch("/drafts/{draft_id}", response_model=StrategyDraftRecord)
def update_draft(
    request: Request,
    draft_id: str,
    body: StrategyDraftUpdate,
    authorization: str | None = Header(default=None),
) -> StrategyDraftRecord | JSONResponse:
    try:
        user_id = _resolve_user(_settings(request), authorization)
    except AuthError as exc:
        return JSONResponse({"detail": str(exc)}, status_code=401)
    draft = _runner(request).update_draft(user_id, draft_id, body)
    if draft is None:
        return JSONResponse({"detail": "draft not found"}, status_code=404)
    return draft


@router.post("/drafts/{draft_id}/versions", response_model=StrategyVersionRecord, status_code=201)
def create_version(
    request: Request, draft_id: str, authorization: str | None = Header(default=None)
) -> StrategyVersionRecord | JSONResponse:
    try:
        user_id = _resolve_user(_settings(request), authorization)
    except AuthError as exc:
        return JSONResponse({"detail": str(exc)}, status_code=401)
    version = _runner(request).create_version_from_draft(user_id, draft_id)
    if version is None:
        return JSONResponse({"detail": "draft not found"}, status_code=404)
    return version


@router.post("/versions/{version_id}/backtest", response_model=RunResponse, status_code=202)
async def backtest_version(
    request: Request, version_id: str, authorization: str | None = Header(default=None)
) -> RunResponse | JSONResponse:
    try:
        user_id = _resolve_user(_settings(request), authorization)
    except AuthError as exc:
        return JSONResponse({"detail": str(exc)}, status_code=401)
    run_id = _runner(request).submit_version(user_id, version_id, RunKind.BACKTEST)
    if run_id is None:
        return JSONResponse({"detail": "version not found"}, status_code=404)
    snapshot = _runner(request).get(run_id, user_id)
    assert snapshot is not None
    return snapshot


@router.post("/versions/{version_id}/validate", response_model=RunResponse, status_code=202)
async def validate_version(
    request: Request, version_id: str, authorization: str | None = Header(default=None)
) -> RunResponse | JSONResponse:
    try:
        user_id = _resolve_user(_settings(request), authorization)
    except AuthError as exc:
        return JSONResponse({"detail": str(exc)}, status_code=401)
    run_id = _runner(request).submit_version(user_id, version_id, RunKind.VALIDATION)
    if run_id is None:
        return JSONResponse({"detail": "version not found"}, status_code=404)
    snapshot = _runner(request).get(run_id, user_id)
    assert snapshot is not None
    return snapshot


@router.post("/runs", response_model=RunResponse, status_code=202)
async def submit_run(
    request: Request, body: RunRequest, authorization: str | None = Header(default=None)
) -> RunResponse | JSONResponse:
    # async so the job is scheduled on the running event loop (submit calls
    # asyncio.create_task, which needs a loop in this thread).
    try:
        user_id = _resolve_user(_settings(request), authorization)
    except AuthError as exc:
        return JSONResponse({"detail": str(exc)}, status_code=401)
    runner = _runner(request)
    run_id = runner.submit(user_id, body)
    snapshot = runner.get(run_id, user_id)
    assert snapshot is not None  # just created
    return snapshot


@router.post("/generate", response_model=RunResponse, status_code=202)
async def submit_generation(
    request: Request, body: GenerateRequest, authorization: str | None = Header(default=None)
) -> RunResponse | JSONResponse:
    """Submit a natural-language strategy description. Apollo generates the code
    (tier picks the model — server-side only), then it runs through the same gate.
    Returns immediately; the run streams `generating → running → completed`."""
    try:
        user_id = _resolve_user(_settings(request), authorization)
    except AuthError as exc:
        return JSONResponse({"detail": str(exc)}, status_code=401)
    runner = _runner(request)
    run_id = runner.submit_generation(user_id, body.prompt, body.tier)
    snapshot = runner.get(run_id, user_id)
    assert snapshot is not None  # just created
    return snapshot


@router.post("/runs/{run_id}/validate", response_model=RunResponse, status_code=202)
async def validate_existing_run(
    request: Request, run_id: str, authorization: str | None = Header(default=None)
) -> RunResponse | JSONResponse:
    """Clone an owned run's request as a formal validation run."""
    try:
        user_id = _resolve_user(_settings(request), authorization)
    except AuthError as exc:
        return JSONResponse({"detail": str(exc)}, status_code=401)
    runner = _runner(request)
    new_id = runner.submit_validation_from_run(user_id, run_id)
    if new_id is None:
        return JSONResponse({"detail": "run not found"}, status_code=404)
    snapshot = runner.get(new_id, user_id)
    assert snapshot is not None
    return snapshot


@router.get("/runs", response_model=list[RunSummary])
def list_runs(
    request: Request, authorization: str | None = Header(default=None)
) -> list[RunSummary] | JSONResponse:
    try:
        user_id = _resolve_user(_settings(request), authorization)
    except AuthError as exc:
        return JSONResponse({"detail": str(exc)}, status_code=401)
    return _runner(request).list_for_user(user_id)


@router.get("/runs/{run_id}", response_model=RunResponse)
def get_run(
    request: Request, run_id: str, authorization: str | None = Header(default=None)
) -> RunResponse | JSONResponse:
    try:
        user_id = _resolve_user(_settings(request), authorization)
    except AuthError as exc:
        return JSONResponse({"detail": str(exc)}, status_code=401)
    snapshot = _runner(request).get(run_id, user_id)
    if snapshot is None:
        return JSONResponse({"detail": "run not found"}, status_code=404)
    return snapshot


@router.websocket("/runs/{run_id}/ws")
async def stream_run(websocket: WebSocket, run_id: str) -> None:
    await websocket.accept()
    # Browsers can't set Authorization on a WebSocket, so accept the token via a
    # query param too (?token=...), falling back to the header for non-browsers.
    header = websocket.headers.get("authorization")
    query_token = websocket.query_params.get("token")
    bearer = header or (f"Bearer {query_token}" if query_token else None)
    try:
        user_id = _resolve_user(_settings(websocket), bearer)
    except AuthError as exc:
        await websocket.send_json({"detail": str(exc)})
        await websocket.close(code=4401)
        return

    stream = await _runner(websocket).stream(run_id, user_id)
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


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    app = FastAPI(title="green — strategy validation API", version="0.1.0")
    app.state.settings = settings
    store = build_store(settings.store, sqlite_path=settings.sqlite_path)
    app.state.runner = JobRunner(
        store,
        max_jobs=settings.max_jobs,
        anthropic_key=settings.anthropic_api_key,
        gemini_key=settings.gemini_api_key,
        gemini_model=settings.gemini_model,
    )
    # The browser frontend (Next.js) is a separate origin; allow it through.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router)
    return app


app = create_app()
