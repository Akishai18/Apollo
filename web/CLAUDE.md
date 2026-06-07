# web — Next.js frontend

The visual differentiator. Our edge is fundamentally visual (overfit curves,
equity curves, parameter-sweep heatmaps, "why we rejected this" panels) — this
is where it gets shown. Build in Phase 5.

## Stack

- **Next.js (App Router) + TypeScript + Tailwind + shadcn/ui**.
- Charts: **TradingView lightweight-charts** for price/equity; **Plotly or visx**
  for overfit curves and parameter-sweep heatmaps.
- Talks to the FastAPI backend over **REST + WebSocket** (live progress).

## Rule

Frontend holds **no business logic**. All strategy execution, validation, and
scoring happen in the Python backend; the web layer fetches, streams, and renders.
If you're tempted to compute a verdict here, it belongs in `validation`.

## The screens that matter

- Strategy editor (write/paste, or NL prompt that routes to the generator).
- Equity curve + metrics for a run.
- Overfit-gate verdict: in-sample vs. forward-window curves, legible pass/fail.
- Parameter-sweep heatmap.
- "Why we rejected this" panel — the reason, with evidence.
