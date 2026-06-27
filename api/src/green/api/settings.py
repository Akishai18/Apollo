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

type StoreBackend = Literal["memory", "sqlite", "postgres"]


class Settings(BaseModel):
    model_config = ConfigDict(frozen=True)

    # Auth: when no verifier is configured, auth is OFF and every request is the
    # dev user (handy for local dev + the offline test suite). Modern Supabase
    # projects use JWKS/RS256; legacy projects can still use the shared HS256
    # JWT secret.
    jwt_secret: str | None = None
    jwt_jwks_url: str | None = None
    jwt_issuer: str | None = None
    jwt_audience: str = "authenticated"
    supabase_url: str | None = None
    supabase_anon_key: str | None = None
    dev_user_id: str = "local-dev"

    # Persistence: "memory" (ephemeral), "sqlite" (local durable), or "postgres"
    # (Supabase/Postgres via GREEN_DATABASE_URL).
    store: StoreBackend = "memory"
    sqlite_path: str = "green.db"
    database_url: str | None = None

    max_jobs: int = 256

    # Browser origins allowed to call the API (the Next.js frontend). Defaults to
    # the local dev server; override with GREEN_CORS_ORIGINS (comma-separated).
    cors_origins: tuple[str, ...] = ("http://localhost:3000", "http://127.0.0.1:3000")

    # Generator (NL → strategy) provider keys. When a tier's real provider has no
    # key, the generator falls back to the offline mock — so the app works in dev
    # and goes live the moment a key is set. Model ids live in green.generator.
    anthropic_api_key: str | None = None  # paid tiers (Sonnet / Opus)
    gemini_api_key: str | None = None  # free tier
    gemini_model: str | None = None  # optional override of the free model id
    default_tier: str = "free"

    @classmethod
    def from_env(cls) -> Settings:
        store = os.environ.get("GREEN_STORE", "memory")
        backend: StoreBackend
        if store == "postgres":
            backend = "postgres"
        elif store == "sqlite":
            backend = "sqlite"
        else:
            backend = "memory"
        supabase_url = (os.environ.get("GREEN_SUPABASE_URL") or "").rstrip("/")
        default_jwks = f"{supabase_url}/auth/v1/.well-known/jwks.json" if supabase_url else None
        default_issuer = f"{supabase_url}/auth/v1" if supabase_url else None
        origins_env = os.environ.get("GREEN_CORS_ORIGINS")
        origins = (
            tuple(o.strip() for o in origins_env.split(",") if o.strip())
            if origins_env
            else ("http://localhost:3000", "http://127.0.0.1:3000")
        )
        return cls(
            jwt_secret=os.environ.get("GREEN_JWT_SECRET") or None,
            jwt_jwks_url=os.environ.get("GREEN_JWT_JWKS_URL") or default_jwks,
            jwt_issuer=os.environ.get("GREEN_JWT_ISSUER") or default_issuer,
            jwt_audience=os.environ.get("GREEN_JWT_AUDIENCE", "authenticated"),
            supabase_url=supabase_url or None,
            supabase_anon_key=(
                os.environ.get("GREEN_SUPABASE_ANON_KEY")
                or os.environ.get("SUPABASE_ANON_KEY")
                or None
            ),
            dev_user_id=os.environ.get("GREEN_DEV_USER_ID", "local-dev"),
            store=backend,
            sqlite_path=os.environ.get("GREEN_SQLITE_PATH", "green.db"),
            database_url=(
                os.environ.get("GREEN_DATABASE_URL") or os.environ.get("DATABASE_URL") or None
            ),
            cors_origins=origins,
            anthropic_api_key=os.environ.get("GREEN_ANTHROPIC_API_KEY")
            or os.environ.get("ANTHROPIC_API_KEY")
            or None,
            gemini_api_key=os.environ.get("GREEN_GEMINI_API_KEY")
            or os.environ.get("GEMINI_API_KEY")
            or None,
            gemini_model=os.environ.get("GREEN_GEMINI_MODEL") or None,
            default_tier=os.environ.get("GREEN_DEFAULT_TIER", "free"),
        )

    @property
    def auth_enabled(self) -> bool:
        return self.jwt_secret is not None or self.jwt_jwks_url is not None
