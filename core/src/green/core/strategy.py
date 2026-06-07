"""The Strategy contract — the only code in the system that is untrusted.

Every strategy (hand-written today, LLM-generated later) subclasses this. It is
handed a `MarketView` each tick and returns desired orders; the engine and the
environment adapter decide fills. It must never reach outside the view it is
given — and by construction (see marketview.py) it cannot reach the future.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from green.core.marketview import MarketView
from green.core.models import Order


class Strategy(ABC):
    def __init__(self, params: dict[str, Any]) -> None:
        # params come from the user / the sweep, never hardcoded
        self.params = params

    @abstractmethod
    def on_tick(self, view: MarketView) -> list[Order]:
        """Called once per timestep. `view` exposes data up to and including now.
        Return the desired orders for this tick."""
        ...
