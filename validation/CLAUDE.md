# validation — the gates (cheap → critical → statistical)

This layer orchestrates the checks a strategy must pass and produces verdicts
that are **legible to a non-quant**. "Reject with a reason" is the product.

## The three gates

1. **Static (cheap, fast):** does it run, respect position limits, call only
   allowed APIs. Catches unsafe calls. This is roughly all competitors have.
2. **Lookahead (critical):** handled *by construction* in `core` via
   `MarketView` — NOT re-implemented here as code inspection. This layer just
   relies on the guarantee; it does not try to grep for `t+1`.
3. **Overfit (statistical):** walk-forward — fit params on one window, test on
   held-out forward windows, reject when out-of-sample performance collapses.
   The harness itself lives in `core/overfit/`; this layer drives it and renders
   the verdict.

## Output contract

Verdicts must be explainable, e.g. "made money in-sample but lost in 4 of 6
forward windows — here's the curve." A verdict is never just pass/fail; it
carries the evidence the UI shows in the "why we rejected this" panel.

## Dependencies

Depends on `core` (and the overfit harness). Does not import adapters directly;
it runs strategies through the engine, which is handed an adapter.
