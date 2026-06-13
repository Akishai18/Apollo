"""The overfit gate — walk-forward validation that rejects with a reason.

For each rolling window the gate *fits on train* (grid-search the params, keep
the best by the selection metric) and then *evaluates on held-out* data the
selection never saw. A real edge survives that move; a curve-fit one collapses,
because its "edge" was the noise of the particular training window.

Two structural notes:

- Training runs execute on `dataset.window(train_start, train_end)` — the
  held-out data is physically absent from the object, the same construction as
  the per-tick lookahead law. Selection cannot leak.
- Each run gets a **fresh strategy instance** from the factory. Strategies carry
  state (`self._holding` etc.); reusing an instance would leak state across the
  train/held-out boundary and quietly corrupt the verdict.

Caveat (v1): held-out runs start cold at `test_start`, so indicator warm-up
consumes the first `lookback` bars of each held-out window. Size `test_size`
comfortably above the largest lookback in the grid.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from statistics import mean
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from green.core.adapter import EnvironmentAdapter
from green.core.dataset import Dataset
from green.core.engine import DEFAULT_STARTING_CASH, run
from green.core.metrics import Metrics, compute_metrics
from green.core.overfit.sweep import expand_grid
from green.core.overfit.windows import Window, make_windows
from green.core.strategy import Strategy

type SelectBy = Literal["sharpe", "total_return"]
type StrategyFactory = Callable[[dict[str, Any]], Strategy]

# (timestep, marked-to-market equity) pairs. Timesteps are window-local (0-based
# within the train/test slice) — offset by window.train_start / window.test_start
# for an absolute axis.
type EquityCurve = tuple[tuple[int, float], ...]


class SweepPoint(BaseModel):
    model_config = ConfigDict(frozen=True)

    params: dict[str, Any]
    train: Metrics


class WindowResult(BaseModel):
    model_config = ConfigDict(frozen=True)

    window: Window
    chosen_params: dict[str, Any]
    train: Metrics  # in-sample, for the chosen params
    test: Metrics  # held-out, same params
    sweep: tuple[SweepPoint, ...]  # full grid on train — the heatmap data
    # The chosen params' equity curves. Side by side these ARE the overfit story:
    # in-sample looks good, held-out is the honest test. The visuals draw these.
    train_equity: EquityCurve = ()
    test_equity: EquityCurve = ()


class Verdict(BaseModel):
    model_config = ConfigDict(frozen=True)

    passed: bool
    reason: str  # always legible, always populated
    train_sharpe: float  # mean across windows
    test_sharpe: float  # mean across windows
    retention: float  # test_sharpe / train_sharpe (0.0 when train <= 0)
    oos_trades: int  # completed round trips across all held-out windows
    windows: tuple[WindowResult, ...]  # the evidence


class WalkForwardProgress(BaseModel):
    """Emitted after each window finishes. Transport-agnostic on purpose: core
    knows nothing about WebSockets — a caller (the API) turns these into frames."""

    model_config = ConfigDict(frozen=True)

    completed: int  # windows finished so far (1-based)
    total: int  # total windows in this run
    window: WindowResult  # the just-finished window's full evidence


type ProgressHook = Callable[[WalkForwardProgress], None]


def _score(metrics: Metrics, select_by: SelectBy) -> float:
    return metrics.sharpe if select_by == "sharpe" else metrics.total_return


def run_walk_forward(
    strategy_factory: StrategyFactory,
    adapter: EnvironmentAdapter,
    dataset: Dataset,
    grid: Mapping[str, Sequence[Any]],
    *,
    train_size: int,
    test_size: int,
    step: int | None = None,
    starting_cash: float = DEFAULT_STARTING_CASH,
    select_by: SelectBy = "sharpe",
    min_retention: float = 0.5,
    min_oos_trades: int = 2,
    progress: ProgressHook | None = None,
) -> Verdict:
    windows = make_windows(dataset.length, train_size=train_size, test_size=test_size, step=step)
    if not windows:
        raise ValueError("dataset too short for the requested train/test windows")
    spec = adapter.metrics_spec()
    combos = expand_grid(grid)
    total = len(windows)

    results: list[WindowResult] = []
    for window in windows:
        train_data = dataset.window(window.train_start, window.train_end)
        test_data = dataset.window(window.test_start, window.test_end)

        sweep: list[SweepPoint] = []
        best: SweepPoint | None = None
        best_train_equity: EquityCurve = ()
        for params in combos:
            outcome = run(
                strategy_factory(dict(params)), adapter, train_data, starting_cash=starting_cash
            )
            point = SweepPoint(
                params=params,
                train=compute_metrics(
                    outcome.equity_curve,
                    outcome.fills,
                    starting_cash=starting_cash,
                    periods_per_year=spec.periods_per_year,
                ),
            )
            sweep.append(point)
            if best is None or _score(point.train, select_by) > _score(best.train, select_by):
                best = point
                best_train_equity = tuple(outcome.equity_curve)
        assert best is not None  # combos is never empty

        held_out = run(
            strategy_factory(dict(best.params)), adapter, test_data, starting_cash=starting_cash
        )
        window_result = WindowResult(
            window=window,
            chosen_params=best.params,
            train=best.train,
            test=compute_metrics(
                held_out.equity_curve,
                held_out.fills,
                starting_cash=starting_cash,
                periods_per_year=spec.periods_per_year,
            ),
            sweep=tuple(sweep),
            train_equity=best_train_equity,
            test_equity=tuple(held_out.equity_curve),
        )
        results.append(window_result)
        if progress is not None:
            progress(WalkForwardProgress(completed=len(results), total=total, window=window_result))

    train_sharpe = mean(result.train.sharpe for result in results)
    test_sharpe = mean(result.test.sharpe for result in results)
    oos_trades = sum(result.test.num_trades for result in results)
    retention = test_sharpe / train_sharpe if train_sharpe > 0.0 else 0.0
    n = len(results)

    def verdict(passed: bool, reason: str) -> Verdict:
        return Verdict(
            passed=passed,
            reason=reason,
            train_sharpe=train_sharpe,
            test_sharpe=test_sharpe,
            retention=retention,
            oos_trades=oos_trades,
            windows=tuple(results),
        )

    if train_sharpe <= 0.0:
        return verdict(
            False,
            f"rejected: not profitable even in-sample (mean train Sharpe "
            f"{train_sharpe:.2f} <= 0 across {n} windows) — nothing to validate",
        )
    if oos_trades < min_oos_trades:
        return verdict(
            False,
            f"rejected: insufficient out-of-sample evidence — {oos_trades} completed "
            f"trades across {n} held-out windows (need >= {min_oos_trades})",
        )
    if retention < min_retention:
        return verdict(
            False,
            f"rejected: performance collapses out of sample — held-out Sharpe "
            f"{test_sharpe:.2f} retains {retention:.0%} of train Sharpe {train_sharpe:.2f} "
            f"(threshold {min_retention:.0%}); the edge looks fitted to the training windows",
        )
    return verdict(
        True,
        f"passed: held-out Sharpe {test_sharpe:.2f} retains {retention:.0%} of train "
        f"Sharpe {train_sharpe:.2f} across {n} walk-forward windows "
        f"({oos_trades} out-of-sample trades)",
    )
