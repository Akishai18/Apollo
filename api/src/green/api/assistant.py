"""Strategy conversation helpers.

Builder chat is distinct from generation: a question about a completed strategy
should explain the evidence and code, not regenerate code and re-run the gate.
"""

# The google-genai SDK is optional/lazy, so strict type checking cannot resolve it.
# pyright: reportMissingImports=false, reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false

from __future__ import annotations

from statistics import fmean

from green.api.models import StrategyChatRequest
from green.core import Verdict


def answer_strategy_question(
    body: StrategyChatRequest,
    *,
    gemini_key: str | None,
    gemini_model: str | None,
) -> str:
    if gemini_key:
        try:
            return _answer_with_gemini(body, api_key=gemini_key, model=gemini_model)
        except Exception:
            pass
    return _fallback_answer(body)


def _answer_with_gemini(body: StrategyChatRequest, *, api_key: str, model: str | None) -> str:
    from google import genai  # type: ignore[import-not-found]

    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model=model or "gemini-2.5-flash",
        contents=_user_context(body),
        config={
            "system_instruction": (
                "You are Apollo's strategy analyst inside an algorithmic-trading "
                "validation product. Answer the user's question about the current "
                "strategy, code, and validation evidence. Be direct and concrete. "
                "Do not pretend the strategy used real market data when the adapter "
                "says toy. Do not give financial advice or tell the user to trade; "
                "explain what the validation evidence shows and suggest testable "
                "next revisions when useful."
            )
        },
    )
    text = getattr(response, "text", None)
    if not isinstance(text, str) or not text.strip():
        return _fallback_answer(body)
    return text.strip()


def _user_context(body: StrategyChatRequest) -> str:
    return "\n\n".join(
        part
        for part in (
            f"User question:\n{body.question}",
            f"Original strategy request:\n{body.prompt}" if body.prompt else "",
            f"Generator rationale:\n{body.note}" if body.note else "",
            f"Adapter:\n{body.adapter}" if body.adapter else "",
            f"Validation verdict:\n{_verdict_summary(body.verdict)}" if body.verdict else "",
            f"Strategy source:\n```python\n{body.source}\n```",
        )
        if part
    )


def _verdict_summary(verdict: Verdict | None) -> str:
    if verdict is None:
        return "No completed verdict is available yet."
    return (
        f"passed={verdict.passed}\n"
        f"reason={verdict.reason}\n"
        f"train_sharpe={verdict.train_sharpe:.2f}\n"
        f"test_sharpe={verdict.test_sharpe:.2f}\n"
        f"retention={verdict.retention:.2f}\n"
        f"oos_trades={verdict.oos_trades}\n"
        f"windows={len(verdict.windows)}\n"
        f"window_sharpes={_window_sharpes(verdict)}"
    )


def _window_sharpes(verdict: Verdict) -> list[dict[str, float]]:
    return [
        {"train": round(window.train.sharpe, 2), "test": round(window.test.sharpe, 2)}
        for window in verdict.windows
    ]


def _fallback_answer(body: StrategyChatRequest) -> str:
    verdict = body.verdict
    if verdict is None:
        return "I need a completed preview before I can analyze this strategy."

    q = body.question.lower()
    adapter_note = (
        "\n\nImportant: this preview used the toy synthetic adapter, so the ticker name is "
        "not real market data yet. Once the market-data adapter is connected, the same "
        "question should be answered against actual candles."
        if body.adapter == "toy"
        else ""
    )

    if any(k in q for k in ("fail", "failed", "reject", "rejected", "cause", "why")):
        return (
            f"It failed because the gate did not find a durable edge: {verdict.reason}\n\n"
            f"Train Sharpe was {verdict.train_sharpe:.2f}, held-out Sharpe was "
            f"{verdict.test_sharpe:.2f}, retention was {verdict.retention:.0%}, and the "
            f"gate saw {verdict.oos_trades} held-out trades across {len(verdict.windows)} "
            "windows. Common causes for this kind of failure are late entries, whipsaw, "
            "too few clean regimes for the rule, or exits that give back gains before the "
            f"edge is confirmed.{adapter_note}"
        )

    if any(k in q for k in ("improve", "fix", "better", "profitable", "change", "try")):
        return (
            "The next useful move is a specific, testable revision: add a volatility filter, "
            "tighten entries, add a stop or time exit, widen the moving-average gap, or switch "
            f"strategy family if the series is range-bound.{adapter_note}"
        )

    oos_return = _mean([w.test.total_return for w in verdict.windows])
    max_dd = max((w.test.max_drawdown for w in verdict.windows), default=0.0)
    return (
        f"Current read: {verdict.reason}\n\n"
        f"Train Sharpe is {verdict.train_sharpe:.2f}, held-out Sharpe is "
        f"{verdict.test_sharpe:.2f}, retention is {verdict.retention:.0%}, average held-out "
        f"return is {oos_return:+.1%}, max held-out drawdown is {-max_dd:.1%}, and the gate "
        f"saw {verdict.oos_trades} held-out trades across {len(verdict.windows)} windows."
        f"{adapter_note}"
    )


def _mean(values: list[float]) -> float:
    return fmean(values) if values else 0.0
