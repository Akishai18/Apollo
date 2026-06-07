"""The engine — an intentionally boring time-stepping loop. It owns no
environment knowledge: it asks the adapter for a bounded view, runs the
(untrusted) strategy, asks the adapter to fill the orders, updates state, and
records. Swap the adapter and the loop is unchanged.
"""

from __future__ import annotations

from dataclasses import dataclass

from green.core.adapter import EnvironmentAdapter
from green.core.dataset import Dataset
from green.core.models import Fill
from green.core.portfolio import PortfolioState
from green.core.recorder import Recorder
from green.core.strategy import Strategy

DEFAULT_STARTING_CASH = 100_000.0


@dataclass(frozen=True)
class RunResult:
    equity_curve: list[tuple[int, float]]
    fills: list[Fill]
    final_equity: float
    final_cash: float
    final_positions: dict[str, float]


def run(
    strategy: Strategy,
    adapter: EnvironmentAdapter,
    dataset: Dataset,
    *,
    starting_cash: float = DEFAULT_STARTING_CASH,
) -> RunResult:
    state = PortfolioState(cash=starting_cash)
    recorder = Recorder()

    for t in dataset.timeline:
        view = adapter.make_view(dataset, t)  # bounded by construction
        orders = strategy.on_tick(view)  # untrusted code runs here
        fills = adapter.apply_orders(orders, state, dataset, t)
        for fill in fills:
            state.apply(fill)
        prices = {symbol: dataset.price(symbol, t) for symbol in dataset.symbols}
        recorder.log(t, state.equity(prices), fills)

    last = dataset.length - 1
    final_prices = {symbol: dataset.price(symbol, last) for symbol in dataset.symbols}
    return RunResult(
        equity_curve=recorder.equity_curve,
        fills=recorder.fills,
        final_equity=state.equity(final_prices),
        final_cash=state.cash,
        final_positions=dict(state.positions),
    )
