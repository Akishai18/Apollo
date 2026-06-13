"""Runtime configuration, env-driven.

Mirrors a locked decision (toy fixture for tests, real provider later): the API
runs fully offline by default — auth disabled, runs kept in memory — so the
existing tests and a quick local spin need zero setup. Point it at a Supabase
project by setting the env vars below and it persists + isolates per user.
"""

from __future__ import annotations

import os
from typing import Literal

from pydantic import BaseModel, ConfigDict

type StoreBackend = Literal["memory", "sqlite"]


class Settings(BaseModel):
    model_config = ConfigDict(frozen=True)

    # Auth: when jwt_secret is None, auth is OFF and every request is the dev user
    # (handy for local dev + the offline test suite). Set it (Supabase project's
    # JWT secret) to require + verify real bearer tokens.
    jwt_secret: str | None = None
    jwt_audience: str = "authenticated"
    dev_user_id: str = "local-dev"

    # Persistence: "memory" (ephemeral) or "sqlite" (durable, survives restart).
    # Postgres/Supabase is the same RunStore interface behind a DATABASE_URL in
    # production — see api/migrations/0001_init.sql.
    store: StoreBackend = "memory"
    sqlite_path: str = "green.db"

    max_jobs: int = 256

    @classmethod
    def from_env(cls) -> Settings:
        store = os.environ.get("GREEN_STORE", "memory")
        backend: StoreBackend = "sqlite" if store == "sqlite" else "memory"
        return cls(
            jwt_secret=os.environ.get("GREEN_JWT_SECRET") or None,
            jwt_audience=os.environ.get("GREEN_JWT_AUDIENCE", "authenticated"),
            dev_user_id=os.environ.get("GREEN_DEV_USER_ID", "local-dev"),
            store=backend,
            sqlite_path=os.environ.get("GREEN_SQLITE_PATH", "green.db"),
        )

    @property
    def auth_enabled(self) -> bool:
        return self.jwt_secret is not None
