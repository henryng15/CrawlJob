"""Tests for the state machines (spec §13).

The important test in this file is
``TestHumanGate::test_submitted_is_unreachable_without_a_human_gate``. It proves by
graph search that no sequence of automated transitions reaches ``SUBMITTED``. If
someone later adds a well-meaning shortcut to the transition table, that test —
not a code reviewer — is what catches it.
"""

from __future__ import annotations

from collections import deque
from enum import StrEnum
from itertools import pairwise

import pytest

from app.domain.states import (
    APPLICATION_TRANSITIONS,
    BROWSER_SLOT_TRANSITIONS,
    HUMAN_GATED_APPLICATION_STATES,
    JOB_TRANSITIONS,
    OUTREACH_TRANSITIONS,
    ApplicationState,
    BrowserSlotState,
    InvalidTransition,
    JobState,
    OutreachState,
    assert_transition,
    can_transition,
)

ALL_MACHINES = [
    (JobState, JOB_TRANSITIONS),
    (ApplicationState, APPLICATION_TRANSITIONS),
    (OutreachState, OUTREACH_TRANSITIONS),
    (BrowserSlotState, BROWSER_SLOT_TRANSITIONS),
]


def reachable_from[S: StrEnum](
    start: S,
    table: dict[S, frozenset[S]],
    *,
    do_not_expand: frozenset[S] = frozenset(),
) -> set[S]:
    """States reachable from ``start`` without expanding out of ``do_not_expand``."""
    seen = {start}
    queue = deque([start])
    while queue:
        state = queue.popleft()
        if state in do_not_expand:
            continue
        for target in table[state]:
            if target not in seen:
                seen.add(target)
                queue.append(target)
    return seen


# --------------------------------------------------------- table integrity


@pytest.mark.parametrize(
    ("enum_cls", "table"), ALL_MACHINES, ids=lambda x: getattr(x, "__name__", "")
)
class TestTableIntegrity:
    def test_every_state_has_an_entry(self, enum_cls, table):
        assert set(table) == set(enum_cls), "every state needs an explicit entry, even if terminal"

    def test_every_target_is_a_known_state(self, enum_cls, table):
        for source, targets in table.items():
            unknown = {t for t in targets if t not in set(enum_cls)}
            assert not unknown, f"{source} points at unknown states {unknown}"

    def test_no_state_transitions_to_itself(self, enum_cls, table):
        offenders = [s for s, targets in table.items() if s in targets]
        assert not offenders, f"self-transitions hide bugs: {offenders}"

    def test_every_state_is_reachable_or_is_an_entry_point(self, enum_cls, table):
        """Catches states that were added to the enum but never wired up."""
        entry_points = {JobState.DISCOVERED, ApplicationState.CREATED, BrowserSlotState.IDLE}
        targeted = {t for targets in table.values() for t in targets}
        orphans = set(enum_cls) - targeted - entry_points
        # Outreach starts at either NOT_ELIGIBLE or SCHEDULED depending on §8.2.
        orphans -= {OutreachState.NOT_ELIGIBLE}
        assert not orphans, f"unreachable states: {orphans}"


# ------------------------------------------------------------- human gate


class TestHumanGate:
    def test_submitted_is_unreachable_without_a_human_gate(self):
        """The core safety property: the machine cannot submit an application.

        We walk every automated transition from CREATED but refuse to step *out
        of* a human-gated state, since only a person can do that. SUBMITTED must
        stay unreachable.
        """
        reached = reachable_from(
            ApplicationState.CREATED,
            APPLICATION_TRANSITIONS,
            do_not_expand=HUMAN_GATED_APPLICATION_STATES,
        )
        assert ApplicationState.SUBMITTED not in reached
        assert ApplicationState.SUBMISSION_PENDING_CONFIRMATION not in reached

    def test_submitted_is_reachable_once_a_human_acts(self):
        """Sanity check: the gate blocks the machine, not the product."""
        reached = reachable_from(ApplicationState.CREATED, APPLICATION_TRANSITIONS)
        assert ApplicationState.SUBMITTED in reached

    def test_filling_worker_cannot_jump_to_submitted(self):
        assert not can_transition(ApplicationState.BROWSER_FILLING, ApplicationState.SUBMITTED)

    @pytest.mark.parametrize("state", sorted(ApplicationState))
    def test_only_confirmation_states_lead_to_submitted(self, state):
        if ApplicationState.SUBMITTED in APPLICATION_TRANSITIONS[state]:
            assert state in {
                ApplicationState.SUBMISSION_PENDING_CONFIRMATION,
                ApplicationState.SUBMISSION_UNCERTAIN,
            }

    def test_outreach_cannot_reach_sent_without_review(self):
        """Nothing may mark outreach SENT except reconciliation after review."""
        senders = [s for s, t in OUTREACH_TRANSITIONS.items() if OutreachState.SENT in t]
        assert senders == [OutreachState.READY_FOR_REVIEW]

    def test_reply_cancels_followup(self):
        """A replied thread may only close — never queue another draft (§8.4)."""
        assert OUTREACH_TRANSITIONS[OutreachState.REPLIED] == frozenset({OutreachState.CLOSED})


# ---------------------------------------------------------------- engine


class TestAssertTransition:
    def test_allowed_transition_returns_target(self):
        result = assert_transition(ApplicationState.CREATED, ApplicationState.MATERIALS_PREPARING)
        assert result is ApplicationState.MATERIALS_PREPARING

    def test_disallowed_transition_raises(self):
        with pytest.raises(InvalidTransition) as exc:
            assert_transition(ApplicationState.CREATED, ApplicationState.SUBMITTED)
        assert exc.value.current is ApplicationState.CREATED
        assert exc.value.target is ApplicationState.SUBMITTED

    def test_error_message_lists_allowed_targets(self):
        with pytest.raises(InvalidTransition, match="MATERIALS_PREPARING"):
            assert_transition(ApplicationState.CREATED, ApplicationState.SUBMITTED)

    def test_terminal_state_reports_as_terminal(self):
        with pytest.raises(InvalidTransition, match=r"terminal"):
            assert_transition(ApplicationState.SKIPPED, ApplicationState.CREATED)

    def test_mixing_machines_is_a_type_error(self):
        with pytest.raises(TypeError, match="ApplicationState"):
            assert_transition(JobState.DISCOVERED, ApplicationState.CREATED)

    def test_unregistered_enum_is_a_type_error(self):
        class Rogue(StrEnum):
            A = "A"

        with pytest.raises(TypeError, match="No transition table"):
            assert_transition(Rogue.A, Rogue.A)


class TestRepresentativeFlows:
    def test_happy_path_application(self):
        flow = [
            ApplicationState.CREATED,
            ApplicationState.MATERIALS_PREPARING,
            ApplicationState.MATERIALS_READY,
            ApplicationState.BROWSER_QUEUED,
            ApplicationState.BROWSER_FILLING,
            ApplicationState.READY_FOR_REVIEW,
            ApplicationState.LIVE_REVIEW_READY,
            ApplicationState.SUBMISSION_PENDING_CONFIRMATION,
            ApplicationState.SUBMITTED,
        ]
        for current, target in pairwise(flow):
            assert_transition(current, target)

    def test_expired_session_replay_path(self):
        flow = [
            ApplicationState.READY_FOR_REVIEW,
            ApplicationState.READY_FOR_REPLAY,
            ApplicationState.REPLAYING,
            ApplicationState.LIVE_REVIEW_READY,
        ]
        for current, target in pairwise(flow):
            assert_transition(current, target)

    def test_uncertain_submission_can_be_replayed_or_confirmed(self):
        assert can_transition(ApplicationState.SUBMISSION_UNCERTAIN, ApplicationState.SUBMITTED)
        assert can_transition(
            ApplicationState.SUBMISSION_UNCERTAIN, ApplicationState.READY_FOR_REPLAY
        )

    def test_happy_path_outreach(self):
        flow = [
            OutreachState.SCHEDULED,
            OutreachState.HOOK_GENERATING,
            OutreachState.DRAFT_CREATING,
            OutreachState.READY_FOR_REVIEW,
            OutreachState.SENT,
            OutreachState.REPLIED,
            OutreachState.CLOSED,
        ]
        for current, target in pairwise(flow):
            assert_transition(current, target)

    def test_browser_slot_recycles_to_idle(self):
        flow = [
            BrowserSlotState.IDLE,
            BrowserSlotState.ALLOCATING,
            BrowserSlotState.FILLING,
            BrowserSlotState.LIVE_REVIEW,
            BrowserSlotState.CLEANING,
            BrowserSlotState.IDLE,
        ]
        for current, target in pairwise(flow):
            assert_transition(current, target)

    def test_unhealthy_slot_must_be_cleaned_before_reuse(self):
        assert not can_transition(BrowserSlotState.UNHEALTHY, BrowserSlotState.IDLE)
        assert can_transition(BrowserSlotState.UNHEALTHY, BrowserSlotState.CLEANING)
