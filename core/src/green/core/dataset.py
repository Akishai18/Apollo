"""Dataset — the loaded, aligned time series an adapter produces and the engine
steps over. Engine-internal (a frozen dataclass, not a boundary contract).

The slicing helper `slice_at` is what makes the lookahead guarantee physical:
it produces sequences truncated to `[0, t]`, which is what the adapter hands to
a `MarketView`. Future indices simply do not exist in the result.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

type Symbol = str
type Field = str


@dataclass(frozen=True)
class Dataset:
    series: Mapping[Symbol, Mapping[Field, Sequence[float]]]

    def __post_init__(self) -> None:
        lengths = {len(vals) for fields in self.series.values() for vals in fields.values()}
        if len(lengths) > 1:
            raise ValueError("all series must have the same length")

    @property
    def symbols(self) -> tuple[Symbol, ...]:
        return tuple(self.series)

    @property
    def length(self) -> int:
        for fields in self.series.values():
            for vals in fields.values():
                return len(vals)
        return 0

    @property
    def timeline(self) -> range:
        return range(self.length)

    def price(self, symbol: Symbol, t: int, field: Field = "close") -> float:
        return self.series[symbol][field][t]

    def slice_at(self, t: int) -> dict[Symbol, dict[Field, Sequence[float]]]:
        """Series truncated to indices [0, t] — the lookahead boundary."""
        return {
            symbol: {name: vals[: t + 1] for name, vals in fields.items()}
            for symbol, fields in self.series.items()
        }

    def window(self, start: int, end: int) -> Dataset:
        """Dataset restricted to [start, end) — everything outside is physically
        absent. The walk-forward gate uses this so a training run cannot touch
        held-out data even in principle (same construction as the lookahead law).
        """
        if not (0 <= start < end <= self.length):
            raise ValueError("window bounds out of range")
        return Dataset(
            series={
                symbol: {name: vals[start:end] for name, vals in fields.items()}
                for symbol, fields in self.series.items()
            }
        )
