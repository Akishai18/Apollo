# api — FastAPI backend

The authoritative brain. All real logic lives behind here (engine, validation,
sandbox orchestration). The web frontend is a thin client.

## Status (Phase 4, 2026-06-10)

Built: `create_app()` (factory; `JobRunner` on `app.state`), endpoints
`GET /healthz`, `POST /runs`, `GET /runs/{id}`, `WS /runs/{id}/ws`. Modules:
`models.py` (DTOs over core `Verdict`), `registry.py` (adapter + sandboxed
strategy factory), `jobs.py` (`JobRunner`), `app.py`. Untrusted source **always**
runs through `SandboxedStrategy` — there is no trusted in-process path here.
Not yet: Supabase (auth/persistence/RLS), parallel sweep, Parquet artifacts.

Key invariant the tests pin: the gate is sync + CPU-heavy + spawns sandbox
subprocesses, so it runs via `asyncio.to_thread`; per-window progress is bridged
to the loop with `call_soon_threadsafe`. Never run the gate on the event loop.
When testing with Starlette's `TestClient`, use it as a context manager so the
portal event loop stays alive and background jobs actually progress.

## Shape

- **REST** for CRUD and to kick off jobs; **WebSocket** to stream backtest /
  sweep progress to the UI. No GraphQL (see root CLAUDE.md for the rationale).
- Long-running work (backtests, parameter sweeps, walk-forward) runs as jobs.
  Start with an async in-process runner behind a clean interface; move to
  **Dramatiq/RQ + Redis** when we scale (sweeps are embarrassingly parallel).
- Large artifacts (equity curves, tick logs, sweep grids) are served as
  Parquet/Arrow or via signed storage URLs — not stuffed into JSON.

## Supabase integration (discipline rule)

Supabase provides **Postgres + Auth + Storage + RLS** — primitives only. FastAPI
is authoritative:

- Verify Supabase **JWTs** on requests; rely on **RLS** for per-user isolation.
- Do NOT route the core through Supabase's auto-generated data API or edge
  functions. Heavy/long compute lives in our worker + sandbox infra, never in
  Supabase edge functions.

## Dependencies

Depends on `core`, `validation`, `sandbox`, and the adapters it exposes. Holds no
business rules of its own beyond transport, auth, and job orchestration.
