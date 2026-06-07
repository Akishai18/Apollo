# Project Brief: AI Strategy Platform (working title)

## One-line concept

A web platform where someone describes a trading strategy in plain English, an
LLM generates the algorithm, and the platform **refuses to trust that code** —
it runs it through a faithful backtester and a rigorous validation/overfit gate
before the user relies on it. The natural-language input is the demo; the
**validation layer is the product**.

---

## Origin & motivation

Came out of IMC Prosperity (an algo-trading competition where you build
algorithms to trade products and maximize PnL using strategies like mean
reversion, Black-Scholes, buy-and-hold, etc.). Many competitors spend most of
their time building plumbing — backtesters and visualizers — instead of
strategy. The wedge is collapsing that plumbing into natural language so people
strong on ideas but weaker on engineering can go from idea to tested algorithm
fast.

The platform is **general**, not Prosperity-specific. Prosperity is the first
concrete *example/environment*, chosen because we know it cold and can model it
exactly.

---

## Competitive context: Finny

A similar product exists ([finnyai.tech](https://finnyai.tech),
github.com/Jaiminp007/finny). Honest assessment:

- It's a **fork of OpenCode** (an open-source terminal AI-agent harness),
  retooled for trading. "Claude Code for Financial Markets." The CLI form factor
  was inherited from the fork, not chosen as a product decision.
- Real added surface is thin: 7 strategy templates, a yfinance-based backtest
  engine, a validation pass, Convex for storage/versioning. Repo is early
  (1 star, 0 forks, no releases, 0.2% Python).
- Marketing site is well ahead of shipped code (Monte Carlo, walk-forward,
  "60+ metrics", brokerage links are mostly aspirational copy).
- **Their validation is shallow** — mostly static analysis: syntax check,
  required methods, blocklist of forbidden imports (`os`, `subprocess`, etc.)
  and dangerous calls (`exec`, `eval`), plus grep-style "trading pitfall"
  heuristics for lookahead bias. The "institutional walk-forward overfit gate"
  is a tagline, not a real guarantee.
- **Their bet:** general retail trading (stocks/crypto, brokerage links to
  Alpaca/Binance/IBKR). Crowded, commoditizing, and real-money liability is a
  swamp. They explicitly do NOT target competition/quant-training.

**Our edge = the opposite bet + a real guarantee where theirs is a heuristic.**

---

## Strategic decisions made

1. **Web platform, not CLI.** Reasons: (a) our differentiator (validation,
   overfit curves, equity curves, parameter-sweep heatmaps, "why we rejected
   this" panels) is fundamentally visual and cramped in a terminal; (b) web
   widens the market toward strong-strategy/weak-engineering users — the
   underserved segment; (c) avoids being a Finny clone.

2. **General core, pluggable environments.** "General" should mean the
   *architecture*, not the launch claim. Ship with concrete, faithful
   adapters. Prosperity is the first adapter, made competition-grade exact.
   A general platform with one undeniably-good environment beats one that does
   everything shallowly.

3. **No real-money brokerage execution in early scope.** That inherits
   regulatory exposure, liability, and safety burden. Stay on
   competition/paper/backtest until the core loop is loved.

4. **Build the hard, defensible thing first.** The NL front-end is nearly a
   commodity (bolt on in an afternoon). The backtester-you-can-trust and
   rejection-with-a-reason are what nobody has nailed. Build those first.

---

## The key technical idea: lookahead-by-construction

Don't *detect* lookahead bias by reading the code (grep-style, like Finny).
Make it **structurally impossible**: the strategy never touches the raw
dataset. Each timestep the engine hands it a `MarketView` window that
*physically contains only data up to and including now*. There is no `.future`.
If the LLM writes `data[t+1]`, that index doesn't exist in the object it was
handed. This is a guarantee a code-scan can't make, and it falls out of the
architecture for free.

---

## Architecture: three layers that stay ignorant of each other

**Strategy** (top — the only thing the LLM writes)
→ **Engine** (middle — general, dumb time-stepping loop)
→ **Environment Adapter** (bottom — owns everything environment-specific)

### Strategy interface (contract the generated code fills in)
```python
class Strategy:
    def __init__(self, params: dict):
        # params come from the user / the sweep, never hardcoded
        ...

    def on_tick(self, view: MarketView) -> list[Order]:
        # called once per timestep
        # `view` only exposes data up to and including now
        # returns desired orders; engine + adapter decide fills
        ...
```

### MarketView — the most important object (where the guarantee lives)
- Exposes **history and present, never future**: rolling windows, indicators
  computed up to now, current order book.
- Constructed fresh each tick by the adapter, physically sliced at `t`.
- Load-bearing design tension: too thin (just current price) → strategies can't
  do anything; too rich → leaks the dataset and loses the guarantee. Discipline:
  rich on past/present, structurally empty on future.

### Environment Adapter (the pluggable part)
```python
class EnvironmentAdapter:
    def load_data(self, config) -> Dataset: ...
    def make_view(self, dataset, t) -> MarketView:   # the lookahead boundary
        ...
    def apply_orders(self, orders, state, t) -> FillResult:
        # enforces position limits, applies fees, models slippage/fills
        ...
    def metrics_config(self) -> MetricsSpec: ...      # what "PnL" means here
```
Every environment answers the same four questions: how to load, what the
strategy can see at `t`, what happens when it submits orders, how performance is
scored. Prosperity's fill model / position limits / fee structure differ wildly
from "buy AAPL at the close" — keeping that in the adapter is what makes
"general" true instead of a lie. A faithful Prosperity adapter means a strategy
that passes our backtest behaves the same on submission.

### Engine (intentionally boring)
```python
for t in dataset.timeline:
    view = adapter.make_view(dataset, t)      # bounded by construction
    orders = strategy.on_tick(view)            # untrusted code runs here
    fills = adapter.apply_orders(orders, state, t)
    state.update(fills)
    recorder.log(t, state, fills)
```

---

## Two boundaries that matter most

- **Sandbox boundary** wraps *only* `strategy.on_tick` — the sole untrusted
  code. Run that in a locked-down container: CPU/memory/time limits, no network,
  no filesystem, timeouts on infinite loops. Engine/adapter/recorder are trusted
  and run normally. Drawing the sandbox tightly around just the strategy call
  keeps it fast and the trusted parts simple. (NOTE: running untrusted
  LLM-generated Python on our servers is the real new infra cost of going web —
  budget for it. It overlaps with the controlled-harness work anyway.)

- **Overfit gate** lives entirely outside the engine. It runs the *same*
  strategy through the engine multiple times on different time windows (train
  window to fit params; held-out forward windows to test), then compares.
  Environment-agnostic — walk-forward on Prosperity and on stocks is the
  identical procedure, only the adapter differs. Output should be legible to a
  non-quant: e.g. "made money in-sample but lost in 4 of 6 forward windows,
  here's the curve."

---

## Validation layers (cheap → critical → statistical)

1. **Static validation (cheap, fast):** does it run, respect position limits,
   call only allowed APIs. Catches unsafe calls. (This is roughly all Finny has.)
2. **Lookahead (critical):** handled by construction via `MarketView`, not by
   inspection. Our headline guarantee.
3. **Overfit gate (statistical):** walk-forward — fit on one window, test on
   held-out future windows, reject strategies whose performance collapses
   out-of-sample. Make it automatic and legible, not a tagline.

---

## Recommended build order (each layer testable with a hand-written strategy before any AI)

1. **Engine loop + `MarketView`** — proves lookahead-by-construction, the
   headline guarantee.
2. **One faithful environment adapter** — pick the one you can make undeniably
   good (Prosperity, since we know it cold).
3. **Recorder + one real visualization** — equity curve + overfit-gate verdict.
4. **Overfit-gate harness** around the engine.
5. **LLM front-end** that emits a `Strategy` subclass — last, because it's the
   commodity part.

Building in this order also lets us prove the backtester is correct
*independently* of whether the generation is any good.

---

## Open questions to decide

- Exact richness of `MarketView` for the first adapter (the load-bearing call).
- Faithfulness target for the Prosperity adapter: match the real engine
  semantics (data format, position limits, fee model, `Trader` interface) so
  backtest == submission behavior.
- Sandbox tech choice (container runtime, isolation model, resource limits).
- What "general" ships as at launch vs. what stays architectural.

---

## First concrete coding task

Build a minimal runnable skeleton: the **engine loop**, the **`MarketView`**, a
**toy environment adapter**, and a **hand-coded mean-reversion strategy** — so
the lookahead boundary is visible and executing. No LLM yet. Prove the loop and
the guarantee first.
