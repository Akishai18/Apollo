"""Bearer-token auth — verify Supabase-issued JWTs ourselves (FastAPI is the
authoritative brain; Supabase is a primitive).

We verify HS256 tokens with the project's shared JWT secret. HS256 is pinned
explicitly — the algorithm is read from our config, never trusted from the
token header — which closes the classic JWT alg-confusion / `alg:none` holes.
(Projects using asymmetric signing keys would verify RS256/ES256 against the
JWKS endpoint instead; that is the extension point, noted in the migration.)

No third-party dependency: HS256 verification is just an HMAC, and owning it
keeps the security surface small and the types strict.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from typing import Any, cast


class AuthError(Exception):
    """Token missing, malformed, or failing verification."""


@dataclass(frozen=True)
class Principal:
    user_id: str  # the JWT `sub` claim


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
    secret: str,
    audience: str | None = "authenticated",
    leeway_seconds: int = 0,
    now: int | None = None,
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
