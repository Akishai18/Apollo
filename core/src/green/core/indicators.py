"""Indicators — pure functions over a window of past values.

Lookahead-safe by construction: each takes a `Sequence[float]` (normally the
output of `MarketView.history`, already sliced to `[0, t]`) and returns a single
scalar computed only from the values handed in. They cannot reach past their
argument, so they cannot see the future.
"""

from __future__ import annotations

from collections.abc import Sequence


def _window(values: Sequence[float], window: int) -> Sequence[float]:
    if window <= 0:
        raise ValueError("window must be positive")
    if len(values) < window:
        raise ValueError("not enough data for window")
    return values[-window:]


def sma(values: Sequence[float], window: int) -> float:
    """Simple moving average of the last `window` values."""
    tail = _window(values, window)
    return sum(tail) / window


def ema(values: Sequence[float], window: int) -> float:
    """Exponential moving average, seeded with the first value of the window."""
    tail = _window(values, window)
    alpha = 2.0 / (window + 1)
    result = tail[0]
    for value in tail[1:]:
        result = alpha * value + (1.0 - alpha) * result
    return result


def zscore(values: Sequence[float], window: int) -> float:
    """Z-score of the latest value against the last `window` values.

    Returns 0.0 for a flat (zero-variance) window rather than dividing by zero.
    """
    tail = _window(values, window)
    mean = sum(tail) / window
    variance = sum((value - mean) ** 2 for value in tail) / window
    std = variance**0.5
    if std == 0.0:
        return 0.0
    return (tail[-1] - mean) / std
