"""Recorder — accumulates per-tick run output (equity curve + fills). Phase 3
upgrades this to full metrics and trade-log artifacts.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from green.core.models import Fill


@dataclass
class Recorder:
    equity_curve: list[tuple[int, float]] = field(default_factory=list[tuple[int, float]])
    fills: list[Fill] = field(default_factory=list[Fill])

    def log(self, t: int, equity: float, fills: list[Fill]) -> None:
        self.equity_curve.append((t, equity))
        self.fills.extend(fills)
