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
import json
import os
import re
import uuid
from collections.abc import AsyncGenerator, Callable
from dataclasses import dataclass, field
from typing import Any

from green.api.models import (
    AdapterSpec,
    DecayAlert,
    ProgressInfo,
    RunKind,
    RunRequest,
    RunResponse,
    RunState,
    RunSummary,
    StrategyCreate,
    StrategyDetail,
    StrategyDraftCreate,
    StrategyDraftRecord,
    StrategyDraftUpdate,
    StrategyRecord,
    StrategySummary,
    StrategyVersionRecord,
)
from green.api.registry import ConfigError, build_adapter, make_strategy_factory
from green.api.store import RunStore, StoredRun, kind_from_class, symbol_of
from green.core import Verdict, WalkForwardProgress
from green.core.overfit.gate import ProgressHook, run_walk_forward
from green.generator import GenerationError, generate_validated
from green.sandbox import SandboxError

# Put on a subscriber's queue to signal "no more events" (the run is terminal).
_SENTINEL = object()

# Environment + windows for NL-generated preview runs. Builder should feel fast:
# it proves the generated code can run through the sandbox + gate, then the user
# can promote the frozen version to the larger formal validation gate.
_GEN_PREVIEW_ADAPTER = AdapterSpec(
    name="toy", params={"n_steps": 180, "mu": 100.0, "theta": 0.1, "sigma": 1.0, "seed": 7}
)
_GEN_PREVIEW_TRAIN = 80
_GEN_PREVIEW_TEST = 50
_GEN_MARKET_PREVIEW_TRAIN = 120
_GEN_MARKET_PREVIEW_TEST = 60

# Formal defaults for generated strategies once the user explicitly validates.
_GEN_FORMAL_ADAPTER = AdapterSpec(
    name="toy", params={"n_steps": 600, "mu": 100.0, "theta": 0.1, "sigma": 1.0, "seed": 7}
)
_GEN_FORMAL_TRAIN = 200
_GEN_FORMAL_TEST = 100
_GEN_MARKET_FORMAL_TRAIN = 200
_GEN_MARKET_FORMAL_TEST = 100

# A throwaway request stored at generation-job creation, replaced once the
# generator produces real source (the store row only needs *a* valid request).
_PLACEHOLDER_REQUEST = RunRequest(
    run_kind=RunKind.BACKTEST,
    source="# pending generation",
    grid={"symbol": ["SYN"]},
    adapter=_GEN_PREVIEW_ADAPTER,
    train_size=_GEN_PREVIEW_TRAIN,
    test_size=_GEN_PREVIEW_TEST,
)


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
    note: str | None = None  # generator rationale (NL runs)
    prompt: str | None = None  # NL prompt (generation jobs)
    generation_prompt: str | None = None  # internal prompt, may include revision context
    tier: str | None = None  # branded tier (generation jobs)
    subscribers: set[asyncio.Queue[object]] = field(default_factory=_new_subscribers)
    done: asyncio.Event = field(default_factory=asyncio.Event)

    @property
    def is_generation(self) -> bool:
        return self.prompt is not None

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
            note=self.note,
            prompt=self.prompt,
            source=self.request.source,
            symbol=symbol_of(self.request),
            kind=kind_from_class(self.request.class_name),
            run_kind=self.request.run_kind,
            train_size=self.request.train_size,
            test_size=self.request.test_size,
            adapter=self.request.adapter.name,
        )


class JobRunner:
    """Owns submitted runs and their lifecycle. One instance per app.

    `max_jobs` bounds the *live* in-memory job map by evicting the oldest
    finished runs (a running run is never evicted; an in-flight WebSocket stream
    holds its own reference, so eviction from the live map never breaks it). The
    durable store is unaffected — finished runs remain queryable there.
    """

    def __init__(
        self,
        store: RunStore,
        *,
        max_jobs: int = 256,
        anthropic_key: str | None = None,
        gemini_key: str | None = None,
        gemini_model: str | None = None,
    ) -> None:
        self._store = store
        self._jobs: dict[str, _Job] = {}
        self._tasks: set[asyncio.Task[None]] = set()
        self._max_jobs = max_jobs
        self._anthropic_key = anthropic_key
        self._gemini_key = gemini_key
        self._gemini_model = gemini_model

    def submit(self, user_id: str, request: RunRequest) -> str:
        return self._start(user_id, _Job(id=uuid.uuid4().hex, user_id=user_id, request=request))

    def submit_version(self, user_id: str, version_id: str, kind: RunKind) -> str | None:
        version = self._store.get_version_for_user(version_id, user_id)
        if version is None:
            return None
        request = RunRequest(
            run_kind=kind,
            strategy_id=version.strategy_id,
            strategy_version_id=version.id,
            source=version.source,
            class_name=version.class_name,
            grid=version.grid,
            adapter=version.adapter,
            train_size=version.train_size,
            test_size=version.test_size,
            step=version.step,
            starting_cash=version.starting_cash,
            select_by=version.select_by,
            min_retention=version.min_retention,
            min_oos_trades=version.min_oos_trades,
        )
        if kind is RunKind.VALIDATION and version.prompt:
            request = _formal_generated_request(request)
        new_id = self._start(user_id, _Job(id=uuid.uuid4().hex, user_id=user_id, request=request))
        if version.prompt:
            self._store.update(new_id, prompt=version.prompt)
        if version.rationale:
            self._store.update(new_id, note=version.rationale)
        return new_id

    def submit_validation_from_run(self, user_id: str, run_id: str) -> str | None:
        source = self._store.get_for_user(run_id, user_id)
        if source is None:
            return None
        request = source.request.model_copy(update={"run_kind": RunKind.VALIDATION})
        if source.prompt:
            request = _formal_generated_request(request)
        new_id = self._start(user_id, _Job(id=uuid.uuid4().hex, user_id=user_id, request=request))
        self._copy_label(source, new_id)
        return new_id

    def submit_generation(
        self, user_id: str, prompt: str, tier: str, *, generation_prompt: str | None = None
    ) -> str:
        """Submit a natural-language run: generate the strategy, then gate it."""
        return self._start(
            user_id,
            _Job(
                id=uuid.uuid4().hex,
                user_id=user_id,
                request=_PLACEHOLDER_REQUEST,
                prompt=prompt,
                generation_prompt=generation_prompt,
                tier=tier,
            ),
        )

    def _start(self, user_id: str, job: _Job) -> str:
        self._store.create(job.id, user_id, job.request)
        if job.prompt is not None:
            self._store.update(job.id, prompt=job.prompt)  # surface it in lists/sidebar now
        self._jobs[job.id] = job
        self._evict_finished()
        task = asyncio.create_task(self._run(job))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return job.id

    def _copy_label(self, source: StoredRun, run_id: str) -> None:
        if source.prompt:
            self._store.update(run_id, prompt=source.prompt)

    def get(self, run_id: str, user_id: str) -> RunResponse | None:
        run = self._store.get_for_user(run_id, user_id)
        return run.to_response() if run is not None else None

    def list_for_user(self, user_id: str) -> list[RunSummary]:
        return [run.to_summary() for run in self._store.list_for_user(user_id)]

    def create_strategy(self, user_id: str, body: StrategyCreate) -> StrategyRecord:
        return self._store.create_strategy(user_id, body)

    def list_strategies_for_user(self, user_id: str) -> list[StrategySummary]:
        return [
            self._strategy_summary(user_id, strategy)
            for strategy in self._store.list_strategies_for_user(user_id)
        ]

    def get_strategy_detail(self, user_id: str, strategy_id: str) -> StrategyDetail | None:
        strategy = self._store.get_strategy_for_user(strategy_id, user_id)
        if strategy is None:
            return None
        return StrategyDetail(
            strategy=strategy,
            drafts=tuple(self._store.list_drafts_for_strategy(strategy_id, user_id)),
            versions=tuple(self._store.list_versions_for_strategy(strategy_id, user_id)),
            runs=tuple(
                run.to_summary() for run in self._store.list_runs_for_strategy(strategy_id, user_id)
            ),
        )

    def create_draft(
        self, user_id: str, strategy_id: str, body: StrategyDraftCreate
    ) -> StrategyDraftRecord | None:
        return self._store.create_draft(strategy_id, user_id, body)

    def update_draft(
        self, user_id: str, draft_id: str, body: StrategyDraftUpdate
    ) -> StrategyDraftRecord | None:
        return self._store.update_draft(draft_id, user_id, body)

    def create_version_from_draft(
        self, user_id: str, draft_id: str
    ) -> StrategyVersionRecord | None:
        return self._store.create_version_from_draft(draft_id, user_id)

    def _strategy_summary(self, user_id: str, strategy: StrategyRecord) -> StrategySummary:
        runs = [
            run.to_summary() for run in self._store.list_runs_for_strategy(strategy.id, user_id)
        ]
        versions = self._store.list_versions_for_strategy(strategy.id, user_id)
        latest_run = max(runs, key=lambda run: run.updated_at, default=None)
        validations = [run for run in runs if run.run_kind is RunKind.VALIDATION]
        latest_validation = max(validations, key=lambda run: run.updated_at, default=None)
        return StrategySummary(
            **strategy.model_dump(),
            latest_run=latest_run,
            latest_validation=latest_validation,
            versions_count=len(versions),
            runs_count=len(runs),
            promoted=any(v.promoted for v in versions),
        )

    def promote_strategy(self, user_id: str, strategy_id: str, promoted: bool) -> bool:
        """Promote/demote a strategy by toggling its latest version's flag. Promoted
        versions are what scheduled re-validation re-runs on fresh data."""
        versions = self._store.list_versions_for_strategy(strategy_id, user_id)
        if not versions:
            return False
        latest = max(versions, key=lambda v: v.version_number)
        # demote any other promoted versions so a strategy has one champion
        for v in versions:
            if v.promoted and v.id != latest.id:
                self._store.set_version_promoted(v.id, user_id, False)
        return self._store.set_version_promoted(latest.id, user_id, promoted) is not None

    def revalidate_promoted(self, user_id: str) -> list[str]:
        """Re-run formal validation for every promoted version (on current data).
        Returns the new run ids. Powers scheduled decay monitoring."""
        run_ids: list[str] = []
        for version in self._store.list_promoted_versions(user_id):
            run_id = self.submit_version(user_id, version.id, RunKind.VALIDATION)
            if run_id is not None:
                run_ids.append(run_id)
        return run_ids

    def decay_alerts(self, user_id: str, min_oos_sharpe: float) -> list[DecayAlert]:
        """Promoted strategies whose latest completed validation breached the bar
        (rejected out-of-sample, or held-out Sharpe below `min_oos_sharpe`)."""
        alerts: list[DecayAlert] = []
        seen: set[str] = set()
        for version in self._store.list_promoted_versions(user_id):
            sid = version.strategy_id
            if sid in seen:
                continue
            seen.add(sid)
            strategy = self._store.get_strategy_for_user(sid, user_id)
            if strategy is None:
                continue
            validations = [
                r
                for r in self._store.list_runs_for_strategy(sid, user_id)
                if r.request.run_kind is RunKind.VALIDATION
                and r.state is RunState.COMPLETED
                and r.verdict is not None
            ]
            if not validations:
                vals = version.grid.get("symbol", [])
                alerts.append(
                    DecayAlert(
                        strategy_id=sid,
                        title=strategy.title,
                        symbol=str(vals[0]) if vals else None,
                        reason="promoted but never validated",
                    )
                )
                continue
            latest = max(validations, key=lambda r: r.updated_at)
            v = latest.verdict
            assert v is not None
            reason = ""
            if not v.passed:
                reason = "rejected out-of-sample"
            elif v.test_sharpe < min_oos_sharpe:
                reason = f"held-out Sharpe {v.test_sharpe:.2f} below {min_oos_sharpe:.2f}"
            if reason:
                alerts.append(
                    DecayAlert(
                        strategy_id=sid,
                        title=strategy.title,
                        symbol=symbol_of(latest.request),
                        passed=v.passed,
                        oos_sharpe=v.test_sharpe,
                        retention=v.retention,
                        reason=reason,
                    )
                )
        return alerts

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
        initial = RunState.GENERATING if job.is_generation else RunState.RUNNING
        job.state = initial
        self._store.update(job.id, state=initial)
        loop = asyncio.get_running_loop()

        def on_progress(progress: WalkForwardProgress) -> None:
            # Fires on the worker thread — hop back onto the loop to mutate state
            # and notify subscribers safely.
            loop.call_soon_threadsafe(self._publish_progress, job, progress)

        def on_generated(
            note: str, strategy_request: RunRequest, preview_request: RunRequest
        ) -> None:
            # Generation finished; flip GENERATING → RUNNING and surface the
            # generator's rationale + the code it wrote, from the worker thread.
            loop.call_soon_threadsafe(
                self._publish_generated, job, note, strategy_request, preview_request
            )

        # Ordering note: the last on_progress is scheduled (call_soon_threadsafe)
        # before _execute returns, and the to_thread completion that resumes this
        # coroutine is scheduled after — call_soon callbacks run FIFO, so every
        # progress event is published before _finish runs. Do not reorder.
        try:
            verdict = await asyncio.to_thread(self._execute, job, on_progress, on_generated)
        except (ConfigError, GenerationError) as exc:
            job.state, job.error = RunState.ERROR, str(exc)
            self._store.update(job.id, state=RunState.ERROR, error=job.error)
        except Exception as exc:  # sandbox crash/timeout/violation, bad config, etc.
            job.state, job.error = RunState.ERROR, f"{type(exc).__name__}: {exc}"
            self._store.update(job.id, state=RunState.ERROR, error=job.error)
        else:
            job.state, job.verdict = RunState.COMPLETED, verdict
            self._store.update(job.id, state=RunState.COMPLETED, verdict=verdict)
            await asyncio.to_thread(_log_mlflow, job, verdict)  # best-effort, off the loop
        finally:
            self._finish(job)

    def _execute(
        self,
        job: _Job,
        on_progress: ProgressHook,
        on_generated: Callable[[str, RunRequest, RunRequest], None],
    ) -> Verdict:
        # Runs on a worker thread (generation does network I/O; the sandboxed gate
        # spawns child processes — neither belongs on the event loop).
        if job.is_generation:
            return self._generate_and_run(job, on_progress, on_generated)
        return self._run_gate(
            job.request,
            allow_fallback=job.request.run_kind is RunKind.VALIDATION,
            on_progress=on_progress,
        )

    def _generate_and_run(
        self,
        job: _Job,
        on_progress: ProgressHook,
        on_generated: Callable[[str, RunRequest, RunRequest], None],
    ) -> Verdict:
        """Generate → preview-run → on a sandbox crash, regenerate with the crash
        fed back as guidance, up to the runtime-repair budget. Iron-clad: the user
        never sees a raw traceback — either a working strategy or a clean message."""
        assert job.prompt is not None
        feedback: str | None = None
        for _ in range(_GEN_RUNTIME_REPAIRS + 1):
            gen, _cfg = generate_validated(
                job.generation_prompt or job.prompt,
                job.tier or "free",
                anthropic_key=self._anthropic_key,
                gemini_key=self._gemini_key,
                gemini_model=self._gemini_model,
                extra_feedback=feedback,
            )
            grid = _grid_with_prompt_symbol(gen.grid(), job.prompt)
            full = RunRequest(
                run_kind=RunKind.BACKTEST,
                source=gen.source,
                class_name=gen.class_name or None,
                grid=grid,
                adapter=_generated_adapter(grid),
                train_size=_generated_train_size(grid),
                test_size=_generated_test_size(grid),
                min_oos_trades=0,
            )
            preview = _preview_generated_request(full)
            on_generated(gen.rationale, full, preview)
            try:
                return self._run_gate(preview, allow_fallback=True, on_progress=on_progress)
            except SandboxError as exc:
                feedback = _runtime_feedback(exc)  # the generated code crashed — fix it
        raise GenerationError(
            "Apollo couldn't produce a working strategy for this after several attempts — "
            "try rephrasing the idea or simplifying the rules."
        )

    def _run_gate(
        self, request: RunRequest, *, allow_fallback: bool, on_progress: ProgressHook
    ) -> Verdict:
        # Iron-tight: a generated/validation run must never hard-error because a
        # market-data symbol can't be loaded (typo, odd phrasing, delisted, no
        # rows). Fall back to the synthetic series so the user still gets a verdict.
        try:
            adapter, dataset = build_adapter(request.adapter)
        except Exception:
            if allow_fallback and request.adapter.name == "market_data":
                request = _synthetic_fallback(request)
                adapter, dataset = build_adapter(request.adapter)
            else:
                raise
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

    def _publish_generated(
        self, job: _Job, note: str, strategy_request: RunRequest, request: RunRequest
    ) -> None:
        job.note = note
        if job.prompt is not None and strategy_request.strategy_id is None:
            strategy = self._store.create_strategy(
                job.user_id,
                StrategyCreate(
                    title=_title_from_prompt(job.prompt),
                    description="Generated in Builder.",
                ),
            )
            draft = self._store.create_draft(
                strategy.id,
                job.user_id,
                StrategyDraftCreate(
                    prompt=job.prompt,
                    rationale=note,
                    source=strategy_request.source,
                    class_name=strategy_request.class_name,
                    grid=strategy_request.grid,
                    adapter=strategy_request.adapter,
                    train_size=strategy_request.train_size,
                    test_size=strategy_request.test_size,
                    step=strategy_request.step,
                    starting_cash=strategy_request.starting_cash,
                    select_by=strategy_request.select_by,
                    min_retention=strategy_request.min_retention,
                    min_oos_trades=strategy_request.min_oos_trades,
                ),
            )
            if draft is not None:
                version = self._store.create_version_from_draft(draft.id, job.user_id)
                if version is not None:
                    request = request.model_copy(
                        update={
                            "strategy_id": strategy.id,
                            "strategy_version_id": version.id,
                            "run_kind": RunKind.BACKTEST,
                        }
                    )
        job.request = request  # the real generated code (replaces the placeholder)
        job.state = RunState.RUNNING
        self._store.update(job.id, state=RunState.RUNNING, note=note, request=request)
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


def _title_from_prompt(prompt: str) -> str:
    compact = " ".join(prompt.strip().split())
    if not compact:
        return "Untitled strategy"
    return compact if len(compact) <= 80 else f"{compact[:79]}…"


# Common words / indicator acronyms that look like tickers but aren't, so we
# never route them to a market-data fetch. (A wrong guess that slips through is
# still caught by the synthetic fallback in _execute — this just reduces noise.)
_SYMBOL_STOPWORDS = frozenset(
    {
        # articles / prepositions / conjunctions / verbs that scan as tickers
        "A",
        "AN",
        "AND",
        "AS",
        "AT",
        "BE",
        "BY",
        "DO",
        "FOR",
        "GO",
        "IF",
        "IN",
        "IS",
        "IT",
        "ME",
        "MY",
        "NO",
        "OF",
        "ON",
        "OR",
        "SO",
        "TO",
        "UP",
        "US",
        "WE",
        "THE",
        "WHEN",
        "WITH",
        "THAT",
        "THIS",
        "FROM",
        "INTO",
        "OVER",
        "THEN",
        # strategy / trading vocabulary
        "BUY",
        "SELL",
        "EXIT",
        "HOLD",
        "LONG",
        "SHORT",
        "FAST",
        "SLOW",
        "MEAN",
        "STOCK",
        "STOCKS",
        "SHARE",
        "SHARES",
        "EQUITY",
        "PRICE",
        "TREND",
        "CROSS",
        "BAND",
        "STOP",
        "RISK",
        "PROFIT",
        "LOSS",
        "TRADE",
        "TRADES",
        "BUILD",
        "STRATEGY",
        "AROUND",
        "MAXIMIZE",
        "MARKET",
        "DAILY",
        "WEEKLY",
        "AVERAGE",
        # indicator acronyms (not tickers)
        "MA",
        "SMA",
        "EMA",
        "WMA",
        "RSI",
        "ATR",
        "MACD",
        "VWAP",
        "ADX",
        "BB",
        "OHLC",
        "PNL",
        "ROI",
        "ETF",
        "AI",
        "ML",
    }
)

_TICKER = r"[A-Za-z][A-Za-z.\-]{0,5}"


_BEFORE_NOUN = re.compile(rf"\b({_TICKER})\s+(?:stock|shares?|equity|etf|index)\b", re.IGNORECASE)
_AFTER_KEYWORD = re.compile(rf"\b(?:ticker|symbol|on|trade|trading)\s+({_TICKER})\b", re.IGNORECASE)
_UPPER_TOKEN = re.compile(r"\b[A-Z][A-Z0-9.\-]{1,5}\b")


def _plausible_symbol(candidate: str) -> bool:
    if candidate in _SYMBOL_STOPWORDS:
        return False
    return bool(re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,5}", candidate))


def _prompt_symbol(prompt: str) -> str | None:
    """Best-effort ticker extraction from a natural-language prompt. Ordered from
    most to least explicit; a wrong guess is harmless (the run falls back to a
    synthetic series rather than erroring)."""
    # 1) "<TICKER> stock/shares/equity" — the ticker precedes the noun ("sls stock")
    # 2) "ticker/symbol/on/trade <TICKER>" — the ticker follows the keyword
    for pattern in (_BEFORE_NOUN, _AFTER_KEYWORD):
        for m in pattern.finditer(prompt):
            c = m.group(1).upper()
            if _plausible_symbol(c):
                return c
    # 3) an explicit upper-case ticker token (AAPL, SPY, KO)
    for token in _UPPER_TOKEN.findall(prompt):
        if _plausible_symbol(token):
            return token
    return None


def _grid_with_prompt_symbol(grid: dict[str, list[Any]], prompt: str) -> dict[str, list[Any]]:
    symbol = _prompt_symbol(prompt)
    current = _grid_symbols(grid)
    if symbol is None or any(_is_real_symbol(s) for s in current):
        return grid
    return {**grid, "symbol": [symbol]}


def _grid_symbols(grid: dict[str, list[Any]]) -> tuple[str, ...]:
    values = grid.get("symbol", [])
    return tuple(str(value).strip().upper() for value in values if str(value).strip())


def _real_symbols(grid: dict[str, list[Any]]) -> tuple[str, ...]:
    return tuple(symbol for symbol in _grid_symbols(grid) if _is_real_symbol(symbol))


def _is_real_symbol(symbol: str) -> bool:
    return symbol != "SYN" and bool(re.fullmatch(r"[A-Z][A-Z0-9.-]{0,6}", symbol))


def _generated_adapter(grid: dict[str, list[Any]]) -> AdapterSpec:
    symbols = _real_symbols(grid)
    if not symbols:
        return _GEN_PREVIEW_ADAPTER
    costs = {"fee_per_share": 0.005, "slippage_bps": 1.0, "max_position": 1000.0}
    # Prefer the governed Delta source when Databricks is configured; else Yahoo.
    if os.environ.get("GREEN_DATABRICKS_HOST"):
        return AdapterSpec(
            name="market_data",
            params={"provider": "delta", "symbols": list(symbols), **costs},
        )
    return AdapterSpec(
        name="market_data",
        params={
            "provider": "yahoo",
            "symbols": list(symbols),
            "period": "2y",
            "interval": "1d",
            "auto_adjust": True,
            **costs,
        },
    )


# How many times to regenerate after the generated code crashes in the sandbox
# before giving up with a clean message (total attempts = this + 1).
_GEN_RUNTIME_REPAIRS = 2


def _log_mlflow(job: _Job, verdict: Verdict) -> None:
    """Log a completed run to MLflow (params, OOS metrics, source) when a tracking
    URI is configured. Best-effort: tracking must never break a validation run."""
    uri = os.environ.get("GREEN_MLFLOW_TRACKING_URI")
    if not uri:
        return
    try:
        import mlflow  # lazy: only needed when tracking is on

        if uri == "databricks":  # reuse the Delta workspace creds for MLflow auth
            host = os.environ.get("GREEN_DATABRICKS_HOST", "")
            os.environ.setdefault(
                "DATABRICKS_HOST", host if host.startswith("http") else f"https://{host}"
            )
            os.environ.setdefault("DATABRICKS_TOKEN", os.environ.get("GREEN_DATABRICKS_TOKEN", ""))
        mlflow.set_tracking_uri(uri)
        mlflow.set_experiment(os.environ.get("GREEN_MLFLOW_EXPERIMENT", "apollo"))

        req = job.request
        run_name = (job.prompt or req.class_name or "backtest")[:60]
        with mlflow.start_run(run_name=run_name):
            mlflow.set_tags(
                {
                    "symbol": symbol_of(req) or "SYN",
                    "adapter": req.adapter.name,
                    "run_kind": req.run_kind.value,
                    "tier": job.tier or "n/a",
                    "passed": str(verdict.passed),
                }
            )
            mlflow.log_params(
                {
                    "train_size": req.train_size,
                    "test_size": req.test_size,
                    "select_by": req.select_by,
                    "grid": json.dumps(req.grid)[:500],
                }
            )
            mlflow.log_metrics(
                {
                    "oos_sharpe": verdict.test_sharpe,
                    "is_sharpe": verdict.train_sharpe,
                    "retention": verdict.retention,
                    "oos_trades": float(verdict.oos_trades),
                    "windows": float(len(verdict.windows)),
                    "passed": 1.0 if verdict.passed else 0.0,
                }
            )
            mlflow.log_text(verdict.reason, "verdict.txt")
            mlflow.log_text(req.source, "strategy.py")
    except Exception:
        pass


def _runtime_feedback(exc: SandboxError) -> str:
    """Turn a sandbox crash into concise guidance the model can act on."""
    lines = [line.strip() for line in str(exc).splitlines() if line.strip()]
    detail = lines[-1] if lines else str(exc)
    return (
        f"Your previous strategy crashed at runtime: {detail}. Fix this bug. "
        "Use the MarketView API correctly: history values are sequences (safe for "
        "len()/indexing) while a single price is a float — never call len() on a "
        "scalar or index it. Guard against short history at the start of the series. "
        "Return a corrected strategy."
    )


def _synthetic_fallback(request: RunRequest) -> RunRequest:
    """Recast a (market-data) request onto the deterministic synthetic series so a
    run that can't load real data still completes with a verdict."""
    grid = {**request.grid, "symbol": ["SYN"]}
    return request.model_copy(
        update={
            "adapter": _GEN_PREVIEW_ADAPTER,
            "grid": grid,
            "train_size": _GEN_PREVIEW_TRAIN,
            "test_size": _GEN_PREVIEW_TEST,
        }
    )


def _generated_train_size(grid: dict[str, list[Any]]) -> int:
    return _GEN_MARKET_PREVIEW_TRAIN if _real_symbols(grid) else _GEN_PREVIEW_TRAIN


def _generated_test_size(grid: dict[str, list[Any]]) -> int:
    return _GEN_MARKET_PREVIEW_TEST if _real_symbols(grid) else _GEN_PREVIEW_TEST


def _generated_formal_adapter(grid: dict[str, list[Any]]) -> AdapterSpec:
    adapter = _generated_adapter(grid)
    if adapter.name != "market_data":
        return _GEN_FORMAL_ADAPTER
    return adapter


def _preview_generated_request(request: RunRequest) -> RunRequest:
    grid = {key: values[:1] for key, values in request.grid.items()}
    return request.model_copy(
        update={
            "adapter": _generated_adapter(grid),
            "train_size": _generated_train_size(grid),
            "test_size": _generated_test_size(grid),
            "grid": grid,
            "min_oos_trades": 0,
        }
    )


def _formal_generated_request(request: RunRequest) -> RunRequest:
    is_market = bool(_real_symbols(request.grid))
    return request.model_copy(
        update={
            "adapter": _generated_formal_adapter(request.grid),
            "train_size": _GEN_MARKET_FORMAL_TRAIN if is_market else _GEN_FORMAL_TRAIN,
            "test_size": _GEN_MARKET_FORMAL_TEST if is_market else _GEN_FORMAL_TEST,
            "min_oos_trades": max(request.min_oos_trades, 2),
        }
    )
