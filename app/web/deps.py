"""Request-scoped dependencies for the web app."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db.session import get_sessionmaker
from app.web.security import COOKIE_NAME, CSRF_FIELD, read
from app.web.security import Session as AuthSession

__all__ = ["Config", "CurrentSession", "Db", "get_db", "require_csrf"]


def get_db() -> Iterator[Session]:
    session = get_sessionmaker()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_config() -> Settings:
    return get_settings()


class NotAuthenticated(HTTPException):
    """Raised past the login wall. Handled into a redirect, not a JSON 401.

    A browser asked for a page; sending it ``{"detail": "..."}`` would be a worse
    answer than the login form it actually needs.
    """

    def __init__(self, next_url: str = "/") -> None:
        super().__init__(status_code=status.HTTP_401_UNAUTHORIZED, detail=next_url)


def current_session(
    request: Request,
    settings: Annotated[Settings, Depends(get_config)],
) -> AuthSession:
    session = read(request.cookies.get(COOKIE_NAME), settings)
    if session is None:
        raise NotAuthenticated(request.url.path)
    # Re-signed on the way out by the refresh middleware, making the timeout idle.
    request.state.auth = session
    return session


async def require_csrf(
    request: Request,
    session: Annotated[AuthSession, Depends(current_session)],
) -> None:
    """Reject a state-changing request whose token does not match the cookie.

    ``SameSite=Strict`` already blocks the classic cross-site form post, but it is
    one browser setting away from not applying, and this is the check that does
    not depend on the client behaving.
    """
    form = await request.form()
    submitted = form.get(CSRF_FIELD)
    if not isinstance(submitted, str) or not session.csrf_matches(submitted):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF check failed")


Db = Annotated[Session, Depends(get_db)]
Config = Annotated[Settings, Depends(get_config)]
CurrentSession = Annotated[AuthSession, Depends(current_session)]
