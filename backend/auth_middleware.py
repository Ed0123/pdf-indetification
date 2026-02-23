"""FastAPI dependency that validates the Firebase ID token from the
Authorization header and returns the decoded user claims.

Usage in a route:
    @router.get("/me")
    async def me(user: dict = Depends(require_auth)):
        return user

Set ``DEV_MODE=1`` to bypass Firebase token validation during local
development. A fake user dict is returned instead.
"""

import os

from fastapi import Depends, HTTPException, Request

from backend.firebase_setup import verify_token

_DEV_MODE = os.getenv("DEV_MODE", "").strip() in ("1", "true", "yes")

# Fake user returned in dev mode when no token is supplied
_DEV_USER = {
    "uid": "dev-local-user",
    "email": "dev@localhost",
    "name": "Dev User",
    "picture": "",
}


def _get_token(request: Request) -> str:
    """Extract the Bearer token from the Authorization header."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        if _DEV_MODE:
            return ""  # allow empty token in dev mode
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    return auth[7:]


def require_auth(token: str = Depends(_get_token)) -> dict:
    """Verify the Firebase ID token and return decoded claims.

    In ``DEV_MODE`` an empty token is accepted and a fake local user is
    returned so that every endpoint can be exercised without Firebase.
    """
    if _DEV_MODE and not token:
        return _DEV_USER
    try:
        claims = verify_token(token)
        return claims
    except Exception as exc:
        if _DEV_MODE:
            return _DEV_USER
        raise HTTPException(status_code=401, detail=f"Invalid token: {exc}")
