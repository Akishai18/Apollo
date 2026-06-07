"""EnvironmentAdapter — the port the engine programs against (dependency
inversion: core defines the interface, concrete adapters in `adapters/`
implement it, so core never imports an environment).

Every environment answers the same questions: how to load data, what a strategy
can see at `t` (the lookahead boundary), and what happens when it submits orders.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Sequence

from green.core.dataset import Dataset
from green.core.marketview import MarketView
from green.core.models import Fill, Order
from green.core.portfolio import PortfolioState


class EnvironmentAdapter(ABC):
    @abstractmethod
    def load_data(self) -> Dataset:
        """Load (or generate) the dataset for this environment."""
        ...

    @abstractmethod
    def make_view(self, dataset: Dataset, t: int) -> MarketView:
        """THE lookahead boundary: build a view physically bounded at `t`."""
        ...

    @abstractmethod
    def apply_orders(
        self, orders: Sequence[Order], state: PortfolioState, dataset: Dataset, t: int
    ) -> list[Fill]:
        """Turn desired orders into fills under this environment's rules
        (fill model, fees, slippage, position limits). The engine applies the
        returned fills to the portfolio state."""
        ...
