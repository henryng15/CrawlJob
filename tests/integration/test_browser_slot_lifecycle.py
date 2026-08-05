"""A browser slot is reusable (spec §15.4).

The bug this file exists for: a slot finished a fill, moved to ``LIVE_REVIEW``
and left its session row open. ``_slot_row`` then handed that same row to the
next application, which asked for ``LIVE_REVIEW -> ALLOCATING`` — refused by the
state machine, retried three times, dead. One application per slot until the
03:15 cleanup sweep, and nothing anywhere said so.

Nothing caught it because every test either drove one application, or truncated
the table between runs. So the property under test here is specifically the
*second* application.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import BrowserSession
from app.domain.states import BrowserSlotState, InvalidTransition, assert_transition
from app.worker.browser_slot import SLOT_NAME, _release, _slot_row

pytestmark = pytest.mark.db

NOW = datetime.now(UTC).replace(microsecond=0)


@pytest.fixture
def db(committing_db) -> Iterator[Session]:
    session = committing_db()
    try:
        yield session
    finally:
        session.close()


def open_rows(db: Session) -> list[BrowserSession]:
    return list(
        db.scalars(
            select(BrowserSession)
            .where(BrowserSession.slot_name == SLOT_NAME)
            .where(BrowserSession.ended_at.is_(None))
        ).all()
    )


class TestTheStateMachineStillRefusesTheBadMove:
    def test_a_slot_in_live_review_cannot_start_a_fill(self):
        """The guard is right. The fix is to not still be in that state."""
        with pytest.raises(InvalidTransition):
            assert_transition(BrowserSlotState.LIVE_REVIEW, BrowserSlotState.ALLOCATING)

    def test_idle_is_the_only_state_a_fill_may_begin_from(self):
        startable = []
        for state in BrowserSlotState:
            try:
                assert_transition(state, BrowserSlotState.ALLOCATING)
            except InvalidTransition:
                continue
            startable.append(state)
        assert startable == [BrowserSlotState.IDLE]


class TestReleasing:
    def test_it_records_how_the_fill_ended(self, db: Session):
        slot = _slot_row(db, now=NOW)
        slot.status = assert_transition(BrowserSlotState.IDLE, BrowserSlotState.ALLOCATING)
        slot.status = assert_transition(
            BrowserSlotState(slot.status), BrowserSlotState.FILLING
        )

        _release(slot, into=BrowserSlotState.LIVE_REVIEW, now=NOW)

        assert slot.status == BrowserSlotState.LIVE_REVIEW
        assert slot.ended_at == NOW

    def test_a_released_slot_has_no_open_session(self, db: Session):
        slot = _slot_row(db, now=NOW)
        slot.status = assert_transition(BrowserSlotState.IDLE, BrowserSlotState.ALLOCATING)
        slot.status = assert_transition(
            BrowserSlotState(slot.status), BrowserSlotState.FILLING
        )
        _release(slot, into=BrowserSlotState.LIVE_REVIEW, now=NOW)
        db.commit()

        assert open_rows(db) == []


class TestTheSlotIsReusable:
    def _fill_and_release(self, db: Session, *, at: datetime) -> BrowserSession:
        """Everything the handler does to the slot row, without a browser."""
        slot = _slot_row(db, now=at)
        slot.status = assert_transition(
            BrowserSlotState(slot.status), BrowserSlotState.ALLOCATING
        )
        slot.status = assert_transition(
            BrowserSlotState(slot.status), BrowserSlotState.FILLING
        )
        _release(slot, into=BrowserSlotState.LIVE_REVIEW, now=at)
        db.commit()
        return slot

    def test_a_second_application_can_use_the_same_slot(self, db: Session):
        """The regression. This raised InvalidTransition before the fix."""
        self._fill_and_release(db, at=NOW)
        self._fill_and_release(db, at=NOW + timedelta(minutes=5))

    def test_ten_applications_run_through_one_slot(self, db: Session):
        """One slot, one day. The old ceiling was one."""
        for minute in range(10):
            self._fill_and_release(db, at=NOW + timedelta(minutes=minute))

        rows = db.scalars(
            select(BrowserSession).where(BrowserSession.slot_name == SLOT_NAME)
        ).all()
        assert len(rows) == 10, "one closed session per application"
        assert all(row.ended_at is not None for row in rows)

    def test_each_application_gets_its_own_row(self, db: Session):
        """The row is the audit trail of one fill, not a reused scratchpad."""
        first = self._fill_and_release(db, at=NOW)
        second = self._fill_and_release(db, at=NOW + timedelta(minutes=5))
        assert first.id != second.id


class TestRecoveringFromASlotThatDied:
    def test_an_open_row_left_in_a_terminal_state_is_retired(self, db: Session):
        """Rows the old code left behind, and slots killed mid-fill.

        Refusing to work until somebody clears these by hand is how the ceiling
        got to be two a day in the first place.
        """
        stale = _slot_row(db, now=NOW)
        stale.status = assert_transition(BrowserSlotState.IDLE, BrowserSlotState.ALLOCATING)
        stale.status = assert_transition(
            BrowserSlotState(stale.status), BrowserSlotState.FILLING
        )
        stale.status = assert_transition(
            BrowserSlotState(stale.status), BrowserSlotState.LIVE_REVIEW
        )
        db.commit()
        assert len(open_rows(db)) == 1, "precondition: an open, unusable row"

        fresh = _slot_row(db, now=NOW + timedelta(hours=1))
        db.commit()

        assert fresh.id != stale.id
        assert fresh.status == BrowserSlotState.IDLE
        db.refresh(stale)
        assert stale.ended_at is not None, "the stale row was closed, not left open"

    def test_the_retired_row_keeps_the_state_it_died_in(self, db: Session):
        """It is evidence. Closing it must not rewrite what happened."""
        stale = _slot_row(db, now=NOW)
        stale.status = assert_transition(BrowserSlotState.IDLE, BrowserSlotState.ALLOCATING)
        stale.status = assert_transition(
            BrowserSlotState(stale.status), BrowserSlotState.FILLING
        )
        db.commit()

        _slot_row(db, now=NOW + timedelta(hours=1))
        db.commit()

        db.refresh(stale)
        assert stale.status == BrowserSlotState.FILLING
        assert stale.ended_at is not None
