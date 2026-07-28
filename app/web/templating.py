"""Jinja environment shared by every router."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import Request
from fastapi.templating import Jinja2Templates
from starlette.responses import HTMLResponse

from app.web.security import Session

__all__ = ["TEMPLATES_DIR", "render", "templates"]

TEMPLATES_DIR = Path(__file__).parent / "templates"
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))
# Autoescape is on by default for .html, which is what keeps a job description
# scraped from a stranger's website from executing on this page.
templates.env.trim_blocks = True
templates.env.lstrip_blocks = True


def render(
    request: Request,
    name: str,
    context: dict[str, Any] | None = None,
    *,
    session: Session | None = None,
    status_code: int = 200,
) -> HTMLResponse:
    payload: dict[str, Any] = {"session": session, "flash": None, "flash_kind": None}
    payload.update(context or {})
    return templates.TemplateResponse(request, name, payload, status_code=status_code)
