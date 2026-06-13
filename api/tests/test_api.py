"""The API end to end, in-process (Starlette TestClient — real HTTP + WebSocket,
no server). Submit untrusted source → the gate runs it sandboxed → poll the
verdict, or stream per-window progress live. Bad configs and hostile strategies
surface as clean, typed run errors, never as a 500 or a hang.
"""

from __future__ import annotations

import asyncio
import inspect
import time
from collections.abc import Iterator
from typing import Any, cast

import httpx
import pytest
from fastapi.testclient import TestClient

import green.strategies.mean_reversion
from green.api import AdapterSpec, RunRequest, create_app
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


def _post(client: httpx.Client, path: str, payload: dict[str, Any]) -> httpx.Response:
    # Typed as httpx.Client (TestClient's base) so pyright sees the typed method
    # signatures rather than Starlette's untyped overrides.
    return client.post(path, json=payload)


def _get(client: httpx.Client, path: str) -> httpx.Response:
    return client.get(path)


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


def test_job_store_is_bounded_and_evicts_oldest_finished_runs() -> None:
    """The in-memory store must not grow without bound. Oldest *finished* runs
    are evicted once over capacity; the newest survive."""

    bad = RunRequest(
        source="x",
        grid={},
        # Fails fast at adapter build (no sandbox spawn) so the run finishes quickly.
        adapter=AdapterSpec(name="toy", params={"not_a_param": 1}),
        train_size=1,
        test_size=1,
    )

    async def scenario() -> tuple[JobRunner, list[str]]:
        runner = JobRunner(max_jobs=5)
        ids = [runner.submit(bad) for _ in range(12)]
        await asyncio.gather(*list(runner._tasks), return_exceptions=True)  # pyright: ignore[reportPrivateUsage]
        return runner, ids

    runner, ids = asyncio.run(scenario())
    assert len(runner._jobs) <= 5  # pyright: ignore[reportPrivateUsage]
    assert runner.get(ids[0]) is None  # oldest evicted
    assert runner.get(ids[-1]) is not None  # newest retained
