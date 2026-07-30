"""Persisting the model budget (spec §26.2).

:class:`BudgetLedger` counts in memory, which is right for the hot path — a
database query before every classification would put the database on the critical
path of the pipeline — and wrong across restarts. A cap that resets when the
worker restarts is not a cap: a crash loop spends it repeatedly, and the one
failure §26.2 exists to prevent is precisely a retry loop quietly spending the
month's budget overnight.

So the ledger is loaded from the database when a provider is built and written
back after each charge. The stored row is per calendar month in the *business*
timezone, because that is the month the user is thinking about when they set a
cap.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.db.models import AuditEvent
from app.services.llm.base import BudgetLedger, Usage

__all__ = [
    "EVENT_TYPE",
    "MonthlyUsage",
    "load_ledger",
    "month_of",
    "spent_this_month",
    "usage_this_month",
]

log = logging.getLogger(__name__)

#: Charges are audit events rather than a table of their own. Every one is a fact
#: about something that happened, which is what the audit log is for, and it means
#: the spend is inspectable alongside the work that caused it.
EVENT_TYPE = "LLM_CHARGE"


def month_of(moment: datetime, settings: Settings) -> date:
    """First day of the moment's month, in the business timezone."""
    local = moment.astimezone(settings.timezone)
    return date(local.year, local.month, 1)


def spent_this_month(
    session: Session, settings: Settings, *, now: datetime | None = None
) -> float:
    """Total charged so far this month."""
    from app.db.base import utcnow

    start_local = month_of(now or utcnow(), settings)
    start = datetime(
        start_local.year, start_local.month, start_local.day, tzinfo=settings.timezone
    )

    total = session.scalar(
        select(func.coalesce(func.sum(AuditEvent.event_metadata["cost_usd"].as_float()), 0.0))
        .where(AuditEvent.event_type == EVENT_TYPE)
        .where(AuditEvent.created_at >= start)
    )
    return float(total or 0.0)


def load_ledger(
    session_factory: sessionmaker[Session],
    settings: Settings,
    *,
    now: datetime | None = None,
) -> BudgetLedger:
    """A ledger that starts from what has already been spent and records each charge.

    The write happens in its own short-lived session: a charge must survive even
    if the task that incurred it goes on to fail and roll back. The money was
    spent either way, and a budget that forgets failed calls under-counts exactly
    when it matters — a retry loop.
    """
    from app.db.base import utcnow

    moment = now or utcnow()
    with session_factory() as session:
        already = spent_this_month(session, settings, now=moment)

    ledger = BudgetLedger(
        monthly_cap_usd=settings.llm_monthly_budget_usd,
        spent_usd=already,
        month=month_of(moment, settings),
    )

    def record(amount_usd: float, running_total: float, usage: Usage | None = None) -> None:
        if amount_usd <= 0:
            return
        try:
            with session_factory() as session:
                session.add(
                    AuditEvent(
                        event_type=EVENT_TYPE,
                        entity_type="llm",
                        actor_type="SYSTEM",
                        event_metadata={
                            "cost_usd": amount_usd,
                            "running_total_usd": running_total,
                            **_usage_metadata(usage),
                        },
                    )
                )
                session.commit()
        except Exception:
            # Losing the record is bad; losing the work because recording failed
            # is worse. The in-memory total still holds for this process.
            log.exception("could not record an LLM charge of $%.4f", amount_usd)

    ledger.on_charge = record
    return ledger


def _usage_metadata(usage: Usage | None) -> dict[str, Any]:
    """The per-call detail, or nothing.

    Deliberately no prompt, no response and no schema name: this row sits in the
    audit log next to everything else, and the prompts carry the user's
    employment history (§23.5).
    """
    if usage is None:
        return {}
    return {
        "model": usage.model,
        "task": usage.task.value,
        "batch": usage.batch,
        "input_tokens": usage.tokens.input_tokens,
        "output_tokens": usage.tokens.output_tokens,
        "cache_read_tokens": usage.tokens.cache_read_tokens,
        "cache_write_tokens": usage.tokens.cache_write_tokens,
    }


@dataclass(frozen=True, slots=True)
class MonthlyUsage:
    """What the month has actually cost, and on what."""

    spent_usd: float = 0.0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    by_task: dict[str, float] = field(default_factory=dict)
    by_model: dict[str, float] = field(default_factory=dict)
    calls: int = 0

    @property
    def cache_hit_rate(self) -> float:
        """Fraction of input tokens served from cache.

        Reported, never relied on. Caching is best-effort (§26.2) — the cap check
        before a batch assumes no cache at all, so a rate of zero costs money but
        cannot break the budget.
        """
        total = self.input_tokens + self.cache_read_tokens
        return self.cache_read_tokens / total if total else 0.0


def usage_this_month(
    session: Session, settings: Settings, *, now: datetime | None = None
) -> MonthlyUsage:
    """Aggregate the month's charges from the audit log.

    Read from the log rather than a running counter so the answer survives a
    restart and cannot drift from the record of what happened.
    """
    from app.db.base import utcnow

    start_local = month_of(now or utcnow(), settings)
    start = datetime(
        start_local.year, start_local.month, start_local.day, tzinfo=settings.timezone
    )

    rows = session.scalars(
        select(AuditEvent)
        .where(AuditEvent.event_type == EVENT_TYPE)
        .where(AuditEvent.created_at >= start)
    ).all()

    spent = 0.0
    tokens = {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_tokens": 0,
        "cache_write_tokens": 0,
    }
    by_task: dict[str, float] = {}
    by_model: dict[str, float] = {}

    for row in rows:
        data = row.event_metadata or {}
        cost = float(data.get("cost_usd", 0.0) or 0.0)
        spent += cost
        for key in tokens:
            tokens[key] += int(data.get(key, 0) or 0)
        if task := data.get("task"):
            by_task[str(task)] = by_task.get(str(task), 0.0) + cost
        if model := data.get("model"):
            by_model[str(model)] = by_model.get(str(model), 0.0) + cost

    return MonthlyUsage(
        spent_usd=spent,
        by_task=by_task,
        by_model=by_model,
        calls=len(rows),
        **tokens,
    )
