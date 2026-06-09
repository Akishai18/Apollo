"""Indicator correctness on known inputs, plus the window guards."""

from __future__ import annotations

import pytest

from green.core.indicators import ema, sma, zscore

_TOL = 1e-12


def test_sma_uses_only_the_last_window() -> None:
    assert sma([1.0, 2.0, 3.0, 4.0], 2) == 3.5
    assert sma([1.0, 2.0, 3.0, 4.0], 4) == 2.5


def test_ema_is_seeded_with_first_window_value() -> None:
    assert ema([5.0], 1) == 5.0
    assert ema([10.0, 10.0, 10.0], 3) == 10.0
    # window 2 -> alpha = 2/3; seed 1, then (2/3)*2 + (1/3)*1
    assert abs(ema([1.0, 2.0], 2) - 5.0 / 3.0) < _TOL


def test_zscore_flat_window_is_zero() -> None:
    assert zscore([5.0, 5.0, 5.0], 3) == 0.0


def test_zscore_known_value() -> None:
    # mean 2, population std sqrt(2/3); last value 3
    assert abs(zscore([1.0, 2.0, 3.0], 3) - 1.0 / (2.0 / 3.0) ** 0.5) < _TOL


def test_window_too_large_raises() -> None:
    for fn in (sma, ema, zscore):
        with pytest.raises(ValueError):
            fn([1.0, 2.0], 3)


def test_non_positive_window_raises() -> None:
    for fn in (sma, ema, zscore):
        with pytest.raises(ValueError):
            fn([1.0, 2.0], 0)
