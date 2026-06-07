from __future__ import annotations

from typing import Any

from green.core.marketview import MarketView
from green.core.models import Order, Side
from green.core.strategy import Strategy


class BuyAndHold(Strategy):
    """Buy a fixed quantity on the first tick, then hold. The baseline every
    other strategy has to beat."""

    def __init__(self, params: dict[str, Any]) -> None:
        super().__init__(params)
        self.symbol: str = params["symbol"]
        self.quantity: float = params.get("quantity", 10.0)
        self._invested = False

    def on_tick(self, view: MarketView) -> list[Order]:
        if self._invested:
            return []
        self._invested = True
        return [Order(symbol=self.symbol, side=Side.BUY, quantity=self.quantity)]
