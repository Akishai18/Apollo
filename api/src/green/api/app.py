"""The FastAPI app — the authoritative brain (REST to submit/fetch, WebSocket to
stream progress). It holds no business rules beyond transport, auth, and job
orchestration; the engine, gate, and sandbox do the work.

Auth: every request is resolved to a user. With Supabase JWT verification
configured, a verified bearer token is required; without one (local/dev),
requests run as a fixed dev user. Runs are owned by the submitting user and
reads are scoped to the owner — a cross-user fetch is indistinguishable from
"not found".

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

from green.api.assistant import answer_strategy_question
from green.api.auth import AuthError, verify_supabase_jwt, verify_supabase_user_endpoint
from green.api.jobs import JobRunner
from green.api.models import (
    DecayAlert,
    GenerateRequest,
    RunKind,
    RunRequest,
    RunResponse,
    RunSummary,
    StrategyChatRequest,
    StrategyChatResponse,
    StrategyCreate,
    StrategyDetail,
    StrategyDraftCreate,
    StrategyDraftRecord,
    StrategyDraftUpdate,
    StrategyRecord,
    StrategySummary,
    StrategyVersionRecord,
    TrackedRun,
)
from green.api.settings import Settings
from green.api.store import build_store
from green.api.templates import templates_payload
from green.api.tracking import list_tracked_runs

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
    token = bearer.split(" ", 1)[1].strip()
    try:
        principal = verify_supabase_jwt(
            token,
            secret=settings.jwt_secret,
            jwks_url=settings.jwt_jwks_url,
            issuer=settings.jwt_issuer,
            audience=settings.jwt_audience,
        )
    except AuthError:
        if not settings.supabase_url or not settings.supabase_anon_key:
            raise
        principal = verify_supabase_user_endpoint(
            token,
            supabase_url=settings.supabase_url,
            anon_key=settings.supabase_anon_key,
        )
    return principal.user_id


def _generation_prompt(body: GenerateRequest) -> str | None:
    if body.context is None:
        return None

    parts = [
        "Revise the existing Apollo trading strategy instead of starting from scratch.",
        "Keep the result as one valid Strategy subclass that passes Apollo's sandbox and gate.",
        "Preserve the existing intent unless the user's new request explicitly changes it.",
        "",
        "User requested change:",
        body.prompt,
    ]
    if body.context.prompt:
        parts.extend(["", "Previous user request:", body.context.prompt])
    if body.context.note:
        parts.extend(["", "Previous rationale:", body.context.note])
    parts.extend(
        [
            "",
            "Existing strategy source:",
            "```python",
            body.context.source,
            "```",
        ]
    )
    return "\n".join(parts)


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


@router.post("/strategies/{strategy_id}/promote")
def promote_strategy(
    request: Request, strategy_id: str, authorization: str | None = Header(default=None)
) -> JSONResponse:
    try:
        user_id = _resolve_user(_settings(request), authorization)
    except AuthError as exc:
        return JSONResponse({"detail": str(exc)}, status_code=401)
    ok = _runner(request).promote_strategy(user_id, strategy_id, True)
    if not ok:
        return JSONResponse({"detail": "strategy has no versions to promote"}, status_code=404)
    return JSONResponse({"strategy_id": strategy_id, "promoted": True})


@router.post("/strategies/{strategy_id}/demote")
def demote_strategy(
    request: Request, strategy_id: str, authorization: str | None = Header(default=None)
) -> JSONResponse:
    try:
        user_id = _resolve_user(_settings(request), authorization)
    except AuthError as exc:
        return JSONResponse({"detail": str(exc)}, status_code=401)
    ok = _runner(request).promote_strategy(user_id, strategy_id, False)
    if not ok:
        return JSONResponse({"detail": "strategy has no versions"}, status_code=404)
    return JSONResponse({"strategy_id": strategy_id, "promoted": False})


@router.post("/maintenance/revalidate")
async def revalidate_promoted(
    request: Request, authorization: str | None = Header(default=None)
) -> JSONResponse:
    """Re-run formal validation for every promoted strategy on current data.
    Callable on a schedule (see scripts/revalidate.py) for decay monitoring."""
    try:
        user_id = _resolve_user(_settings(request), authorization)
    except AuthError as exc:
        return JSONResponse({"detail": str(exc)}, status_code=401)
    run_ids = _runner(request).revalidate_promoted(user_id)
    return JSONResponse({"run_ids": run_ids, "count": len(run_ids)})


@router.get("/maintenance/alerts", response_model=list[DecayAlert])
def decay_alerts(
    request: Request,
    min_oos_sharpe: float = 0.5,
    authorization: str | None = Header(default=None),
) -> list[DecayAlert] | JSONResponse:
    """Promoted strategies whose latest validation breached the bar — the decay
    monitor's read side (pair with POST /maintenance/revalidate on a schedule)."""
    try:
        user_id = _resolve_user(_settings(request), authorization)
    except AuthError as exc:
        return JSONResponse({"detail": str(exc)}, status_code=401)
    return _runner(request).decay_alerts(user_id, min_oos_sharpe)


@router.get("/experiments/runs", response_model=list[TrackedRun])
def experiment_runs(
    request: Request, authorization: str | None = Header(default=None)
) -> list[TrackedRun] | JSONResponse:
    """MLflow-tracked backtests for the in-app browser (empty when tracking off)."""
    try:
        _resolve_user(_settings(request), authorization)
    except AuthError as exc:
        return JSONResponse({"detail": str(exc)}, status_code=401)
    return list_tracked_runs()


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
    run_id = runner.submit_generation(
        user_id,
        body.prompt,
        body.tier,
        generation_prompt=_generation_prompt(body),
    )
    snapshot = runner.get(run_id, user_id)
    assert snapshot is not None  # just created
    return snapshot


@router.post("/assistant/strategy", response_model=StrategyChatResponse)
def chat_about_strategy(
    request: Request,
    body: StrategyChatRequest,
    authorization: str | None = Header(default=None),
) -> StrategyChatResponse | JSONResponse:
    """Answer a conversational question about a generated strategy/run.

    This endpoint never changes code or starts a new backtest. Revision requests
    still go through /generate with context.
    """
    try:
        _resolve_user(_settings(request), authorization)
    except AuthError as exc:
        return JSONResponse({"detail": str(exc)}, status_code=401)
    settings = _settings(request)
    return StrategyChatResponse(
        answer=answer_strategy_question(
            body,
            gemini_key=settings.gemini_api_key,
            gemini_model=settings.gemini_model,
        )
    )


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
    store = build_store(
        settings.store,
        sqlite_path=settings.sqlite_path,
        database_url=settings.database_url,
    )
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
