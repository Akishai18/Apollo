"""Shared test fixtures: mint HS256 JWTs the way Supabase does, so auth paths can
be exercised entirely offline with a known secret. Exposed as fixtures (rather
than importable functions) so the test files need no cross-module imports."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from collections.abc import Callable
from typing import Any

import pytest

# A safely-distant expiry (year 2286) so tokens minted in tests don't drift into
# "expired". Tests that check expiry pass an explicit `now` to the verifier.
FAR_FUTURE = 9_999_999_999


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _mint_hs256(payload: dict[str, Any], secret: str, *, alg: str = "HS256") -> str:
    header = _b64url(json.dumps({"alg": alg, "typ": "JWT"}).encode())
    body = _b64url(json.dumps(payload).encode())
    signature = hmac.new(secret.encode(), f"{header}.{body}".encode(), hashlib.sha256).digest()
    return f"{header}.{body}.{_b64url(signature)}"


def _user_token(sub: str, secret: str, *, audience: str = "authenticated") -> str:
    return _mint_hs256({"sub": sub, "aud": audience, "exp": FAR_FUTURE}, secret)


@pytest.fixture(autouse=True)
def _isolate_market_cache(
    tmp_path_factory: pytest.TempPathFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Never let tests (which mock the Yahoo fetch) write fake OHLCV into the
    shared `data/market_data/yahoo` cache — point the adapter at a throwaway dir."""
    monkeypatch.setenv("GREEN_MARKET_DATA_CACHE", str(tmp_path_factory.mktemp("market-cache")))


@pytest.fixture
def far_future() -> int:
    return FAR_FUTURE


@pytest.fixture
def mint_hs256() -> Callable[..., str]:
    """Build a signed JWT; `alg` is overridable to mint deliberately-bad tokens
    (alg=none / RS256) that prove the verifier pins the algorithm."""
    return _mint_hs256


@pytest.fixture
def user_token() -> Callable[..., str]:
    """Mint a valid, far-future Supabase-style token for a given subject."""
    return _user_token
