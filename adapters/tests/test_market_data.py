"""MarketDataAdapter — faithfulness checks: next-bar-open fills, slippage, fees,
position limits, and the no-fill-on-the-last-bar rule. Prices are derived from
the loaded dataset (no magic constants) so the assertions stay exact.
"""

# pandas/yfinance are untyped test fixtures here.
# pyright: reportMissingTypeStubs=false, reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest
import yfinance as yf

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


def test_yahoo_provider_fetches_ohlcv_dates_and_uses_cache(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[str] = []

    class FakeTicker:
        def __init__(self, symbol: str) -> None:
            self.symbol = symbol

        def history(self, **kwargs: object) -> pd.DataFrame:
            calls.append(self.symbol)
            index = pd.to_datetime(["2024-01-02", "2024-01-03", "2024-01-04"])
            index.name = "Date"
            return pd.DataFrame(
                {
                    "Open": [10.0, 10.5, 11.0],
                    "High": [10.8, 11.1, 11.4],
                    "Low": [9.8, 10.2, 10.7],
                    "Close": [10.4, 10.9, 11.2],
                    "Volume": [1000, 1200, 900],
                },
                index=index,
            )

    monkeypatch.setattr(yf, "Ticker", FakeTicker)
    adapter = MarketDataAdapter(
        provider="yahoo",
        symbols="sls",
        period="1mo",
        cache_dir=tmp_path,
        fee_per_share=0.0,
        slippage_bps=0.0,
    )

    dataset = adapter.load_data()

    assert calls == ["SLS"]
    assert dataset.symbols == ("SLS",)
    assert dataset.dates == ("2024-01-02", "2024-01-03", "2024-01-04")
    assert dataset.price("SLS", 1, "open") == 10.5

    def fail_ticker(symbol: str) -> object:
        raise AssertionError(f"network should not be called for {symbol}")

    monkeypatch.setattr(yf, "Ticker", fail_ticker)
    cached = adapter.load_data()
    assert cached.dates == dataset.dates


def test_delta_provider_builds_dataset_and_uses_cache(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import polars as pl

    import green.adapters.market_data as md

    calls: list[tuple[str, ...]] = []

    def fake_delta(symbols: tuple[str, ...], **_kw: object) -> pl.DataFrame:
        calls.append(symbols)
        return pl.DataFrame(
            {
                "t": [0, 1, 2],
                "date": ["2024-02-01", "2024-02-02", "2024-02-05"],
                "symbol": ["SLS", "SLS", "SLS"],
                "open": [12.0, 12.3, 12.1],
                "high": [12.5, 12.6, 12.4],
                "low": [11.9, 12.1, 11.8],
                "close": [12.4, 12.2, 12.3],
                "volume": [5000.0, 5200.0, 4800.0],
            }
        )

    monkeypatch.setattr(md, "_fetch_delta", fake_delta)
    adapter = MarketDataAdapter(
        provider="delta", symbols="SLS", table="apollo_market_ohlcv", cache_dir=tmp_path
    )

    dataset = adapter.load_data()
    assert calls == [("SLS",)]
    assert dataset.symbols == ("SLS",)
    assert dataset.dates == ("2024-02-01", "2024-02-02", "2024-02-05")
    assert dataset.price("SLS", 1, "open") == 12.3

    def boom(*_a: object, **_k: object) -> object:
        raise AssertionError("delta should not be queried again — cache must serve")

    monkeypatch.setattr(md, "_fetch_delta", boom)
    assert adapter.load_data().dates == dataset.dates  # served from parquet cache


def test_delta_query_time_travel() -> None:
    from green.adapters.market_data import _delta_query

    sql, params = _delta_query("apollo.market.ohlcv", ("AAPL",), start=None, end=None, as_of=None)
    assert "VERSION AS OF" not in sql and "TIMESTAMP AS OF" not in sql
    assert params == ["AAPL"]

    sql_v, _ = _delta_query("t", ("AAPL",), start=None, end=None, as_of="12")
    assert "VERSION AS OF 12" in sql_v

    sql_ts, _ = _delta_query("t", ("AAPL",), start=None, end=None, as_of="2024-01-02")
    assert "TIMESTAMP AS OF '2024-01-02'" in sql_ts

    with pytest.raises(ValueError, match="as_of"):
        _delta_query("t", ("AAPL",), start=None, end=None, as_of="DROP TABLE")


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
