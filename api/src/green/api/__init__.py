"""green.api — FastAPI backend, the authoritative brain.

Submit untrusted strategy source + a config, run the walk-forward overfit gate
with every strategy instance sandboxed, stream per-window progress over a
WebSocket, and fetch the verdict. Runs are persisted (durably, scoped per user)
and auth is JWT-based. All heavy/long compute lives here and in the sandbox —
never in a Supabase edge function (see api/CLAUDE.md).
"""

from green.api.app import app, create_app
from green.api.auth import AuthError, Principal, verify_supabase_jwt
from green.api.jobs import JobRunner
from green.api.models import (
    AdapterSpec,
    ProgressInfo,
    RunRequest,
    RunResponse,
    RunState,
)
from green.api.settings import Settings
from green.api.store import InMemoryRunStore, RunStore, SqliteRunStore, StoredRun, build_store

__all__ = [
    "AdapterSpec",
    "AuthError",
    "InMemoryRunStore",
    "JobRunner",
    "Principal",
    "ProgressInfo",
    "RunRequest",
    "RunResponse",
    "RunState",
    "RunStore",
    "Settings",
    "SqliteRunStore",
    "StoredRun",
    "app",
    "build_store",
    "create_app",
    "verify_supabase_jwt",
]
