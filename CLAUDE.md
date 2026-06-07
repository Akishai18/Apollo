# project-green — root guide

## What this is

A platform for developing and **validating** algorithmic trading strategies.
Someone describes or writes a strategy; the platform refuses to trust it until a
faithful backtester and a rigorous validation/overfit gate have vetted it. The
natural-language input is the demo — **the validation layer is the product**.

Positioning note: this is a **general** tool for building trading algorithms for
many destinations. It is NOT a competition tool. Prosperity (the IMC competition)
was only the origin of the idea and is at most a showcase adapter — never the
brand or the pitch. Lead with the trust guarantees, which are environment-agnostic.

## The three differentiators

1. **Lookahead-by-construction** — strategies only see a `MarketView` physically
   sliced at time `t`. Future data does not exist in the object; lookahead bias
   is structurally impossible, not detected by code-scan. This is the headline.
2. **Overfit gate** — walk-forward across train/held-out windows; reject
   strategies whose performance collapses out-of-sample, with a legible reason.
3. **Secure sandbox** — untrusted `on_tick` runs isolated (no net/fs, CPU/mem/
   time limits).

## Layer map and the cardinal rule

```
Strategy (untrusted, generated)
   ↓ runs inside
Sandbox  →  Engine (dumb time-stepper)  →  EnvironmentAdapter (env-specific)
                                              ↑ builds the MarketView at t
Validation orchestrates the gates · API exposes it · Web visualizes it
```

**Cardinal rule: layers stay ignorant of each other.** Dependencies point
inward toward `core`. `core/` must never import adapters, sandbox, api, or any
environment-specific code. Adapters never import each other. This is enforced by
package boundaries (uv workspace members), not convention alone.

| Layer | Path | Responsibility |
|-------|------|----------------|
| Core | `core/` | Engine, `MarketView`, `Strategy` contract, recorder, overfit gate. Env-agnostic. |
| Adapters | `adapters/` | Pluggable environments. |
| Sandbox | `sandbox/` | Isolation around untrusted `on_tick`. |
| Validation | `validation/` | Static checks + gate orchestration. |
| API | `api/` | FastAPI (REST + WebSocket). |
| Generator | `generator/` | LLM front-end → `Strategy` subclass (built last). |
| Web | `web/` | Next.js frontend. |

Each layer has its own `CLAUDE.md` with that layer's contract and invariants —
read it before editing that layer.

## Tech stack & why

- **Python 3.12+, uv workspace.** Each layer is a workspace member so layer
  boundaries are real (a layer can't import what it doesn't depend on).
- **ruff** (lint+format), **pyright strict** (types), **pytest + Hypothesis**
  (property tests — the lookahead guarantee gets property-tested).
- **pydantic v2** for all contracts; **polars/numpy** for data + indicators.
- **FastAPI, REST + WebSocket.** WebSocket streams backtest progress. We chose
  REST over **GraphQL**: the domain is fairly linear, payloads are large numeric
  arrays better served as Parquet/Arrow, and long jobs fit REST+WS cleanly.
- **Supabase** for managed **Postgres + Auth + Storage + RLS**. Discipline rule:
  Supabase provides *primitives only*; **FastAPI is the authoritative brain**. Do
  NOT route the core through Supabase's auto-generated data API or edge functions
  (their edge functions are short-lived Deno; our backtests are long, CPU-heavy,
  sandboxed). FastAPI verifies Supabase JWTs; RLS isolates per-user data.
- **Docker** sandbox per run now; path to gVisor/Firecracker later.
- **Next.js + TypeScript + Tailwind + shadcn/ui**; TradingView lightweight-charts
  + Plotly/visx for the validation visuals.
- **Anthropic Claude API** (with prompt caching) for generation — built last.

## Conventions

- Contracts (`Order`, `Fill`, …) are **immutable** (frozen pydantic).
- Types are **strict** — pyright strict must pass, no untyped escapes.
- Every layer is tested; the guarantee gets a property test, not just examples.
- Backtests are **deterministic/reproducible** (seeded, pinned data versions).
- Never introduce a path by which a strategy can see the future. If you can
  express it, it's a bug.

## Dev commands

```sh
uv sync
uv run ruff check .
uv run ruff format --check .
uv run pyright
uv run pytest
```
