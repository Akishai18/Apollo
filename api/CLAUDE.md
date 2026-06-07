# api — FastAPI backend

The authoritative brain. All real logic lives behind here (engine, validation,
sandbox orchestration). The web frontend is a thin client.

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
