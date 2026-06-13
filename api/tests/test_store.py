"""RunStore — the persistence contract, proven on both backends, plus durability
and per-user isolation. The same contract is what Postgres/Supabase implements in
production (see api/migrations/0001_init.sql)."""

from __future__ import annotations

from pathlib import Path

import pytest

from green.api.models import AdapterSpec, ProgressInfo, RunRequest, RunState
from green.api.store import InMemoryRunStore, RunStore, SqliteRunStore
from green.core import Verdict


def _request() -> RunRequest:
    return RunRequest(source="x", grid={}, adapter=AdapterSpec(), train_size=1, test_size=1)


def _verdict() -> Verdict:
    return Verdict(
        passed=True,
        reason="ok",
        train_sharpe=1.0,
        test_sharpe=0.5,
        retention=0.5,
        oos_trades=3,
        windows=(),
    )


@pytest.fixture(params=["memory", "sqlite"])
def store(request: pytest.FixtureRequest, tmp_path: Path) -> RunStore:
    if request.param == "memory":
        return InMemoryRunStore()
    return SqliteRunStore(str(tmp_path / "runs.db"))


def test_create_then_get_round_trips(store: RunStore) -> None:
    store.create("r1", "user-a", _request())
    run = store.get("r1")
    assert run is not None
    assert run.user_id == "user-a"
    assert run.state is RunState.QUEUED
    assert run.request.source == "x"


def test_update_persists_state_progress_and_verdict(store: RunStore) -> None:
    store.create("r1", "user-a", _request())
    store.update("r1", state=RunState.RUNNING, progress=ProgressInfo(completed=1, total=2))
    store.update("r1", state=RunState.COMPLETED, verdict=_verdict())

    run = store.get("r1")
    assert run is not None
    assert run.state is RunState.COMPLETED
    assert run.progress == ProgressInfo(completed=1, total=2)
    assert run.verdict is not None and run.verdict.passed


def test_reads_are_scoped_per_user(store: RunStore) -> None:
    store.create("r1", "user-a", _request())
    store.create("r2", "user-b", _request())

    assert {r.id for r in store.list_for_user("user-a")} == {"r1"}
    assert {r.id for r in store.list_for_user("user-b")} == {"r2"}
    # Ownership-checked read hides other users' runs as if missing.
    assert store.get_for_user("r1", "user-a") is not None
    assert store.get_for_user("r1", "user-b") is None
    assert store.get_for_user("missing", "user-a") is None


def test_sqlite_persists_across_reopen(tmp_path: Path) -> None:
    path = str(tmp_path / "runs.db")
    first = SqliteRunStore(path)
    first.create("r1", "user-a", _request())
    first.update("r1", state=RunState.COMPLETED, verdict=_verdict())
    first.close()

    # A fresh store on the same file sees the durable run — the whole point.
    reopened = SqliteRunStore(path)
    run = reopened.get("r1")
    assert run is not None
    assert run.state is RunState.COMPLETED
    assert run.verdict is not None and run.verdict.passed
    reopened.close()
