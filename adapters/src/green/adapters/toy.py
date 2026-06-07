"""ToyAdapter — an idealized environment whose only job is to prove the engine
loop and the lookahead guarantee with exact, deterministic arithmetic.

It generates a synthetic mean-reverting (Ornstein-Uhlenbeck) price series and
fills market orders immediately at the current tick price with no fees or
slippage. This is deliberately NOT faithful to any real market — faithfulness
(next-bar fills, fees, slippage, position limits) lives in the market_data
adapter (Phase 2).
"""

from __future__ import annotations

import random
from collections.abc import Sequence

from green.core.adapter import EnvironmentAdapter
from green.core.dataset import Dataset
from green.core.marketview import MarketView
from green.core.models import Fill, Order
from green.core.portfolio import PortfolioState
from green.core.views import SlicedView


class ToyAdapter(EnvironmentAdapter):
    def __init__(
        self,
        *,
        symbol: str = "SYN",
        n_steps: int = 500,
        mu: float = 100.0,
        theta: float = 0.1,
        sigma: float = 1.0,
        seed: int = 0,
    ) -> None:
        self.symbol = symbol
        self.n_steps = n_steps
        self.mu = mu
        self.theta = theta
        self.sigma = sigma
        self.seed = seed

    def load_data(self) -> Dataset:
        rng = random.Random(self.seed)
        prices: list[float] = []
        x = self.mu
        for _ in range(self.n_steps):
            x = x + self.theta * (self.mu - x) + self.sigma * rng.gauss(0.0, 1.0)
            prices.append(x)
        return Dataset(series={self.symbol: {"close": tuple(prices)}})

    def make_view(self, dataset: Dataset, t: int) -> MarketView:
        return SlicedView(t, dataset.slice_at(t))

    def apply_orders(
        self, orders: Sequence[Order], state: PortfolioState, dataset: Dataset, t: int
    ) -> list[Fill]:
        return [
            Fill(
                symbol=order.symbol,
                side=order.side,
                quantity=order.quantity,
                price=dataset.price(order.symbol, t),
                fee=0.0,
                t=t,
            )
            for order in orders
        ]
