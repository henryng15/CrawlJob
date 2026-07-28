"""Candidate facts registry and locked-field enforcement (spec §7.1, §2.2).

This module is the reason the system can be trusted to fill a form. Everything it
writes into an application comes from here, and the rules below decide what may
change and who may change it.

Two ideas do the work:

**Actor.** Every write names who is making it. An ``AI`` actor is refused on any
locked fact, so a prompt injection in a job description cannot talk the system
into changing the user's work authorization — there is no code path from a model
response to a locked value.

**Always-locked keys.** Some facts are locked regardless of what the caller asks
for. Work authorization, citizenship, graduation date, GPA and the EEO answers are
locked because a wrong answer there is a false statement on a legal document, not
a formatting mistake. ``is_locked=False`` on those keys is ignored, not honoured.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.db.models import CandidateFact
from app.safety import SafetyViolation

__all__ = [
    "ALWAYS_LOCKED_PREFIXES",
    "Actor",
    "FactValue",
    "Sensitivity",
    "delete_fact",
    "get_fact",
    "get_value",
    "is_always_locked",
    "list_facts",
    "set_fact",
]


class Actor(StrEnum):
    """Who is performing a write."""

    #: The user, acting deliberately through the settings UI.
    USER = "USER"
    #: A profile or resume import the user initiated and will verify.
    IMPORT = "IMPORT"
    #: Deterministic derivation from other facts (e.g. first name from legal name).
    SYSTEM = "SYSTEM"
    #: A language model. Never permitted to touch a locked fact.
    AI = "AI"


class Sensitivity(StrEnum):
    #: Safe to log and to show in a screenshot.
    PUBLIC = "public"
    #: Redacted from logs; shown in the UI.
    PERSONAL = "personal"
    #: Redacted everywhere except the field it fills (§23.5).
    RESTRICTED = "restricted"


#: Facts that are locked no matter what the caller requests. Matched by prefix, so
#: `work_authorization.anything` is covered.
#:
#: A wrong value in any of these is a false statement on an application, which is
#: the one failure mode this project must never have.
ALWAYS_LOCKED_PREFIXES: tuple[str, ...] = (
    "candidate.legal_name",
    "candidate.date_of_birth",
    "candidate.graduation_date",
    "citizenship",
    "education.gpa",
    "education.graduation_date",
    "eeo.",
    "employment.",
    "export_control",
    "work_authorization",
)

#: Default sensitivity by prefix. Anything unmatched is PERSONAL — the cautious
#: choice, since an unclassified fact is more likely to be sensitive than not.
_SENSITIVITY_BY_PREFIX: tuple[tuple[str, Sensitivity], ...] = (
    ("candidate.github", Sensitivity.PUBLIC),
    ("candidate.linkedin", Sensitivity.PUBLIC),
    ("candidate.portfolio", Sensitivity.PUBLIC),
    ("candidate.preferred_name", Sensitivity.PUBLIC),
    ("skills.", Sensitivity.PUBLIC),
    ("projects.", Sensitivity.PUBLIC),
    ("candidate.address", Sensitivity.RESTRICTED),
    ("candidate.date_of_birth", Sensitivity.RESTRICTED),
    ("candidate.legal_name", Sensitivity.RESTRICTED),
    ("citizenship", Sensitivity.RESTRICTED),
    ("eeo.", Sensitivity.RESTRICTED),
    ("export_control", Sensitivity.RESTRICTED),
    ("work_authorization", Sensitivity.RESTRICTED),
)


@dataclass(frozen=True, slots=True)
class FactValue:
    """A fact as the rest of the system consumes it."""

    key: str
    value: Any
    is_locked: bool
    sensitivity: Sensitivity
    source: str
    verified_at: Any | None = None

    @property
    def is_verified(self) -> bool:
        return self.verified_at is not None


def is_always_locked(key: str) -> bool:
    """Whether ``key`` is locked by policy rather than by choice."""
    return key.startswith(ALWAYS_LOCKED_PREFIXES)


def default_sensitivity(key: str) -> Sensitivity:
    for prefix, sensitivity in _SENSITIVITY_BY_PREFIX:
        if key.startswith(prefix):
            return sensitivity
    return Sensitivity.PERSONAL


def set_fact(
    session: Session,
    key: str,
    value: Any,
    *,
    actor: Actor,
    is_locked: bool | None = None,
    sensitivity: Sensitivity | None = None,
    verified: bool = False,
) -> CandidateFact:
    """Create or update a fact.

    Args:
        key: dotted path, e.g. ``work_authorization.requires_future_sponsorship``.
        value: JSON-serialisable value.
        actor: who is writing. ``AI`` cannot write a locked fact.
        is_locked: requested lock state. Ignored (forced true) for keys in
            :data:`ALWAYS_LOCKED_PREFIXES`.
        sensitivity: overrides the prefix-derived default.
        verified: whether the user has confirmed this value is correct.

    Raises:
        SafetyViolation: when an ``AI`` actor targets a locked fact.
        ValueError: when the key is empty.
    """
    if not key.strip():
        raise ValueError("fact key must not be empty")

    existing = session.scalars(select(CandidateFact).where(CandidateFact.fact_key == key)).first()

    # Policy first, then the existing row, then the caller's request. A caller
    # asking to unlock an always-locked key is not an error — it is simply not
    # granted, because refusing loudly would tempt callers to route around it.
    locked = (
        True
        if is_always_locked(key)
        else (existing.is_locked if is_locked is None and existing else bool(is_locked))
    )

    if actor is Actor.AI and (locked or (existing is not None and existing.is_locked)):
        raise SafetyViolation(
            f"A model may not write the locked fact {key!r}. Locked facts are "
            "changed only by the user. See docs/spec/07-functional-requirements/"
            "01-candidate-profile.md."
        )

    if existing is not None:
        existing.value_json = {"value": value}
        existing.is_locked = locked
        existing.source = actor.value
        if sensitivity is not None:
            existing.sensitivity = sensitivity.value
        if verified:
            existing.verified_at = utcnow()
        session.flush()
        return existing

    fact = CandidateFact(
        fact_key=key,
        value_json={"value": value},
        data_type=type(value).__name__,
        sensitivity=(sensitivity or default_sensitivity(key)).value,
        is_locked=locked,
        source=actor.value,
        verified_at=utcnow() if verified else None,
    )
    session.add(fact)
    session.flush()
    return fact


def get_fact(session: Session, key: str) -> FactValue | None:
    row = session.scalars(select(CandidateFact).where(CandidateFact.fact_key == key)).first()
    if row is None:
        return None
    return FactValue(
        key=row.fact_key,
        value=row.value_json.get("value"),
        is_locked=row.is_locked,
        sensitivity=Sensitivity(row.sensitivity),
        source=row.source,
        verified_at=row.verified_at,
    )


def get_value(session: Session, key: str, default: Any = None) -> Any:
    """The value of a fact, or ``default``.

    Callers filling a form should prefer :func:`get_fact` so they can record the
    source type and lock state alongside the answer (§7.8).
    """
    fact = get_fact(session, key)
    return default if fact is None else fact.value


def list_facts(session: Session, *, prefix: str = "") -> list[FactValue]:
    stmt = select(CandidateFact).order_by(CandidateFact.fact_key)
    if prefix:
        stmt = stmt.where(CandidateFact.fact_key.startswith(prefix))
    return [
        FactValue(
            key=row.fact_key,
            value=row.value_json.get("value"),
            is_locked=row.is_locked,
            sensitivity=Sensitivity(row.sensitivity),
            source=row.source,
            verified_at=row.verified_at,
        )
        for row in session.scalars(stmt)
    ]


def delete_fact(session: Session, key: str, *, actor: Actor) -> bool:
    """Remove a fact. Only the user may delete a locked one."""
    row = session.scalars(select(CandidateFact).where(CandidateFact.fact_key == key)).first()
    if row is None:
        return False
    if row.is_locked and actor is not Actor.USER:
        raise SafetyViolation(f"Only the user may delete the locked fact {key!r}.")
    session.delete(row)
    session.flush()
    return True
