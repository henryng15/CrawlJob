"""What the month actually cost, and the ladder that keeps it inside the cap
(spec §26.2).

Two things are being protected here. The cap, which is the user's money. And the
*answer to where it went* — a budget page that shows one opaque number cannot
tell you whether to raise the cap or change what you are spending it on.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.services.llm.base import BudgetState, Task, TokenCounts, Usage
from app.services.llm.ledger import (
    EVENT_TYPE,
    load_ledger,
    spent_this_month,
    usage_this_month,
)

pytestmark = pytest.mark.db

NOW = datetime.now(UTC).replace(microsecond=0)


@pytest.fixture
def settings() -> Settings:
    return Settings(
        app_env="development",
        app_secret_key="usage-tests",
        llm_monthly_budget_usd=15.0,
    )


@pytest.fixture
def db(committing_db: sessionmaker[Session]) -> Iterator[Session]:
    session = committing_db()
    try:
        yield session
    finally:
        session.close()


def usage(
    task: Task = Task.SPONSORSHIP,
    *,
    model: str = "llama-3.3-70b-versatile",
    cost: float = 0.01,
    input_tokens: int = 1000,
    output_tokens: int = 200,
    cache_read: int = 0,
    batch: bool = False,
) -> Usage:
    return Usage(
        model=model,
        task=task,
        tokens=TokenCounts(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cache_read_tokens=cache_read,
        ),
        cost_usd=cost,
        batch=batch,
    )


class TestRecordingACharge:
    def test_the_amount_reaches_the_audit_log(
        self, committing_db: sessionmaker[Session], db: Session, settings: Settings
    ):
        ledger = load_ledger(committing_db, settings, now=NOW)
        ledger.charge(0.25, usage(cost=0.25))
        assert spent_this_month(db, settings, now=NOW) == pytest.approx(0.25)

    def test_the_token_detail_reaches_it_too(
        self, committing_db: sessionmaker[Session], db: Session, settings: Settings
    ):
        ledger = load_ledger(committing_db, settings, now=NOW)
        ledger.charge(0.25, usage(input_tokens=5000, output_tokens=700))

        month = usage_this_month(db, settings, now=NOW)
        assert month.input_tokens == 5000
        assert month.output_tokens == 700
        assert month.calls == 1

    def test_spend_is_broken_down_by_task(
        self, committing_db: sessionmaker[Session], db: Session, settings: Settings
    ):
        """"$11 on resume plans" and "$11 on sponsorship checks" call for
        different reactions."""
        ledger = load_ledger(committing_db, settings, now=NOW)
        ledger.charge(1.0, usage(Task.RESUME_PLAN, cost=1.0))
        ledger.charge(0.5, usage(Task.SPONSORSHIP, cost=0.5))
        ledger.charge(0.25, usage(Task.SPONSORSHIP, cost=0.25))

        month = usage_this_month(db, settings, now=NOW)
        assert month.by_task["RESUME_PLAN"] == pytest.approx(1.0)
        assert month.by_task["SPONSORSHIP"] == pytest.approx(0.75)

    def test_spend_is_broken_down_by_model(
        self, committing_db: sessionmaker[Session], db: Session, settings: Settings
    ):
        ledger = load_ledger(committing_db, settings, now=NOW)
        ledger.charge(1.0, usage(model="claude-sonnet-5", cost=1.0))
        ledger.charge(0.1, usage(model="llama-3.3-70b-versatile", cost=0.1))

        month = usage_this_month(db, settings, now=NOW)
        assert month.by_model["claude-sonnet-5"] == pytest.approx(1.0)
        assert month.by_model["llama-3.3-70b-versatile"] == pytest.approx(0.1)

    def test_a_charge_without_detail_still_counts_toward_the_cap(
        self, committing_db: sessionmaker[Session], db: Session, settings: Settings
    ):
        """The money was spent whether or not the caller described it."""
        ledger = load_ledger(committing_db, settings, now=NOW)
        ledger.charge(0.4)
        assert spent_this_month(db, settings, now=NOW) == pytest.approx(0.4)

    def test_a_zero_charge_writes_nothing(
        self, committing_db: sessionmaker[Session], db: Session, settings: Settings
    ):
        ledger = load_ledger(committing_db, settings, now=NOW)
        ledger.charge(0.0, usage(cost=0.0))
        assert usage_this_month(db, settings, now=NOW).calls == 0


class TestNoPiiInTheLedger:
    def test_the_recorded_row_carries_no_prompt_or_response(
        self, committing_db: sessionmaker[Session], db: Session, settings: Settings
    ):
        """These rows sit in the audit log; the prompts carry an employment
        history and the responses carry a resume (§23.5)."""
        from sqlalchemy import select

        from app.db.models import AuditEvent

        ledger = load_ledger(committing_db, settings, now=NOW)
        ledger.charge(0.25, usage(Task.RESUME_PLAN, cost=0.25))

        row = db.scalars(
            select(AuditEvent).where(AuditEvent.event_type == EVENT_TYPE)
        ).one()
        assert set(row.event_metadata) == {
            "cost_usd",
            "running_total_usd",
            "model",
            "task",
            "batch",
            "input_tokens",
            "output_tokens",
            "cache_read_tokens",
            "cache_write_tokens",
        }


class TestCacheSavingsAreObservedNotAssumed:
    def test_cache_reads_are_recorded_when_the_provider_reports_them(
        self, committing_db: sessionmaker[Session], db: Session, settings: Settings
    ):
        ledger = load_ledger(committing_db, settings, now=NOW)
        ledger.charge(0.1, usage(input_tokens=1000, cache_read=3000))

        month = usage_this_month(db, settings, now=NOW)
        assert month.cache_read_tokens == 3000
        assert month.cache_hit_rate == pytest.approx(0.75)

    def test_a_provider_that_reports_nothing_reads_as_no_cache(
        self, committing_db: sessionmaker[Session], db: Session, settings: Settings
    ):
        """A provider may report no cache figures. That must read as 0%, not as an error."""
        ledger = load_ledger(committing_db, settings, now=NOW)
        ledger.charge(0.1, usage(input_tokens=1000))
        assert usage_this_month(db, settings, now=NOW).cache_hit_rate == 0.0

    def test_no_cache_at_all_still_leaves_the_month_countable(
        self, committing_db: sessionmaker[Session], db: Session, settings: Settings
    ):
        ledger = load_ledger(committing_db, settings, now=NOW)
        ledger.charge(0.1, usage())
        assert usage_this_month(db, settings, now=NOW).spent_usd == pytest.approx(0.1)


class TestTheCapSurvivesARestart:
    def test_a_new_ledger_starts_from_what_was_already_spent(
        self, committing_db: sessionmaker[Session], settings: Settings
    ):
        """The failure this prevents: a crash loop that spends the cap repeatedly
        because each restart believes the month is untouched."""
        first = load_ledger(committing_db, settings, now=NOW)
        first.charge(11.0, usage(cost=11.0))  # 73% of $15

        second = load_ledger(committing_db, settings, now=NOW)
        assert second.spent_usd == pytest.approx(11.0)
        assert second.state is BudgetState.WARNING

    def test_the_ladder_is_reached_across_restarts(
        self, committing_db: sessionmaker[Session], settings: Settings
    ):
        load_ledger(committing_db, settings, now=NOW).charge(14.0, usage(cost=14.0))
        restarted = load_ledger(committing_db, settings, now=NOW)
        assert restarted.state is BudgetState.RESTRICTED
        assert restarted.tailoring_limit(30) == 5

    def test_last_months_spend_does_not_count_against_this_month(
        self, committing_db: sessionmaker[Session], settings: Settings
    ):
        ledger = load_ledger(committing_db, settings, now=NOW)
        ledger.charge(12.0, usage(cost=12.0))

        next_month = load_ledger(committing_db, settings, now=NOW + timedelta(days=40))
        assert next_month.spent_usd == 0.0
        assert next_month.state is BudgetState.OK
