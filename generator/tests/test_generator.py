"""Generator tests — the offline-testable surface: the mock provider produces
valid on-contract strategies, static validation catches real violations, the
repair loop and tier mapping behave, and the secret model map never leaks a model
id through anything user-facing.
"""

from __future__ import annotations

import pytest

from green.generator import (
    DEFAULT_TIER,
    GeneratedStrategy,
    generate_validated,
    tier_config,
    validate_source,
)
from green.generator.providers.mock import MockProvider

_GOOD = """
from green.core import Order, Side, Strategy

class Probe(Strategy):
    def on_tick(self, view):
        return []
"""


def test_mock_generation_is_valid_and_runnable_shape() -> None:
    gen, cfg = generate_validated("mean reversion on SYN, buy below the average", "pro")
    assert isinstance(gen, GeneratedStrategy)
    assert gen.class_name == "MeanReversion"
    assert validate_source(gen.source) == []  # the mock always emits valid source
    grid = gen.grid()
    assert grid["symbol"] == ["SYN"]
    assert grid["lookback"] == [10, 20]  # value strings coerced to ints
    assert cfg.key == "pro"


def test_prompt_routes_to_strategy_family() -> None:
    mock = MockProvider()
    assert mock.generate("trend crossover", model="x", effort="low").class_name == (
        "MovingAverageCrossover"
    )
    assert mock.generate("buy and hold SYN", model="x", effort="low").class_name == "BuyAndHold"


def test_validate_catches_contract_violations() -> None:
    assert validate_source(_GOOD) == []

    bad_syntax = validate_source("def (oops")
    assert any("SyntaxError" in e for e in bad_syntax)

    no_class = validate_source("x = 1")
    assert any("Strategy" in e for e in no_class)

    bad_import = validate_source(
        "import os\nfrom green.core import Strategy\n"
        "class S(Strategy):\n    def on_tick(self, view):\n        return []\n"
    )
    assert any("os" in e for e in bad_import)

    bad_sma = validate_source(
        "from green.core import Strategy\n"
        "from green.core.indicators import sma\n"
        "class S(Strategy):\n"
        "    def on_tick(self, view):\n"
        "        value = sma(20)\n"
        "        return []\n"
    )
    assert any("sma() expects 2 positional arguments" in e for e in bad_sma)


def test_tier_map_and_default() -> None:
    assert tier_config("free").provider == "gemini"
    assert tier_config("plus").model == "claude-sonnet-4-6"
    assert tier_config("pro").model == "claude-opus-4-8"
    # unknown tier falls back to the default
    assert tier_config("bogus").key == tier_config(DEFAULT_TIER).key


def test_branded_label_carries_no_model_id() -> None:
    # the user-facing label must not reveal the underlying model
    for key in ("free", "plus", "pro"):
        cfg = tier_config(key)
        assert "claude" not in cfg.label.lower()
        assert "gemini" not in cfg.label.lower()
        assert "gpt" not in cfg.label.lower()


def test_repair_loop_raises_when_unfixable(monkeypatch: pytest.MonkeyPatch) -> None:
    # a provider that always emits broken source exhausts the repair budget
    class BrokenProvider:
        def generate(
            self, prompt: str, *, model: str, effort: str, feedback: str | None = None
        ) -> GeneratedStrategy:
            return GeneratedStrategy(class_name="X", rationale="", source="import os")

    def fake_build_provider(*args: object, **kwargs: object) -> BrokenProvider:
        return BrokenProvider()

    monkeypatch.setattr("green.generator.generate.build_provider", fake_build_provider)
    with pytest.raises(Exception, match="valid strategy"):
        generate_validated("anything", "pro")


def test_repair_loop_feeds_indicator_arity_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str | None] = []

    class RepairsIndicator:
        def generate(
            self, prompt: str, *, model: str, effort: str, feedback: str | None = None
        ) -> GeneratedStrategy:
            calls.append(feedback)
            if feedback is None:
                return GeneratedStrategy(
                    class_name="BrokenSma",
                    rationale="bad first draft",
                    source=(
                        "from green.core import Strategy\n"
                        "from green.core.indicators import sma\n"
                        "class BrokenSma(Strategy):\n"
                        "    def on_tick(self, view):\n"
                        "        value = sma(20)\n"
                        "        return []\n"
                    ),
                )
            return GeneratedStrategy(class_name="Probe", rationale="fixed", source=_GOOD)

    def fake_build_provider(*args: object, **kwargs: object) -> RepairsIndicator:
        return RepairsIndicator()

    monkeypatch.setattr("green.generator.generate.build_provider", fake_build_provider)

    gen, _cfg = generate_validated("moving average", "free")

    assert gen.class_name == "Probe"
    assert calls[0] is None
    assert calls[1] is not None and "sma() expects 2 positional arguments" in calls[1]
