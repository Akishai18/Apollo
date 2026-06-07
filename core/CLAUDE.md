# core — the trust core

The heart of the product and the only layer that must be *undeniably* correct.
Everything here is **environment-agnostic**.

## Hard rule

`core` must NOT import from `adapters`, `sandbox`, `api`, `validation`,
`generator`, or any environment-specific code. Dependencies point inward. If
core needs to know something environment-specific, the design is wrong — that
knowledge belongs in an adapter.

## The lookahead law (most important invariant)

`MarketView` (see `marketview.py`) exposes **history and present, never the
future**. It is constructed fresh each tick by an environment adapter, sliced at
the current timestep `t`. There is deliberately no accessor for future data.

If a strategy could ever express future access, that is a bug in the adapter
that built the view — NOT something to detect by reading strategy code. The
guarantee falls out of the architecture. Any change here that could leak future
data is a critical regression; it should be covered by a property test that a
malicious strategy cannot reach `t+1`.

## Contracts

- `Order`, `Fill` (`models.py`) — **immutable** (frozen). Do not mutate after
  creation; produce new instances instead.
- `Strategy` (`strategy.py`) — the ABC the (eventually LLM-generated) strategy
  fills in. It is the **only untrusted code** in the system. `on_tick(view)` is
  the sandbox boundary.
- `MarketView` (`marketview.py`) — the read-only window contract.

## Build order within core

- Phase 0 (done): data contracts + `Strategy`/`MarketView` interfaces.
- Phase 1: the engine loop + a concrete `MarketView`; property test the guarantee.
- Phase 3: `recorder` (equity curve + metrics) and the `overfit/` walk-forward gate.

## Design tension to hold

`MarketView` richness is load-bearing: too thin (just current price) and
strategies are toys; too rich and it leaks the dataset and loses the guarantee.
Be rich on past/present, structurally empty on future. Grow it only when a
hand-written strategy actually needs more.
