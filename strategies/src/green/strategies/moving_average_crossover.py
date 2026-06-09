from __future__ import annotations

from typing import Any

from green.core.indicators import sma
from green.core.marketview import MarketView
from green.core.models import Order, Side
from green.core.strategy import Strategy


class MovingAverageCrossover(Strategy):
    """Go long while the fast SMA sits above the slow SMA; exit when it crosses
    back below. A trend-following counterpart to MeanReversion. Params are
    defaults the overfit gate will later sweep — never hardcoded constants.
    """

    def __init__(self, params: dict[str, Any]) -> None:
        super().__init__(params)
        self.symbol: str = params["symbol"]
        self.fast: int = params.get("fast", 10)
        self.slow: int = params.get("slow", 30)
        self.quantity: float = params.get("quantity", 10.0)
        self._holding = False

    def on_tick(self, view: MarketView) -> list[Order]:
        closes = view.history(self.symbol, "close", self.slow)
        if len(closes) < self.slow:
            return []
        fast_ma = sma(closes, self.fast)
        slow_ma = sma(closes, self.slow)
        if not self._holding and fast_ma > slow_ma:
            self._holding = True
            return [Order(symbol=self.symbol, side=Side.BUY, quantity=self.quantity)]
        if self._holding and fast_ma < slow_ma:
            self._holding = False
            return [Order(symbol=self.symbol, side=Side.SELL, quantity=self.quantity)]
        return []
