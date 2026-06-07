from __future__ import annotations

from statistics import mean, pstdev
from typing import Any

from green.core.marketview import MarketView
from green.core.models import Order, Side
from green.core.strategy import Strategy


class MeanReversion(Strategy):
    """Buy when price is `entry_z` standard deviations below its rolling mean;
    exit when it reverts back to `exit_z`. Params are defaults the overfit gate
    will later sweep — never hardcoded constants.
    """

    def __init__(self, params: dict[str, Any]) -> None:
        super().__init__(params)
        self.symbol: str = params["symbol"]
        self.lookback: int = params.get("lookback", 20)
        self.entry_z: float = params.get("entry_z", -1.0)
        self.exit_z: float = params.get("exit_z", 0.0)
        self.quantity: float = params.get("quantity", 10.0)
        self._holding = False

    def on_tick(self, view: MarketView) -> list[Order]:
        closes = view.history(self.symbol, "close", self.lookback)
        if len(closes) < self.lookback:
            return []
        spread = pstdev(closes)
        if spread == 0.0:
            return []
        z = (view.last(self.symbol, "close") - mean(closes)) / spread
        if not self._holding and z <= self.entry_z:
            self._holding = True
            return [Order(symbol=self.symbol, side=Side.BUY, quantity=self.quantity)]
        if self._holding and z >= self.exit_z:
            self._holding = False
            return [Order(symbol=self.symbol, side=Side.SELL, quantity=self.quantity)]
        return []
