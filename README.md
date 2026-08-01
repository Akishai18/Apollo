# Apollo

A platform for developing and **validating** algorithmic trading strategies. You
describe or write a strategy; the platform refuses to trust it until a faithful
backtester and a rigorous validation/overfit gate have vetted it. The
natural-language input is the demo — **the validation layer is the product**.

The core differentiator is trust:

- **Lookahead-by-construction** — strategies only ever see a `MarketView`
  physically sliced at time `t`. Future data does not exist in the object they
  are handed, so lookahead bias is structurally impossible (not grep-detected).
- **Overfit gate** — walk-forward validation runs the same strategy across
  train and held-out windows and rejects strategies whose performance collapses
  out-of-sample, with a legible explanation.
- **Secure sandbox** — untrusted strategy code (`on_tick`) runs isolated:
  no network, no filesystem, CPU/memory/time limits.

The architecture is **general**: a dumb time-stepping engine plus pluggable
environment adapters. Historical market data is the first faithful environment.

## Layers

| Layer | Path | Responsibility |
|-------|------|----------------|
| Core | `core/` | Engine loop, `MarketView`, `Strategy` contract, recorder, overfit gate. Environment-agnostic. The trust core. |
| Adapters | `adapters/` | Pluggable environments (load data, view-at-`t`, apply orders, score). |
| Sandbox | `sandbox/` | Isolation boundary around untrusted `on_tick`. |
| Validation | `validation/` | Static checks + orchestration of the validation gates. |
| API | `api/` | FastAPI backend (REST + WebSocket). |
| Generator | `generator/` | LLM front-end that emits a `Strategy` subclass (built last). |
| Web | `web/` | Next.js frontend — equity curves, overfit curves, sweep heatmaps, rejection panels. |

Each layer has its own `CLAUDE.md` describing the contract and invariants that
edits to that layer must respect.

The product model and target workflow live in [`PRODUCT.md`](./PRODUCT.md):
Builder -> Backtest -> Visualizer -> Validation -> Report.

## Stack

Python 3.12+ (uv workspace, ruff, pyright, pytest + Hypothesis, pydantic v2,
polars/numpy) · FastAPI (REST + WebSocket) · Supabase (managed Postgres + Auth +
Storage + RLS) · Docker sandbox (path to gVisor/Firecracker) · Next.js +
TypeScript + Tailwind + shadcn/ui + TradingView lightweight-charts ·
Anthropic Claude API for generation.

## Development

```sh
uv sync          # install workspace + dev tooling
uv run ruff check .
uv run ruff format --check .
uv run pyright
uv run pytest
```
