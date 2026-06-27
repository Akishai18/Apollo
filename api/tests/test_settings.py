from __future__ import annotations

from pytest import MonkeyPatch

from green.api.settings import Settings


def test_supabase_url_derives_jwks_and_issuer(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("GREEN_SUPABASE_URL", "https://project.supabase.co/")

    settings = Settings.from_env()

    assert settings.auth_enabled
    assert settings.jwt_jwks_url == "https://project.supabase.co/auth/v1/.well-known/jwks.json"
    assert settings.jwt_issuer == "https://project.supabase.co/auth/v1"


def test_postgres_store_reads_database_url(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("GREEN_STORE", "postgres")
    monkeypatch.setenv("GREEN_DATABASE_URL", "postgresql://user:pass@example.test/db")

    settings = Settings.from_env()

    assert settings.store == "postgres"
    assert settings.database_url == "postgresql://user:pass@example.test/db"
