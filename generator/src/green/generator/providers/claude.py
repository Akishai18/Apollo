"""Claude provider (Sonnet / Opus tiers).

Uses the Anthropic SDK with:
  - a cached system prompt (the big fixed strategy contract) — prefix caching
    makes every generation after the first read it at ~0.1x cost;
  - structured output (`output_config.format`, strict JSON schema) so the model
    returns a parseable GeneratedStrategy, not free-form markdown;
  - adaptive thinking + per-tier effort — code generation benefits from reasoning.

Per the Claude API guidance: adaptive thinking only (no budget_tokens), no
sampling params, exact model id strings.
"""

from __future__ import annotations

import json
from typing import Any, cast

import anthropic

from green.generator.contract import SYSTEM_PROMPT
from green.generator.models import GeneratedStrategy, GenerationError

# Strict JSON schema mirroring GeneratedStrategy (params as name/value-strings so
# the whole thing is strictly schema-able — no open dicts).
_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "class_name": {"type": "string"},
        "rationale": {"type": "string"},
        "source": {"type": "string"},
        "params": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "values": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["name", "values"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["class_name", "rationale", "source", "params"],
    "additionalProperties": False,
}


class ClaudeProvider:
    def __init__(self, api_key: str) -> None:
        self._client = anthropic.Anthropic(api_key=api_key)

    def generate(
        self, prompt: str, *, model: str, effort: str, feedback: str | None = None
    ) -> GeneratedStrategy:
        user = prompt if not feedback else f"{prompt}\n\n{feedback}"
        try:
            response = self._client.messages.create(
                model=model,
                max_tokens=8000,
                thinking={"type": "adaptive"},
                system=[
                    {
                        "type": "text",
                        "text": SYSTEM_PROMPT,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                output_config=cast(
                    "Any",
                    {"effort": effort, "format": {"type": "json_schema", "schema": _SCHEMA}},
                ),
                messages=[{"role": "user", "content": user}],
            )
        except anthropic.AnthropicError as exc:  # network, auth, rate limit, ...
            raise GenerationError(f"Claude request failed: {exc}") from exc

        text = next((b.text for b in response.content if b.type == "text"), None)
        if not text:
            raise GenerationError("Claude returned no text content")
        try:
            data = cast("dict[str, Any]", json.loads(text))
            return GeneratedStrategy.model_validate(data)
        except (json.JSONDecodeError, ValueError) as exc:
            raise GenerationError(f"Claude output did not match the schema: {exc}") from exc
