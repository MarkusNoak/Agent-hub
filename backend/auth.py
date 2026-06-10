"""Authentication & authorization: JWT sessions, password hashing, API keys.

Passwords use PBKDF2-HMAC-SHA256 and tokens are HS256 JWTs — both implemented
with the standard library only, so auth has zero native dependencies.
"""

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request

import database as db

PBKDF2_ITERATIONS = 200_000
TOKEN_TTL_HOURS = int(os.environ.get("AUTH_TOKEN_TTL_HOURS", "72"))

_jwt_secret: str | None = None


def jwt_secret() -> str:
    global _jwt_secret
    if _jwt_secret is None:
        _jwt_secret = os.environ.get("JWT_SECRET") or secrets.token_hex(32)
        if not os.environ.get("JWT_SECRET"):
            print(
                "WARNING: JWT_SECRET not set — using a random secret. "
                "All sessions are invalidated on restart. Set JWT_SECRET in .env "
                "for production."
            )
    return _jwt_secret


# ── Passwords ─────────────────────────────────────────────────────────────────


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), salt.encode(), PBKDF2_ITERATIONS
    ).hex()
    return f"pbkdf2${PBKDF2_ITERATIONS}${salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iterations, salt, digest = stored.split("$")
        candidate = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), salt.encode(), int(iterations)
        ).hex()
        return hmac.compare_digest(candidate, digest)
    except (ValueError, AttributeError):
        return False


# ── JWT (HS256, stdlib implementation) ────────────────────────────────────────


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(segment: str) -> bytes:
    return base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4))


def _sign(signing_input: bytes) -> bytes:
    return hmac.new(jwt_secret().encode(), signing_input, hashlib.sha256).digest()


def create_token(user_id: str, org_id: str, role: str) -> str:
    expiry = datetime.now(timezone.utc) + timedelta(hours=TOKEN_TTL_HOURS)
    header = _b64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = _b64url(json.dumps({
        "sub": user_id,
        "org": org_id,
        "role": role,
        "exp": int(expiry.timestamp()),
    }).encode())
    signing_input = f"{header}.{payload}".encode()
    return f"{header}.{payload}.{_b64url(_sign(signing_input))}"


def decode_token(token: str) -> dict | None:
    try:
        header, payload, signature = token.split(".")
        signing_input = f"{header}.{payload}".encode()
        if not hmac.compare_digest(_b64url(_sign(signing_input)), signature):
            return None
        claims = json.loads(_b64url_decode(payload))
        if claims.get("exp", 0) < time.time():
            return None
        return claims
    except (ValueError, json.JSONDecodeError):
        return None


# ── API keys ──────────────────────────────────────────────────────────────────


def generate_api_key() -> tuple[str, str, str]:
    """Returns (full_key, prefix, key_hash). Only the hash is stored."""
    raw = secrets.token_urlsafe(32)
    full_key = f"ahub_{raw}"
    prefix = full_key[:12]
    key_hash = hashlib.sha256(full_key.encode()).hexdigest()
    return full_key, prefix, key_hash


def hash_api_key(full_key: str) -> str:
    return hashlib.sha256(full_key.encode()).hexdigest()


# ── FastAPI dependencies ──────────────────────────────────────────────────────


class AuthContext:
    def __init__(self, user_id: str, org_id: str, role: str):
        self.user_id = user_id
        self.org_id = org_id
        self.role = role


async def get_current_auth(request: Request) -> AuthContext:
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = header.removeprefix("Bearer ")

    # Programmatic API keys (ahub_...) authenticate as the organization
    if token.startswith("ahub_"):
        key = await db.get_api_key_by_hash(hash_api_key(token))
        if not key:
            raise HTTPException(status_code=401, detail="Invalid API key")
        return AuthContext(user_id=None, org_id=key["org_id"], role="api")

    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return AuthContext(
        user_id=payload["sub"], org_id=payload["org"], role=payload["role"]
    )


async def require_admin(
    auth: AuthContext = Depends(get_current_auth),
) -> AuthContext:
    if auth.role not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return auth


async def auth_from_ws_token(token: str | None) -> AuthContext | None:
    """WebSocket auth: token passed as query parameter."""
    if not token:
        return None
    if token.startswith("ahub_"):
        key = await db.get_api_key_by_hash(hash_api_key(token))
        if not key:
            return None
        return AuthContext(user_id=None, org_id=key["org_id"], role="api")
    payload = decode_token(token)
    if not payload:
        return None
    return AuthContext(
        user_id=payload["sub"], org_id=payload["org"], role=payload["role"]
    )
