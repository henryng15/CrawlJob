"""Central state-transition module (spec §13).

Every state change in the system goes through :func:`assert_transition`. Nothing
else is permitted to mutate a status field.

The transition tables encode one property that matters more than the rest: an
application cannot reach ``SUBMITTED`` without passing through a state that only a
human can leave. The machine prepares; the person submits. ``test_states.py``
asserts this by graph search rather than by inspection, so the property survives
future edits to the tables.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Final

__all__ = [
    "APPLICATION_TRANSITIONS",
    "BROWSER_SLOT_TRANSITIONS",
    "HUMAN_GATED_APPLICATION_STATES",
    "JOB_TRANSITIONS",
    "OUTREACH_TRANSITIONS",
    "ApplicationState",
    "BrowserSlotState",
    "InvalidTransition",
    "JobState",
    "OutreachState",
    "assert_transition",
    "can_transition",
]


class InvalidTransition(ValueError):
    """Raised when code attempts a state change the machine does not allow."""

    def __init__(self, current: StrEnum, target: StrEnum, allowed: frozenset[StrEnum]) -> None:
        self.current = current
        self.target = target
        self.allowed = allowed
        super().__init__(
            f"{type(current).__name__}: cannot move {current.value} -> {target.value}. "
            f"Allowed: {sorted(s.value for s in allowed) or ['(terminal)']}"
        )


# --------------------------------------------------------------------- job


class JobState(StrEnum):
    DISCOVERED = "DISCOVERED"
    ENRICHED = "ENRICHED"
    DUPLICATE_EXACT = "DUPLICATE_EXACT"
    DUPLICATE_PROBABLE = "DUPLICATE_PROBABLE"
    ELIGIBILITY_REJECTED = "ELIGIBILITY_REJECTED"
    SPONSORSHIP_REVIEW = "SPONSORSHIP_REVIEW"
    SCORED = "SCORED"
    SELECTED = "SELECTED"
    CLOSED = "CLOSED"
    ARCHIVED = "ARCHIVED"


JOB_TRANSITIONS: Final[dict[JobState, frozenset[JobState]]] = {
    JobState.DISCOVERED: frozenset(
        {
            JobState.ENRICHED,
            JobState.DUPLICATE_EXACT,
            JobState.DUPLICATE_PROBABLE,
            JobState.CLOSED,
        }
    ),
    JobState.ENRICHED: frozenset(
        {
            JobState.DUPLICATE_EXACT,
            JobState.DUPLICATE_PROBABLE,
            JobState.ELIGIBILITY_REJECTED,
            JobState.SPONSORSHIP_REVIEW,
            JobState.SCORED,
            JobState.CLOSED,
        }
    ),
    # A probable duplicate is a human decision, never a silent delete (§7.4).
    JobState.DUPLICATE_PROBABLE: frozenset(
        {JobState.DUPLICATE_EXACT, JobState.ENRICHED, JobState.ARCHIVED}
    ),
    JobState.SPONSORSHIP_REVIEW: frozenset(
        {JobState.SCORED, JobState.ELIGIBILITY_REJECTED, JobState.ARCHIVED}
    ),
    JobState.SCORED: frozenset(
        {JobState.SELECTED, JobState.ELIGIBILITY_REJECTED, JobState.CLOSED, JobState.ARCHIVED}
    ),
    JobState.SELECTED: frozenset({JobState.CLOSED, JobState.ARCHIVED}),
    JobState.DUPLICATE_EXACT: frozenset({JobState.ARCHIVED}),
    JobState.ELIGIBILITY_REJECTED: frozenset({JobState.ARCHIVED}),
    JobState.CLOSED: frozenset({JobState.ARCHIVED}),
    JobState.ARCHIVED: frozenset(),
}


# -------------------------------------------------------------- application


class ApplicationState(StrEnum):
    CREATED = "CREATED"
    MATERIALS_PREPARING = "MATERIALS_PREPARING"
    MATERIALS_READY = "MATERIALS_READY"
    BROWSER_QUEUED = "BROWSER_QUEUED"
    BROWSER_FILLING = "BROWSER_FILLING"
    MANUAL_LOGIN_REQUIRED = "MANUAL_LOGIN_REQUIRED"
    MANUAL_FIELD_REQUIRED = "MANUAL_FIELD_REQUIRED"
    READY_FOR_REVIEW = "READY_FOR_REVIEW"
    READY_FOR_REPLAY = "READY_FOR_REPLAY"
    REPLAYING = "REPLAYING"
    LIVE_REVIEW_READY = "LIVE_REVIEW_READY"
    SUBMISSION_PENDING_CONFIRMATION = "SUBMISSION_PENDING_CONFIRMATION"
    SUBMITTED = "SUBMITTED"
    SUBMISSION_UNCERTAIN = "SUBMISSION_UNCERTAIN"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"
    WITHDRAWN = "WITHDRAWN"
    #: Prepared, offered to the user, and not acted on within the TTL (§7.9).
    #: Not a delete and not terminal: the resume, the answers, the screenshots
    #: and the audit trail all survive, and the row can be restored.
    EXPIRED = "EXPIRED"
    #: A restore was asked for and refused, with a reason on the row. The posting
    #: closed, another application already covers the job, or the form changed
    #: too much for the stored answers to be trusted into it.
    RESTORE_BLOCKED = "RESTORE_BLOCKED"


#: States the machine cannot leave on its own — a person must act. Every path to
#: SUBMITTED must cross one of these. Enforced by test, not by convention.
HUMAN_GATED_APPLICATION_STATES: Final[frozenset[ApplicationState]] = frozenset(
    {
        ApplicationState.READY_FOR_REVIEW,
        ApplicationState.LIVE_REVIEW_READY,
        ApplicationState.MANUAL_LOGIN_REQUIRED,
        ApplicationState.MANUAL_FIELD_REQUIRED,
    }
)

_ABANDON = frozenset({ApplicationState.SKIPPED, ApplicationState.WITHDRAWN})

#: Expiry is offered from exactly the states where the application is waiting on
#: a person — the same set as ``HUMAN_GATED_APPLICATION_STATES``, and not by
#: coincidence: a TTL measures how long the user has had the chance to act, so
#: anything the *machine* still owns must never age out from under it.
_EXPIRE = frozenset({ApplicationState.EXPIRED})

APPLICATION_TRANSITIONS: Final[dict[ApplicationState, frozenset[ApplicationState]]] = {
    ApplicationState.CREATED: frozenset({ApplicationState.MATERIALS_PREPARING}) | _ABANDON,
    ApplicationState.MATERIALS_PREPARING: frozenset(
        {ApplicationState.MATERIALS_READY, ApplicationState.FAILED}
    )
    | _ABANDON,
    # READY_FOR_REVIEW without a browser is the manual-only path: employers on
    # the operator's own shortlist are prepared — resume attached, link ready —
    # and then handed straight over, because those are the ones they have said
    # they will fill in themselves. Adding this edge cannot weaken the property
    # this table exists for: READY_FOR_REVIEW is human-gated, so every route to
    # SUBMITTED still crosses a state only a person can leave.
    ApplicationState.MATERIALS_READY: frozenset(
        {ApplicationState.BROWSER_QUEUED, ApplicationState.READY_FOR_REVIEW}
    )
    | _ABANDON,
    ApplicationState.BROWSER_QUEUED: frozenset(
        {ApplicationState.BROWSER_FILLING, ApplicationState.FAILED}
    )
    | _ABANDON,
    # Note the absence of SUBMITTED here. The filling worker cannot submit.
    ApplicationState.BROWSER_FILLING: frozenset(
        {
            ApplicationState.READY_FOR_REVIEW,
            ApplicationState.MANUAL_LOGIN_REQUIRED,
            ApplicationState.MANUAL_FIELD_REQUIRED,
            ApplicationState.FAILED,
        }
    )
    | _ABANDON,
    ApplicationState.MANUAL_LOGIN_REQUIRED: frozenset(
        {ApplicationState.BROWSER_FILLING, ApplicationState.FAILED}
    )
    | _ABANDON
    | _EXPIRE,
    ApplicationState.MANUAL_FIELD_REQUIRED: frozenset(
        {ApplicationState.READY_FOR_REVIEW, ApplicationState.FAILED}
    )
    | _ABANDON
    | _EXPIRE,
    ApplicationState.READY_FOR_REVIEW: frozenset(
        {
            ApplicationState.LIVE_REVIEW_READY,
            ApplicationState.READY_FOR_REPLAY,
            ApplicationState.SUBMISSION_PENDING_CONFIRMATION,
        }
    )
    | _ABANDON
    | _EXPIRE,
    ApplicationState.READY_FOR_REPLAY: frozenset(
        {ApplicationState.REPLAYING, ApplicationState.FAILED}
    )
    | _ABANDON,
    ApplicationState.REPLAYING: frozenset(
        {
            ApplicationState.LIVE_REVIEW_READY,
            ApplicationState.MANUAL_FIELD_REQUIRED,
            ApplicationState.FAILED,
            # A restore reproduces the work the user already had, so it returns
            # them to the state they were in when it expired — which for a
            # prepared application is the review queue, not a live window.
            ApplicationState.READY_FOR_REVIEW,
            ApplicationState.MANUAL_LOGIN_REQUIRED,
            # The form changed under a restore. Blocking is the only safe answer:
            # the whole premise was reproducing stored answers exactly.
            ApplicationState.RESTORE_BLOCKED,
        }
    )
    | _ABANDON,
    ApplicationState.LIVE_REVIEW_READY: frozenset(
        {
            ApplicationState.SUBMISSION_PENDING_CONFIRMATION,
            ApplicationState.READY_FOR_REPLAY,
        }
    )
    | _ABANDON
    | _EXPIRE,
    ApplicationState.SUBMISSION_PENDING_CONFIRMATION: frozenset(
        {ApplicationState.SUBMITTED, ApplicationState.SUBMISSION_UNCERTAIN}
    ),
    ApplicationState.SUBMISSION_UNCERTAIN: frozenset(
        {ApplicationState.SUBMITTED, ApplicationState.READY_FOR_REPLAY, ApplicationState.FAILED}
    )
    | _ABANDON,
    ApplicationState.SUBMITTED: frozenset({ApplicationState.WITHDRAWN}),
    ApplicationState.FAILED: frozenset({ApplicationState.BROWSER_QUEUED}) | _ABANDON,
    ApplicationState.SKIPPED: frozenset(),
    ApplicationState.WITHDRAWN: frozenset(),
    # Restoring goes through a replay: the browser reopens the form and puts the
    # stored answers back, so the row passes through READY_FOR_REPLAY rather than
    # jumping straight to a review state it has not actually reached. Either way
    # it lands human-gated, so a restored application still cannot reach
    # SUBMITTED without a person. Abandoning outright is the other way out.
    ApplicationState.EXPIRED: frozenset(
        {ApplicationState.READY_FOR_REPLAY, ApplicationState.RESTORE_BLOCKED}
    )
    | _ABANDON,
    # Blocked is not a punishment. A block is usually about something *else* —
    # the job closed, or another application claimed it — and those change. Going
    # back to EXPIRED returns the row to the restorable pool rather than
    # inventing a second restore path for the retry.
    ApplicationState.RESTORE_BLOCKED: frozenset({ApplicationState.EXPIRED}) | _ABANDON,
}


# ----------------------------------------------------------------- outreach


class OutreachState(StrEnum):
    NOT_ELIGIBLE = "NOT_ELIGIBLE"
    SCHEDULED = "SCHEDULED"
    RECRUITER_MATCH_REQUIRED = "RECRUITER_MATCH_REQUIRED"
    HOOK_GENERATING = "HOOK_GENERATING"
    DRAFT_CREATING = "DRAFT_CREATING"
    READY_FOR_REVIEW = "READY_FOR_REVIEW"
    SENT = "SENT"
    REPLIED = "REPLIED"
    FOLLOWUP_DUE = "FOLLOWUP_DUE"
    CLOSED = "CLOSED"
    SUPPRESSED = "SUPPRESSED"
    FAILED = "FAILED"


_STOP = frozenset({OutreachState.SUPPRESSED, OutreachState.CLOSED})

OUTREACH_TRANSITIONS: Final[dict[OutreachState, frozenset[OutreachState]]] = {
    OutreachState.NOT_ELIGIBLE: frozenset({OutreachState.SCHEDULED}),
    OutreachState.SCHEDULED: frozenset(
        {
            OutreachState.RECRUITER_MATCH_REQUIRED,
            OutreachState.HOOK_GENERATING,
            OutreachState.NOT_ELIGIBLE,
        }
    )
    | _STOP,
    OutreachState.RECRUITER_MATCH_REQUIRED: frozenset({OutreachState.HOOK_GENERATING}) | _STOP,
    OutreachState.HOOK_GENERATING: frozenset({OutreachState.DRAFT_CREATING, OutreachState.FAILED})
    | _STOP,
    OutreachState.DRAFT_CREATING: frozenset({OutreachState.READY_FOR_REVIEW, OutreachState.FAILED})
    | _STOP,
    # READY_FOR_REVIEW -> SENT happens only when reconciliation observes the user's
    # own send. There is no code path that performs the send (§7.14).
    OutreachState.READY_FOR_REVIEW: frozenset({OutreachState.SENT}) | _STOP,
    OutreachState.SENT: frozenset({OutreachState.REPLIED, OutreachState.FOLLOWUP_DUE}) | _STOP,
    # A reply cancels every follow-up (§8.4).
    OutreachState.REPLIED: frozenset({OutreachState.CLOSED}),
    OutreachState.FOLLOWUP_DUE: frozenset({OutreachState.DRAFT_CREATING, OutreachState.REPLIED})
    | _STOP,
    OutreachState.FAILED: frozenset({OutreachState.HOOK_GENERATING}) | _STOP,
    OutreachState.SUPPRESSED: frozenset(),
    OutreachState.CLOSED: frozenset(),
}


# ------------------------------------------------------------- browser slot


class BrowserSlotState(StrEnum):
    IDLE = "IDLE"
    ALLOCATING = "ALLOCATING"
    FILLING = "FILLING"
    LIVE_REVIEW = "LIVE_REVIEW"
    REPLAYING = "REPLAYING"
    MANUAL_LOGIN = "MANUAL_LOGIN"
    CLEANING = "CLEANING"
    UNHEALTHY = "UNHEALTHY"


_SLOT_FAULT = frozenset({BrowserSlotState.UNHEALTHY, BrowserSlotState.CLEANING})

BROWSER_SLOT_TRANSITIONS: Final[dict[BrowserSlotState, frozenset[BrowserSlotState]]] = {
    BrowserSlotState.IDLE: frozenset({BrowserSlotState.ALLOCATING, BrowserSlotState.UNHEALTHY}),
    BrowserSlotState.ALLOCATING: frozenset({BrowserSlotState.FILLING, BrowserSlotState.REPLAYING})
    | _SLOT_FAULT,
    BrowserSlotState.FILLING: frozenset(
        {BrowserSlotState.LIVE_REVIEW, BrowserSlotState.MANUAL_LOGIN}
    )
    | _SLOT_FAULT,
    BrowserSlotState.REPLAYING: frozenset({BrowserSlotState.LIVE_REVIEW}) | _SLOT_FAULT,
    BrowserSlotState.MANUAL_LOGIN: frozenset({BrowserSlotState.FILLING}) | _SLOT_FAULT,
    BrowserSlotState.LIVE_REVIEW: frozenset({BrowserSlotState.CLEANING}) | _SLOT_FAULT,
    BrowserSlotState.CLEANING: frozenset({BrowserSlotState.IDLE, BrowserSlotState.UNHEALTHY}),
    BrowserSlotState.UNHEALTHY: frozenset({BrowserSlotState.CLEANING}),
}


# ------------------------------------------------------------------ engine

_TABLES: Final[dict[type[StrEnum], dict[StrEnum, frozenset[StrEnum]]]] = {
    JobState: JOB_TRANSITIONS,  # type: ignore[dict-item]
    ApplicationState: APPLICATION_TRANSITIONS,  # type: ignore[dict-item]
    OutreachState: OUTREACH_TRANSITIONS,  # type: ignore[dict-item]
    BrowserSlotState: BROWSER_SLOT_TRANSITIONS,  # type: ignore[dict-item]
}


def _table[S: StrEnum](state: S) -> dict[S, frozenset[S]]:
    try:
        return _TABLES[type(state)]  # type: ignore[return-value]
    except KeyError:
        raise TypeError(f"No transition table registered for {type(state).__name__}") from None


def can_transition[S: StrEnum](current: S, target: S) -> bool:
    """Return whether ``current -> target`` is allowed."""
    if type(current) is not type(target):
        raise TypeError(
            f"Cannot compare {type(current).__name__} with {type(target).__name__} states."
        )
    return target in _table(current)[current]


def assert_transition[S: StrEnum](current: S, target: S) -> S:
    """Validate a state change and return the target state.

    Returns the target so call sites read as ``obj.status = assert_transition(
    obj.status, ApplicationState.SUBMITTED)`` — making it awkward to bypass.

    Raises:
        InvalidTransition: if the move is not allowed.
        TypeError: if the two states belong to different machines.
    """
    if not can_transition(current, target):
        raise InvalidTransition(current, target, _table(current)[current])
    return target
