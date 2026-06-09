# project-green — Plan & Roadmap

> **Living document.** This is the working plan we build off of. Update it as
> phases land, decisions change, or scope shifts. Per-layer contracts live in
> each layer's `CLAUDE.md`; this doc is the roadmap, decisions, and status.

**Last updated:** 2026-06-08
**Current phase:** Phase 3 (Validation — recorder + overfit gate) — next
**Status legend:** `[x]` done · `[~]` in progress · `[ ]` not started

---

## 1. Vision & positioning

A platform for developing and **validating** algorithmic trading strategies.
Someone describes or writes a strategy; the platform refuses to trust it until a
faithful backtester and a rigorous validation/overfit gate have vetted it. The
natural-language input is the demo — **the validation layer is the product**.

- **General**, not competition-specific. A tool to build trading algorithms for
  many destinations. Prosperity (IMC competition) was only the origin of the
  idea and is at most a showcase adapter — never the brand or the pitch.
- Goals: **production-grade** (real people find it genuinely useful) and
  **technically impressive**.

### The three differentiators
1. **Lookahead-by-construction** — strategies only see a `MarketView` physically
   sliced at time `t`. Future data does not exist in the object; lookahead bias
   is structurally impossible, not detected by code-scan. *The headline.*
2. **Overfit gate** — walk-forward across train/held-out windows; reject
   strategies whose performance collapses out-of-sample, with a legible reason.
3. **Secure sandbox** — untrusted `on_tick` runs isolated (no net/fs, CPU/mem/
   time limits).

---

## 2. How it works

### Product loop (user-facing)
1. Pick an environment (e.g. market data: symbols + date range).
2. Provide a strategy — write Python implementing the `Strategy` contract, or
   (later) describe it in English and the generator emits the subclass.
3. Platform vets it: static checks → backtest (lookahead impossible) → overfit
   gate (walk-forward).
4. Get a verdict + evidence: equity curve, metrics, overfit verdict, sweep
   heatmap, "why we rejected this" panel.
5. Iterate — tweak and rerun, or feed the rejection reason back to the generator.

### Runtime flow (one backtest)
```
request: strategy code + env config + params
  → validation: static gate (runs? allowed APIs? limit-aware?)
  → engine.run(strategy, adapter, config):
        for t in timeline:
            view   = adapter.make_view(dataset, t)        # ← lookahead boundary
            orders = sandbox.run(strategy.on_tick, view)  # ← only untrusted code
            fills  = adapter.apply_orders(orders, state, t)
            state.update(fills)
            recorder.log(t, state, fills)
  → recorder → equity curve + metrics
  → overfit gate (wraps engine): re-run across train/forward windows, compare
  → verdict + artifacts → store (Supabase/Parquet) → stream/return to web
```
Two wrappers stay *outside* the loop: the **sandbox** wraps only `on_tick`; the
**overfit gate** calls `engine.run` many times on different windows. The engine
stays dumb. Swap the adapter and everything else is identical — that's what makes
"general" honest.

---

## 3. Architecture & layers

**Cardinal rule:** layers stay ignorant of each other; dependencies point inward
toward `core`. Enforced by uv workspace package boundaries, not convention.

| Layer | Path | Responsibility | CLAUDE.md |
|-------|------|----------------|-----------|
| Core | `core/` | Engine, `MarketView`, `Strategy` contract, recorder, overfit gate. Env-agnostic. | ✓ |
| Adapters | `adapters/` | Pluggable environments (load, view@t, apply orders, score). | ✓ |
| Sandbox | `sandbox/` | Isolation around untrusted `on_tick`. | ✓ |
| Validation | `validation/` | Static checks + gate orchestration. | ✓ |
| API | `api/` | FastAPI (REST + WebSocket). | ✓ |
| Generator | `generator/` | LLM front-end → `Strategy` subclass (built last). | ✓ |
| Web | `web/` | Next.js frontend (the visuals). | ✓ |

Notes: the `EnvironmentAdapter` ABC lives in `core` (the port the engine programs
against); concrete adapters in `adapters/` implement it. Example strategies live
in a `strategies/` workspace member — they are *content* (a `Strategy` subclass,
exactly what a user/the generator supplies), not an infrastructure layer.

---

## 4. Tech stack

- **Python 3.12+, uv workspace** — each layer a member so boundaries are real.
- **ruff** (lint+format), **pyright strict**, **pytest + Hypothesis**.
- **pydantic v2** (contracts) · **polars/numpy** (data + indicators).
- **FastAPI** — REST + WebSocket (progress streaming).
- **Supabase** — managed Postgres + Auth + Storage + RLS.
- **Docker** sandbox per run (path to gVisor/Firecracker).
- **Next.js + TypeScript + Tailwind + shadcn/ui**; TradingView lightweight-charts
  + Plotly/visx for the validation visuals.
- **Anthropic Claude API** (prompt caching) for generation.

---

## 5. Locked decisions

- **GraphQL: out.** REST + WebSocket fits the workload (linear domain, large
  numeric payloads better as Parquet/Arrow, long jobs map to REST+WS).
- **Supabase: in, as primitives only.** Postgres + Auth + Storage + RLS.
  **FastAPI is the authoritative brain** — do NOT route core through Supabase's
  auto data API or edge functions (short-lived Deno; our backtests are long,
  CPU-heavy, sandboxed).
- **Toy adapter data = synthetic OU process** (mean-reverting), so mean-reversion
  provably profits and PnL is deterministic for tests.
- **Market-data dev source = vendored Parquet fixture**; real provider
  (Polygon/Alpaca) wired behind the adapter later. Keeps tests offline/deterministic.
- **Fill timing = next-bar open**, not same-bar close (avoids a real lookahead trap).
- **Param fitting = grid search** to start (transparent, parallelizable, gives
  the heatmap for free).
- **Metric set (small):** total return, Sharpe, max drawdown, win rate, #trades.
- **Build the defensible core before the commodity** (web, LLM last).
- **Package namespace = `green`** (working codename; rename when product is named).

---

## 6. Build roadmap

### Phase 0 — Foundation `[x]` done
- [x] Monorepo + uv workspace + ruff/pyright/pytest + CI
- [x] `core` package: `Order`/`Fill`/`Side`/`OrderType` (frozen), `Strategy` &
      `MarketView` ABCs, `py.typed`, tests
- [x] Root + per-layer `CLAUDE.md`
- [x] git initialized & committed

### Phase 1 — Trust core (engine + the guarantee) `[x]` done
**Goal:** a runnable backtest that proves a strategy structurally cannot see the
future. No LLM, no web, no real data, no sandbox hardening.
- [x] `adapters/` is a workspace member; `EnvironmentAdapter` ABC (the port, in
      `core`) + `Dataset` (apply_orders returns `list[Fill]` for now)
- [x] Concrete `MarketView` (`SlicedView`, physically sliced at `t`)
- [x] Engine loop (`core/engine.py`): make_view → on_tick → apply_orders →
      state.apply → recorder.log
- [x] `PortfolioState` (positions + cash + PnL accounting)
- [x] Toy adapter (`adapters/toy.py`): synthetic OU price series, immediate fill
- [x] Strategies (`strategies/` member): mean-reversion + buy-and-hold baseline
- [x] Basic recorder → equity-curve series
- [x] **Property test** (Hypothesis): nothing the view exposes is index `> t`
- [x] **Correctness test**: known strategy on known data → exact expected PnL

**Proof:** ✓ backtest runs end-to-end (mean-reversion ~+$378 / 52 trades vs.
buy-and-hold ~flat on seeded OU data); guarantee property-tested; engine PnL
exact on synthetic data. 13 tests green; ruff + pyright-strict clean.

### Phase 2 — First faithful environment `[x]` done
**Goal:** one real environment, modeled honestly.
- [x] `market_data` adapter: OHLCV load from committed Parquet fixture
      (`synthetic.py` generates a deterministic 756-bar GBM fixture; adapter only reads it)
- [x] Realistic fills: next-bar open + flat-bps slippage + per-share fee
- [x] Position limits (fills clipped so `|position| <= max_position`)
- [x] Indicators (`core/indicators.py`: `sma`/`ema`/`zscore`) — pure functions over
      `view.history` output, lookahead-safe by construction (not view methods)
- [ ] `MetricsSpec` for market PnL — deferred to Phase 3 (equity still marked generically
      at `close[t]`; a per-environment metrics contract lands with the recorder upgrade)

**Proof:** `MovingAverageCrossover` vs. buy-and-hold over 756 GBM bars with believable
costs — crossover does 14 round-trips at next-bar-open prices and slightly trails
buy-and-hold after frictions (costs matter, exactly as a faithful sim should show).

### Phase 3 — Validation (the product) `[ ]`
**Goal:** recorder + overfit gate that reject-with-a-reason.
- [ ] Recorder upgraded: full metrics + trade log + drawdown (Parquet artifacts)
- [ ] Walk-forward harness (`core/overfit/`): train/forward split, fit on train,
      eval on held-out
- [ ] Parameter sweep (grid) → heatmap data
- [ ] `Verdict` object: pass/reject + reason + evidence

**Proof:** a curve-fit strategy is rejected with a legible reason; a robust one passes.

### Phase 4 — API + sandbox `[ ]`
**Goal:** callable and safe.
- [ ] FastAPI: submit strategy + config, run, fetch results; WebSocket progress
- [ ] `StrategyExecutor` seam → Docker-per-run (no net, ro fs, resource limits)
- [ ] Async job runner (parallel sweep windows)
- [ ] Supabase: Postgres schema (users, strategies, versions, runs, results),
      Auth/JWT verify, Storage, RLS

**Proof:** submit via API, stream progress, get verdict; infinite-loop/network
strategy is contained.

### Phase 5 — Web `[ ]`
**Goal:** show the differentiator.
- [ ] Next.js app + Supabase auth
- [ ] Strategy editor + run + live progress
- [ ] Equity curve (lightweight-charts), overfit curve, sweep heatmap, rejection panel

**Proof:** full loop in the browser.

### Phase 6 — Generator (the magic) `[ ]`
**Goal:** NL → validated strategy.
- [ ] Claude API → `Strategy` subclass; prompt caching
- [ ] Validation feedback loop (rejection reason → regeneration)
- [ ] Generated code runs through the SAME sandbox + gates (no trust shortcut)

**Proof:** "mean reversion on AAPL, 20-day window" → validated strategy + verdict.

---

## 7. Feature tiers (MVP slicing)

Build strictly in order; the differentiation is the trust core, so prove it first.

- **Tier 1 — the spine (Phases 1–3):** engine + guarantee + faithful adapter +
  recorder + overfit gate. This *is* the core claim, demonstrable with zero UI/LLM.
- **Tier 2 — usable product (Phases 4–5):** API + sandbox + Supabase + web visuals.
- **Tier 3 — the magic (Phase 6):** NL → strategy generator.

---

## 8. Example user prompts (grounding)

The generated `Strategy` must satisfy the same contract a hand-written one does.

- "Create a mean reversion strategy on AAPL." *(vague — platform fills gaps)*
- "Mean reversion on AAPL: buy when price is 2 std below its 20-day MA, sell at
  the mean." *(specific)*
- "Moving-average crossover on SPY — long when 50-day crosses above 200-day."
- "Momentum on the Nasdaq 100: weekly, hold the 10 strongest over 3 months."
- "Mean reversion on TSLA, max 100 shares, 5% stop loss." *(with constraints)*

**NL → Strategy flow (one example):**
```
"buy 2 std below the 20-day MA, sell at the mean on AAPL"
  → params {"symbol":"AAPL","lookback":20,"entry_z":-2.0,"exit_z":0.0}
  → on_tick(view): window = view.history("AAPL","close",20)
                   z = (view.last(...) - mean(window)) / std(window)
                   buy if z<=entry_z; sell if z>=exit_z and holding
  → overfit gate sweeps lookback/entry_z across train/forward windows → verdict + heatmap
```
Key implication: **params are never hardcoded** — the prompt's numbers become
*defaults*, and the overfit gate sweeps them. This is why `Strategy(params: dict)`
matters, and it sets the richness bar for `MarketView` (rolling history, current
value, multiple symbols, indicators up-to-now).

---

## 9. Open questions

- Exact `MarketView` richness for the first adapter (load-bearing — too thin =
  toy strategies, too rich = leaks the dataset).
- Faithfulness target for `market_data` v1 (how exact on fills/fees/slippage).
- Sandbox tech for production (Docker vs. gVisor/Firecracker vs. managed).
- What "general" ships as at launch vs. what stays architectural.
- Real product name (currently codename `green`).

---

## 10. Update log

- **2026-06-08** — **Phase 2 complete.** First *faithful* environment shipped:
  `MarketDataAdapter` (`adapters/market_data.py`) loads a committed, deterministic
  756-bar GBM OHLCV Parquet fixture (`synthetic.py`, regen via
  `python -m green.adapters.synthetic`) and models real frictions — **next-bar-open
  fills** (`open[t+1]`, dropped on the last bar), flat-bps slippage, per-share fee,
  and position-limit clipping. Added `core/indicators.py` (`sma`/`ema`/`zscore`, pure
  + lookahead-safe) and `MovingAverageCrossover`. The faithful adapter reuses
  `SlicedView`, so the lookahead guarantee is unchanged: the simulator may read
  `open[t+1]` to price a fill, but the `MarketView` still slices to `[0, t]`. 25 tests
  green (indicators + market-data faithfulness: exact fill price, slippage/fee,
  limit-clip, no-fill-on-last-bar, Parquet round-trip), ruff + pyright-strict clean.
  Deferred: `MetricsSpec` (equity still marked generically at `close[t]`) → Phase 3.
  Next: Phase 3 (recorder upgrade + walk-forward overfit gate).
- **2026-06-07** — **Phase 1 complete.** Engine loop + `SlicedView` + `Dataset` +
  `PortfolioState` + `Recorder` + `EnvironmentAdapter` port in `core`; `ToyAdapter`
  (OU) in `adapters/`; `MeanReversion` + `BuyAndHold` in new `strategies/` member.
  Lookahead guarantee property-tested; engine PnL exact on known data. 13 tests
  green, ruff + pyright-strict clean. Note: toy adapter uses immediate fill (the
  next-bar-open decision applies to the faithful market_data adapter in Phase 2);
  `apply_orders` returns `list[Fill]` (no `FillResult` wrapper yet). Next: Phase 2.
- **2026-06-07** — Plan doc created. Phase 0 complete (foundation, toolchain,
  CLAUDE.md, core contracts). Decisions locked: GraphQL out / Supabase in, synthetic
  OU toy data, next-bar-open fills, grid-search sweeps. Next: Phase 1.
