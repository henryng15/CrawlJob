"""Login and logout (spec §23.2)."""

from __future__ import annotations

import time
from typing import Annotated

from fastapi import APIRouter, Depends, Form, Request, Response
from starlette.responses import RedirectResponse

from app.config import Settings
from app.web.deps import Config, CurrentSession, require_csrf
from app.web.security import COOKIE_NAME, authenticate, issue
from app.web.templating import render

__all__ = ["router", "set_session_cookie"]

router = APIRouter()

#: Cost of a failed login. Enough that guessing a real password over the network
#: is hopeless, short enough that a typo is not annoying. Argon2 already costs
#: ~100 ms; this raises the floor without a lockout that a wrong guess could use
#: to lock the real user out.
_FAILURE_DELAY_SECONDS = 0.75


def set_session_cookie(response: Response, value: str, settings: Settings) -> None:
    response.set_cookie(
        COOKIE_NAME,
        value,
        httponly=True,
        samesite="strict",
        secure=settings.session_cookie_secure,
        max_age=settings.session_idle_timeout_minutes * 60,
        path="/",
    )


def _safe_next(candidate: str | None) -> str:
    """Only same-site absolute paths. ``//evil.com`` is a URL, not a path.

    Without this an attacker mails a login link that bounces the user to a page
    they control, arriving with the appearance of having come from here.
    """
    if not candidate or not candidate.startswith("/") or candidate.startswith("//"):
        return "/"
    return candidate


@router.get("/login")
def login_form(request: Request, settings: Config) -> Response:
    return render(
        request,
        "login.html",
        {
            "next_url": _safe_next(request.query_params.get("next")),
            "configured": bool(settings.admin_password_hash),
            "error": None,
        },
    )


@router.post("/login")
def login(
    request: Request,
    settings: Config,
    username: Annotated[str, Form()],
    password: Annotated[str, Form()],
    next: Annotated[str, Form()] = "/",
) -> Response:
    session = authenticate(username, password, settings)
    if session is None:
        time.sleep(_FAILURE_DELAY_SECONDS)
        return render(
            request,
            "login.html",
            {
                "next_url": _safe_next(next),
                "configured": bool(settings.admin_password_hash),
                # Deliberately not "unknown user" or "wrong password": which one
                # it was is information the person typing already has.
                "error": "Incorrect username or password.",
            },
            status_code=401,
        )

    response = RedirectResponse(_safe_next(next), status_code=303)
    set_session_cookie(response, issue(session, settings), settings)
    return response


@router.post("/logout", dependencies=[Depends(require_csrf)])
def logout(session: CurrentSession) -> Response:
    response = RedirectResponse("/login", status_code=303)
    response.delete_cookie(COOKIE_NAME, path="/")
    return response
