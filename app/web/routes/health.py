"""Health endpoints (spec §25.1).

Unauthenticated on purpose: they are what a monitor polls, and they say nothing a
stranger could use. Nothing here reveals a job, a company, or a person — only
counts and liveness. Reachability is already limited to Tailscale (§23.1).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from sqlalchemy import text

from app.safety import load_safety_settings
from app.web.deps import Db

__all__ = ["router"]

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/live")
def live() -> dict[str, str]:
    """Process is up. Deliberately touches nothing else."""
    return {"status": "ok"}


@router.get("/ready")
def ready(db: Db) -> dict[str, Any]:
    db.execute(text("SELECT 1"))
    safety = load_safety_settings()
    return {
        "status": "ok",
        "database": "ok",
        # Reported so a monitor can alert if a deployment ever came up with a
        # kill switch flipped. It cannot happen — parsing fails closed — but an
        # alert that never fires is cheaper than discovering it could.
        "auto_submit_enabled": safety.auto_submit_enabled,
        "auto_send_email_enabled": safety.auto_send_email_enabled,
    }


@router.get("/queue")
def queue(db: Db) -> dict[str, Any]:
    from app.worker.runtime import health as queue_health

    return queue_health(db)
