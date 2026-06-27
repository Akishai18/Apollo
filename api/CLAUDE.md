# api — FastAPI backend

The authoritative brain. All real logic lives behind here (engine, validation,
sandbox orchestration). The web frontend is a thin client.

## Status (Phase 4 done, 2026-06-11)

Built: `create_app(settings)` (factory; `JobRunner` + `Settings` on `app.state`),
endpoints `GET /healthz`, `POST /runs`, `GET /runs`, `GET /runs/{id}`,
`WS /runs/{id}/ws`. Modules: `models.py` (DTOs over core `Verdict`), `registry.py`
(adapter + sandboxed strategy factory), `jobs.py` (`JobRunner`), `auth.py` (JWT),
`settings.py` (env config), `store.py` (`RunStore` + InMemory/SQLite/Postgres),
`app.py`.
Untrusted source **always** runs through `SandboxedStrategy` — no trusted
in-process path. Deferred: Supabase Storage / Parquet artifacts and parallel
sweep (see PLAN.md rationale); a hosted `PostgresRunStore` stub.

Invariants the tests pin:
- The gate is sync + CPU-heavy + spawns sandbox subprocesses → it runs via
  `asyncio.to_thread`; per-window progress is bridged to the loop with
  `call_soon_threadsafe`. **Never run the gate on the event loop.**
- With `TestClient`, use it as a **context manager** so the portal event loop
  stays alive and background jobs progress.
- Auth is **off when no JWT verifier is configured** (offline dev/tests = fixed
  user). Set `GREEN_SUPABASE_URL` for modern Supabase JWKS/RS256 verification,
  or `GREEN_JWT_SECRET` for legacy HS256. Algorithm is pinned from our side —
  never trust the token header's `alg`.
- Reads are **ownership-scoped**: another user's run is 404, not 403 (existence
  never leaks). The durable store is the source of truth; the live `_Job` map is
  only streaming machinery and is bounded/evicted.

### Config (env)
`GREEN_SUPABASE_URL` (derives JWKS + issuer), `GREEN_JWT_JWKS_URL`,
`GREEN_JWT_ISSUER`, `GREEN_JWT_SECRET` (legacy HS256), `GREEN_JWT_AUDIENCE`
(default `authenticated`), `GREEN_STORE` (`memory` | `sqlite` | `postgres`),
`GREEN_SQLITE_PATH`, `GREEN_DATABASE_URL`, `GREEN_DEV_USER_ID`,
`GREEN_CORS_ORIGINS` (comma-separated; default `http://localhost:3000`).
Supabase deployment: run `api/migrations/0001_init.sql`.

### What the web (Phase 5) consumes — all sourced
- equity chart → `verdict.windows[].train_equity` / `test_equity` (in-sample vs
  held-out; the overfit story). Window-local 0-based timesteps.
- overfit curve → `verdict.windows[].train`/`test` Sharpe per window.
- sweep heatmap → `verdict.windows[].sweep` (params + train metrics per combo).
- rejection panel → `verdict.passed` + `verdict.reason`.
- run list → `GET /runs` (lean `RunSummary`); detail → `GET /runs/{id}`.
- live progress → `WS /runs/{id}/ws`.

Note: equity curves are embedded in the verdict JSON (durable for free). For
large datasets/long runs this row grows — move equity series to Storage/Parquet
(blob + signed URL) when that becomes a problem; the interface is ready for it.

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
