"""The API end to end, in-process (Starlette TestClient — real HTTP + WebSocket,
no server). Submit untrusted source → the gate runs it sandboxed → poll the
verdict, or stream per-window progress live. Bad configs and hostile strategies
surface as clean, typed run errors, never as a 500 or a hang.
"""

from __future__ import annotations

import asyncio
import inspect
import time
from collections.abc import Callable, Iterator
from typing import Any, cast

import httpx
import polars as pl
import pytest
from fastapi.testclient import TestClient

import green.strategies.mean_reversion
from green.api import AdapterSpec, InMemoryRunStore, RunRequest, Settings, create_app
from green.api.jobs import JobRunner

MEAN_REVERSION_SOURCE = inspect.getsource(green.strategies.mean_reversion)

# Small but real: OU toy series, two windows, a 2-point grid → a few sandboxed
# runs, fast enough for a test, enough to produce a genuine verdict.
_BASE_REQUEST: dict[str, Any] = {
    "source": MEAN_REVERSION_SOURCE,
    "grid": {"symbol": ["SYN"], "lookback": [10, 20], "quantity": [10]},
    "adapter": {"name": "toy", "params": {"n_steps": 120, "mu": 100.0, "seed": 7}},
    "train_size": 60,
    "test_size": 30,
}


@pytest.fixture
def client() -> Iterator[TestClient]:
    # Context-manager form keeps the portal event loop alive across requests, so
    # the background job actually progresses while the test polls.
    with TestClient(create_app()) as test_client:
        yield test_client


def _json(response: httpx.Response) -> dict[str, Any]:
    return cast("dict[str, Any]", response.json())


def _json_list(response: httpx.Response) -> list[dict[str, Any]]:
    return cast("list[dict[str, Any]]", response.json())


def _headers(token: str | None) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"} if token else {}


def _post(
    client: httpx.Client, path: str, payload: dict[str, Any], token: str | None = None
) -> httpx.Response:
    # Typed as httpx.Client (TestClient's base) so pyright sees the typed method
    # signatures rather than Starlette's untyped overrides.
    return client.post(path, json=payload, headers=_headers(token))


def _get(client: httpx.Client, path: str, token: str | None = None) -> httpx.Response:
    return client.get(path, headers=_headers(token))


def _patch(
    client: httpx.Client, path: str, payload: dict[str, Any], token: str | None = None
) -> httpx.Response:
    return client.patch(path, json=payload, headers=_headers(token))


def _get_raw(client: httpx.Client, path: str, headers: dict[str, str]) -> httpx.Response:
    return client.get(path, headers=headers)


def _wait_for_terminal(client: TestClient, run_id: str, timeout: float = 30.0) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        body = _json(_get(client, f"/runs/{run_id}"))
        if body["state"] in ("completed", "error"):
            return body
        time.sleep(0.05)
    raise AssertionError("run did not reach a terminal state in time")


def test_healthz(client: TestClient) -> None:
    assert _json(_get(client, "/healthz")) == {"status": "ok"}


def test_templates_are_runnable_end_to_end(client: TestClient) -> None:
    """The frontend's starting points: GET /templates returns ready RunRequests,
    and submitting one runs the real gate to a verdict (the wiring contract)."""
    templates = _json_list(_get(client, "/templates"))
    keys = {t["id"] if "id" in t else t["key"] for t in templates}
    assert {"mean-reversion", "crossover"} <= keys

    mr = next(t for t in templates if t["key"] == "mean-reversion")
    request = cast("dict[str, Any]", mr["request"])
    run_id = cast("str", _json(_post(client, "/runs", request))["id"])

    final = _wait_for_terminal(client, run_id)
    assert final["state"] == "completed"
    verdict = final["verdict"]
    assert verdict is not None
    assert verdict["passed"] is True  # mean-reversion holds up on the toy OU series
    assert len(verdict["windows"]) == 4


def test_submit_runs_the_gate_sandboxed_and_returns_a_verdict(client: TestClient) -> None:
    submit = _post(client, "/runs", _BASE_REQUEST)
    assert submit.status_code == 202
    body = _json(submit)
    run_id = cast("str", body["id"])
    assert body["state"] == "queued"
    assert body["run_kind"] == "backtest"

    final = _wait_for_terminal(client, run_id)
    assert final["state"] == "completed"
    verdict = final["verdict"]
    assert verdict is not None
    assert isinstance(verdict["passed"], bool)
    assert verdict["reason"]  # always legible
    assert len(verdict["windows"]) == 2  # 120 bars, train 60 / test 30 → 2 windows
    # Equity curves reach the API for the web charts: one point per bar per slice.
    window = verdict["windows"][0]
    assert len(window["train_equity"]) == 60
    assert len(window["test_equity"]) == 30


def test_strategy_draft_version_and_version_runs(client: TestClient) -> None:
    strategy = _json(
        _post(client, "/strategies", {"title": "SYN mean reversion", "description": "toy lab"})
    )
    strategy_id = cast("str", strategy["id"])

    draft_body = {
        "prompt": "mean reversion on SYN",
        "source": MEAN_REVERSION_SOURCE,
        "class_name": "MeanReversion",
        "grid": {"symbol": ["SYN"], "lookback": [10], "quantity": [10]},
        "adapter": {"name": "toy", "params": {"n_steps": 90, "mu": 100.0, "seed": 7}},
        "train_size": 40,
        "test_size": 25,
    }
    draft = _json(_post(client, f"/strategies/{strategy_id}/drafts", draft_body))
    assert draft["strategy_id"] == strategy_id

    patched = _json(_patch(client, f"/drafts/{draft['id']}", {"assumptions": ["toy OU data"]}))
    assert patched["assumptions"] == ["toy OU data"]

    version = _json(_post(client, f"/drafts/{draft['id']}/versions", {}))
    version_id = cast("str", version["id"])
    assert version["version_number"] == 1

    submitted = _json(_post(client, f"/versions/{version_id}/backtest", {}))
    run_id = cast("str", submitted["id"])
    assert submitted["run_kind"] == "backtest"
    assert submitted["strategy_id"] == strategy_id
    assert submitted["strategy_version_id"] == version_id

    final = _wait_for_terminal(client, run_id)
    assert final["state"] == "completed"
    assert final["strategy_id"] == strategy_id
    assert final["strategy_version_id"] == version_id

    validation = _json(_post(client, f"/versions/{version_id}/validate", {}))
    assert validation["run_kind"] == "validation"
    assert validation["strategy_id"] == strategy_id

    detail = _json(_get(client, f"/strategies/{strategy_id}"))
    assert detail["strategy"]["title"] == "SYN mean reversion"
    assert len(detail["drafts"]) == 1
    assert len(detail["versions"]) == 1
    assert any(r["id"] == run_id for r in detail["runs"])

    rows = _json_list(_get(client, "/strategies"))
    row = next(r for r in rows if r["id"] == strategy_id)
    assert row["versions_count"] == 1
    assert row["runs_count"] >= 2
    assert row["latest_run"]["strategy_id"] == strategy_id


def test_completed_backtest_can_be_promoted_to_validation(client: TestClient) -> None:
    run_id = cast("str", _json(_post(client, "/runs", _BASE_REQUEST))["id"])
    _wait_for_terminal(client, run_id)

    promoted = _json(_post(client, f"/runs/{run_id}/validate", {}))
    validation_id = cast("str", promoted["id"])
    assert promoted["run_kind"] == "validation"
    assert validation_id != run_id

    final = _wait_for_terminal(client, validation_id)
    assert final["state"] == "completed"
    assert final["run_kind"] == "validation"
    assert final["source"] == MEAN_REVERSION_SOURCE

    rows = _json_list(_get(client, "/runs"))
    by_id = {r["id"]: r for r in rows}
    assert by_id[run_id]["run_kind"] == "backtest"
    assert by_id[validation_id]["run_kind"] == "validation"


def test_promote_then_revalidate_runs_promoted_strategies(client: TestClient) -> None:
    """Promote a strategy → scheduled re-validation re-runs its latest version; demote
    → nothing re-runs. This is the decay-monitoring loop."""
    created = _post(client, "/strategies", {"title": "Champ", "description": ""})
    sid = cast("str", _json(created)["id"])
    draft_body = {
        "prompt": "mean reversion on SYN",
        "source": MEAN_REVERSION_SOURCE,
        "class_name": "MeanReversion",
        "grid": {"symbol": ["SYN"], "lookback": [10], "quantity": [10]},
        "adapter": {"name": "toy", "params": {"n_steps": 90, "mu": 100.0, "seed": 7}},
        "train_size": 40,
        "test_size": 25,
    }
    draft = _json(_post(client, f"/strategies/{sid}/drafts", draft_body))
    _json(_post(client, f"/drafts/{draft['id']}/versions", {}))

    assert _json(_post(client, f"/strategies/{sid}/promote", {}))["promoted"] is True
    rows = _json_list(_get(client, "/strategies"))
    assert next(r for r in rows if r["id"] == sid)["promoted"] is True

    revalidated = _json(_post(client, "/maintenance/revalidate", {}))
    assert revalidated["count"] >= 1
    run_id = cast("str", revalidated["run_ids"][0])
    final = _wait_for_terminal(client, run_id)
    assert final["state"] == "completed"
    assert final["run_kind"] == "validation"

    assert _json(_post(client, f"/strategies/{sid}/demote", {}))["promoted"] is False
    assert _json(_post(client, "/maintenance/revalidate", {}))["count"] == 0


def test_decay_alerts_flag_promoted_strategies_below_threshold(client: TestClient) -> None:
    """A promoted strategy with a completed validation is flagged when its held-out
    Sharpe falls under the threshold; a generous threshold flags nothing."""
    created = _post(client, "/strategies", {"title": "Decayer", "description": ""})
    sid = cast("str", _json(created)["id"])
    draft = _json(
        _post(
            client,
            f"/strategies/{sid}/drafts",
            {
                "source": MEAN_REVERSION_SOURCE,
                "class_name": "MeanReversion",
                "grid": {"symbol": ["SYN"], "lookback": [10], "quantity": [10]},
                "adapter": {"name": "toy", "params": {"n_steps": 90, "mu": 100.0, "seed": 7}},
                "train_size": 40,
                "test_size": 25,
            },
        )
    )
    version = _json(_post(client, f"/drafts/{draft['id']}/versions", {}))
    _post(client, f"/strategies/{sid}/promote", {})
    validation = _post(client, f"/versions/{version['id']}/validate", {})
    _wait_for_terminal(client, cast("str", _json(validation)["id"]))

    # impossibly high bar → flagged
    flagged = _json_list(_get(client, "/maintenance/alerts?min_oos_sharpe=999"))
    assert any(a["strategy_id"] == sid for a in flagged)
    # forgiving bar → not flagged
    clear = _json_list(_get(client, "/maintenance/alerts?min_oos_sharpe=-999"))
    assert not any(a["strategy_id"] == sid for a in clear)


def test_experiments_runs_empty_without_tracking(client: TestClient) -> None:
    # tracking off in tests → clean empty list, never a 500
    assert _json_list(_get(client, "/experiments/runs")) == []


def test_list_returns_lean_summaries_not_full_verdicts(client: TestClient) -> None:
    run_id = cast("str", _json(_post(client, "/runs", _BASE_REQUEST))["id"])
    _wait_for_terminal(client, run_id)

    rows = _json_list(_get(client, "/runs"))
    assert len(rows) == 1
    row = rows[0]
    assert row["id"] == run_id
    assert row["state"] == "completed"
    assert isinstance(row["passed"], bool)  # summarized from the verdict
    assert row["reason"]
    assert row["created_at"]  # timestamps for sorting in the UI
    # The heavy fields (full verdict, per-window sweeps + equity) are NOT in a row.
    assert "verdict" not in row
    assert "windows" not in row


def test_cors_allows_the_frontend_origin(client: TestClient) -> None:
    origin = "http://localhost:3000"
    response = _get_raw(client, "/healthz", {"Origin": origin})
    assert response.headers.get("access-control-allow-origin") == origin


def test_websocket_streams_progress_then_the_verdict(client: TestClient) -> None:
    run_id = cast("str", _json(_post(client, "/runs", _BASE_REQUEST))["id"])

    progress_totals: list[int] = []
    final: dict[str, Any] | None = None
    with client.websocket_connect(f"/runs/{run_id}/ws") as ws:
        while True:
            msg = cast("dict[str, Any]", ws.receive_json())
            if msg["progress"] is not None:
                progress_totals.append(msg["progress"]["completed"])
            if msg["state"] in ("completed", "error"):
                final = msg
                break

    assert final is not None and final["state"] == "completed"
    assert final["verdict"] is not None
    # Per-window progress was actually streamed, in order, before the verdict.
    assert progress_totals == sorted(progress_totals)
    assert progress_totals[-1] == 2  # both windows reported


def test_generate_runs_through_the_same_gate_to_a_verdict(client: TestClient) -> None:
    """A natural-language submission generates a strategy (offline: the mock
    provider, since no API key is set) and runs it through the SAME gate — no
    trust shortcut. The generator's rationale surfaces as `note`."""
    submit = _post(client, "/generate", {"prompt": "mean reversion on SYN", "tier": "pro"})
    assert submit.status_code == 202
    body = _json(submit)
    run_id = cast("str", body["id"])

    final = _wait_for_terminal(client, run_id)
    assert final["state"] == "completed"
    assert final["verdict"] is not None
    assert isinstance(final["verdict"]["passed"], bool)
    assert final["note"]  # the generator's rationale reached the API


def test_generate_streams_to_completion_with_rationale_over_ws(client: TestClient) -> None:
    # The offline mock generates instantly, so the `generating` snapshot may be
    # coalesced before a subscriber attaches (real model calls take seconds and
    # the phase is plainly observable). What's deterministic: the stream reaches a
    # verdict and the generator's rationale rides along.
    submit = _json(_post(client, "/generate", {"prompt": "buy and hold SYN", "tier": "free"}))
    run_id = cast("str", submit["id"])

    final: dict[str, Any] | None = None
    with client.websocket_connect(f"/runs/{run_id}/ws") as ws:
        while True:
            msg = cast("dict[str, Any]", ws.receive_json())
            if msg["state"] in ("completed", "error"):
                final = msg
                break

    assert final is not None and final["state"] == "completed"
    assert final["verdict"] is not None
    assert final["note"]  # the rationale streamed through to the client


def test_generate_persists_prompt_and_generated_source(client: TestClient) -> None:
    """The detail view can reconstruct a run: the original NL prompt, the code
    Apollo actually generated (not the placeholder), and a title for lists."""
    prompt = "mean reversion on SYN, fade moves away from the average"
    submit = _post(client, "/generate", {"prompt": prompt, "tier": "free"})
    run_id = cast("str", _json(submit)["id"])
    final = _wait_for_terminal(client, run_id)

    assert final["state"] == "completed"
    assert final["prompt"] == prompt
    assert final["source"] and "pending generation" not in final["source"]
    assert "Strategy" in final["source"]  # real strategy code reached the detail view

    rows = _json_list(_get(client, "/runs"))
    row = next(r for r in rows if r["id"] == run_id)
    assert row["title"] == prompt[:47] + "…"  # truncated prompt as the list label


def test_generate_refinement_uses_context_without_replacing_visible_prompt(
    client: TestClient,
) -> None:
    prompt = "make the entries stricter and reduce drawdown"
    submit = _post(
        client,
        "/generate",
        {
            "prompt": prompt,
            "tier": "free",
            "context": {
                "prompt": "mean reversion on SYN",
                "note": "Buy stretched moves and exit at the mean.",
                "source": MEAN_REVERSION_SOURCE,
            },
        },
    )
    run_id = cast("str", _json(submit)["id"])
    final = _wait_for_terminal(client, run_id)

    assert final["state"] == "completed"
    assert final["prompt"] == prompt
    assert "Existing strategy source" not in final["prompt"]

    rows = _json_list(_get(client, "/runs"))
    row = next(r for r in rows if r["id"] == run_id)
    assert row["title"] == prompt


def test_generated_real_symbol_preview_uses_market_data(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fake_yahoo(
        symbols: tuple[str, ...],
        *,
        start: str | None,
        end: str | None,
        period: str,
        interval: str,
        auto_adjust: bool,
    ) -> pl.DataFrame:
        assert symbols == ("SLS",)
        assert period == "2y"
        rows = 260
        return pl.DataFrame(
            {
                "t": list(range(rows)),
                "date": [f"2024-01-{(i % 28) + 1:02d}" for i in range(rows)],
                "symbol": ["SLS"] * rows,
                "open": [10.0 + i * 0.01 for i in range(rows)],
                "high": [10.5 + i * 0.01 for i in range(rows)],
                "low": [9.5 + i * 0.01 for i in range(rows)],
                "close": [10.1 + i * 0.01 for i in range(rows)],
                "volume": [1000.0] * rows,
            }
        )

    monkeypatch.setattr("green.adapters.market_data._fetch_yahoo", fake_yahoo)
    prompt = "mean reversion on SLS, buy below the rolling average and exit at the mean"
    submit = _post(client, "/generate", {"prompt": prompt, "tier": "free"})
    run_id = cast("str", _json(submit)["id"])
    final = _wait_for_terminal(client, run_id)

    assert final["state"] == "completed"
    assert final["symbol"] == "SLS"
    assert final["adapter"] == "market_data"
    assert final["train_size"] == 120
    assert final["test_size"] == 60
    assert final["verdict"]["windows"][0]["train_dates"]


def test_generation_never_errors_when_market_data_unavailable(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Iron-tight chat: a prompt whose ticker can't be loaded (typo, delisted, no
    rows) must still return a verdict on the synthetic series — never a hard error."""

    def no_rows(*_args: object, **_kwargs: object) -> pl.DataFrame:
        raise ValueError("Yahoo returned no rows for ZZZZ")

    monkeypatch.setattr("green.adapters.market_data._fetch_yahoo", no_rows)
    prompt = "build a strategy around the zzzz stock to maximize profit"
    submit = _post(client, "/generate", {"prompt": prompt, "tier": "free"})
    run_id = cast("str", _json(submit)["id"])
    final = _wait_for_terminal(client, run_id)

    assert final["state"] == "completed"  # fell back to synthetic, did not error
    assert final["verdict"] is not None
    assert final["error"] is None


# A generated strategy that passes static validation but crashes at runtime
# (len() on a float), and a clean one that runs.
_CRASHING_SRC = (
    "from green.core import Strategy\n"
    "class Boom(Strategy):\n"
    "    def on_tick(self, view):\n"
    "        return len(1.0)\n"
)
_CLEAN_SRC = (
    "from green.core import Strategy\n"
    "class Ok(Strategy):\n"
    "    def on_tick(self, view):\n"
    "        return []\n"
)


def _fake_gen(source: str):  # type: ignore[no-untyped-def]
    from green.generator import GeneratedStrategy, tier_config
    from green.generator.models import ParamSpec

    def gen(_prompt: str, _tier: str, **_kw: object):  # type: ignore[no-untyped-def]
        strat = GeneratedStrategy(
            class_name="",
            rationale="r",
            source=source,
            params=[ParamSpec(name="symbol", values=["SYN"])],
        )
        return strat, tier_config("free")

    return gen


def _gen_run(client: TestClient, prompt: str = "a simple strategy") -> dict[str, Any]:
    submit = _post(client, "/generate", {"prompt": prompt, "tier": "free"})
    return _wait_for_terminal(client, cast("str", _json(submit)["id"]))


def test_generation_repairs_a_strategy_that_crashes_at_runtime(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Generated code that crashes in the sandbox is regenerated (crash fed back),
    not surfaced as a traceback — the run completes once a working version lands."""
    calls = {"n": 0}
    crash_gen = _fake_gen(_CRASHING_SRC)
    clean_gen = _fake_gen(_CLEAN_SRC)

    def flaky(prompt: str, tier: str, **kw: object):  # type: ignore[no-untyped-def]
        calls["n"] += 1
        return (crash_gen if calls["n"] == 1 else clean_gen)(prompt, tier, **kw)

    monkeypatch.setattr("green.api.jobs.generate_validated", flaky)
    final = _gen_run(client)

    assert final["state"] == "completed"  # repaired, no traceback
    assert calls["n"] >= 2  # regenerated after the crash


def test_generation_gives_clean_message_when_unrepairable(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """If every attempt crashes, the user gets a friendly message — never a raw traceback."""
    monkeypatch.setattr("green.api.jobs.generate_validated", _fake_gen(_CRASHING_SRC))
    final = _gen_run(client)

    assert final["state"] == "error"
    assert "working strategy" in (final["error"] or "")
    assert "Traceback" not in (final["error"] or "")


def test_completed_run_is_logged_to_mlflow(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When tracking is configured, a finished backtest is logged to MLflow with
    its OOS metrics. (We stub MLflow's I/O — the point is our wiring, not MLflow's
    storage; and logging is best-effort so it never breaks a run.)"""
    import mlflow

    captured: dict[str, float] = {}

    class _Ctx:
        def __enter__(self) -> _Ctx:
            return self

        def __exit__(self, *_a: object) -> bool:
            return False

    monkeypatch.setenv("GREEN_MLFLOW_TRACKING_URI", "stub")
    monkeypatch.setattr(mlflow, "set_tracking_uri", lambda *_a, **_k: None)
    monkeypatch.setattr(mlflow, "set_experiment", lambda *_a, **_k: None)
    monkeypatch.setattr(mlflow, "start_run", lambda *_a, **_k: _Ctx())
    monkeypatch.setattr(mlflow, "set_tags", lambda *_a, **_k: None)
    monkeypatch.setattr(mlflow, "log_params", lambda *_a, **_k: None)
    monkeypatch.setattr(mlflow, "log_text", lambda *_a, **_k: None)
    monkeypatch.setattr(mlflow, "log_metrics", lambda metrics: captured.update(metrics))

    final = _gen_run(client, "mean reversion strategy")
    assert final["state"] == "completed"

    for _ in range(50):  # logging fires just after COMPLETED, on a worker thread
        if captured:
            break
        time.sleep(0.05)

    assert "oos_sharpe" in captured and "retention" in captured and "passed" in captured


def test_strategy_assistant_answers_without_starting_a_run(client: TestClient) -> None:
    run_id = cast("str", _json(_post(client, "/runs", _BASE_REQUEST))["id"])
    final = _wait_for_terminal(client, run_id)
    before = _json_list(_get(client, "/runs"))

    answer = _json(
        _post(
            client,
            "/assistant/strategy",
            {
                "question": "what causes this strategy to fail?",
                "source": final["source"],
                "prompt": "mean reversion on SYN",
                "verdict": final["verdict"],
                "adapter": final["adapter"],
            },
        )
    )

    assert answer["answer"]
    assert "Sharpe" in answer["answer"]
    after = _json_list(_get(client, "/runs"))
    assert [row["id"] for row in after] == [row["id"] for row in before]


def test_generated_preview_creates_strategy_and_promotes_to_formal_validation(
    client: TestClient,
) -> None:
    prompt = "mean reversion on SYN, buy below the rolling average and exit at the mean"
    submit = _post(client, "/generate", {"prompt": prompt, "tier": "free"})
    run_id = cast("str", _json(submit)["id"])

    preview = _wait_for_terminal(client, run_id)
    strategy_id = cast("str", preview["strategy_id"])
    version_id = cast("str", preview["strategy_version_id"])
    assert preview["state"] == "completed"
    assert preview["run_kind"] == "backtest"
    assert preview["train_size"] == 80
    assert preview["test_size"] == 50
    assert preview["progress"] == {"completed": 2, "total": 2}
    assert strategy_id
    assert version_id

    detail = _json(_get(client, f"/strategies/{strategy_id}"))
    assert detail["strategy"]["title"] == prompt
    assert len(detail["drafts"]) == 1
    assert len(detail["versions"]) == 1
    draft = detail["drafts"][0]
    assert draft["prompt"] == prompt
    # The preview run caps the grid for speed; the saved draft/version keeps the
    # full generated grid so formal validation can do real parameter selection.
    assert draft["grid"]["lookback"] == [10, 20]
    assert draft["grid"]["entry_z"] == [-1.5, -1.0]

    promoted = _json(_post(client, f"/runs/{run_id}/validate", {}))
    validation_id = cast("str", promoted["id"])
    assert promoted["run_kind"] == "validation"
    assert promoted["strategy_id"] == strategy_id
    assert promoted["strategy_version_id"] == version_id
    assert promoted["train_size"] == 200
    assert promoted["test_size"] == 100

    validation = _wait_for_terminal(client, validation_id)
    assert validation["state"] == "completed"
    assert validation["run_kind"] == "validation"
    assert validation["train_size"] == 200
    assert validation["test_size"] == 100
    assert validation["strategy_id"] == strategy_id
    assert validation["strategy_version_id"] == version_id
    assert validation["prompt"] == prompt
    assert len(validation["verdict"]["windows"]) == 4

    rows = _json_list(_get(client, "/strategies"))
    row = next(r for r in rows if r["id"] == strategy_id)
    assert row["latest_validation"]["id"] == validation_id
    assert row["runs_count"] == 2


def test_generate_rejects_empty_prompt(client: TestClient) -> None:
    assert _post(client, "/generate", {"prompt": "", "tier": "pro"}).status_code == 422


def test_get_unknown_run_is_404(client: TestClient) -> None:
    assert _get(client, "/runs/does-not-exist").status_code == 404


def test_bad_adapter_params_become_a_clean_run_error(client: TestClient) -> None:
    bad = {**_BASE_REQUEST, "adapter": {"name": "toy", "params": {"not_a_param": 1}}}
    run_id = cast("str", _json(_post(client, "/runs", bad))["id"])
    body = _wait_for_terminal(client, run_id)
    assert body["state"] == "error"
    assert "invalid params" in body["error"]
    assert body["verdict"] is None


def test_hostile_strategy_is_contained_and_surfaces_as_run_error(client: TestClient) -> None:
    """A strategy that tries to open a file dies in the sandbox; the API reports
    a run error with a legible message instead of crashing or hanging."""
    hostile = {
        **_BASE_REQUEST,
        "source": (
            "from green.core import Strategy\n"
            "class Thief(Strategy):\n"
            "    def on_tick(self, view):\n"
            "        open('loot.txt', 'w').write('x')\n"
            "        return []\n"
        ),
        "grid": {"symbol": ["SYN"]},
    }
    run_id = cast("str", _json(_post(client, "/runs", hostile))["id"])
    body = _wait_for_terminal(client, run_id)
    assert body["state"] == "error"
    assert body["error"]  # populated and legible
    assert body["verdict"] is None


def test_invalid_request_is_422(client: TestClient) -> None:
    # Missing required fields (source, grid, window sizes) → validation error.
    assert _post(client, "/runs", {"source": ""}).status_code == 422


def test_early_websocket_disconnect_drops_the_subscriber() -> None:
    """A client that connects and immediately leaves must not be left registered
    as a subscriber (which would leak and keep receiving puts)."""
    app = create_app()
    runner = cast("JobRunner", app.state.runner)
    with TestClient(app) as client:
        run_id = cast("str", _json(_post(client, "/runs", _BASE_REQUEST))["id"])
        with client.websocket_connect(f"/runs/{run_id}/ws") as ws:
            ws.receive_json()  # take the first snapshot, then bail out of the context

        job = runner._jobs[run_id]  # pyright: ignore[reportPrivateUsage]
        # Give the server a moment to run the handler's finally (aclose → discard).
        deadline = time.monotonic() + 5.0
        while job.subscribers and time.monotonic() < deadline:
            time.sleep(0.02)
        assert job.subscribers == set()
        # The run itself still completes regardless of the dropped listener.
        assert _wait_for_terminal(client, run_id)["state"] == "completed"


def test_live_job_map_is_bounded_but_the_store_keeps_everything() -> None:
    """The live in-memory job map must not grow without bound — oldest *finished*
    runs are evicted from it. The durable store retains them all (eviction only
    bounds the streaming machinery, never the source of truth)."""

    bad = RunRequest(
        source="x",
        grid={},
        # Fails fast at adapter build (no sandbox spawn) so the run finishes quickly.
        adapter=AdapterSpec(name="toy", params={"not_a_param": 1}),
        train_size=1,
        test_size=1,
    )

    async def scenario() -> tuple[JobRunner, list[str]]:
        runner = JobRunner(InMemoryRunStore(), max_jobs=5)
        ids = [runner.submit("u", bad) for _ in range(12)]
        await asyncio.gather(*list(runner._tasks), return_exceptions=True)  # pyright: ignore[reportPrivateUsage]
        return runner, ids

    runner, ids = asyncio.run(scenario())
    assert len(runner._jobs) <= 5  # pyright: ignore[reportPrivateUsage]  # live map bounded
    assert ids[0] not in runner._jobs  # pyright: ignore[reportPrivateUsage]  # oldest evicted from live map
    assert runner.get(ids[0], "u") is not None  # ...but still durable in the store
    assert runner.get(ids[-1], "u") is not None


def test_auth_required_and_runs_are_isolated_per_user(user_token: Callable[..., str]) -> None:
    """With a JWT secret configured: no token → 401; a run is visible only to the
    user who submitted it (cross-user fetch is 404, never a leak); lists are scoped."""
    secret = "test-secret"
    token_a = user_token("user-a", secret)
    token_b = user_token("user-b", secret)
    with TestClient(create_app(Settings(jwt_secret=secret))) as client:
        assert _post(client, "/runs", _BASE_REQUEST).status_code == 401  # no token
        assert _get(client, "/runs").status_code == 401

        run_id = cast("str", _json(_post(client, "/runs", _BASE_REQUEST, token=token_a))["id"])

        # B cannot see A's run; A can. 404 (not 403) so existence never leaks.
        assert _get(client, f"/runs/{run_id}", token=token_b).status_code == 404
        assert _get(client, f"/runs/{run_id}", token=token_a).status_code == 200

        # Listing is scoped to the caller.
        assert [r["id"] for r in _json_list(_get(client, "/runs", token=token_a))] == [run_id]
        assert _json_list(_get(client, "/runs", token=token_b)) == []

        # The run still completes for its owner.
        deadline = time.monotonic() + 30.0
        while time.monotonic() < deadline:
            if _json(_get(client, f"/runs/{run_id}", token=token_a))["state"] in (
                "completed",
                "error",
            ):
                break
            time.sleep(0.05)


def test_websocket_rejects_a_bad_token_when_auth_is_on(user_token: Callable[..., str]) -> None:
    with TestClient(create_app(Settings(jwt_secret="s"))) as client:
        token = user_token("user-a", "s")
        run_id = cast("str", _json(_post(client, "/runs", _BASE_REQUEST, token=token))["id"])
        # A garbage token on the WS query param is refused before streaming.
        with client.websocket_connect(f"/runs/{run_id}/ws?token=not-a-jwt") as ws:
            msg = cast("dict[str, Any]", ws.receive_json())
            assert "detail" in msg
