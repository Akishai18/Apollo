"""The headline guarantee, property-tested: a MarketView built at `t` can never
expose data from any index > t.

We use a ramp dataset where value == index, so any future leak is detectable as
a value greater than `t`. Hypothesis searches across lengths and timesteps.
"""

from __future__ import annotations

import pytest
from hypothesis import given
from hypothesis import strategies as st

from green.adapters import ToyAdapter
from green.core.dataset import Dataset


def _ramp(n: int) -> Dataset:
    return Dataset(series={"R": {"close": tuple(float(i) for i in range(n))}})


@given(data=st.data())
def test_view_never_exposes_the_future(data: st.DataObject) -> None:
    n = data.draw(st.integers(min_value=1, max_value=200))
    t = data.draw(st.integers(min_value=0, max_value=n - 1))

    view = ToyAdapter().make_view(_ramp(n), t)

    assert view.now == t
    assert view.last("R", "close") == float(t)

    window = view.history("R", "close", n + 10)  # ask for more than exists
    assert len(window) == t + 1  # only [0, t] exists
    assert max(window) == float(t)  # never an index > t
    assert min(window) == 0.0

    # The data is physically bounded: index t+1 is not in the object.
    with pytest.raises(IndexError):
        _ = window[t + 1]
