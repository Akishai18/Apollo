"""PortfolioState — evolving cash + positions during a run. Engine-internal,
mutable: the engine applies fills to it tick by tick.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field

from green.core.models import Fill, Side


@dataclass
class PortfolioState:
    cash: float
    positions: dict[str, float] = field(default_factory=dict[str, float])

    def apply(self, fill: Fill) -> None:
        notional = fill.quantity * fill.price
        if fill.side is Side.BUY:
            self.cash -= notional + fill.fee
            signed = fill.quantity
        else:
            self.cash += notional - fill.fee
            signed = -fill.quantity
        self.positions[fill.symbol] = self.positions.get(fill.symbol, 0.0) + signed

    def position(self, symbol: str) -> float:
        return self.positions.get(symbol, 0.0)

    def equity(self, prices: Mapping[str, float]) -> float:
        holdings = sum(qty * prices[symbol] for symbol, qty in self.positions.items())
        return self.cash + holdings
