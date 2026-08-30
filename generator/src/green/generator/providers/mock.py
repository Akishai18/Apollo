"""Offline provider — no network, no key. Maps a prompt to one of the real
example strategies so the whole NL → generate → validate → gate loop works in
dev and tests. Behaves like a (deterministic) model that always emits valid,
runnable, on-contract code. Replaced transparently by Claude/Gemini once a key
is set.
"""

from __future__ import annotations

import inspect
import re

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

# Mirrors api/jobs.py: words/acronyms that scan as tickers but aren't.
_SYMBOL_STOPWORDS = frozenset(
    {
        "A",
        "AN",
        "AND",
        "AS",
        "AT",
        "BE",
        "BY",
        "DO",
        "FOR",
        "GO",
        "IF",
        "IN",
        "IS",
        "IT",
        "ME",
        "MY",
        "NO",
        "OF",
        "ON",
        "OR",
        "SO",
        "TO",
        "UP",
        "US",
        "WE",
        "THE",
        "WHEN",
        "WITH",
        "THAT",
        "THIS",
        "FROM",
        "INTO",
        "OVER",
        "THEN",
        "BUY",
        "SELL",
        "EXIT",
        "HOLD",
        "LONG",
        "SHORT",
        "FAST",
        "SLOW",
        "MEAN",
        "STOCK",
        "STOCKS",
        "SHARE",
        "SHARES",
        "EQUITY",
        "PRICE",
        "TREND",
        "CROSS",
        "BAND",
        "STOP",
        "RISK",
        "PROFIT",
        "LOSS",
        "TRADE",
        "TRADES",
        "BUILD",
        "STRATEGY",
        "AROUND",
        "MAXIMIZE",
        "MARKET",
        "DAILY",
        "WEEKLY",
        "AVERAGE",
        "MA",
        "SMA",
        "EMA",
        "WMA",
        "RSI",
        "ATR",
        "MACD",
        "VWAP",
        "ADX",
        "BB",
        "OHLC",
        "PNL",
        "ROI",
        "ETF",
        "AI",
        "ML",
    }
)

_TICKER = r"[A-Za-z][A-Za-z.\-]{0,5}"
_BEFORE_NOUN = re.compile(rf"\b({_TICKER})\s+(?:stock|shares?|equity|etf|index)\b", re.IGNORECASE)
_AFTER_KEYWORD = re.compile(rf"\b(?:ticker|symbol|on|trade|trading)\s+({_TICKER})\b", re.IGNORECASE)
_UPPER_TOKEN = re.compile(r"\b[A-Z][A-Z0-9.\-]{1,5}\b")


def _plausible_symbol(candidate: str) -> bool:
    if candidate in _SYMBOL_STOPWORDS:
        return False
    return bool(re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,5}", candidate))


def _prompt_symbol(prompt: str) -> str | None:
    for pattern in (_BEFORE_NOUN, _AFTER_KEYWORD):
        for m in pattern.finditer(prompt):
            c = m.group(1).upper()
            if _plausible_symbol(c):
                return c
    for token in _UPPER_TOKEN.findall(prompt):
        if _plausible_symbol(token):
            return token
    return None


def _with_prompt_symbol(strategy: GeneratedStrategy, prompt: str) -> GeneratedStrategy:
    symbol = _prompt_symbol(prompt)
    if symbol is None:
        return strategy
    params = tuple(
        ParamSpec(name=p.name, values=[symbol] if p.name == "symbol" else p.values)
        for p in strategy.params
    )
    return strategy.model_copy(update={"params": params})


class MockProvider:
    def generate(
        self, prompt: str, *, model: str, effort: str, feedback: str | None = None
    ) -> GeneratedStrategy:
        p = prompt.lower()
        if any(
            k in p for k in ("momentum", "crossover", "moving average", "trend", "fast", "slow")
        ):
            return _with_prompt_symbol(_CROSSOVER, prompt)
        if "hold" in p and "buy" in p:
            return _with_prompt_symbol(_BUY_HOLD, prompt)
        return _with_prompt_symbol(
            _MEAN_REVERSION, prompt
        )  # default: mean reversion (passes on the toy series)
