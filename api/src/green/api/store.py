"""Durable run records, behind one interface.

`RunStore` is the persistence boundary. Two implementations ship:

- `InMemoryRunStore` — ephemeral, the zero-setup default.
- `SqliteRunStore` — durable; a run survives a restart and is queryable.

Postgres/Supabase is the same interface against a managed database — see
api/migrations/0001_init.sql (schema + row-level security). This mirrors the
sandbox's SubprocessExecutor→DockerExecutor seam: prove the logic on a backend
we can test offline, swap the transport for production.

Per-user isolation is enforced here at the application layer (every read is
scoped to a user_id); on Postgres, RLS enforces the same rule a second time at
the database — defense in depth.
"""

from __future__ import annotations

import sqlite3
import threading
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, cast

from green.api.models import ProgressInfo, RunRequest, RunResponse, RunState
from green.core import Verdict


@dataclass
class StoredRun:
    id: str
    user_id: str
    state: RunState
    request: RunRequest
    progress: ProgressInfo | None = None
    verdict: Verdict | None = None
    error: str | None = None
    created_at: str = ""
    updated_at: str = ""

    def to_response(self) -> RunResponse:
        return RunResponse(
            id=self.id,
            state=self.state,
            progress=self.progress,
            verdict=self.verdict,
            error=self.error,
        )


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


class RunStore(ABC):
    @abstractmethod
    def create(self, run_id: str, user_id: str, request: RunRequest) -> StoredRun: ...

    @abstractmethod
    def get(self, run_id: str) -> StoredRun | None:
        """By id, unscoped. Callers enforce ownership (see `get_for_user`)."""
        ...

    @abstractmethod
    def update(
        self,
        run_id: str,
        *,
        state: RunState | None = None,
        progress: ProgressInfo | None = None,
        verdict: Verdict | None = None,
        error: str | None = None,
    ) -> None: ...

    @abstractmethod
    def list_for_user(self, user_id: str) -> list[StoredRun]: ...

    def get_for_user(self, run_id: str, user_id: str) -> StoredRun | None:
        """Ownership-checked read: returns None for both 'missing' and 'someone
        else's' so existence never leaks across users."""
        run = self.get(run_id)
        if run is None or run.user_id != user_id:
            return None
        return run


class InMemoryRunStore(RunStore):
    def __init__(self) -> None:
        self._runs: dict[str, StoredRun] = {}
        self._lock = threading.Lock()

    def create(self, run_id: str, user_id: str, request: RunRequest) -> StoredRun:
        now = _now_iso()
        run = StoredRun(
            id=run_id,
            user_id=user_id,
            state=RunState.QUEUED,
            request=request,
            created_at=now,
            updated_at=now,
        )
        with self._lock:
            self._runs[run_id] = run
        return run

    def get(self, run_id: str) -> StoredRun | None:
        with self._lock:
            return self._runs.get(run_id)

    def update(
        self,
        run_id: str,
        *,
        state: RunState | None = None,
        progress: ProgressInfo | None = None,
        verdict: Verdict | None = None,
        error: str | None = None,
    ) -> None:
        with self._lock:
            run = self._runs.get(run_id)
            if run is None:
                return
            if state is not None:
                run.state = state
            if progress is not None:
                run.progress = progress
            if verdict is not None:
                run.verdict = verdict
            if error is not None:
                run.error = error
            run.updated_at = _now_iso()

    def list_for_user(self, user_id: str) -> list[StoredRun]:
        with self._lock:
            return [r for r in self._runs.values() if r.user_id == user_id]


_SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    state        TEXT NOT NULL,
    request_json TEXT NOT NULL,
    progress_json TEXT,
    verdict_json TEXT,
    error        TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_user_id ON runs (user_id);
"""


class SqliteRunStore(RunStore):
    """Durable store on SQLite. One connection guarded by a lock — writes come
    from the event-loop thread, direct reads from request handlers/tests; a lock
    makes mixed-thread single-connection access safe without a pool."""

    def __init__(self, path: str = "green.db") -> None:
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._lock = threading.Lock()
        with self._lock:
            self._conn.executescript(_SCHEMA)
            self._conn.commit()

    def create(self, run_id: str, user_id: str, request: RunRequest) -> StoredRun:
        now = _now_iso()
        run = StoredRun(
            id=run_id,
            user_id=user_id,
            state=RunState.QUEUED,
            request=request,
            created_at=now,
            updated_at=now,
        )
        with self._lock:
            self._conn.execute(
                "INSERT INTO runs (id, user_id, state, request_json, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (run_id, user_id, run.state.value, request.model_dump_json(), now, now),
            )
            self._conn.commit()
        return run

    def get(self, run_id: str) -> StoredRun | None:
        with self._lock:
            cursor = self._conn.execute(
                "SELECT id, user_id, state, request_json, progress_json, verdict_json, "
                "error, created_at, updated_at FROM runs WHERE id = ?",
                (run_id,),
            )
            row = cursor.fetchone()
        return self._row_to_run(cast("tuple[Any, ...]", row)) if row is not None else None

    def update(
        self,
        run_id: str,
        *,
        state: RunState | None = None,
        progress: ProgressInfo | None = None,
        verdict: Verdict | None = None,
        error: str | None = None,
    ) -> None:
        sets: list[str] = []
        values: list[Any] = []
        if state is not None:
            sets.append("state = ?")
            values.append(state.value)
        if progress is not None:
            sets.append("progress_json = ?")
            values.append(progress.model_dump_json())
        if verdict is not None:
            sets.append("verdict_json = ?")
            values.append(verdict.model_dump_json())
        if error is not None:
            sets.append("error = ?")
            values.append(error)
        sets.append("updated_at = ?")
        values.append(_now_iso())
        values.append(run_id)
        with self._lock:
            self._conn.execute(f"UPDATE runs SET {', '.join(sets)} WHERE id = ?", values)
            self._conn.commit()

    def list_for_user(self, user_id: str) -> list[StoredRun]:
        with self._lock:
            cursor = self._conn.execute(
                "SELECT id, user_id, state, request_json, progress_json, verdict_json, "
                "error, created_at, updated_at FROM runs WHERE user_id = ? ORDER BY created_at",
                (user_id,),
            )
            rows = cursor.fetchall()
        return [self._row_to_run(cast("tuple[Any, ...]", row)) for row in rows]

    @staticmethod
    def _row_to_run(row: tuple[Any, ...]) -> StoredRun:
        id_, user_id, state, request_json = row[0], row[1], row[2], row[3]
        progress_json, verdict_json, error, created, updated = (
            row[4],
            row[5],
            row[6],
            row[7],
            row[8],
        )
        progress = (
            ProgressInfo.model_validate_json(cast("str", progress_json))
            if progress_json is not None
            else None
        )
        verdict = (
            Verdict.model_validate_json(cast("str", verdict_json))
            if verdict_json is not None
            else None
        )
        return StoredRun(
            id=cast("str", id_),
            user_id=cast("str", user_id),
            state=RunState(cast("str", state)),
            request=RunRequest.model_validate_json(cast("str", request_json)),
            progress=progress,
            verdict=verdict,
            error=cast("str | None", error),
            created_at=cast("str", created),
            updated_at=cast("str", updated),
        )

    def close(self) -> None:
        with self._lock:
            self._conn.close()


def build_store(backend: str, *, sqlite_path: str = "green.db") -> RunStore:
    return SqliteRunStore(sqlite_path) if backend == "sqlite" else InMemoryRunStore()


__all__ = [
    "InMemoryRunStore",
    "RunStore",
    "SqliteRunStore",
    "StoredRun",
    "build_store",
]
