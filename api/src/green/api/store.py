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

import re
import sqlite3
import threading
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, cast

import psycopg
from psycopg.rows import tuple_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from green.api.models import (
    ProgressInfo,
    RunRequest,
    RunResponse,
    RunState,
    RunSummary,
    StrategyCreate,
    StrategyDraftCreate,
    StrategyDraftRecord,
    StrategyDraftUpdate,
    StrategyRecord,
    StrategyStatus,
    StrategyVersionRecord,
)
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
    note: str | None = None  # generator rationale (NL-generated runs)
    prompt: str | None = None  # original NL prompt (NL-generated runs)
    created_at: str = ""
    updated_at: str = ""

    def _title(self) -> str:
        """A short human label for lists/sidebar: the prompt, else the class."""
        if self.prompt:
            p = self.prompt.strip().replace("\n", " ")
            return p if len(p) <= 48 else f"{p[:47]}…"
        return self.request.class_name or "Strategy"

    def to_response(self) -> RunResponse:
        return RunResponse(
            id=self.id,
            state=self.state,
            progress=self.progress,
            verdict=self.verdict,
            error=self.error,
            note=self.note,
            prompt=self.prompt,
            source=self.request.source,
            symbol=symbol_of(self.request),
            kind=kind_from_class(self.request.class_name),
            run_kind=self.request.run_kind,
            strategy_id=self.request.strategy_id,
            strategy_version_id=self.request.strategy_version_id,
            train_size=self.request.train_size,
            test_size=self.request.test_size,
            adapter=self.request.adapter.name,
        )

    def to_summary(self) -> RunSummary:
        v = self.verdict
        return RunSummary(
            id=self.id,
            state=self.state,
            title=self._title(),
            symbol=symbol_of(self.request),
            kind=kind_from_class(self.request.class_name),
            run_kind=self.request.run_kind,
            strategy_id=self.request.strategy_id,
            strategy_version_id=self.request.strategy_version_id,
            passed=v.passed if v is not None else None,
            reason=v.reason if v is not None else None,
            oos_sharpe=v.test_sharpe if v is not None else None,
            edge_retained=v.retention if v is not None else None,
            max_dd=(max((w.test.max_drawdown for w in v.windows), default=0.0) if v else None),
            spark=_oos_equity(v) if v is not None else (),
            progress=self.progress,
            error=self.error,
            created_at=self.created_at,
            updated_at=self.updated_at,
        )


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _downsample(xs: list[float], n: int = 28) -> tuple[float, ...]:
    if len(xs) <= n:
        return tuple(xs)
    step = (len(xs) - 1) / (n - 1)
    return tuple(xs[round(i * step)] for i in range(n))


def _oos_equity(verdict: Verdict) -> tuple[float, ...]:
    """Held-out equity across all windows, each segment rebased to continue from
    the last — one continuous out-of-sample curve — then downsampled for a spark."""
    series: list[float] = []
    last: float | None = None
    for w in verdict.windows:
        seg = [v for _, v in w.test_equity]
        if not seg:
            continue
        if last is not None and seg[0] != 0:
            factor = last / seg[0]
            seg = [v * factor for v in seg]
        series.extend(seg)
        last = series[-1]
    return _downsample(series)


def kind_from_class(name: str | None) -> str | None:
    if not name:
        return None
    words = re.findall(r"[A-Z][a-z0-9]*", name)
    return " ".join(w.lower() for w in words) if words else name.lower()


def symbol_of(request: RunRequest) -> str | None:
    vals = request.grid.get("symbol")
    return str(vals[0]) if vals else None


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
        note: str | None = None,
        prompt: str | None = None,
        request: RunRequest | None = None,
    ) -> None: ...

    @abstractmethod
    def list_for_user(self, user_id: str) -> list[StoredRun]: ...

    @abstractmethod
    def create_strategy(self, user_id: str, body: StrategyCreate) -> StrategyRecord: ...

    @abstractmethod
    def list_strategies_for_user(self, user_id: str) -> list[StrategyRecord]: ...

    @abstractmethod
    def get_strategy_for_user(self, strategy_id: str, user_id: str) -> StrategyRecord | None: ...

    @abstractmethod
    def create_draft(
        self, strategy_id: str, user_id: str, body: StrategyDraftCreate
    ) -> StrategyDraftRecord | None: ...

    @abstractmethod
    def update_draft(
        self, draft_id: str, user_id: str, body: StrategyDraftUpdate
    ) -> StrategyDraftRecord | None: ...

    @abstractmethod
    def get_draft_for_user(self, draft_id: str, user_id: str) -> StrategyDraftRecord | None: ...

    @abstractmethod
    def list_drafts_for_strategy(
        self, strategy_id: str, user_id: str
    ) -> list[StrategyDraftRecord]: ...

    @abstractmethod
    def create_version_from_draft(
        self, draft_id: str, user_id: str
    ) -> StrategyVersionRecord | None: ...

    @abstractmethod
    def get_version_for_user(
        self, version_id: str, user_id: str
    ) -> StrategyVersionRecord | None: ...

    @abstractmethod
    def list_versions_for_strategy(
        self, strategy_id: str, user_id: str
    ) -> list[StrategyVersionRecord]: ...

    @abstractmethod
    def list_runs_for_strategy(self, strategy_id: str, user_id: str) -> list[StoredRun]: ...

    @abstractmethod
    def set_version_promoted(
        self, version_id: str, user_id: str, promoted: bool
    ) -> StrategyVersionRecord | None: ...

    @abstractmethod
    def list_promoted_versions(self, user_id: str) -> list[StrategyVersionRecord]: ...

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
        self._strategies: dict[str, StrategyRecord] = {}
        self._strategy_users: dict[str, str] = {}
        self._drafts: dict[str, StrategyDraftRecord] = {}
        self._draft_users: dict[str, str] = {}
        self._versions: dict[str, StrategyVersionRecord] = {}
        self._version_users: dict[str, str] = {}
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
        note: str | None = None,
        prompt: str | None = None,
        request: RunRequest | None = None,
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
            if note is not None:
                run.note = note
            if prompt is not None:
                run.prompt = prompt
            if request is not None:
                run.request = request
            run.updated_at = _now_iso()

    def list_for_user(self, user_id: str) -> list[StoredRun]:
        with self._lock:
            return [r for r in self._runs.values() if r.user_id == user_id]

    def create_strategy(self, user_id: str, body: StrategyCreate) -> StrategyRecord:
        now = _now_iso()
        record = StrategyRecord(
            id=uuid.uuid4().hex,
            title=body.title,
            description=body.description,
            status=StrategyStatus.ACTIVE,
            created_at=now,
            updated_at=now,
        )
        with self._lock:
            self._strategies[record.id] = record
            self._strategy_users[record.id] = user_id
        return record

    def list_strategies_for_user(self, user_id: str) -> list[StrategyRecord]:
        with self._lock:
            return [
                s for sid, s in self._strategies.items() if self._strategy_users.get(sid) == user_id
            ]

    def get_strategy_for_user(self, strategy_id: str, user_id: str) -> StrategyRecord | None:
        with self._lock:
            if self._strategy_users.get(strategy_id) != user_id:
                return None
            return self._strategies.get(strategy_id)

    def create_draft(
        self, strategy_id: str, user_id: str, body: StrategyDraftCreate
    ) -> StrategyDraftRecord | None:
        now = _now_iso()
        with self._lock:
            if self._strategy_users.get(strategy_id) != user_id:
                return None
            record = StrategyDraftRecord(
                **body.model_dump(),
                id=uuid.uuid4().hex,
                strategy_id=strategy_id,
                created_at=now,
                updated_at=now,
            )
            self._drafts[record.id] = record
            self._draft_users[record.id] = user_id
            self._touch_strategy(strategy_id, now)
            return record

    def update_draft(
        self, draft_id: str, user_id: str, body: StrategyDraftUpdate
    ) -> StrategyDraftRecord | None:
        now = _now_iso()
        with self._lock:
            current = self._drafts.get(draft_id)
            if current is None or self._draft_users.get(draft_id) != user_id:
                return None
            data = current.model_dump()
            for key, value in body.model_dump(exclude_unset=True).items():
                data[key] = value
            data["updated_at"] = now
            record = StrategyDraftRecord.model_validate(data)
            self._drafts[draft_id] = record
            self._touch_strategy(record.strategy_id, now)
            return record

    def get_draft_for_user(self, draft_id: str, user_id: str) -> StrategyDraftRecord | None:
        with self._lock:
            if self._draft_users.get(draft_id) != user_id:
                return None
            return self._drafts.get(draft_id)

    def list_drafts_for_strategy(self, strategy_id: str, user_id: str) -> list[StrategyDraftRecord]:
        with self._lock:
            if self._strategy_users.get(strategy_id) != user_id:
                return []
            return [d for d in self._drafts.values() if d.strategy_id == strategy_id]

    def create_version_from_draft(
        self, draft_id: str, user_id: str
    ) -> StrategyVersionRecord | None:
        now = _now_iso()
        with self._lock:
            draft = self._drafts.get(draft_id)
            if draft is None or self._draft_users.get(draft_id) != user_id:
                return None
            version_number = 1 + max(
                (
                    v.version_number
                    for v in self._versions.values()
                    if v.strategy_id == draft.strategy_id
                ),
                default=0,
            )
            record = StrategyVersionRecord(
                **draft.model_dump(
                    exclude={"id", "created_at", "updated_at"},
                ),
                id=uuid.uuid4().hex,
                draft_id=draft_id,
                version_number=version_number,
                frozen_at=now,
            )
            self._versions[record.id] = record
            self._version_users[record.id] = user_id
            self._touch_strategy(record.strategy_id, now)
            return record

    def get_version_for_user(self, version_id: str, user_id: str) -> StrategyVersionRecord | None:
        with self._lock:
            if self._version_users.get(version_id) != user_id:
                return None
            return self._versions.get(version_id)

    def list_versions_for_strategy(
        self, strategy_id: str, user_id: str
    ) -> list[StrategyVersionRecord]:
        with self._lock:
            if self._strategy_users.get(strategy_id) != user_id:
                return []
            versions = [v for v in self._versions.values() if v.strategy_id == strategy_id]
        return sorted(versions, key=lambda v: v.version_number)

    def list_runs_for_strategy(self, strategy_id: str, user_id: str) -> list[StoredRun]:
        with self._lock:
            return [
                r
                for r in self._runs.values()
                if r.user_id == user_id and r.request.strategy_id == strategy_id
            ]

    def set_version_promoted(
        self, version_id: str, user_id: str, promoted: bool
    ) -> StrategyVersionRecord | None:
        with self._lock:
            if self._version_users.get(version_id) != user_id:
                return None
            current = self._versions.get(version_id)
            if current is None:
                return None
            updated = current.model_copy(update={"promoted": promoted})
            self._versions[version_id] = updated
            return updated

    def list_promoted_versions(self, user_id: str) -> list[StrategyVersionRecord]:
        with self._lock:
            return [
                v
                for vid, v in self._versions.items()
                if self._version_users.get(vid) == user_id and v.promoted
            ]

    def _touch_strategy(self, strategy_id: str, now: str) -> None:
        current = self._strategies.get(strategy_id)
        if current is not None:
            self._strategies[strategy_id] = current.model_copy(update={"updated_at": now})


_SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    strategy_id  TEXT,
    strategy_version_id TEXT,
    state        TEXT NOT NULL,
    request_json TEXT NOT NULL,
    progress_json TEXT,
    verdict_json TEXT,
    error        TEXT,
    note         TEXT,
    prompt       TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_user_id ON runs (user_id);
CREATE INDEX IF NOT EXISTS runs_strategy_id ON runs (strategy_id);

CREATE TABLE IF NOT EXISTS strategies (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    title        TEXT NOT NULL,
    description  TEXT NOT NULL,
    status       TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS strategies_user_id ON strategies (user_id);

CREATE TABLE IF NOT EXISTS strategy_drafts (
    id           TEXT PRIMARY KEY,
    strategy_id  TEXT NOT NULL,
    user_id      TEXT NOT NULL,
    draft_json   TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS strategy_drafts_strategy_id ON strategy_drafts (strategy_id);
CREATE INDEX IF NOT EXISTS strategy_drafts_user_id ON strategy_drafts (user_id);

CREATE TABLE IF NOT EXISTS strategy_versions (
    id             TEXT PRIMARY KEY,
    strategy_id    TEXT NOT NULL,
    draft_id       TEXT NOT NULL,
    user_id        TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    version_json   TEXT NOT NULL,
    frozen_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS strategy_versions_strategy_id ON strategy_versions (strategy_id);
CREATE INDEX IF NOT EXISTS strategy_versions_user_id ON strategy_versions (user_id);
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
            # Additive migrations for DBs created before these columns existed.
            cols = {r[1] for r in self._conn.execute("PRAGMA table_info(runs)").fetchall()}
            if "strategy_id" not in cols:
                self._conn.execute("ALTER TABLE runs ADD COLUMN strategy_id TEXT")
            if "strategy_version_id" not in cols:
                self._conn.execute("ALTER TABLE runs ADD COLUMN strategy_version_id TEXT")
            if "note" not in cols:
                self._conn.execute("ALTER TABLE runs ADD COLUMN note TEXT")
            if "prompt" not in cols:
                self._conn.execute("ALTER TABLE runs ADD COLUMN prompt TEXT")
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
                "INSERT INTO runs (id, user_id, strategy_id, strategy_version_id, state, "
                "request_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    run_id,
                    user_id,
                    request.strategy_id,
                    request.strategy_version_id,
                    run.state.value,
                    request.model_dump_json(),
                    now,
                    now,
                ),
            )
            self._conn.commit()
        return run

    def get(self, run_id: str) -> StoredRun | None:
        with self._lock:
            cursor = self._conn.execute(
                "SELECT id, user_id, state, request_json, progress_json, verdict_json, "
                "error, note, prompt, created_at, updated_at FROM runs WHERE id = ?",
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
        note: str | None = None,
        prompt: str | None = None,
        request: RunRequest | None = None,
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
        if note is not None:
            sets.append("note = ?")
            values.append(note)
        if prompt is not None:
            sets.append("prompt = ?")
            values.append(prompt)
        if request is not None:
            sets.append("request_json = ?")
            values.append(request.model_dump_json())
            sets.append("strategy_id = ?")
            values.append(request.strategy_id)
            sets.append("strategy_version_id = ?")
            values.append(request.strategy_version_id)
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
                "error, note, prompt, created_at, updated_at "
                "FROM runs WHERE user_id = ? ORDER BY created_at",
                (user_id,),
            )
            rows = cursor.fetchall()
        return [self._row_to_run(cast("tuple[Any, ...]", row)) for row in rows]

    def create_strategy(self, user_id: str, body: StrategyCreate) -> StrategyRecord:
        now = _now_iso()
        record = StrategyRecord(
            id=uuid.uuid4().hex,
            title=body.title,
            description=body.description,
            status=StrategyStatus.ACTIVE,
            created_at=now,
            updated_at=now,
        )
        with self._lock:
            self._conn.execute(
                "INSERT INTO strategies "
                "(id, user_id, title, description, status, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    record.id,
                    user_id,
                    record.title,
                    record.description,
                    record.status.value,
                    record.created_at,
                    record.updated_at,
                ),
            )
            self._conn.commit()
        return record

    def list_strategies_for_user(self, user_id: str) -> list[StrategyRecord]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT id, title, description, status, created_at, updated_at "
                "FROM strategies WHERE user_id = ? ORDER BY updated_at DESC",
                (user_id,),
            ).fetchall()
        return [self._row_to_strategy(cast("tuple[Any, ...]", row)) for row in rows]

    def get_strategy_for_user(self, strategy_id: str, user_id: str) -> StrategyRecord | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT id, title, description, status, created_at, updated_at "
                "FROM strategies WHERE id = ? AND user_id = ?",
                (strategy_id, user_id),
            ).fetchone()
        return self._row_to_strategy(cast("tuple[Any, ...]", row)) if row else None

    def create_draft(
        self, strategy_id: str, user_id: str, body: StrategyDraftCreate
    ) -> StrategyDraftRecord | None:
        now = _now_iso()
        if self.get_strategy_for_user(strategy_id, user_id) is None:
            return None
        record = StrategyDraftRecord(
            **body.model_dump(),
            id=uuid.uuid4().hex,
            strategy_id=strategy_id,
            created_at=now,
            updated_at=now,
        )
        with self._lock:
            self._conn.execute(
                "INSERT INTO strategy_drafts "
                "(id, strategy_id, user_id, draft_json, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (
                    record.id,
                    strategy_id,
                    user_id,
                    record.model_dump_json(),
                    now,
                    now,
                ),
            )
            self._touch_strategy_sql(strategy_id, now)
            self._conn.commit()
        return record

    def update_draft(
        self, draft_id: str, user_id: str, body: StrategyDraftUpdate
    ) -> StrategyDraftRecord | None:
        current = self.get_draft_for_user(draft_id, user_id)
        if current is None:
            return None
        now = _now_iso()
        data = current.model_dump()
        for key, value in body.model_dump(exclude_unset=True).items():
            data[key] = value
        data["updated_at"] = now
        record = StrategyDraftRecord.model_validate(data)
        with self._lock:
            self._conn.execute(
                "UPDATE strategy_drafts SET draft_json = ?, updated_at = ? "
                "WHERE id = ? AND user_id = ?",
                (record.model_dump_json(), now, draft_id, user_id),
            )
            self._touch_strategy_sql(record.strategy_id, now)
            self._conn.commit()
        return record

    def get_draft_for_user(self, draft_id: str, user_id: str) -> StrategyDraftRecord | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT draft_json FROM strategy_drafts WHERE id = ? AND user_id = ?",
                (draft_id, user_id),
            ).fetchone()
        return StrategyDraftRecord.model_validate_json(cast("str", row[0])) if row else None

    def list_drafts_for_strategy(self, strategy_id: str, user_id: str) -> list[StrategyDraftRecord]:
        if self.get_strategy_for_user(strategy_id, user_id) is None:
            return []
        with self._lock:
            rows = self._conn.execute(
                "SELECT draft_json FROM strategy_drafts WHERE strategy_id = ? AND user_id = ? "
                "ORDER BY created_at DESC",
                (strategy_id, user_id),
            ).fetchall()
        return [StrategyDraftRecord.model_validate_json(cast("str", row[0])) for row in rows]

    def create_version_from_draft(
        self, draft_id: str, user_id: str
    ) -> StrategyVersionRecord | None:
        draft = self.get_draft_for_user(draft_id, user_id)
        if draft is None:
            return None
        now = _now_iso()
        with self._lock:
            row = self._conn.execute(
                "SELECT MAX(version_number) FROM strategy_versions "
                "WHERE strategy_id = ? AND user_id = ?",
                (draft.strategy_id, user_id),
            ).fetchone()
            version_number = int(row[0] or 0) + 1
            record = StrategyVersionRecord(
                **draft.model_dump(exclude={"id", "created_at", "updated_at"}),
                id=uuid.uuid4().hex,
                draft_id=draft_id,
                version_number=version_number,
                frozen_at=now,
            )
            self._conn.execute(
                "INSERT INTO strategy_versions (id, strategy_id, draft_id, user_id, "
                "version_number, version_json, frozen_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    record.id,
                    record.strategy_id,
                    draft_id,
                    user_id,
                    version_number,
                    record.model_dump_json(),
                    now,
                ),
            )
            self._touch_strategy_sql(record.strategy_id, now)
            self._conn.commit()
        return record

    def get_version_for_user(self, version_id: str, user_id: str) -> StrategyVersionRecord | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT version_json FROM strategy_versions WHERE id = ? AND user_id = ?",
                (version_id, user_id),
            ).fetchone()
        return StrategyVersionRecord.model_validate_json(cast("str", row[0])) if row else None

    def list_versions_for_strategy(
        self, strategy_id: str, user_id: str
    ) -> list[StrategyVersionRecord]:
        if self.get_strategy_for_user(strategy_id, user_id) is None:
            return []
        with self._lock:
            rows = self._conn.execute(
                "SELECT version_json FROM strategy_versions WHERE strategy_id = ? AND user_id = ? "
                "ORDER BY version_number",
                (strategy_id, user_id),
            ).fetchall()
        return [StrategyVersionRecord.model_validate_json(cast("str", row[0])) for row in rows]

    def list_runs_for_strategy(self, strategy_id: str, user_id: str) -> list[StoredRun]:
        if self.get_strategy_for_user(strategy_id, user_id) is None:
            return []
        with self._lock:
            cursor = self._conn.execute(
                "SELECT id, user_id, state, request_json, progress_json, verdict_json, "
                "error, note, prompt, created_at, updated_at "
                "FROM runs WHERE strategy_id = ? AND user_id = ? ORDER BY created_at DESC",
                (strategy_id, user_id),
            )
            rows = cursor.fetchall()
        return [self._row_to_run(cast("tuple[Any, ...]", row)) for row in rows]

    def set_version_promoted(
        self, version_id: str, user_id: str, promoted: bool
    ) -> StrategyVersionRecord | None:
        current = self.get_version_for_user(version_id, user_id)
        if current is None:
            return None
        updated = current.model_copy(update={"promoted": promoted})
        with self._lock:
            self._conn.execute(
                "UPDATE strategy_versions SET version_json = ? WHERE id = ? AND user_id = ?",
                (updated.model_dump_json(), version_id, user_id),
            )
            self._conn.commit()
        return updated

    def list_promoted_versions(self, user_id: str) -> list[StrategyVersionRecord]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT version_json FROM strategy_versions "
                "WHERE user_id = ? ORDER BY version_number",
                (user_id,),
            ).fetchall()
        versions = [StrategyVersionRecord.model_validate_json(cast("str", r[0])) for r in rows]
        return [v for v in versions if v.promoted]

    @staticmethod
    def _row_to_run(row: tuple[Any, ...]) -> StoredRun:
        id_, user_id, state, request_json = row[0], row[1], row[2], row[3]
        progress_json, verdict_json, error, note, prompt, created, updated = (
            row[4],
            row[5],
            row[6],
            row[7],
            row[8],
            row[9],
            row[10],
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
            note=cast("str | None", note),
            prompt=cast("str | None", prompt),
            created_at=cast("str", created),
            updated_at=cast("str", updated),
        )

    @staticmethod
    def _row_to_strategy(row: tuple[Any, ...]) -> StrategyRecord:
        return StrategyRecord(
            id=cast("str", row[0]),
            title=cast("str", row[1]),
            description=cast("str", row[2]),
            status=StrategyStatus(cast("str", row[3])),
            created_at=cast("str", row[4]),
            updated_at=cast("str", row[5]),
        )

    def _touch_strategy_sql(self, strategy_id: str, now: str) -> None:
        self._conn.execute("UPDATE strategies SET updated_at = ? WHERE id = ?", (now, strategy_id))

    def close(self) -> None:
        with self._lock:
            self._conn.close()


class PostgresRunStore(RunStore):
    """Durable store on Postgres/Supabase.

    FastAPI connects server-side and preserves the same application-level owner
    checks as SQLite. The Supabase migration adds RLS as defense in depth.

    Uses a connection pool rather than one long-lived connection: managed
    Postgres (Supabase pooler, Render) reaps idle connections and restarts for
    maintenance, which would leave a single shared connection permanently
    "closed" and 500 every request. The pool health-checks each connection
    before handing it out and recycles idle ones, so a reaped connection is
    transparently replaced instead of surfacing as an error.
    """

    def __init__(self, database_url: str) -> None:
        self._pool: ConnectionPool[psycopg.Connection[tuple[Any, ...]]] = ConnectionPool(
            database_url,
            min_size=1,
            max_size=10,
            max_idle=60.0,  # recycle before the server reaps idle connections
            check=ConnectionPool.check_connection,  # validate liveness on checkout
            kwargs={
                "autocommit": True,
                "row_factory": tuple_row,
                "prepare_threshold": None,
            },
            open=True,
        )

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
        with self._pool.connection() as conn, conn.cursor() as cur:
            cur.execute(
                "INSERT INTO public.runs "
                "(id, user_id, strategy_id, strategy_version_id, state, request_json, "
                "created_at, updated_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                (
                    run_id,
                    user_id,
                    request.strategy_id,
                    request.strategy_version_id,
                    run.state.value,
                    Jsonb(request.model_dump(mode="json")),
                    now,
                    now,
                ),
            )
        return run

    def get(self, run_id: str) -> StoredRun | None:
        with self._pool.connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT id, user_id::text, state, request_json, progress_json, verdict_json, "
                "error, note, prompt, created_at, updated_at FROM public.runs WHERE id = %s",
                (run_id,),
            )
            row = cur.fetchone()
        return self._row_to_run(row) if row is not None else None

    def update(
        self,
        run_id: str,
        *,
        state: RunState | None = None,
        progress: ProgressInfo | None = None,
        verdict: Verdict | None = None,
        error: str | None = None,
        note: str | None = None,
        prompt: str | None = None,
        request: RunRequest | None = None,
    ) -> None:
        sets: list[str] = []
        values: list[Any] = []
        if state is not None:
            sets.append("state = %s")
            values.append(state.value)
        if progress is not None:
            sets.append("progress_json = %s")
            values.append(Jsonb(progress.model_dump(mode="json")))
        if verdict is not None:
            sets.append("verdict_json = %s")
            values.append(Jsonb(verdict.model_dump(mode="json")))
        if error is not None:
            sets.append("error = %s")
            values.append(error)
        if note is not None:
            sets.append("note = %s")
            values.append(note)
        if prompt is not None:
            sets.append("prompt = %s")
            values.append(prompt)
        if request is not None:
            sets.append("request_json = %s")
            values.append(Jsonb(request.model_dump(mode="json")))
            sets.append("strategy_id = %s")
            values.append(request.strategy_id)
            sets.append("strategy_version_id = %s")
            values.append(request.strategy_version_id)
        sets.append("updated_at = %s")
        values.append(_now_iso())
        values.append(run_id)
        with self._pool.connection() as conn, conn.cursor() as cur:
            cur.execute(
                cast("Any", f"UPDATE public.runs SET {', '.join(sets)} WHERE id = %s"),
                values,
            )

    def list_for_user(self, user_id: str) -> list[StoredRun]:
        with self._pool.connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT id, user_id::text, state, request_json, progress_json, verdict_json, "
                "error, note, prompt, created_at, updated_at "
                "FROM public.runs WHERE user_id = %s ORDER BY created_at",
                (user_id,),
            )
            rows = cur.fetchall()
        return [self._row_to_run(row) for row in rows]

    def create_strategy(self, user_id: str, body: StrategyCreate) -> StrategyRecord:
        now = _now_iso()
        record = StrategyRecord(
            id=uuid.uuid4().hex,
            title=body.title,
            description=body.description,
            status=StrategyStatus.ACTIVE,
            created_at=now,
            updated_at=now,
        )
        with self._pool.connection() as conn, conn.cursor() as cur:
            cur.execute(
                "INSERT INTO public.strategies "
                "(id, user_id, title, description, status, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (
                    record.id,
                    user_id,
                    record.title,
                    record.description,
                    record.status.value,
                    record.created_at,
                    record.updated_at,
                ),
            )
        return record

    def list_strategies_for_user(self, user_id: str) -> list[StrategyRecord]:
        with self._pool.connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT id, title, description, status, created_at, updated_at "
                "FROM public.strategies WHERE user_id = %s ORDER BY updated_at DESC",
                (user_id,),
            )
            rows = cur.fetchall()
        return [self._row_to_strategy(row) for row in rows]

    def get_strategy_for_user(self, strategy_id: str, user_id: str) -> StrategyRecord | None:
        with self._pool.connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT id, title, description, status, created_at, updated_at "
                "FROM public.strategies WHERE id = %s AND user_id = %s",
                (strategy_id, user_id),
            )
            row = cur.fetchone()
        return self._row_to_strategy(row) if row else None

    def create_draft(
        self, strategy_id: str, user_id: str, body: StrategyDraftCreate
    ) -> StrategyDraftRecord | None:
        now = _now_iso()
        if self.get_strategy_for_user(strategy_id, user_id) is None:
            return None
        record = StrategyDraftRecord(
            **body.model_dump(),
            id=uuid.uuid4().hex,
            strategy_id=strategy_id,
            created_at=now,
            updated_at=now,
        )
        with self._pool.connection() as conn, conn.cursor() as cur:
            cur.execute(
                "INSERT INTO public.strategy_drafts "
                "(id, strategy_id, user_id, draft_json, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                (
                    record.id,
                    strategy_id,
                    user_id,
                    Jsonb(record.model_dump(mode="json")),
                    now,
                    now,
                ),
            )
            self._touch_strategy_sql(cur, strategy_id, now)
        return record

    def update_draft(
        self, draft_id: str, user_id: str, body: StrategyDraftUpdate
    ) -> StrategyDraftRecord | None:
        current = self.get_draft_for_user(draft_id, user_id)
        if current is None:
            return None
        now = _now_iso()
        data = current.model_dump()
        for key, value in body.model_dump(exclude_unset=True).items():
            data[key] = value
        data["updated_at"] = now
        record = StrategyDraftRecord.model_validate(data)
        with self._pool.connection() as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE public.strategy_drafts SET draft_json = %s, updated_at = %s "
                "WHERE id = %s AND user_id = %s",
                (Jsonb(record.model_dump(mode="json")), now, draft_id, user_id),
            )
            self._touch_strategy_sql(cur, record.strategy_id, now)
        return record

    def get_draft_for_user(self, draft_id: str, user_id: str) -> StrategyDraftRecord | None:
        with self._pool.connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT draft_json FROM public.strategy_drafts WHERE id = %s AND user_id = %s",
                (draft_id, user_id),
            )
            row = cur.fetchone()
        return StrategyDraftRecord.model_validate(row[0]) if row else None

    def list_drafts_for_strategy(self, strategy_id: str, user_id: str) -> list[StrategyDraftRecord]:
        if self.get_strategy_for_user(strategy_id, user_id) is None:
            return []
        with self._pool.connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT draft_json FROM public.strategy_drafts "
                "WHERE strategy_id = %s AND user_id = %s ORDER BY created_at DESC",
                (strategy_id, user_id),
            )
            rows = cur.fetchall()
        return [StrategyDraftRecord.model_validate(row[0]) for row in rows]

    def create_version_from_draft(
        self, draft_id: str, user_id: str
    ) -> StrategyVersionRecord | None:
        draft = self.get_draft_for_user(draft_id, user_id)
        if draft is None:
            return None
        now = _now_iso()
        with self._pool.connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT MAX(version_number) FROM public.strategy_versions "
                "WHERE strategy_id = %s AND user_id = %s",
                (draft.strategy_id, user_id),
            )
            row = cur.fetchone()
            version_number = int(row[0] or 0) + 1 if row else 1
            record = StrategyVersionRecord(
                **draft.model_dump(exclude={"id", "created_at", "updated_at"}),
                id=uuid.uuid4().hex,
                draft_id=draft_id,
                version_number=version_number,
                frozen_at=now,
            )
            cur.execute(
                "INSERT INTO public.strategy_versions "
                "(id, strategy_id, draft_id, user_id, version_number, version_json, frozen_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (
                    record.id,
                    record.strategy_id,
                    draft_id,
                    user_id,
                    version_number,
                    Jsonb(record.model_dump(mode="json")),
                    now,
                ),
            )
            self._touch_strategy_sql(cur, record.strategy_id, now)
        return record

    def get_version_for_user(self, version_id: str, user_id: str) -> StrategyVersionRecord | None:
        with self._pool.connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT version_json FROM public.strategy_versions WHERE id = %s AND user_id = %s",
                (version_id, user_id),
            )
            row = cur.fetchone()
        return StrategyVersionRecord.model_validate(row[0]) if row else None

    def list_versions_for_strategy(
        self, strategy_id: str, user_id: str
    ) -> list[StrategyVersionRecord]:
        if self.get_strategy_for_user(strategy_id, user_id) is None:
            return []
        with self._pool.connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT version_json FROM public.strategy_versions "
                "WHERE strategy_id = %s AND user_id = %s ORDER BY version_number",
                (strategy_id, user_id),
            )
            rows = cur.fetchall()
        return [StrategyVersionRecord.model_validate(row[0]) for row in rows]

    def list_runs_for_strategy(self, strategy_id: str, user_id: str) -> list[StoredRun]:
        if self.get_strategy_for_user(strategy_id, user_id) is None:
            return []
        with self._pool.connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT id, user_id::text, state, request_json, progress_json, verdict_json, "
                "error, note, prompt, created_at, updated_at "
                "FROM public.runs WHERE strategy_id = %s AND user_id = %s ORDER BY created_at DESC",
                (strategy_id, user_id),
            )
            rows = cur.fetchall()
        return [self._row_to_run(row) for row in rows]

    def set_version_promoted(
        self, version_id: str, user_id: str, promoted: bool
    ) -> StrategyVersionRecord | None:
        current = self.get_version_for_user(version_id, user_id)
        if current is None:
            return None
        updated = current.model_copy(update={"promoted": promoted})
        with self._pool.connection() as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE public.strategy_versions SET version_json = %s "
                "WHERE id = %s AND user_id = %s",
                (Jsonb(updated.model_dump(mode="json")), version_id, user_id),
            )
        return updated

    def list_promoted_versions(self, user_id: str) -> list[StrategyVersionRecord]:
        with self._pool.connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT version_json FROM public.strategy_versions "
                "WHERE user_id = %s ORDER BY version_number",
                (user_id,),
            )
            rows = cur.fetchall()
        versions = [StrategyVersionRecord.model_validate(row[0]) for row in rows]
        return [v for v in versions if v.promoted]

    @staticmethod
    def _row_to_run(row: tuple[Any, ...]) -> StoredRun:
        progress = ProgressInfo.model_validate(row[4]) if row[4] is not None else None
        verdict = Verdict.model_validate(row[5]) if row[5] is not None else None
        return StoredRun(
            id=cast("str", row[0]),
            user_id=cast("str", row[1]),
            state=RunState(cast("str", row[2])),
            request=RunRequest.model_validate(row[3]),
            progress=progress,
            verdict=verdict,
            error=cast("str | None", row[6]),
            note=cast("str | None", row[7]),
            prompt=cast("str | None", row[8]),
            created_at=_db_time_to_iso(row[9]),
            updated_at=_db_time_to_iso(row[10]),
        )

    @staticmethod
    def _row_to_strategy(row: tuple[Any, ...]) -> StrategyRecord:
        return StrategyRecord(
            id=cast("str", row[0]),
            title=cast("str", row[1]),
            description=cast("str", row[2]),
            status=StrategyStatus(cast("str", row[3])),
            created_at=_db_time_to_iso(row[4]),
            updated_at=_db_time_to_iso(row[5]),
        )

    @staticmethod
    def _touch_strategy_sql(
        cur: psycopg.Cursor[tuple[Any, ...]], strategy_id: str, now: str
    ) -> None:
        cur.execute(
            "UPDATE public.strategies SET updated_at = %s WHERE id = %s",
            (now, strategy_id),
        )

    def close(self) -> None:
        self._pool.close()


def _db_time_to_iso(value: object) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return cast("str", value)


def build_store(
    backend: str,
    *,
    sqlite_path: str = "green.db",
    database_url: str | None = None,
) -> RunStore:
    if backend == "sqlite":
        return SqliteRunStore(sqlite_path)
    if backend == "postgres":
        if not database_url:
            raise ValueError("GREEN_DATABASE_URL is required when GREEN_STORE=postgres")
        return PostgresRunStore(database_url)
    return InMemoryRunStore()


__all__ = [
    "InMemoryRunStore",
    "PostgresRunStore",
    "RunStore",
    "SqliteRunStore",
    "StoredRun",
    "build_store",
]
