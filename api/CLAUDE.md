# api — FastAPI backend

The authoritative brain. All real logic lives behind here (engine, validation,
sandbox orchestration). The web frontend is a thin client.

## Status (Phase 4 done, 2026-06-11)

Built: `create_app(settings)` (factory; `JobRunner` + `Settings` on `app.state`),
endpoints `GET /healthz`, `POST /runs`, `GET /runs`, `GET /runs/{id}`,
`WS /runs/{id}/ws`. Modules: `models.py` (DTOs over core `Verdict`), `registry.py`
(adapter + sandboxed strategy factory), `jobs.py` (`JobRunner`), `auth.py` (JWT),
`settings.py` (env config), `store.py` (`RunStore` + InMemory/SQLite), `app.py`.
Untrusted source **always** runs through `SandboxedStrategy` — no trusted
in-process path. Deferred: Supabase Storage / Parquet artifacts and parallel
sweep (see PLAN.md rationale); a hosted `PostgresRunStore` stub.

Invariants the tests pin:
- The gate is sync + CPU-heavy + spawns sandbox subprocesses → it runs via
  `asyncio.to_thread`; per-window progress is bridged to the loop with
  `call_soon_threadsafe`. **Never run the gate on the event loop.**
- With `TestClient`, use it as a **context manager** so the portal event loop
  stays alive and background jobs progress.
- Auth is **off when no JWT secret is configured** (offline dev/tests = fixed
  user); set `GREEN_JWT_SECRET` to require verified bearer tokens. Algorithm is
  pinned to HS256 from our side — never trust the token header's `alg`.
- Reads are **ownership-scoped**: another user's run is 404, not 403 (existence
  never leaks). The durable store is the source of truth; the live `_Job` map is
  only streaming machinery and is bounded/evicted.

### Config (env)
`GREEN_JWT_SECRET` (unset → auth off), `GREEN_JWT_AUDIENCE` (default
`authenticated`), `GREEN_STORE` (`memory` | `sqlite`), `GREEN_SQLITE_PATH`,
`GREEN_DEV_USER_ID`, `GREEN_CORS_ORIGINS` (comma-separated; default
`http://localhost:3000`). Supabase deployment: run `api/migrations/0001_init.sql`.

### Decision needed before wiring real Supabase auth (Phase 5/6)
`auth.py` verifies **HS256** (shared JWT secret) — works for Supabase projects
using the legacy/shared JWT secret. **Modern Supabase projects default to
asymmetric signing keys (RS256/ES256)** verified against the project's JWKS.
Pick one before connecting browser auth:
- **HS256 (current):** create the project with a JWT secret, set
  `GREEN_JWT_SECRET`. Zero extra code; fully tested offline.
- **RS256/JWKS:** extend `verify_supabase_jwt` to fetch + cache the JWKS and
  verify asymmetric signatures (needs a crypto lib, e.g. `pyjwt[crypto]`). The
  alg is already pinned from our side, so this is a localized change at the
  `header.get("alg")` branch — not a rewrite. Deferred until a real project
  exists to verify against (can't be tested offline without a configured key).

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
