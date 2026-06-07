"""Engine correctness — exact PnL on known data, proving the loop is right
independent of any strategy generation.
"""

from __future__ import annotations

from green.adapters import ToyAdapter
from green.core.dataset import Dataset
from green.core.engine import run
from green.core.marketview import MarketView
from green.core.models import Order, Side
from green.core.strategy import Strategy
from green.strategies import BuyAndHold


def _series(values: list[float]) -> Dataset:
    return Dataset(series={"X": {"close": tuple(values)}})


class _Scripted(Strategy):
    """Buys 10 at t=0, sells 10 at t=2 — fully deterministic, for exact math."""

    def on_tick(self, view: MarketView) -> list[Order]:
        if view.now == 0:
            return [Order(symbol="X", side=Side.BUY, quantity=10)]
        if view.now == 2:
            return [Order(symbol="X", side=Side.SELL, quantity=10)]
        return []


def test_engine_exact_pnl() -> None:
    dataset = _series([100.0, 101.0, 102.0, 103.0, 104.0])
    result = run(_Scripted({}), ToyAdapter(), dataset, starting_cash=100_000.0)

    # buy 10@100 -> cash 99_000; sell 10@102 -> cash 100_020; flat at the end
    assert result.final_cash == 100_020.0
    assert result.final_positions.get("X", 0.0) == 0.0
    assert result.final_equity == 100_020.0
    assert [(f.side, f.price) for f in result.fills] == [
        (Side.BUY, 100.0),
        (Side.SELL, 102.0),
    ]


def test_buy_and_hold_exact_equity() -> None:
    dataset = _series([100.0, 101.0, 102.0, 103.0, 104.0])
    result = run(
        BuyAndHold({"symbol": "X", "quantity": 10}),
        ToyAdapter(),
        dataset,
        starting_cash=100_000.0,
    )

    # buy 10@100 at t=0, hold; end price 104 -> equity 99_000 + 1_040
    assert result.final_equity == 100_040.0
    assert result.final_positions["X"] == 10.0
    assert len(result.fills) == 1


def test_equity_curve_has_one_point_per_tick() -> None:
    dataset = _series([100.0, 101.0, 102.0, 103.0, 104.0])
    result = run(_Scripted({}), ToyAdapter(), dataset)
    assert [t for t, _ in result.equity_curve] == [0, 1, 2, 3, 4]
