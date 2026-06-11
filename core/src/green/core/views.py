"""SlicedView — the concrete MarketView handed to a strategy each tick.

It holds sequences that have ALREADY been physically sliced to [0, t] by the
adapter (see Dataset.slice_at). Future indices do not exist in the data it was
given, so the lookahead guarantee is structural: there is nothing to look ahead
*to*.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from green.core.marketview import MarketView


class SlicedView(MarketView):
    def __init__(self, t: int, sliced: Mapping[str, Mapping[str, Sequence[float]]]) -> None:
        self._t = t
        self._sliced = sliced

    @property
    def now(self) -> int:
        return self._t

    def history(self, symbol: str, field: str, lookback: int) -> Sequence[float]:
        if lookback <= 0:
            raise ValueError("lookback must be positive")
        return self._sliced[symbol][field][-lookback:]

    def last(self, symbol: str, field: str) -> float:
        return self._sliced[symbol][field][-1]

    def symbols(self) -> tuple[str, ...]:
        return tuple(self._sliced)

    def fields(self, symbol: str) -> tuple[str, ...]:
        return tuple(self._sliced[symbol])
