"""Bearer-token auth for Supabase-issued JWTs.

FastAPI is the authoritative brain; Supabase is the identity primitive. We
support both Supabase signing systems:

- HS256 via the legacy shared JWT secret.
- RS256/ES256 via the modern JWKS endpoint (Supabase's asymmetric signing keys;
  new/migrated projects issue ES256, older ones RS256).

In both cases the allowed algorithm is pinned from our config path, not trusted
from a token's header, so `alg:none` / alg-confusion bypasses are rejected.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, cast

import jwt
from jwt import PyJWKClient
from jwt.exceptions import InvalidTokenError


class AuthError(Exception):
    """Token missing, malformed, or failing verification."""


@dataclass(frozen=True)
class Principal:
    user_id: str  # the JWT `sub` claim


_JWK_CLIENTS: dict[str, PyJWKClient] = {}


def _b64url_decode(segment: str) -> bytes:
    padding = "=" * (-len(segment) % 4)
    return base64.urlsafe_b64decode(segment + padding)


def _decode_json(segment: str) -> dict[str, Any]:
    obj = json.loads(_b64url_decode(segment))
    if not isinstance(obj, dict):
        raise AuthError("token segment is not a JSON object")
    return cast("dict[str, Any]", obj)


def verify_supabase_jwt(
    token: str,
    *,
    secret: str | None = None,
    jwks_url: str | None = None,
    issuer: str | None = None,
    audience: str | None = "authenticated",
    leeway_seconds: int = 0,
    now: int | None = None,
) -> Principal:
    if secret is None and jwks_url is None:
        raise AuthError("auth verifier is not configured")
    if secret is not None:
        return _verify_hs256(
            token,
            secret=secret,
            audience=audience,
            leeway_seconds=leeway_seconds,
            now=now,
        )
    assert jwks_url is not None
    return _verify_jwks(
        token,
        jwks_url=jwks_url,
        audience=audience,
        issuer=issuer,
        leeway_seconds=leeway_seconds,
    )


def _verify_hs256(
    token: str,
    *,
    secret: str,
    audience: str | None,
    leeway_seconds: int,
    now: int | None,
) -> Principal:
    parts = token.split(".")
    if len(parts) != 3:
        raise AuthError("malformed token (expected 3 segments)")
    header_b64, payload_b64, signature_b64 = parts

    try:
        header = _decode_json(header_b64)
    except (ValueError, AuthError) as exc:
        raise AuthError("unreadable token header") from exc
    if header.get("alg") != "HS256":
        # Pin the algorithm from OUR side — never honour the token's choice.
        raise AuthError(f"unsupported alg {header.get('alg')!r}; expected HS256")

    expected = hmac.new(
        secret.encode(), f"{header_b64}.{payload_b64}".encode(), hashlib.sha256
    ).digest()
    try:
        actual = _b64url_decode(signature_b64)
    except ValueError as exc:
        raise AuthError("unreadable token signature") from exc
    if not hmac.compare_digest(expected, actual):
        raise AuthError("signature mismatch")

    try:
        payload = _decode_json(payload_b64)
    except (ValueError, AuthError) as exc:
        raise AuthError("unreadable token payload") from exc

    current = now if now is not None else int(time.time())
    exp = payload.get("exp")
    if exp is not None and current > int(exp) + leeway_seconds:
        raise AuthError("token expired")
    nbf = payload.get("nbf")
    if nbf is not None and current + leeway_seconds < int(nbf):
        raise AuthError("token not yet valid")

    if audience is not None:
        aud = payload.get("aud")
        allowed: list[Any] = cast("list[Any]", aud) if isinstance(aud, list) else [aud]
        if audience not in allowed:
            raise AuthError("token audience mismatch")

    sub = payload.get("sub")
    if not isinstance(sub, str) or not sub:
        raise AuthError("token missing a subject (sub)")
    return Principal(user_id=sub)


# Asymmetric algorithms the JWKS path accepts — pinned from OUR side. Never
# HS* here: a symmetric alg against a public JWKS key is the classic
# alg-confusion attack.
_JWKS_ALGS: tuple[str, ...] = ("RS256", "ES256")


def _verify_jwks(
    token: str,
    *,
    jwks_url: str,
    audience: str | None,
    issuer: str | None,
    leeway_seconds: int,
) -> Principal:
    parts = token.split(".")
    if len(parts) != 3:
        raise AuthError("malformed token (expected 3 segments)")
    try:
        header = _decode_json(parts[0])
    except (ValueError, AuthError) as exc:
        raise AuthError("unreadable token header") from exc
    if header.get("alg") not in _JWKS_ALGS:
        raise AuthError(
            f"unsupported alg {header.get('alg')!r}; expected one of {', '.join(_JWKS_ALGS)}"
        )

    try:
        key = _jwk_client(jwks_url).get_signing_key_from_jwt(token).key
        options = {"verify_aud": audience is not None, "verify_iss": issuer is not None}
        payload = jwt.decode(
            token,
            key=key,
            algorithms=list(_JWKS_ALGS),
            audience=audience,
            issuer=issuer,
            leeway=leeway_seconds,
            options=cast("Any", options),
        )
    except InvalidTokenError as exc:
        raise AuthError(str(exc)) from exc

    sub = payload.get("sub")
    if not isinstance(sub, str) or not sub:
        raise AuthError("token missing a subject (sub)")
    return Principal(user_id=sub)


def verify_supabase_user_endpoint(
    token: str,
    *,
    supabase_url: str,
    anon_key: str,
) -> Principal:
    """Ask Supabase Auth to validate the bearer token.

    This is a compatibility path for projects whose access tokens are not
    verifiable by the configured local JWKS/HS256 path. The anon key is public;
    the token remains the authority.
    """

    url = f"{supabase_url.rstrip('/')}/auth/v1/user"
    request = urllib.request.Request(
        url,
        headers={
            "apikey": anon_key,
            "authorization": f"Bearer {token}",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            payload = json.loads(response.read().decode())
    except (OSError, urllib.error.HTTPError, json.JSONDecodeError) as exc:
        raise AuthError("Supabase token verification failed") from exc

    if not isinstance(payload, dict):
        raise AuthError("Supabase user response is not a JSON object")
    payload = cast("dict[str, Any]", payload)
    sub = payload.get("id")
    if not isinstance(sub, str) or not sub:
        raise AuthError("Supabase user response missing id")
    return Principal(user_id=sub)


def _jwk_client(jwks_url: str) -> PyJWKClient:
    client = _JWK_CLIENTS.get(jwks_url)
    if client is None:
        client = PyJWKClient(jwks_url)
        _JWK_CLIENTS[jwks_url] = client
    return client
