"""State machine tests.

The property this file used to assert — that ``SUBMITTED`` was unreachable
without crossing a state only a person could leave — is deliberately gone. The
system submits now. What replaces it is smaller and about shape rather than
permission: the machine has exactly one automated route to ``SUBMITTED``, one way
to hand an application to the user, and no state it can get stuck in.
"""

from __future__ import annotations

import pytest

from app.domain.states import (
    APPLICATION_TRANSITIONS,
    JOB_TRANSITIONS,
    TERMINAL_APPLICATION_STATES,
    ApplicationState,
    InvalidTransition,
    JobState,
    assert_transition,
    can_transition,
)


def reachable(start, table):
    """Every state reachable from ``start``."""
    seen, queue = {start}, [start]
    while queue:
        for nxt in table[queue.pop()]:
            if nxt not in seen:
                seen.add(nxt)
                queue.append(nxt)
    return seen


class TestTheTableIsWellFormed:
    @pytest.mark.parametrize("state", list(ApplicationState))
    def test_every_application_state_has_an_entry(self, state):
        assert state in APPLICATION_TRANSITIONS

    @pytest.mark.parametrize("state", list(JobState))
    def test_every_job_state_has_an_entry(self, state):
        assert state in JOB_TRANSITIONS

    @pytest.mark.parametrize("state", list(ApplicationState))
    def test_no_state_is_stranded(self, state):
        assert state in reachable(ApplicationState.CREATED, APPLICATION_TRANSITIONS)

    @pytest.mark.parametrize("state", list(ApplicationState))
    def test_nothing_is_a_dead_end_except_the_terminal_states(self, state):
        if state in TERMINAL_APPLICATION_STATES:
            assert APPLICATION_TRANSITIONS[state] == frozenset()
        else:
            assert APPLICATION_TRANSITIONS[state], f"{state} cannot be left"


class TestTheAutoLane:
    def test_the_browser_can_submit(self):
        """The whole point of the refactor, asserted once and plainly."""
        assert can_transition(ApplicationState.BROWSER_FILLING, ApplicationState.SUBMITTED)

    def test_only_two_states_reach_submitted(self):
        """One is the browser finishing. The other is the user saying they did it."""
        sources = {
            state
            for state, targets in APPLICATION_TRANSITIONS.items()
            if ApplicationState.SUBMITTED in targets
        }
        assert sources == {ApplicationState.BROWSER_FILLING, ApplicationState.NEEDS_ME}

    def test_submitted_is_terminal(self):
        """An application that went out cannot be un-sent, so the row cannot move."""
        assert APPLICATION_TRANSITIONS[ApplicationState.SUBMITTED] == frozenset()

    def test_a_queued_application_cannot_skip_the_browser(self):
        assert not can_transition(ApplicationState.BROWSER_QUEUED, ApplicationState.SUBMITTED)

    def test_materials_cannot_jump_straight_to_submitted(self):
        assert not can_transition(ApplicationState.MATERIALS_READY, ApplicationState.SUBMITTED)


class TestHandingOver:
    def test_both_lanes_end_in_the_same_place(self):
        """The manual list and a blocked form are one state, told apart by a reason."""
        assert can_transition(ApplicationState.MATERIALS_READY, ApplicationState.NEEDS_ME)
        assert can_transition(ApplicationState.BROWSER_FILLING, ApplicationState.NEEDS_ME)

    def test_the_user_can_finish_what_the_machine_handed_over(self):
        assert can_transition(ApplicationState.NEEDS_ME, ApplicationState.SUBMITTED)

    def test_the_machine_never_takes_it_back(self):
        """Two things filling one form is worse than one."""
        assert not can_transition(ApplicationState.NEEDS_ME, ApplicationState.BROWSER_QUEUED)
        assert not can_transition(ApplicationState.NEEDS_ME, ApplicationState.BROWSER_FILLING)

    def test_anything_unfinished_can_be_abandoned(self):
        for state, targets in APPLICATION_TRANSITIONS.items():
            if state in TERMINAL_APPLICATION_STATES:
                continue
            assert ApplicationState.SKIPPED in targets, f"{state} cannot be skipped"


class TestFailure:
    def test_a_failed_application_can_be_retried(self):
        assert can_transition(ApplicationState.FAILED, ApplicationState.BROWSER_QUEUED)

    def test_a_failed_application_cannot_be_declared_submitted(self):
        assert not can_transition(ApplicationState.FAILED, ApplicationState.SUBMITTED)


class TestTheEngine:
    def test_a_legal_move_returns_the_target(self):
        assert (
            assert_transition(ApplicationState.CREATED, ApplicationState.MATERIALS_READY)
            is ApplicationState.MATERIALS_READY
        )

    def test_an_illegal_move_raises_and_says_what_was_allowed(self):
        with pytest.raises(InvalidTransition) as caught:
            assert_transition(ApplicationState.CREATED, ApplicationState.SUBMITTED)
        assert "MATERIALS_READY" in str(caught.value)

    def test_states_from_different_machines_cannot_be_compared(self):
        with pytest.raises(TypeError):
            can_transition(ApplicationState.CREATED, JobState.DISCOVERED)  # type: ignore[arg-type]


class TestJobs:
    def test_a_job_reaches_selected(self):
        assert JobState.SELECTED in reachable(JobState.DISCOVERED, JOB_TRANSITIONS)

    def test_a_rejected_job_can_only_be_archived(self):
        assert JOB_TRANSITIONS[JobState.ELIGIBILITY_REJECTED] == frozenset({JobState.ARCHIVED})

    def test_archived_is_terminal(self):
        assert JOB_TRANSITIONS[JobState.ARCHIVED] == frozenset()
