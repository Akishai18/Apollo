"""Trade log — pairs raw fills into completed round trips (FIFO).

A `Fill` is what the market did; a `Trade` is what the strategy *achieved*: an
entry matched against an exit with realized PnL net of both legs' fees. The
overfit gate uses these as evidence ("3 of 12 held-out trades were profitable"),
which is far more legible than a bare equity curve.

Open positions at the end of a run are not trades — they are ignored here and
show up only in marked-to-market equity.
"""

from __future__ import annotations

from collections import deque
from collections.abc import Sequence
from dataclasses import dataclass
from math import copysign

from pydantic import BaseModel, ConfigDict

from green.core.models import Fill, Side

_EPSILON = 1e-12


class Trade(BaseModel):
    model_config = ConfigDict(frozen=True)

    symbol: str
    direction: Side  # BUY = long round trip, SELL = short round trip
    quantity: float
    entry_t: int
    exit_t: int
    entry_price: float
    exit_price: float
    pnl: float  # realized, net of fees allocated to the matched quantity


@dataclass
class _Lot:
    signed_qty: float  # > 0 long, < 0 short
    price: float
    fee_per_unit: float
    t: int


def pair_trades(fills: Sequence[Fill]) -> list[Trade]:
    book: dict[str, deque[_Lot]] = {}
    trades: list[Trade] = []

    for fill in fills:
        signed = fill.quantity if fill.side is Side.BUY else -fill.quantity
        fee_per_unit = fill.fee / fill.quantity
        lots = book.setdefault(fill.symbol, deque())

        remaining = signed
        while abs(remaining) > _EPSILON and lots and lots[0].signed_qty * remaining < 0:
            lot = lots[0]
            matched = min(abs(remaining), abs(lot.signed_qty))
            is_long = lot.signed_qty > 0
            gross = (fill.price - lot.price) * matched
            trades.append(
                Trade(
                    symbol=fill.symbol,
                    direction=Side.BUY if is_long else Side.SELL,
                    quantity=matched,
                    entry_t=lot.t,
                    exit_t=fill.t,
                    entry_price=lot.price,
                    exit_price=fill.price,
                    pnl=(gross if is_long else -gross)
                    - matched * (lot.fee_per_unit + fee_per_unit),
                )
            )
            lot.signed_qty -= copysign(matched, lot.signed_qty)
            remaining -= copysign(matched, remaining)
            if abs(lot.signed_qty) <= _EPSILON:
                lots.popleft()

        if abs(remaining) > _EPSILON:
            lots.append(
                _Lot(signed_qty=remaining, price=fill.price, fee_per_unit=fee_per_unit, t=fill.t)
            )

    return trades
