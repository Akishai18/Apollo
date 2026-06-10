"""Metrics — what a run *means*, computed from its equity curve and fills.

Pure post-hoc computation: the engine stays a dumb time-stepper and the recorder
stays a dumb accumulator; meaning is assigned here. `MetricsSpec` is the
per-environment contract for interpreting those numbers (an adapter knows what
its bars are; a daily-bar Sharpe and a tick-level Sharpe annualize differently).
"""

from __future__ import annotations

from collections.abc import Sequence
from math import sqrt
from statistics import mean, pstdev

from pydantic import BaseModel, ConfigDict

from green.core.models import Fill
from green.core.trades import pair_trades


class MetricsSpec(BaseModel):
    model_config = ConfigDict(frozen=True)

    periods_per_year: float = 252.0  # daily bars by default


class Metrics(BaseModel):
    model_config = ConfigDict(frozen=True)

    total_return: float  # fraction of starting cash
    sharpe: float  # annualized via periods_per_year
    max_drawdown: float  # peak-to-trough fraction, >= 0
    final_equity: float
    num_fills: int
    num_trades: int  # completed round trips
    win_rate: float  # fraction of round trips with pnl > 0 (0.0 if none)


def compute_metrics(
    equity_curve: Sequence[tuple[int, float]],
    fills: Sequence[Fill],
    *,
    starting_cash: float,
    periods_per_year: float = 252.0,
) -> Metrics:
    equities = [equity for _, equity in equity_curve]
    final_equity = equities[-1] if equities else starting_cash

    returns = [equities[i] / equities[i - 1] - 1.0 for i in range(1, len(equities))]
    sharpe = 0.0
    if len(returns) >= 2:
        spread = pstdev(returns)
        if spread > 0.0:
            sharpe = mean(returns) / spread * sqrt(periods_per_year)

    peak = float("-inf")
    max_drawdown = 0.0
    for equity in equities:
        peak = max(peak, equity)
        if peak > 0.0:
            max_drawdown = max(max_drawdown, (peak - equity) / peak)

    trades = pair_trades(fills)
    wins = sum(1 for trade in trades if trade.pnl > 0.0)

    return Metrics(
        total_return=final_equity / starting_cash - 1.0,
        sharpe=sharpe,
        max_drawdown=max_drawdown,
        final_equity=final_equity,
        num_fills=len(fills),
        num_trades=len(trades),
        win_rate=wins / len(trades) if trades else 0.0,
    )
