"""Transport contracts for the API. Thin DTOs over the core `Verdict` — the API
adds no business rules, only the shape of requests and responses.

A run submits untrusted strategy *source* plus how to evaluate it (adapter,
param grid, walk-forward windows). The source always runs through the sandbox;
there is no trusted in-process path here on purpose — "generated code runs
through the SAME sandbox + gates, no trust shortcut".
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from green.core import Verdict
from green.core.engine import DEFAULT_STARTING_CASH


class RunKind(StrEnum):
    BACKTEST = "backtest"
    VALIDATION = "validation"


class AdapterSpec(BaseModel):
    model_config = ConfigDict(frozen=True)

    name: Literal["toy", "market_data"] = "toy"
    params: dict[str, Any] = Field(default_factory=dict)


class RunRequest(BaseModel):
    model_config = ConfigDict(frozen=True)

    run_kind: RunKind = RunKind.BACKTEST
    strategy_id: str | None = None
    strategy_version_id: str | None = None
    source: str = Field(min_length=1)  # strategy source code (untrusted)
    class_name: str | None = None  # required only if source defines >1 Strategy
    grid: dict[str, list[Any]]  # swept on train, per window
    adapter: AdapterSpec = Field(default_factory=AdapterSpec)
    train_size: int = Field(gt=0)
    test_size: int = Field(gt=0)
    step: int | None = Field(default=None, gt=0)
    starting_cash: float = Field(default=DEFAULT_STARTING_CASH, gt=0)
    select_by: Literal["sharpe", "total_return"] = "sharpe"
    min_retention: float = 0.5
    min_oos_trades: int = 2


class GenerateContext(BaseModel):
    """Prior strategy context for an iterative Builder revision.

    The user's new prompt remains the durable run title. Context is only fed to
    the generator so it can revise the existing strategy faithfully.
    """

    model_config = ConfigDict(frozen=True)

    source: str = Field(min_length=1)
    prompt: str | None = None
    note: str | None = None


class GenerateRequest(BaseModel):
    """Submit a natural-language strategy description; Apollo generates the code,
    then it runs through the same gate. `tier` selects the (branded) model."""

    model_config = ConfigDict(frozen=True)

    prompt: str = Field(min_length=1)
    tier: str = "free"
    context: GenerateContext | None = None


class RunState(StrEnum):
    QUEUED = "queued"
    GENERATING = "generating"  # NL → strategy code (generator runs)
    RUNNING = "running"  # the walk-forward gate runs
    COMPLETED = "completed"  # the gate finished; `verdict` is populated
    ERROR = "error"  # the run failed (bad strategy, bad config); see `error`


class ProgressInfo(BaseModel):
    model_config = ConfigDict(frozen=True)

    completed: int
    total: int


class RunResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    state: RunState
    progress: ProgressInfo | None = None
    verdict: Verdict | None = None
    error: str | None = None
    note: str | None = None  # the generator's rationale (when NL-generated)
    prompt: str | None = None  # the original NL prompt (when NL-generated)
    source: str | None = None  # the strategy source that ran (for the detail view)
    symbol: str | None = None  # primary traded symbol (from the grid)
    kind: str | None = None  # strategy family, derived from the class name
    run_kind: RunKind = RunKind.BACKTEST  # product intent: exploratory vs formal gate
    strategy_id: str | None = None
    strategy_version_id: str | None = None
    # Run config — enough for the report header without re-fetching the request body.
    train_size: int | None = None
    test_size: int | None = None
    adapter: str | None = None


class StrategyChatRequest(BaseModel):
    """Ask a question about the current generated strategy/run.

    This is not a generation request: it should explain evidence, code, and next
    options without silently changing the strategy.
    """

    model_config = ConfigDict(frozen=True)

    question: str = Field(min_length=1)
    source: str = Field(min_length=1)
    prompt: str | None = None
    note: str | None = None
    verdict: Verdict | None = None
    adapter: str | None = None


class StrategyChatResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    answer: str


class RunSummary(BaseModel):
    """A lightweight row for list views — no full verdict (which now carries
    per-window sweep grids and equity curves and can be large). The detail view
    (`GET /runs/{id}`) returns the full `RunResponse`."""

    model_config = ConfigDict(frozen=True)

    id: str
    state: RunState
    title: str | None = None  # short human label (the prompt, else the class name)
    symbol: str | None = None  # primary traded symbol (from the grid), for the badge
    kind: str | None = None  # strategy family, derived from the class name
    run_kind: RunKind = RunKind.BACKTEST  # backtest or validation
    strategy_id: str | None = None
    strategy_version_id: str | None = None
    passed: bool | None = None  # from the verdict, when completed
    reason: str | None = None  # the legible one-liner, when completed
    # At-a-glance verdict metrics (populated once completed) so the list view can
    # render a rich table without N detail fetches.
    oos_sharpe: float | None = None  # held-out Sharpe, mean across windows
    edge_retained: float | None = None  # test/train Sharpe ratio (0..1)
    max_dd: float | None = None  # worst held-out drawdown across windows (fraction)
    spark: tuple[float, ...] = ()  # downsampled held-out equity, for a mini chart
    progress: ProgressInfo | None = None
    error: str | None = None
    created_at: str = ""
    updated_at: str = ""


class StrategyStatus(StrEnum):
    ACTIVE = "active"
    ARCHIVED = "archived"


class StrategyCreate(BaseModel):
    model_config = ConfigDict(frozen=True)

    title: str = Field(min_length=1, max_length=120)
    description: str = ""


class StrategyRecord(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    title: str
    description: str = ""
    status: StrategyStatus = StrategyStatus.ACTIVE
    created_at: str = ""
    updated_at: str = ""


class StrategyDraftCreate(BaseModel):
    model_config = ConfigDict(frozen=True)

    prompt: str | None = None
    rationale: str | None = None
    assumptions: tuple[str, ...] = ()
    source: str = Field(min_length=1)
    class_name: str | None = None
    grid: dict[str, list[Any]]
    adapter: AdapterSpec = Field(default_factory=AdapterSpec)
    train_size: int = Field(gt=0)
    test_size: int = Field(gt=0)
    step: int | None = Field(default=None, gt=0)
    starting_cash: float = Field(default=DEFAULT_STARTING_CASH, gt=0)
    select_by: Literal["sharpe", "total_return"] = "sharpe"
    min_retention: float = 0.5
    min_oos_trades: int = 2


class StrategyDraftUpdate(BaseModel):
    model_config = ConfigDict(frozen=True)

    prompt: str | None = None
    rationale: str | None = None
    assumptions: tuple[str, ...] | None = None
    source: str | None = Field(default=None, min_length=1)
    class_name: str | None = None
    grid: dict[str, list[Any]] | None = None
    adapter: AdapterSpec | None = None
    train_size: int | None = Field(default=None, gt=0)
    test_size: int | None = Field(default=None, gt=0)
    step: int | None = Field(default=None, gt=0)
    starting_cash: float | None = Field(default=None, gt=0)
    select_by: Literal["sharpe", "total_return"] | None = None
    min_retention: float | None = None
    min_oos_trades: int | None = None


class StrategyDraftRecord(StrategyDraftCreate):
    id: str
    strategy_id: str
    created_at: str = ""
    updated_at: str = ""


class StrategyVersionRecord(StrategyDraftCreate):
    id: str
    strategy_id: str
    draft_id: str
    version_number: int
    frozen_at: str = ""
    promoted: bool = False  # marked as a "champion" → eligible for scheduled re-validation


class StrategySummary(StrategyRecord):
    latest_run: RunSummary | None = None
    latest_validation: RunSummary | None = None
    versions_count: int = 0
    runs_count: int = 0
    promoted: bool = False  # any version promoted


class DecayAlert(BaseModel):
    """A promoted strategy whose latest held-out validation breached a threshold —
    surfaced by the decay monitor (re-validation + alerting)."""

    model_config = ConfigDict(frozen=True)

    strategy_id: str
    title: str
    symbol: str | None = None
    passed: bool | None = None
    oos_sharpe: float | None = None
    retention: float | None = None
    reason: str


class TrackedRun(BaseModel):
    """One MLflow-tracked backtest, for the in-app experiments browser."""

    model_config = ConfigDict(frozen=True)

    run_id: str
    name: str
    symbol: str | None = None
    adapter: str | None = None
    run_kind: str | None = None
    passed: bool | None = None
    oos_sharpe: float | None = None
    retention: float | None = None
    oos_trades: float | None = None
    created_at: int = 0  # epoch ms, as MLflow returns


class StrategyDetail(BaseModel):
    model_config = ConfigDict(frozen=True)

    strategy: StrategyRecord
    drafts: tuple[StrategyDraftRecord, ...] = ()
    versions: tuple[StrategyVersionRecord, ...] = ()
    runs: tuple[RunSummary, ...] = ()
