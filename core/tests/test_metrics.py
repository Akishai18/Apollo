"""Metrics + trade pairing — exact arithmetic on hand-built inputs."""

from __future__ import annotations

from green.core.metrics import compute_metrics
from green.core.models import Fill, Side
from green.core.trades import pair_trades

_TOL = 1e-12


def _fill(side: Side, qty: float, price: float, t: int, fee: float = 0.0) -> Fill:
    return Fill(symbol="X", side=side, quantity=qty, price=price, fee=fee, t=t)


def test_metrics_exact_on_known_curve() -> None:
    curve = [(0, 100_000.0), (1, 101_000.0), (2, 99_000.0), (3, 103_000.0)]
    metrics = compute_metrics(curve, [], starting_cash=100_000.0)

    assert abs(metrics.total_return - 0.03) < _TOL
    # peak 101_000 -> trough 99_000
    assert abs(metrics.max_drawdown - 2_000.0 / 101_000.0) < _TOL
    assert metrics.final_equity == 103_000.0
    assert metrics.num_fills == 0
    assert metrics.num_trades == 0
    assert metrics.win_rate == 0.0
    assert metrics.sharpe > 0.0  # rising on net, sign sanity only


def test_flat_curve_has_zero_sharpe_and_drawdown() -> None:
    curve = [(t, 100_000.0) for t in range(10)]
    metrics = compute_metrics(curve, [], starting_cash=100_000.0)
    assert metrics.sharpe == 0.0
    assert metrics.max_drawdown == 0.0
    assert metrics.total_return == 0.0


def test_round_trip_pnl_is_net_of_both_fees() -> None:
    fills = [
        _fill(Side.BUY, 10, 100.0, t=0, fee=1.0),
        _fill(Side.SELL, 10, 110.0, t=5, fee=1.0),
    ]
    trades = pair_trades(fills)
    assert len(trades) == 1
    trade = trades[0]
    assert trade.direction is Side.BUY
    assert (trade.entry_t, trade.exit_t) == (0, 5)
    assert abs(trade.pnl - 98.0) < _TOL  # (110-100)*10 - 1 - 1


def test_partial_closes_split_into_two_trades_fifo() -> None:
    fills = [
        _fill(Side.BUY, 10, 100.0, t=0),
        _fill(Side.SELL, 4, 105.0, t=1),
        _fill(Side.SELL, 6, 90.0, t=2),
    ]
    trades = pair_trades(fills)
    assert [(t.quantity, t.pnl) for t in trades] == [(4.0, 20.0), (6.0, -60.0)]


def test_short_round_trip() -> None:
    fills = [
        _fill(Side.SELL, 5, 100.0, t=0),
        _fill(Side.BUY, 5, 90.0, t=3),
    ]
    trades = pair_trades(fills)
    assert len(trades) == 1
    assert trades[0].direction is Side.SELL
    assert abs(trades[0].pnl - 50.0) < _TOL  # (100-90)*5


def test_open_position_is_not_a_trade() -> None:
    assert pair_trades([_fill(Side.BUY, 10, 100.0, t=0)]) == []


def test_win_rate_flows_into_metrics() -> None:
    fills = [
        _fill(Side.BUY, 10, 100.0, t=0),
        _fill(Side.SELL, 10, 110.0, t=1),  # win
        _fill(Side.BUY, 10, 110.0, t=2),
        _fill(Side.SELL, 10, 105.0, t=3),  # loss
    ]
    curve = [(t, 100_000.0 + t) for t in range(4)]
    metrics = compute_metrics(curve, fills, starting_cash=100_000.0)
    assert metrics.num_fills == 4
    assert metrics.num_trades == 2
    assert metrics.win_rate == 0.5
