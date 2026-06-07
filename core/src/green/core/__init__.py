"""green.core — the trust core: contracts + engine shared by every layer.

Environment-agnostic by design. This package must never import from adapters,
sandbox, api, or any environment-specific code.
"""

from green.core.adapter import EnvironmentAdapter
from green.core.dataset import Dataset
from green.core.engine import RunResult, run
from green.core.marketview import MarketView
from green.core.models import Fill, Order, OrderType, Side
from green.core.portfolio import PortfolioState
from green.core.recorder import Recorder
from green.core.strategy import Strategy
from green.core.views import SlicedView

__all__ = [
    "Dataset",
    "EnvironmentAdapter",
    "Fill",
    "MarketView",
    "Order",
    "OrderType",
    "PortfolioState",
    "Recorder",
    "RunResult",
    "Side",
    "SlicedView",
    "Strategy",
    "run",
]
