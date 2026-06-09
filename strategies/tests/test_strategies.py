"""Example-strategy sanity checks on the synthetic OU environment."""

from __future__ import annotations

from green.adapters import MarketDataAdapter, ToyAdapter
from green.core.engine import run
from green.strategies import BuyAndHold, MeanReversion, MovingAverageCrossover


def test_mean_reversion_profits_on_mean_reverting_data() -> None:
    adapter = ToyAdapter(symbol="SYN", n_steps=500, mu=100.0, theta=0.1, sigma=1.0, seed=7)
    dataset = adapter.load_data()
    result = run(
        MeanReversion(
            {"symbol": "SYN", "lookback": 20, "entry_z": -1.0, "exit_z": 0.0, "quantity": 10}
        ),
        adapter,
        dataset,
        starting_cash=100_000.0,
    )
    assert len(result.fills) >= 2  # at least one completed round trip
    # With zero costs, buying below the mean and selling at it must net a profit.
    assert result.final_equity > 100_000.0


def test_buy_and_hold_trades_exactly_once() -> None:
    adapter = ToyAdapter(seed=1)
    dataset = adapter.load_data()
    result = run(BuyAndHold({"symbol": "SYN", "quantity": 5}), adapter, dataset)
    assert len(result.fills) == 1
    assert result.fills[0].quantity == 5.0


def test_moving_average_crossover_runs_on_faithful_adapter() -> None:
    adapter = MarketDataAdapter()
    dataset = adapter.load_data()
    result = run(
        MovingAverageCrossover({"symbol": "SYN", "fast": 10, "slow": 30, "quantity": 10}),
        adapter,
        dataset,
        starting_cash=100_000.0,
    )
    # Over 756 bars of GBM the fast/slow MAs cross repeatedly: expect real trades,
    # and every fill must land on a bar that actually exists.
    assert len(result.fills) >= 2
    assert all(0 <= fill.t < dataset.length for fill in result.fills)
    assert len(result.equity_curve) == dataset.length
