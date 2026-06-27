"""High-level entry point: NL prompt + tier -> a validated GeneratedStrategy.

Picks the provider for the tier (real model when a key is set, offline mock
otherwise), generates, and runs the static-validation repair loop: on a contract
violation it feeds the errors back and regenerates, up to the tier's repair
budget. Higher tiers get a smarter model AND more repair attempts.

The result still goes through the real sandbox + overfit gate downstream — this
function only produces source; it does not decide whether the strategy is good.
"""

from __future__ import annotations

from green.generator.contract import repair_prompt
from green.generator.models import GeneratedStrategy, GenerationError, TierConfig, tier_config
from green.generator.provider import build_provider
from green.generator.validate import validate_source


def generate_validated(
    prompt: str,
    tier: str,
    *,
    anthropic_key: str | None = None,
    gemini_key: str | None = None,
    gemini_model: str | None = None,
    extra_feedback: str | None = None,
) -> tuple[GeneratedStrategy, TierConfig]:
    cfg = tier_config(tier)
    provider = build_provider(
        cfg, anthropic_key=anthropic_key, gemini_key=gemini_key, gemini_model=gemini_model
    )

    # `extra_feedback` carries a *runtime* failure from a prior attempt (e.g. the
    # generated code crashed in the sandbox) so the model can fix the bug, not
    # just static-contract violations.
    feedback: str | None = extra_feedback
    last_errors: list[str] = []
    for _ in range(cfg.max_repairs + 1):
        gen = provider.generate(prompt, model=cfg.model, effort=cfg.effort, feedback=feedback)
        last_errors = validate_source(gen.source)
        if not last_errors:
            return gen, cfg
        feedback = repair_prompt(last_errors)

    raise GenerationError(
        "couldn't produce a valid strategy after "
        f"{cfg.max_repairs + 1} attempts: {'; '.join(last_errors)}"
    )
