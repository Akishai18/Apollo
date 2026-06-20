"""The provider seam: one interface, swappable backends (Claude / Gemini / mock).

Selecting a provider from a tier + available keys is the only place the secret
tier→model mapping is consulted. With no key for a tier's real provider, we fall
back to the offline `MockProvider` so the whole product works in dev and goes
live the moment a key is configured.
"""

from __future__ import annotations

from typing import Protocol

from green.generator.models import GeneratedStrategy, TierConfig
from green.generator.providers.mock import MockProvider


class LLMProvider(Protocol):
    def generate(
        self, prompt: str, *, model: str, effort: str, feedback: str | None = None
    ) -> GeneratedStrategy: ...


def build_provider(
    cfg: TierConfig,
    *,
    anthropic_key: str | None = None,
    gemini_key: str | None = None,
    gemini_model: str | None = None,
) -> LLMProvider:
    if cfg.provider == "claude" and anthropic_key:
        from green.generator.providers.claude import ClaudeProvider

        return ClaudeProvider(anthropic_key)
    if cfg.provider == "gemini" and gemini_key:
        from green.generator.providers.gemini import GeminiProvider

        return GeminiProvider(gemini_key)
    # No key (or provider == "mock") → offline mock so dev works end-to-end.
    return MockProvider()
