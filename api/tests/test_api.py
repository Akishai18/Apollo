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
