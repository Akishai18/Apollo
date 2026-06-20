"""Gemini provider (free tier).

Lazy-imports `google-genai` so the package installs/runs without it; if the free
tier is selected without the SDK installed, it errors clearly. Uses Gemini's
structured-output (response schema) so the model returns parseable JSON. The
exact free model id is configurable — confirm against Google's current list.
"""

# The google-genai SDK is an optional, lazily-imported dependency, so its types
# are unresolved under pyright strict — that's expected for this provider.
# pyright: reportMissingImports=false, reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false, reportAttributeAccessIssue=false

from __future__ import annotations

import json
from typing import Any, cast

from green.generator.contract import SYSTEM_PROMPT
from green.generator.models import GeneratedStrategy, GenerationError

# Mirrors GeneratedStrategy (same shape as the Claude schema).
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
            },
        },
    },
    "required": ["class_name", "rationale", "source", "params"],
}


class GeminiProvider:
    def __init__(self, api_key: str) -> None:
        try:
            from google import genai  # type: ignore[import-not-found]
        except ImportError as exc:  # pragma: no cover - depends on optional dep
            raise GenerationError(
                "the free tier needs the 'google-genai' package "
                "(uv add --package green-generator google-genai)"
            ) from exc
        self._genai = genai
        self._client = genai.Client(api_key=api_key)

    def generate(
        self, prompt: str, *, model: str, effort: str, feedback: str | None = None
    ) -> GeneratedStrategy:
        user = prompt if not feedback else f"{prompt}\n\n{feedback}"
        try:
            response = self._client.models.generate_content(
                model=model,
                contents=user,
                config={
                    "system_instruction": SYSTEM_PROMPT,
                    "response_mime_type": "application/json",
                    "response_schema": _SCHEMA,
                },
            )
        except Exception as exc:  # SDK raises its own error types
            raise GenerationError(f"Gemini request failed: {exc}") from exc

        text = getattr(response, "text", None)
        if not text:
            raise GenerationError("Gemini returned no text content")
        try:
            data = cast("dict[str, Any]", json.loads(text))
            return GeneratedStrategy.model_validate(data)
        except (json.JSONDecodeError, ValueError) as exc:
            raise GenerationError(f"Gemini output did not match the schema: {exc}") from exc
