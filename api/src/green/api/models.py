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


class GenerateRequest(BaseModel):
    """Submit a natural-language strategy description; Apollo generates the code,
    then it runs through the same gate. `tier` selects the (branded) model."""

    model_config = ConfigDict(frozen=True)

    prompt: str = Field(min_length=1)
    tier: str = "free"


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


class StrategySummary(StrategyRecord):
    latest_run: RunSummary | None = None
    latest_validation: RunSummary | None = None
    versions_count: int = 0
    runs_count: int = 0


class StrategyDetail(BaseModel):
    model_config = ConfigDict(frozen=True)

    strategy: StrategyRecord
    drafts: tuple[StrategyDraftRecord, ...] = ()
    versions: tuple[StrategyVersionRecord, ...] = ()
    runs: tuple[RunSummary, ...] = ()
