"""MarketDataAdapter — faithfulness checks: next-bar-open fills, slippage, fees,
position limits, and the no-fill-on-the-last-bar rule. Prices are derived from
the loaded dataset (no magic constants) so the assertions stay exact.
"""

from __future__ import annotations

from green.adapters import MarketDataAdapter
from green.core.models import Order, Side
from green.core.portfolio import PortfolioState

_TOL = 1e-9


def test_parquet_round_trip_into_dataset() -> None:
    dataset = MarketDataAdapter().load_data()
    assert dataset.symbols == ("SYN",)
    assert dataset.length == 756
    for field in ("open", "high", "low", "close", "volume"):
        assert len(dataset.series["SYN"][field]) == 756


def test_buy_fills_at_next_bar_open_plus_slippage() -> None:
    adapter = MarketDataAdapter(fee_per_share=0.005, slippage_bps=1.0)
    dataset = adapter.load_data()
    state = PortfolioState(cash=100_000.0)

    fills = adapter.apply_orders(
        [Order(symbol="SYN", side=Side.BUY, quantity=10)], state, dataset, t=0
    )

    assert len(fills) == 1
    fill = fills[0]
    assert fill.t == 1  # next bar
    expected = dataset.price("SYN", 1, "open") * (1.0 + 1.0 / 10_000.0)
    assert abs(fill.price - expected) < _TOL
    assert abs(fill.fee - 0.005 * 10) < _TOL


def test_sell_fills_at_next_bar_open_minus_slippage() -> None:
    adapter = MarketDataAdapter(slippage_bps=1.0)
    dataset = adapter.load_data()
    state = PortfolioState(cash=100_000.0, positions={"SYN": 10.0})

    fills = adapter.apply_orders(
        [Order(symbol="SYN", side=Side.SELL, quantity=10)], state, dataset, t=5
    )

    assert len(fills) == 1
    expected = dataset.price("SYN", 6, "open") * (1.0 - 1.0 / 10_000.0)
    assert abs(fills[0].price - expected) < _TOL


def test_no_fill_on_the_last_bar() -> None:
    adapter = MarketDataAdapter()
    dataset = adapter.load_data()
    state = PortfolioState(cash=100_000.0)
    last = dataset.length - 1

    fills = adapter.apply_orders(
        [Order(symbol="SYN", side=Side.BUY, quantity=10)], state, dataset, t=last
    )
    assert fills == []


def test_position_limit_clips_and_then_blocks() -> None:
    adapter = MarketDataAdapter(max_position=5.0)
    dataset = adapter.load_data()
    state = PortfolioState(cash=100_000.0)

    # A 10-share order is clipped to the 5-share cap.
    first = adapter.apply_orders(
        [Order(symbol="SYN", side=Side.BUY, quantity=10)], state, dataset, t=0
    )
    assert len(first) == 1
    assert first[0].quantity == 5.0

    # Now at the cap, a further buy is fully blocked (no zero-quantity fills).
    state.apply(first[0])
    second = adapter.apply_orders(
        [Order(symbol="SYN", side=Side.BUY, quantity=10)], state, dataset, t=0
    )
    assert second == []
