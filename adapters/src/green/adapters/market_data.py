"""MarketDataAdapter — the first *faithful* environment (equities/crypto OHLCV).

Where `ToyAdapter` fills instantly at the current price with no costs, this
adapter models the frictions that make a backtest trustworthy:

- **Next-bar-open fills.** A strategy decides on bar `t` (it has seen data
  through `close[t]`); the order executes at `open[t+1]`. You can never trade on
  a price your decision was derived from. Orders on the final bar have no next
  bar to fill against, so they are dropped.
- **Slippage** — a flat bps haircut: buys pay up, sells receive less.
- **Fees** — per-share commission.
- **Position limits** — fills are clipped so `|position|` never exceeds a cap.

Lookahead note: the *trusted* simulator reads `open[t+1]` to price the fill, but
the strategy never sees it — `make_view` still slices the dataset to `[0, t]`.
Peeking forward inside the simulator is not strategy lookahead; the guarantee is
about what the `MarketView` exposes, and it exposes nothing past `t`.

Point-in-time data is loaded from a committed, versioned parquet fixture (see
`synthetic.py`); the adapter only ever reads it.
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import polars as pl

from green.adapters.synthetic import FIXTURE_PATH
from green.core.adapter import EnvironmentAdapter
from green.core.dataset import Dataset, Field, Symbol
from green.core.marketview import MarketView
from green.core.models import Fill, Order, Side
from green.core.portfolio import PortfolioState
from green.core.views import SlicedView

_FIELDS: tuple[Field, ...] = ("open", "high", "low", "close", "volume")


class MarketDataAdapter(EnvironmentAdapter):
    def __init__(
        self,
        *,
        path: Path = FIXTURE_PATH,
        fee_per_share: float = 0.005,
        slippage_bps: float = 1.0,
        max_position: float = 1000.0,
    ) -> None:
        self.path = path
        self.fee_per_share = fee_per_share
        self.slippage_bps = slippage_bps
        self.max_position = max_position

    def load_data(self) -> Dataset:
        df = pl.read_parquet(self.path)
        symbol_col: list[str] = df["symbol"].to_list()
        t_col: list[int] = df["t"].to_list()
        field_cols: dict[Field, list[float]] = {field: df[field].to_list() for field in _FIELDS}

        rows_by_symbol: dict[Symbol, list[int]] = {}
        for i, symbol in enumerate(symbol_col):
            rows_by_symbol.setdefault(symbol, []).append(i)

        series: dict[Symbol, dict[Field, Sequence[float]]] = {}
        for symbol, rows in rows_by_symbol.items():
            rows.sort(key=lambda i: t_col[i])
            series[symbol] = {field: tuple(field_cols[field][i] for i in rows) for field in _FIELDS}
        return Dataset(series=series)

    def make_view(self, dataset: Dataset, t: int) -> MarketView:
        return SlicedView(t, dataset.slice_at(t))

    def apply_orders(
        self, orders: Sequence[Order], state: PortfolioState, dataset: Dataset, t: int
    ) -> list[Fill]:
        fill_t = t + 1
        if fill_t > dataset.length - 1:
            return []  # no next bar to execute against

        fills: list[Fill] = []
        for order in orders:
            base = dataset.price(order.symbol, fill_t, "open")
            signed = order.quantity if order.side is Side.BUY else -order.quantity
            current = state.position(order.symbol)
            target = max(-self.max_position, min(self.max_position, current + signed))
            quantity = abs(target - current)
            if quantity == 0.0:
                continue  # blocked by position limit

            haircut = self.slippage_bps / 10_000.0
            price = base * (1.0 + haircut) if order.side is Side.BUY else base * (1.0 - haircut)
            fills.append(
                Fill(
                    symbol=order.symbol,
                    side=order.side,
                    quantity=quantity,
                    price=price,
                    fee=self.fee_per_share * quantity,
                    t=fill_t,
                )
            )
        return fills
