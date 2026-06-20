"""green.generator — natural language → a green.core.Strategy subclass.

A thin, provider-swappable front-end (Claude / Gemini / offline mock). It only
produces strategy *source* + a suggested sweep grid; the source then runs through
the SAME sandbox + walk-forward overfit gate as everything else — no trust
shortcut. Depends on green-core + green-strategies (content) only.
"""

from green.generator.generate import generate_validated
from green.generator.models import (
    DEFAULT_TIER,
    TIERS,
    GeneratedStrategy,
    GenerationError,
    ParamSpec,
    TierConfig,
    tier_config,
)
from green.generator.provider import LLMProvider, build_provider
from green.generator.validate import validate_source

__all__ = [
    "DEFAULT_TIER",
    "TIERS",
    "GeneratedStrategy",
    "GenerationError",
    "LLMProvider",
    "ParamSpec",
    "TierConfig",
    "build_provider",
    "generate_validated",
    "tier_config",
    "validate_source",
]
