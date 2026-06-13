"""green.core.overfit — the walk-forward overfit gate (differentiator #2).

Strategies are vetted by how their edge survives data their parameter selection
never saw. The gate's output is a `Verdict`: pass/reject plus a legible reason
and per-window evidence.
"""

from green.core.overfit.gate import (
    SweepPoint,
    Verdict,
    WalkForwardProgress,
    WindowResult,
    run_walk_forward,
)
from green.core.overfit.sweep import expand_grid
from green.core.overfit.windows import Window, make_windows

__all__ = [
    "SweepPoint",
    "Verdict",
    "WalkForwardProgress",
    "Window",
    "WindowResult",
    "expand_grid",
    "make_windows",
    "run_walk_forward",
]
