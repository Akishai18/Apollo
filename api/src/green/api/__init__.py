"""green.api — FastAPI backend, the authoritative brain.

Submit untrusted strategy source + a config, run the walk-forward overfit gate
with every strategy instance sandboxed, stream per-window progress over a
WebSocket, and fetch the verdict. All heavy/long compute lives here and in the
sandbox — never in a Supabase edge function (see api/CLAUDE.md).
"""

from green.api.app import app, create_app
from green.api.jobs import JobRunner
from green.api.models import (
    AdapterSpec,
    ProgressInfo,
    RunRequest,
    RunResponse,
    RunState,
)

__all__ = [
    "AdapterSpec",
    "JobRunner",
    "ProgressInfo",
    "RunRequest",
    "RunResponse",
    "RunState",
    "app",
    "create_app",
]
