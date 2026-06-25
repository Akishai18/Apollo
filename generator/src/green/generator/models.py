"""Generator contracts.

`GeneratedStrategy` is what every provider returns (normalized) — the strategy
source plus the metadata needed to run it through the gate. Keeping `params` as a
list of name/value-strings (rather than an open dict) makes it expressible as a
*strict* JSON schema for structured output; we coerce value strings back to
numbers when building the sweep grid.

The tier map is the **secret** part of the product: branded tier -> real model.
It lives server-side only and is never serialized to a client.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


class GenerationError(Exception):
    """Generation failed (provider error, or repair attempts exhausted)."""


class ParamSpec(BaseModel):
    model_config = ConfigDict(frozen=True)

    name: str
    values: list[str]  # stringified; coerced to int/float/str when building the grid


class GeneratedStrategy(BaseModel):
    """A provider's normalized output: a runnable Strategy + how to sweep it."""

    model_config = ConfigDict(frozen=True)

    class_name: str
    rationale: str  # short, user-facing "here's what I built and why"
    source: str  # full Python module defining exactly one Strategy subclass
    params: tuple[ParamSpec, ...] = ()

    def grid(self) -> dict[str, list[Any]]:
        """Build the sweep grid, coercing value strings to int/float where possible."""
        out: dict[str, list[Any]] = {}
        for p in self.params:
            out[p.name] = [_coerce(v) for v in p.values]
        return out


def _coerce(v: str) -> Any:
    s = v.strip()
    try:
        return int(s)
    except ValueError:
        pass
    try:
        return float(s)
    except ValueError:
        return s


# ---- Tiers: branded name -> real provider + model (SERVER-SIDE ONLY) --------

Provider = Literal["claude", "gemini", "mock"]


class TierConfig(BaseModel):
    model_config = ConfigDict(frozen=True)

    key: str  # internal tier id: free | plus | pro
    label: str  # branded, user-facing name (the only thing the client sees)
    provider: Provider
    model: str  # real model id — never sent to the client
    effort: Literal["low", "medium", "high", "xhigh", "max"] = "high"
    max_repairs: int = 2  # static-validation regeneration attempts


# Branded names are placeholders — change `label`s freely; the mapping never
# leaves the server. Free → Gemini; paid → Claude (Sonnet, then Opus).
TIERS: dict[str, TierConfig] = {
    "free": TierConfig(
        key="free",
        label="Apollo Spark",
        provider="gemini",
        model="gemini-2.5-flash",  # VERIFY against Google's current model list
        effort="low",
        max_repairs=1,
    ),
    "plus": TierConfig(
        key="plus",
        label="Apollo Core",
        provider="claude",
        model="claude-sonnet-4-6",
        effort="high",
        max_repairs=2,
    ),
    "pro": TierConfig(
        key="pro",
        label="Apollo Prime",
        provider="claude",
        model="claude-opus-4-8",
        effort="high",
        max_repairs=3,
    ),
}

# Free tier (Gemini) is the only configured provider for now; make it the
# fallback for unknown/missing tiers too. Bump to "pro" once paid keys are set.
DEFAULT_TIER = "free"


def tier_config(tier: str) -> TierConfig:
    return TIERS.get(tier, TIERS[DEFAULT_TIER])
