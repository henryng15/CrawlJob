"""FastAPI application factory (spec §22, §23).

The app is reachable only over Tailscale Serve and still requires a login (§23.2):
a joined device that is left unlocked is as reachable as the open internet, and
this app can queue applications in the user's name.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.responses import RedirectResponse, Response

from app.config import get_settings
from app.web.deps import NotAuthenticated
from app.web.routes import auth, health, screens
from app.web.security import COOKIE_NAME, issue
from app.web.templating import TEMPLATES_DIR

__all__ = ["create_app"]

STATIC_DIR = TEMPLATES_DIR.parent / "static"

#: Sent on every response. The app renders job descriptions fetched from the open
#: web, so a CSP that forbids inline and remote script is the difference between a
#: hostile posting being text and it being code.
SECURITY_HEADERS: dict[str, str] = {
    "Content-Security-Policy": (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
    ),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    # This app is not a search result; it is also not something a browser should
    # keep in a shared cache.
    "Cache-Control": "no-store",
}


def create_app(**overrides: Any) -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Internship Ops",
        # A private tool needs no public schema, and /docs would be one more
        # unauthenticated surface to reason about.
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        **overrides,
    )
    app.state.settings = settings

    if settings.app_env == "production":
        # Caddy terminates and forwards to loopback; a Host header from anywhere
        # else means the request did not come the way it was supposed to.
        app.add_middleware(
            TrustedHostMiddleware, allowed_hosts=_allowed_hosts(settings.app_base_url)
        )

    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    @app.middleware("http")
    async def session_and_headers(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        for key, value in SECURITY_HEADERS.items():
            response.headers.setdefault(key, value)

        # Re-sign the cookie on every authenticated request. This is what makes
        # the timeout idle rather than absolute: working does not log you out,
        # walking away does.
        #
        # Settings come from app.state, not from the closure, so the middleware
        # and the request handlers cannot end up signing and verifying with
        # different keys — which is exactly what happens if one of them is
        # swapped and the other is not.
        auth_session = getattr(request.state, "auth", None)
        if auth_session is not None:
            active = request.app.state.settings
            auth.set_session_cookie(response, issue(auth_session, active), active)
        return response

    @app.exception_handler(NotAuthenticated)
    async def to_login(request: Request, exc: NotAuthenticated) -> Response:
        response = RedirectResponse(f"/login?next={exc.detail}", status_code=303)
        response.delete_cookie(COOKIE_NAME, path="/")
        return response

    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(screens.router)
    return app


def _allowed_hosts(base_url: str) -> list[str]:
    from urllib.parse import urlparse

    host = urlparse(base_url).hostname
    return [host, "localhost", "127.0.0.1"] if host else ["*"]


app = create_app()
