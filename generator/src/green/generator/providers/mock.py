"""Offline provider — no network, no key. Maps a prompt to one of the real
example strategies so the whole NL → generate → validate → gate loop works in
dev and tests. Behaves like a (deterministic) model that always emits valid,
runnable, on-contract code. Replaced transparently by Claude/Gemini once a key
is set.
"""

from __future__ import annotations

import inspect

import green.strategies.buy_and_hold as buy_and_hold
import green.strategies.mean_reversion as mean_reversion
import green.strategies.moving_average_crossover as moving_average_crossover
from green.generator.models import GeneratedStrategy, ParamSpec

_MEAN_REVERSION = GeneratedStrategy(
    class_name="MeanReversion",
    rationale="Mean reversion: it buys when price stretches below its rolling average "
    "and exits on the reversion — a real edge on range-bound series.",
    source=inspect.getsource(mean_reversion),
    params=(
        ParamSpec(name="symbol", values=["SYN"]),
        ParamSpec(name="lookback", values=["10", "20"]),
        ParamSpec(name="entry_z", values=["-1.5", "-1.0"]),
        ParamSpec(name="quantity", values=["500"]),
    ),
)

_CROSSOVER = GeneratedStrategy(
    class_name="MovingAverageCrossover",
    rationale="A trend-following moving-average crossover: long while the fast SMA is "
    "above the slow SMA. Whether it survives out of sample depends on the data.",
    source=inspect.getsource(moving_average_crossover),
    params=(
        ParamSpec(name="symbol", values=["SYN"]),
        ParamSpec(name="fast", values=["10", "20"]),
        ParamSpec(name="slow", values=["40", "60"]),
        ParamSpec(name="quantity", values=["500"]),
    ),
)

_BUY_HOLD = GeneratedStrategy(
    class_name="BuyAndHold",
    rationale="Buy and hold — the baseline every real edge has to beat.",
    source=inspect.getsource(buy_and_hold),
    params=(
        ParamSpec(name="symbol", values=["SYN"]),
        ParamSpec(name="quantity", values=["500"]),
    ),
)


class MockProvider:
    def generate(
        self, prompt: str, *, model: str, effort: str, feedback: str | None = None
    ) -> GeneratedStrategy:
        p = prompt.lower()
        if any(
            k in p for k in ("momentum", "crossover", "moving average", "trend", "fast", "slow")
        ):
            return _CROSSOVER
        if "hold" in p and "buy" in p:
            return _BUY_HOLD
        return _MEAN_REVERSION  # default: mean reversion (passes on the toy series)
