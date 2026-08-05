"""Central state-transition module.

Every state change in the system goes through :func:`assert_transition`. Nothing
else is permitted to mutate a status field.

The application table encodes the product in one line: the machine submits, and
hands over only what it could not answer. ``BROWSER_FILLING -> SUBMITTED`` is the
auto lane; ``-> NEEDS_ME`` is everything the machine refused to guess at.

An earlier version of this system prepared applications and never submitted them,
and this table enforced that by construction — no path reached ``SUBMITTED``
without crossing a state only a person could leave. That guarantee is gone on
purpose. What replaces it is narrower and lives elsewhere: a submission requires
every *required* field to have come from a locked fact (``app.ats.driver``), and
the click itself is capped and dry-runnable (``app.safety``).
"""

from __future__ import annotations

from enum import StrEnum
from typing import Final

__all__ = [
    "APPLICATION_TRANSITIONS",
    "JOB_TRANSITIONS",
    "TERMINAL_APPLICATION_STATES",
    "WAITING_ON_USER",
    "ApplicationState",
    "InvalidTransition",
    "JobState",
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
            JobState.SCORED,
            JobState.CLOSED,
        }
    ),
    # A probable duplicate is a human decision, never a silent delete.
    JobState.DUPLICATE_PROBABLE: frozenset(
        {JobState.DUPLICATE_EXACT, JobState.ENRICHED, JobState.ARCHIVED}
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
    MATERIALS_READY = "MATERIALS_READY"
    BROWSER_QUEUED = "BROWSER_QUEUED"
    BROWSER_FILLING = "BROWSER_FILLING"
    SUBMITTED = "SUBMITTED"
    #: The machine stopped and the application is the user's to finish, in their
    #: own browser. One state for every reason that can happen — the employer is
    #: on the manual-only list, a required question had no locked fact behind it,
    #: a CAPTCHA appeared, or the submit click went through without the page ever
    #: confirming it. ``needs_me_reason`` carries which, because the user needs
    #: the sentence, not the taxonomy.
    NEEDS_ME = "NEEDS_ME"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"


#: Nothing moves out of these on its own.
TERMINAL_APPLICATION_STATES: Final[frozenset[ApplicationState]] = frozenset(
    {ApplicationState.SUBMITTED, ApplicationState.SKIPPED}
)

#: What the dashboard's middle section lists.
WAITING_ON_USER: Final[frozenset[ApplicationState]] = frozenset({ApplicationState.NEEDS_ME})

_ABANDON = frozenset({ApplicationState.SKIPPED})

APPLICATION_TRANSITIONS: Final[dict[ApplicationState, frozenset[ApplicationState]]] = {
    ApplicationState.CREATED: frozenset({ApplicationState.MATERIALS_READY}) | _ABANDON,
    # NEEDS_ME straight from MATERIALS_READY is the manual-only lane: the resume
    # is attached and the link is ready, and no browser ever opens. Those are the
    # employers the user said they would handle themselves.
    ApplicationState.MATERIALS_READY: frozenset(
        {ApplicationState.BROWSER_QUEUED, ApplicationState.NEEDS_ME}
    )
    | _ABANDON,
    ApplicationState.BROWSER_QUEUED: frozenset(
        {ApplicationState.BROWSER_FILLING, ApplicationState.FAILED}
    )
    | _ABANDON,
    ApplicationState.BROWSER_FILLING: frozenset(
        {
            ApplicationState.SUBMITTED,
            ApplicationState.NEEDS_ME,
            ApplicationState.FAILED,
        }
    )
    | _ABANDON,
    # The user finished it by hand and said so. There is no automated route from
    # NEEDS_ME to SUBMITTED: once the machine has handed an application over, it
    # does not take it back and click something.
    ApplicationState.NEEDS_ME: frozenset({ApplicationState.SUBMITTED}) | _ABANDON,
    ApplicationState.SUBMITTED: frozenset(),
    ApplicationState.FAILED: frozenset({ApplicationState.BROWSER_QUEUED}) | _ABANDON,
    ApplicationState.SKIPPED: frozenset(),
}


# ------------------------------------------------------------------ engine

_TABLES: Final[dict[type[StrEnum], dict[StrEnum, frozenset[StrEnum]]]] = {
    JobState: JOB_TRANSITIONS,  # type: ignore[dict-item]
    ApplicationState: APPLICATION_TRANSITIONS,  # type: ignore[dict-item]
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
