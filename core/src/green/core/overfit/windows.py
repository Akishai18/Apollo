"""Walk-forward windows: a rolling train segment with the held-out segment
immediately after it. The held-out data is *future* relative to training —
exactly the data a curve-fit strategy has never seen.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class Window(BaseModel):
    model_config = ConfigDict(frozen=True)

    train_start: int
    train_end: int  # exclusive; == test_start
    test_start: int
    test_end: int  # exclusive


def make_windows(
    length: int, *, train_size: int, test_size: int, step: int | None = None
) -> list[Window]:
    """Rolling windows over `[0, length)`; `step` defaults to `test_size` so the
    held-out segments tile the timeline without overlap."""
    if train_size <= 0 or test_size <= 0:
        raise ValueError("train_size and test_size must be positive")
    stride = test_size if step is None else step
    if stride <= 0:
        raise ValueError("step must be positive")

    windows: list[Window] = []
    start = 0
    while start + train_size + test_size <= length:
        split = start + train_size
        windows.append(
            Window(
                train_start=start,
                train_end=split,
                test_start=split,
                test_end=split + test_size,
            )
        )
        start += stride
    return windows
