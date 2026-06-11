"""MarketView — the lookahead boundary, the most important object in the system.

LAW: a MarketView exposes history and present, NEVER the future. It is built
fresh each tick by an environment adapter, physically sliced at the current
timestep `t`. There is deliberately no accessor for future data.

If a strategy could ever express future access, that is a bug in the adapter
that constructed the view — not something to be detected by reading strategy
code. The guarantee falls out of the architecture, not out of inspection.

This base class declares the read-only contract. Concrete views are built by
environment adapters (see `adapters/`); Phase 1 fills in a concrete view for
the toy adapter.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Sequence


class MarketView(ABC):
    @property
    @abstractmethod
    def now(self) -> int:
        """Current timestep index. The view exposes data for indices <= now only."""
        ...

    @abstractmethod
    def history(self, symbol: str, field: str, lookback: int) -> Sequence[float]:
        """Up-to-and-including-now values for `field` of `symbol`, most recent
        last, at most `lookback` points. Never includes any index > now."""
        ...

    @abstractmethod
    def last(self, symbol: str, field: str) -> float:
        """The current (at `now`) value of `field` for `symbol`."""
        ...

    @abstractmethod
    def symbols(self) -> tuple[str, ...]:
        """The symbols this view carries data for. Metadata only — grown so a
        proxy (e.g. the sandbox) can enumerate and forward the current bar."""
        ...

    @abstractmethod
    def fields(self, symbol: str) -> tuple[str, ...]:
        """The fields available for `symbol` (e.g. open/high/low/close)."""
        ...
