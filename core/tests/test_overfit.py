"""The overfit gate, proven: a curve-fit strategy is rejected with a legible
reason; a strategy with real structure passes. Plus exact unit checks for
windows, grid expansion, and the physical window slice.
"""

from __future__ import annotations

from typing import Any

import pytest

from green.adapters import ToyAdapter
from green.core import Order, Side, Strategy, run_walk_forward
from green.core.dataset import Dataset
from green.core.marketview import MarketView
from green.core.overfit import WalkForwardProgress, expand_grid, make_windows
from green.strategies import MeanReversion


class LuckyTimer(Strategy):
    """The canonical overfit specimen: buys at a fixed bar index and sells
    `hold` bars later. Sweeping (buy_t, hold) finds whichever timing happened to
    nail the best swing of each training window — pure luck, zero structure —
    so held-out performance must collapse.
    """

    def __init__(self, params: dict[str, Any]) -> None:
        super().__init__(params)
        self.symbol: str = params["symbol"]
        self.buy_t: int = params["buy_t"]
        self.hold: int = params["hold"]

    def on_tick(self, view: MarketView) -> list[Order]:
        if view.now == self.buy_t:
            return [Order(symbol=self.symbol, side=Side.BUY, quantity=50)]
        if view.now == self.buy_t + self.hold:
            return [Order(symbol=self.symbol, side=Side.SELL, quantity=50)]
        return []


def _ou_dataset() -> tuple[ToyAdapter, Dataset]:
    adapter = ToyAdapter(n_steps=600, mu=100.0, theta=0.1, sigma=1.0, seed=7)
    return adapter, adapter.load_data()


def test_make_windows_exact_bounds() -> None:
    windows = make_windows(600, train_size=200, test_size=100)
    assert [(w.train_start, w.train_end, w.test_start, w.test_end) for w in windows] == [
        (0, 200, 200, 300),
        (100, 300, 300, 400),
        (200, 400, 400, 500),
        (300, 500, 500, 600),
    ]


def test_make_windows_empty_when_dataset_too_short() -> None:
    assert make_windows(250, train_size=200, test_size=100) == []


def test_make_windows_rejects_bad_sizes() -> None:
    with pytest.raises(ValueError):
        make_windows(600, train_size=0, test_size=100)
    with pytest.raises(ValueError):
        make_windows(600, train_size=200, test_size=100, step=0)


def test_expand_grid_is_deterministic_cartesian_product() -> None:
    grid = {"a": [1, 2], "b": ["x"]}
    assert expand_grid(grid) == [{"a": 1, "b": "x"}, {"a": 2, "b": "x"}]
    assert expand_grid({}) == [{}]


def test_dataset_window_is_physically_sliced() -> None:
    dataset = Dataset(
        series={"R": {"close": tuple(float(i) for i in range(10))}},
        dates=tuple(f"2024-01-{i + 1:02d}" for i in range(10)),
    )
    sub = dataset.window(3, 7)
    assert sub.length == 4
    assert sub.series["R"]["close"] == (3.0, 4.0, 5.0, 6.0)
    assert sub.dates == ("2024-01-04", "2024-01-05", "2024-01-06", "2024-01-07")
    with pytest.raises(ValueError):
        dataset.window(5, 11)
    with pytest.raises(ValueError):
        dataset.window(5, 5)


def test_robust_strategy_passes_the_gate() -> None:
    adapter, dataset = _ou_dataset()
    verdict = run_walk_forward(
        MeanReversion,
        adapter,
        dataset,
        {"symbol": ["SYN"], "lookback": [10, 20], "entry_z": [-1.5, -1.0], "quantity": [10]},
        train_size=200,
        test_size=100,
    )
    # Mean reversion on an OU process is real structure: the edge survives
    # data the parameter selection never saw.
    assert verdict.passed
    assert verdict.reason.startswith("passed")
    assert verdict.retention >= 0.5
    assert verdict.oos_trades >= 2
    assert len(verdict.windows) == 4


def test_verdict_carries_equity_curves_for_the_visuals() -> None:
    adapter, dataset = _ou_dataset()
    verdict = run_walk_forward(
        MeanReversion,
        adapter,
        dataset,
        {"symbol": ["SYN"], "lookback": [10, 20], "quantity": [10]},
        train_size=200,
        test_size=100,
    )
    # Each window exposes the chosen params' in-sample and held-out equity curves
    # (one point per bar in the slice) — the data the web charts the overfit story
    # from. Timesteps are window-local and start at 0.
    for w in verdict.windows:
        assert len(w.train_equity) == 200
        assert len(w.test_equity) == 100
        assert w.train_equity[0][0] == 0 and w.test_equity[0][0] == 0
        assert all(isinstance(equity, float) for _, equity in w.test_equity)


def test_verdict_carries_window_dates_when_dataset_has_calendar() -> None:
    adapter = ToyAdapter()
    dataset = Dataset(
        series={"SYN": {"close": tuple(100.0 + i for i in range(12))}},
        dates=tuple(f"2024-01-{i + 1:02d}" for i in range(12)),
    )
    verdict = run_walk_forward(
        MeanReversion,
        adapter,
        dataset,
        {"symbol": ["SYN"], "lookback": [2], "quantity": [1]},
        train_size=6,
        test_size=3,
        min_oos_trades=0,
    )
    first = verdict.windows[0]
    assert first.train_dates == tuple(f"2024-01-{i + 1:02d}" for i in range(6))
    assert first.test_dates == ("2024-01-07", "2024-01-08", "2024-01-09")


def test_curve_fit_strategy_is_rejected_with_legible_reason() -> None:
    adapter, dataset = _ou_dataset()
    grid = {
        "symbol": ["SYN"],
        "buy_t": [0, 10, 20, 30, 40, 50, 60, 70, 80],
        "hold": [5, 10],
    }
    verdict = run_walk_forward(LuckyTimer, adapter, dataset, grid, train_size=200, test_size=100)

    assert not verdict.passed
    assert "collapses out of sample" in verdict.reason
    assert f"{verdict.train_sharpe:.2f}" in verdict.reason  # reason carries evidence
    # In-sample the sweep always finds a "winner"; held-out it falls apart.
    assert verdict.train_sharpe > 0.0
    assert verdict.retention < 0.5

    # Evidence is complete: every window records the full sweep (heatmap data)
    # and the chosen params are one of the swept combos.
    for window_result in verdict.windows:
        assert len(window_result.sweep) == 18  # 9 buy_t x 2 hold
        assert window_result.chosen_params in [point.params for point in window_result.sweep]


def test_progress_hook_fires_once_per_window_in_order() -> None:
    adapter, dataset = _ou_dataset()
    seen: list[WalkForwardProgress] = []
    verdict = run_walk_forward(
        MeanReversion,
        adapter,
        dataset,
        {"symbol": ["SYN"], "lookback": [10, 20], "quantity": [10]},
        train_size=200,
        test_size=100,
        progress=seen.append,
    )
    # One event per window, monotonic and total-consistent, carrying the window.
    assert [p.completed for p in seen] == [1, 2, 3, 4]
    assert all(p.total == 4 for p in seen)
    assert [p.window for p in seen] == list(verdict.windows)
