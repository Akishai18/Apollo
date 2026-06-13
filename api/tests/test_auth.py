"""JWT verification — the security-critical bits, proven offline.

The headline test is alg-pinning: a token claiming a different algorithm (or
`none`) is rejected, which is the classic JWT bypass. Plus signature, expiry,
audience, and subject checks. Minting helpers come from conftest fixtures.
"""

from __future__ import annotations

from collections.abc import Callable

import pytest

from green.api.auth import AuthError, verify_supabase_jwt

_SECRET = "shhh"


def test_valid_token_yields_the_subject(user_token: Callable[..., str]) -> None:
    token = user_token("user-123", _SECRET)
    assert verify_supabase_jwt(token, secret=_SECRET).user_id == "user-123"


def test_wrong_secret_is_rejected(user_token: Callable[..., str]) -> None:
    token = user_token("user-123", _SECRET)
    with pytest.raises(AuthError, match="signature mismatch"):
        verify_supabase_jwt(token, secret="wrong-secret")


def test_alg_confusion_is_rejected(mint_hs256: Callable[..., str], far_future: int) -> None:
    # Token header lies about the algorithm; we pin HS256 from our side and refuse.
    for bad_alg in ("none", "RS256", "HS512"):
        token = mint_hs256(
            {"sub": "u", "aud": "authenticated", "exp": far_future}, _SECRET, alg=bad_alg
        )
        with pytest.raises(AuthError, match="unsupported alg"):
            verify_supabase_jwt(token, secret=_SECRET)


def test_expired_token_is_rejected(mint_hs256: Callable[..., str]) -> None:
    token = mint_hs256({"sub": "u", "aud": "authenticated", "exp": 1_000}, _SECRET)
    with pytest.raises(AuthError, match="expired"):
        verify_supabase_jwt(token, secret=_SECRET, now=2_000)


def test_not_yet_valid_token_is_rejected(mint_hs256: Callable[..., str], far_future: int) -> None:
    token = mint_hs256(
        {"sub": "u", "aud": "authenticated", "exp": far_future, "nbf": 5_000}, _SECRET
    )
    with pytest.raises(AuthError, match="not yet valid"):
        verify_supabase_jwt(token, secret=_SECRET, now=1_000)


def test_audience_mismatch_is_rejected(mint_hs256: Callable[..., str], far_future: int) -> None:
    token = mint_hs256({"sub": "u", "aud": "someone-else", "exp": far_future}, _SECRET)
    with pytest.raises(AuthError, match="audience"):
        verify_supabase_jwt(token, secret=_SECRET, audience="authenticated")


def test_missing_subject_is_rejected(mint_hs256: Callable[..., str], far_future: int) -> None:
    token = mint_hs256({"aud": "authenticated", "exp": far_future}, _SECRET)
    with pytest.raises(AuthError, match="subject"):
        verify_supabase_jwt(token, secret=_SECRET)


def test_malformed_token_is_rejected() -> None:
    with pytest.raises(AuthError, match="malformed"):
        verify_supabase_jwt("not.a.valid.jwt.shape", secret=_SECRET)
