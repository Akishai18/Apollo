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


class AdapterSpec(BaseModel):
    model_config = ConfigDict(frozen=True)

    name: Literal["toy", "market_data"] = "toy"
    params: dict[str, Any] = Field(default_factory=dict)


class RunRequest(BaseModel):
    model_config = ConfigDict(frozen=True)

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
