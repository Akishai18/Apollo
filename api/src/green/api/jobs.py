"""In-process async job runner, now backed by a durable `RunStore`.

Backtests are synchronous, CPU-heavy, and (because every strategy is sandboxed)
spawn child processes — so the gate runs in a worker thread, never on the event
loop. Per-window progress is bridged back to the loop with `call_soon_threadsafe`
and fanned out to any WebSocket subscribers.

Two kinds of state, kept distinct:
- The **store** is the durable, ownership-scoped source of truth (survives
  restart; reads/lists go through it). Every lifecycle transition is mirrored in.
- The live **_Job** is ephemeral streaming machinery (subscriber queues) for the
  WebSocket; it is bounded and evicted, the store is not.

Swap the in-process pieces for Dramatiq/RQ + Redis later without the app, the
gate, or the store interface changing.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field

from green.api.models import ProgressInfo, RunRequest, RunResponse, RunState
from green.api.registry import ConfigError, build_adapter, make_strategy_factory
from green.api.store import RunStore
from green.core import Verdict, WalkForwardProgress
from green.core.overfit.gate import ProgressHook, run_walk_forward

# Put on a subscriber's queue to signal "no more events" (the run is terminal).
_SENTINEL = object()


def _new_subscribers() -> set[asyncio.Queue[object]]:
    return set()


@dataclass
class _Job:
    """Live streaming state for one run. Durable state lives in the store."""

    id: str
    user_id: str
    request: RunRequest
    state: RunState = RunState.QUEUED
    progress: WalkForwardProgress | None = None
    verdict: Verdict | None = None
    error: str | None = None
    subscribers: set[asyncio.Queue[object]] = field(default_factory=_new_subscribers)
    done: asyncio.Event = field(default_factory=asyncio.Event)

    def snapshot(self) -> RunResponse:
        progress = (
            ProgressInfo(completed=self.progress.completed, total=self.progress.total)
            if self.progress is not None
            else None
        )
        return RunResponse(
            id=self.id,
            state=self.state,
            progress=progress,
            verdict=self.verdict,
            error=self.error,
        )


class JobRunner:
    """Owns submitted runs and their lifecycle. One instance per app.

    `max_jobs` bounds the *live* in-memory job map by evicting the oldest
    finished runs (a running run is never evicted; an in-flight WebSocket stream
    holds its own reference, so eviction from the live map never breaks it). The
    durable store is unaffected — finished runs remain queryable there.
    """

    def __init__(self, store: RunStore, *, max_jobs: int = 256) -> None:
        self._store = store
        self._jobs: dict[str, _Job] = {}
        self._tasks: set[asyncio.Task[None]] = set()
        self._max_jobs = max_jobs

    def submit(self, user_id: str, request: RunRequest) -> str:
        run_id = uuid.uuid4().hex
        self._store.create(run_id, user_id, request)
        job = _Job(id=run_id, user_id=user_id, request=request)
        self._jobs[run_id] = job
        self._evict_finished()
        task = asyncio.create_task(self._run(job))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return run_id

    def get(self, run_id: str, user_id: str) -> RunResponse | None:
        run = self._store.get_for_user(run_id, user_id)
        return run.to_response() if run is not None else None

    def list_for_user(self, user_id: str) -> list[RunResponse]:
        return [run.to_response() for run in self._store.list_for_user(user_id)]

    async def stream(self, run_id: str, user_id: str) -> AsyncGenerator[RunResponse, None] | None:
        """Ownership-checked stream. None if the run is unknown or not the user's.
        The caller must `aclose()` it (the WS handler does, even on early client
        disconnect) so the subscriber is dropped promptly rather than at GC time."""
        stored = self._store.get_for_user(run_id, user_id)
        if stored is None:
            return None
        live = self._jobs.get(run_id)
        if live is None:
            return self._stream_once(stored.to_response())
        return self._stream(live)

    async def _stream_once(self, snapshot: RunResponse) -> AsyncGenerator[RunResponse, None]:
        # A run that finished and was evicted from the live map (or predates a
        # restart): just hand back its terminal snapshot.
        yield snapshot

    async def _stream(self, job: _Job) -> AsyncGenerator[RunResponse, None]:
        queue: asyncio.Queue[object] = asyncio.Queue()
        job.subscribers.add(queue)
        try:
            yield job.snapshot()  # current state up front (may already be terminal)
            if job.done.is_set():
                return
            while True:
                item = await queue.get()
                if item is _SENTINEL:
                    break
                assert isinstance(item, _Job)
                yield item.snapshot()
        finally:
            job.subscribers.discard(queue)

    def _evict_finished(self) -> None:
        # dict preserves insertion order → iterate oldest-first, drop terminal runs.
        for run_id in list(self._jobs):
            if len(self._jobs) <= self._max_jobs:
                return
            if self._jobs[run_id].done.is_set():
                del self._jobs[run_id]

    async def _run(self, job: _Job) -> None:
        job.state = RunState.RUNNING
        self._store.update(job.id, state=RunState.RUNNING)
        loop = asyncio.get_running_loop()

        def on_progress(progress: WalkForwardProgress) -> None:
            # Fires on the worker thread — hop back onto the loop to mutate state
            # and notify subscribers safely.
            loop.call_soon_threadsafe(self._publish_progress, job, progress)

        # Ordering note: the last on_progress is scheduled (call_soon_threadsafe)
        # before _execute returns, and the to_thread completion that resumes this
        # coroutine is scheduled after — call_soon callbacks run FIFO, so every
        # progress event is published before _finish runs. Do not reorder.
        try:
            verdict = await asyncio.to_thread(self._execute, job.request, on_progress)
        except ConfigError as exc:
            job.state, job.error = RunState.ERROR, str(exc)
            self._store.update(job.id, state=RunState.ERROR, error=job.error)
        except Exception as exc:  # sandbox crash/timeout/violation, bad config, etc.
            job.state, job.error = RunState.ERROR, f"{type(exc).__name__}: {exc}"
            self._store.update(job.id, state=RunState.ERROR, error=job.error)
        else:
            job.state, job.verdict = RunState.COMPLETED, verdict
            self._store.update(job.id, state=RunState.COMPLETED, verdict=verdict)
        finally:
            self._finish(job)

    @staticmethod
    def _execute(request: RunRequest, on_progress: ProgressHook) -> Verdict:
        # Runs on a worker thread (sandboxed gate spawns child processes).
        adapter, dataset = build_adapter(request.adapter)
        factory = make_strategy_factory(request)
        return run_walk_forward(
            factory,
            adapter,
            dataset,
            request.grid,
            train_size=request.train_size,
            test_size=request.test_size,
            step=request.step,
            starting_cash=request.starting_cash,
            select_by=request.select_by,
            min_retention=request.min_retention,
            min_oos_trades=request.min_oos_trades,
            progress=on_progress,
        )

    def _publish_progress(self, job: _Job, progress: WalkForwardProgress) -> None:
        job.progress = progress
        self._store.update(
            job.id, progress=ProgressInfo(completed=progress.completed, total=progress.total)
        )
        for queue in job.subscribers:
            queue.put_nowait(job)

    def _finish(self, job: _Job) -> None:
        job.done.set()
        for queue in job.subscribers:
            queue.put_nowait(job)  # deliver the terminal snapshot...
            queue.put_nowait(_SENTINEL)  # ...then close the stream
        # A burst of submits can outrun submit-time eviction (nothing is finished
        # yet); evicting here too bounds the live map as runs complete.
        self._evict_finished()
