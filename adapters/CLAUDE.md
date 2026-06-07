# adapters — pluggable environments

An adapter owns *everything* environment-specific. The engine and strategies
stay ignorant of it. This is what makes "general" true instead of a lie.

## Dependency rules

- Adapters depend on `core` only. They must NOT import each other, the api,
  the sandbox, or the generator.
- Each adapter is (or becomes) its own workspace member so its dependencies are
  isolated (e.g. a market-data adapter's data libs don't leak into core).

## The EnvironmentAdapter contract

Every environment answers the same four questions:

```python
class EnvironmentAdapter:
    def load_data(self, config) -> Dataset: ...
    def make_view(self, dataset, t) -> MarketView:   # THE lookahead boundary
        ...
    def apply_orders(self, orders, state, t) -> FillResult:
        # position limits, fees, slippage/fill model
        ...
    def metrics_config(self) -> MetricsSpec: ...      # what "PnL" means here
```

`make_view` is where the lookahead guarantee is *enforced*: physically slice the
dataset at `t` and hand back a view that contains nothing after `t`. Get this
wrong and the headline guarantee is gone.

## "Faithful" checklist

An adapter is faithful when a strategy that passes our backtest behaves the same
in the real environment. For a real-market adapter that means: realistic
fill/slippage/fee modeling, **point-in-time** data, no survivorship bias, and
correct corporate-actions handling. Most retail backtesters quietly cheat on
these — we don't.

## Planned adapters

- `toy/` — Phase 1, minimal, exists to prove the engine loop + the guarantee.
- `market_data/` — Phase 2, the first *faithful* environment (equities/crypto
  OHLCV). This is the "genuinely useful to real people" milestone.
- `prosperity/` — optional later, a showcase of faithfulness; never the pitch.
