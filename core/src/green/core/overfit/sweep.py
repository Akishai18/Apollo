"""Parameter grid expansion — deterministic cartesian product, so sweeps (and
therefore verdicts) are reproducible run to run.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from itertools import product
from typing import Any


def expand_grid(grid: Mapping[str, Sequence[Any]]) -> list[dict[str, Any]]:
    keys = list(grid)
    if not keys:
        return [{}]
    combos = product(*(grid[key] for key in keys))
    return [dict(zip(keys, combo, strict=True)) for combo in combos]
