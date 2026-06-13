# project-green — Plan & Roadmap

> **Living document.** This is the working plan we build off of. Update it as
> phases land, decisions change, or scope shifts. Per-layer contracts live in
> each layer's `CLAUDE.md`; this doc is the roadmap, decisions, and status.

**Last updated:** 2026-06-11
**Current phase:** Phase 4 (API + sandbox) — **done**; Phase 5 (Web) next
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
- [x] `MetricsSpec` for market PnL — landed in Phase 3 (`adapter.metrics_spec()`,
      non-abstract default: daily bars / 252 periods-per-year; environments override)

**Proof:** `MovingAverageCrossover` vs. buy-and-hold over 756 GBM bars with believable
costs — crossover does 14 round-trips at next-bar-open prices and slightly trails
buy-and-hold after frictions (costs matter, exactly as a faithful sim should show).

### Phase 3 — Validation (the product) `[x]` done
**Goal:** recorder + overfit gate that reject-with-a-reason.
- [x] Full metrics + trade log + drawdown (`core/metrics.py`: return/Sharpe/max-DD/
      win-rate via `compute_metrics`; `core/trades.py`: FIFO `pair_trades` → `Trade`
      round trips net of fees). Engine/recorder stay dumb; meaning assigned post-hoc.
      Parquet artifact persistence deferred to Phase 4 (lands with Storage).
- [x] Walk-forward harness (`core/overfit/`): rolling `Window`s, fit (grid-select) on
      train, eval chosen params on held-out; training runs use `Dataset.window()` so
      held-out data is *physically absent* (same construction as the lookahead law);
      fresh strategy instance per run (no state leaks across the split)
- [x] Parameter sweep (grid) → heatmap data (`expand_grid`; every `WindowResult`
      records the full train sweep as `SweepPoint`s)
- [x] `Verdict` object: pass/reject + legible reason + per-window evidence; three
      rules: never-profitable-in-sample, insufficient OOS trades, Sharpe-retention
      collapse (`min_retention`, default 50%)

**Proof:** ✓ `LuckyTimer` (fixed-bar-index timing, the canonical curve fit) is
rejected — "performance collapses out of sample — held-out Sharpe -1.20 retains -69%
of train Sharpe 1.74"; each window chose a *different* lucky timing in-sample.
`MeanReversion` on OU passes — held-out Sharpe retains 60% of train. Both deterministic.

**v1 caveat:** held-out runs start cold (indicator warm-up eats the first `lookback`
bars of each test window) — size `test_size` above the largest lookback in the grid.

### Phase 4 — API + sandbox `[x]` done (2026-06-11)
**Goal:** callable and safe.
- [x] Sandbox (`sandbox/` workspace member, depends on green-core only):
  - [x] `StrategyExecutor` seam — the engine/gate never know *how* `on_tick` runs
  - [x] `SubprocessExecutor`: strategy source runs in a separate process,
        kernel-locked-down via setrlimit (CPU, address space, file-size budget,
        no child processes, and an RLIMIT_NOFILE ceiling — every free fd slot
        plugged — so new file/socket opens fail with EMFILE at the kernel)
  - [x] JSON-line protocol (never pickle); strategy `print()` redirected to
        stderr so it cannot forge frames; wall-clock deadlines per init/tick;
        SIGKILL on the whole process group on timeout/violation
  - [x] `SandboxedStrategy(Strategy)` drop-in proxy; single-run enforced;
        `MarketView` grew `symbols()`/`fields()` so the bar can be enumerated
  - [x] Typed, legible failures: `StrategyCrash` (with child traceback + stderr
        tail), `StrategyTimeout`, `ProtocolViolation`
- [x] `DockerExecutor`: the same JSON protocol over `docker run -i --network=none
      --read-only --cap-drop=ALL --security-opt=no-new-privileges --memory
      --pids-limit` (+ `sandbox/Dockerfile`). Shares a `_PipeExecutor` base with
      `SubprocessExecutor` so the two transports can't drift. The production wall.
- [x] FastAPI (`api/` member): `POST /runs`, `GET /runs/{id}`, `WS /runs/{id}/ws`
      (live per-window progress → verdict), `GET /healthz`. Untrusted source
      *always* runs through `SandboxedStrategy` — no trusted in-process path.
- [x] Async `JobRunner`: gate runs in a worker thread (`asyncio.to_thread`);
      per-window progress bridged to the loop (`call_soon_threadsafe`) and fanned
      out to WebSocket subscribers. Clean interface → swap in Dramatiq/RQ later.
- [x] Auth: Supabase JWT verification (`auth.py`, HS256, algorithm pinned from
      our side — closes alg-confusion/`alg:none`). Disabled when no secret is
      configured (offline dev/tests run as a fixed user); set `GREEN_JWT_SECRET`
      to require + verify real bearer tokens. WS accepts the token via `?token=`.
- [x] Persistence behind a `RunStore` interface (`store.py`): `InMemoryRunStore`
      (default) + `SqliteRunStore` (durable, tested incl. survive-restart). Runs
      are owned by the submitting user; every read is ownership-scoped (cross-user
      fetch is 404, never a leak). `GET /runs` lists the caller's runs.
- [x] Supabase Postgres schema + **RLS** as the deployment artifact
      (`api/migrations/0001_init.sql`): `runs` table, RLS policies scoping every
      row to `auth.uid()`. Same `RunStore` interface in prod (a Postgres DSN) —
      the SubprocessExecutor→DockerExecutor pattern again (tested backend now,
      managed backend swapped in for prod). Isolation enforced twice: app layer +
      DB RLS.
- **Deferred, with rationale** (not needed for the "persistence + RLS" proof):
  - Supabase **Storage / Parquet artifacts** — the verdict (incl. full sweep /
    heatmap data) is already persisted as JSON in the run row, so all current
    data is durable. Blob artifacts (equity curves) become worthwhile when the
    gate exposes per-run curves and the web needs to stream them → lands with
    Phase 5 visuals.
  - **Parallel sweep** — a performance optimization, not correctness. Windows
    still run sequentially; the concurrency-isolation test already proves parallel
    sandboxed runs are safe, so this is later wiring, not a blocker.

**Proof (done):** sandboxed runs are *bit-identical* to native (JSON floats
round-trip exactly); the full walk-forward gate run through `SandboxedStrategy`
reproduces the native verdict field-for-field; a probe confirms the future never
crosses the process boundary; file/network/process-spawn die with EMFILE at the
kernel; infinite loops killed; crashes surface with the strategy's own traceback.
**API proven over real HTTP + WebSocket** (TestClient + a live uvicorn smoke):
submit untrusted source → gate runs it sandboxed → stream progress → legible
verdict; bad config and hostile strategies surface as clean run errors, never a
500 or a hang. 65 tests green (18 sandbox + 7 API), 2 skipped (Linux-only memory
cap; Docker daemon), ruff + pyright-strict clean.

**Proof (persistence + auth, done):** durability verified over a live uvicorn —
submit a run, restart the server (same SQLite file), the completed run + verdict
are still there and still listed for the owner; requests without a token get 401;
a second user gets 404 for someone else's run. Backend unit-tested on both
InMemory and SQLite (round-trip, update, per-user isolation, survive-reopen); JWT
verification unit-tested (valid, wrong-secret, alg-confusion, expiry, nbf,
audience, missing-sub, malformed). **84 tests green, 2 skipped** (Linux memory
cap; Docker daemon), ruff + pyright-strict clean.

**v1 caveats:** RLIMIT_AS is best-effort on macOS (hard memory wall arrives with
`DockerExecutor`, daemon-gated test included); per-run subprocess spawn ~0.3s,
fine for the gate, parallelized by a later job-runner iteration. Subprocess is a
hostile-*strategy* wall, not an interpreter-0-day wall — that is what Docker (and
later gVisor/Firecracker) provides. **Postgres RLS is validated by the user
against a real Supabase project** (the migration is the artifact; SQLite proves
the store logic + app-level isolation offline).

**To activate Supabase (deployment, not core code):** create a project; run
`api/migrations/0001_init.sql`; set `GREEN_JWT_SECRET` to the project's JWT
secret. The one remaining code stub for hosted deployment is a `PostgresRunStore`
(same `RunStore` interface, psycopg) selected by a new `GREEN_STORE=postgres` +
`DATABASE_URL` — straightforward, but unverifiable here without a live database.

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

- **2026-06-11** — **Phase 4 complete — persistence + auth + per-user isolation.**
  Auth (`auth.py`): Supabase JWT verification, HS256 with the algorithm pinned
  from our side (closes alg-confusion / `alg:none`); off when no secret is set so
  the offline suite + local dev run as a fixed user. Persistence behind a
  `RunStore` interface (`store.py`): `InMemoryRunStore` + durable `SqliteRunStore`;
  runs owned by the submitter, every read ownership-scoped (cross-user = 404).
  New `GET /runs` lists the caller's runs; the `JobRunner` mirrors every lifecycle
  transition into the store (live `_Job` is now just streaming machinery). The
  Supabase deployment artifact is `api/migrations/0001_init.sql` — `runs` table +
  RLS policies scoping rows to `auth.uid()` (isolation enforced twice: app layer
  + DB). **Durability proven on a live uvicorn**: submit → restart server (same
  SQLite file) → completed run + verdict still present and still listed; 401
  without a token; 404 across users. Deferred with rationale: Supabase Storage /
  Parquet artifacts (verdict + sweep already persisted as JSON; blob artifacts
  land with Phase 5 visuals) and parallel sweep (perf, not correctness). 84 tests
  green (incl. 8 auth + 5 store + multi-user HTTP isolation), 2 skipped, ruff +
  pyright-strict clean. Remaining for hosted deploy (user-side): create a Supabase
  project, run the migration, set `GREEN_JWT_SECRET`; add a `PostgresRunStore`
  stub. **Next: Phase 5 (Web).**
- **2026-06-10** — **Phase 4 API + Docker — the core is callable and safe.**
  New `api/` member (green-api): `POST /runs` submits untrusted strategy source +
  config, `GET /runs/{id}` fetches state/progress/verdict, `WS /runs/{id}/ws`
  streams queued → per-window progress → verdict, `GET /healthz`. Every strategy
  the gate builds is sandboxed — there is no trusted in-process path in the API.
  `JobRunner` runs the (sync, CPU-heavy, subprocess-spawning) gate in a worker
  thread and bridges progress back to the loop; the gate grew an optional
  `progress` hook (`WalkForwardProgress`) so core stays transport-agnostic.
  Also landed `DockerExecutor` (+ `sandbox/Dockerfile`): the same JSON protocol
  over a `--network=none --read-only --cap-drop=ALL --memory --pids-limit`
  container, sharing a `_PipeExecutor` base with `SubprocessExecutor` so the two
  can't drift. Two robustness gaps pinned: a Linux-only memory-bomb test and a
  concurrent-sandbox isolation test. **Proven over real HTTP + WebSocket**
  (TestClient + a live uvicorn smoke): submit source → sandboxed gate → streamed
  progress → legible verdict; bad config + hostile strategy → clean run errors.
  65 tests green (18 sandbox + 7 API), 2 skipped (Linux memory cap; Docker
  daemon), ruff + pyright-strict clean. Next: Supabase (persistence, JWT, RLS).

- **2026-06-09** — **Phase 4 sandbox shipped — the third differentiator.** New
  `sandbox/` workspace member (depends on green-core only). Untrusted strategy
  *source* runs in a separate process (`runner.py`) locked down by the kernel
  before the first strategy line executes: setrlimit CPU/address-space/file-size
  budgets, no child processes, and an RLIMIT_NOFILE ceiling (every free fd slot
  plugged with /dev/null) so any new file or socket open dies with EMFILE.
  Parent side (`executor.py`): `StrategyExecutor` seam, `SubprocessExecutor`
  (JSON-line protocol — never pickle; per-init/per-tick wall-clock deadlines;
  process-group SIGKILL; stderr tail in errors), and `SandboxedStrategy` — a
  drop-in `Strategy`, so the engine and gate run sandboxed code unchanged.
  `MarketView` grew `symbols()`/`fields()` (metadata only) for bar enumeration.
  Process separation *completes* the lookahead guarantee: only bars `<= now`
  ever cross the boundary. **Proof landed:** sandboxed runs bit-identical to
  native; full walk-forward gate through the sandbox reproduces the native
  verdict exactly; probe strategy confirms the horizon; file/network/spawn
  blocked at the kernel; infinite loops killed (init + tick); crashes legible
  with the strategy's own traceback; prints can't forge protocol frames; order
  floods rejected. 55 tests green (16 sandbox), ruff + pyright-strict clean.
  Caveat: RLIMIT_AS best-effort on macOS → hard memory wall arrives with
  `DockerExecutor` (same protocol over `docker run -i --network=none`). Next:
  FastAPI + WS, job runner, Supabase.
- **2026-06-09** — **Phase 3 complete — the product exists.** The overfit gate
  (`core/overfit/`): `run_walk_forward` sweeps a param grid per rolling window,
  selects on train, evaluates on held-out, and returns a frozen `Verdict`
  (pass/reject + legible reason + full per-window evidence incl. sweep heatmap
  data). Train runs execute on `Dataset.window()` slices — held-out data is
  physically absent during selection — and every run gets a fresh strategy
  instance (no state leaks). Supporting modules: `core/metrics.py` (`Metrics`,
  `MetricsSpec` + `adapter.metrics_spec()`, `compute_metrics`: return, annualized
  Sharpe, max drawdown, win rate) and `core/trades.py` (FIFO `pair_trades` →
  `Trade` round trips net of fees). **Proof landed:** curve-fit `LuckyTimer`
  rejected ("collapses out of sample… retains -69%"), `MeanReversion` on OU passes
  (retains 60%); both deterministic and locked in tests. 39 tests green, ruff +
  pyright-strict clean. Deferred: Parquet artifact persistence → Phase 4 (Storage);
  warm-started held-out runs (cold-start warm-up caveat documented). Next: Phase 4
  (FastAPI + WS, Docker sandbox, Supabase).
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
