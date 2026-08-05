"""Form field taxonomy and answer resolution (spec §7.8).

Given a question on an employer's application form, this decides two things: what
the question is asking, and where the answer may come from.

The second decision is the safety-critical one. §7.8 lists the questions that must
never be answered by inference — work authorization, citizenship, export control,
criminal history, the EEO block, salary, attestations and electronic signatures.
None of those may ever be model-derived or read from an unlocked fact.

Within that set the questions divide by *how often the truthful answer changes*:

* Whether someone is a citizen, or has a felony conviction, or how they choose to
  answer the EEO block, is a constant for that person. The user sets it once,
  deliberately, and locks it — see :data:`LOCKED_FACT_ANSWERABLE_KEYS`.
* Expected salary is per-application. Relocation depends on where the job is. A
  clearance or export-control answer depends on the employer asking. And a
  signature or an attestation is not a fact at all but a legal act, which is the
  user's to perform. See :data:`ALWAYS_MANUAL_KEYS`: those stop the application
  even when a locked fact happens to exist.

The classification is deliberately biased toward manual: an unrecognised question
becomes ``UNRESOLVED`` rather than being guessed at. The cost of that bias is the
user answering one more field per application. The cost of the opposite bias is a
false statement on a legal document.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

__all__ = [
    "ALWAYS_MANUAL_KEYS",
    "LOCKED_FACT_ANSWERABLE_KEYS",
    "MANUAL_ONLY_KEYS",
    "Answer",
    "FieldSpec",
    "FieldType",
    "SourceType",
    "classify",
    "resolve",
    "unresolved_fields",
]


class FieldType(StrEnum):
    TEXT = "text"
    TEXTAREA = "textarea"
    EMAIL = "email"
    PHONE = "phone"
    URL = "url"
    NUMBER = "number"
    DATE = "date"
    SELECT = "select"
    MULTISELECT = "multiselect"
    RADIO = "radio"
    CHECKBOX = "checkbox"
    FILE = "file"
    UNKNOWN = "unknown"


class SourceType(StrEnum):
    """Where an answer came from. Rendered beside every field on review (§22.4)."""

    #: A candidate fact the user locked. Never model-derived.
    LOCKED_FACT = "LOCKED_FACT"
    #: An ordinary profile fact.
    PROFILE_FACT = "PROFILE_FACT"
    #: Computed from other facts by code, e.g. first name from legal name.
    DERIVED_DETERMINISTIC = "DERIVED_DETERMINISTIC"
    #: Written by a model. Only ever free text, never a legal answer.
    AI_DRAFT = "AI_DRAFT"
    #: The user edited it during review.
    USER_OVERRIDE = "USER_OVERRIDE"
    #: Recognised, but policy says a human must answer.
    MANUAL_REQUIRED = "MANUAL_REQUIRED"
    #: Not recognised at all.
    UNRESOLVED = "UNRESOLVED"


#: Manual-only keys whose truthful answer is a constant for a given person. The
#: user sets each one once and locks it, and a locked fact is as true on the
#: hundredth form as on the first — so these may be filled from one, and only from
#: one. Never from a model, never from an unlocked fact.
LOCKED_FACT_ANSWERABLE_KEYS: frozenset[str] = frozenset(
    {
        "auth.work_authorized",
        "auth.requires_sponsorship",
        # Listed for completeness only. A question carrying both markers is
        # refused by app.services.work_authorization before resolution reaches
        # this table, because the two facts cannot be combined without changing
        # what is being claimed.
        "auth.work_authorized_without_sponsorship",
        "auth.citizenship",
        "background.criminal_history",
        "background.previously_employed",
        "background.noncompete",
        "eeo.disability",
        "eeo.veteran_status",
        "eeo.race_ethnicity",
        "eeo.gender",
    }
)

#: Manual-only keys that stop the application even when a locked fact exists,
#: because a stored answer would not be the answer to *this* question:
#:
#: * salary expectation and relocation are per-application judgements;
#: * clearance and export control depend on the employer and the role asking;
#: * a signature or an attestation is a legal act, not a fact — only the person
#:   making the statement may make it.
ALWAYS_MANUAL_KEYS: frozenset[str] = frozenset(
    {
        "compensation.expected",
        "commitment.relocation",
        "auth.security_clearance",
        "auth.export_control",
        "legal.attestation",
        "legal.signature",
    }
)

#: Every key a model may never answer and an unlocked fact may never fill. Kept as
#: the union so callers auditing "was policy applied to this field" need only one
#: set; the split above decides whether a locked fact is enough.
MANUAL_ONLY_KEYS: frozenset[str] = LOCKED_FACT_ANSWERABLE_KEYS | ALWAYS_MANUAL_KEYS

#: Ordered question patterns. First match wins, so the specific ones come first.
_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    # --- legal attestations and signatures -------------------------------
    (
        "legal.signature",
        re.compile(
            r"\b(e-?signature|electronic signature|type your (full )?name to sign|sign here)\b",
            re.I,
        ),
    ),
    (
        "legal.attestation",
        re.compile(
            r"\b(i certify|i attest|i confirm that|i acknowledge|"
            r"under penalty of perjury|to the best of my knowledge)\b",
            re.I,
        ),
    ),
    # --- work authorization ----------------------------------------------
    (
        "auth.requires_sponsorship",
        re.compile(
            r"\b(require|need).{0,30}(sponsorship|visa)"
            r"|sponsorship.{0,20}(now or in the future|required)",
            re.I,
        ),
    ),
    (
        "auth.work_authorized",
        re.compile(r"\b(legally )?(authorized|eligible) to work\b|\bwork authorization\b", re.I),
    ),
    ("auth.citizenship", re.compile(r"\b(citizen(ship)?|permanent resident|green card)\b", re.I)),
    ("auth.export_control", re.compile(r"\b(export control|itar|ear\b|u\.?s\.? person)\b", re.I)),
    ("auth.security_clearance", re.compile(r"\bsecurity clearance\b", re.I)),
    # --- background -------------------------------------------------------
    (
        "background.criminal_history",
        re.compile(r"\b(convicted|criminal|felony|misdemeanor)\b", re.I),
    ),
    (
        "background.previously_employed",
        re.compile(
            r"\b(previously (worked|employed)|former employee|worked (here|for us))\b", re.I
        ),
    ),
    (
        "background.noncompete",
        re.compile(r"\b(non-?compete|conflict of interest|restrictive covenant)\b", re.I),
    ),
    # --- EEO --------------------------------------------------------------
    ("eeo.disability", re.compile(r"\bdisabilit(y|ies)\b", re.I)),
    ("eeo.veteran_status", re.compile(r"\bveteran\b|\bprotected veteran\b", re.I)),
    ("eeo.race_ethnicity", re.compile(r"\b(race|ethnicity|hispanic|latino)\b", re.I)),
    ("eeo.gender", re.compile(r"\b(gender|sex)\b", re.I)),
    # --- compensation and commitment --------------------------------------
    (
        "compensation.expected",
        re.compile(
            r"\b(salary|compensation|hourly rate|pay).{0,25}(expectation|requirement|desired)"
            r"|\bexpected (salary|compensation)\b",
            re.I,
        ),
    ),
    ("commitment.relocation", re.compile(r"\b(willing to relocate|relocation)\b", re.I)),
    # --- contact ----------------------------------------------------------
    ("candidate.first_name", re.compile(r"\bfirst name\b|\bgiven name\b", re.I)),
    ("candidate.last_name", re.compile(r"\blast name\b|\bfamily name\b|\bsurname\b", re.I)),
    ("candidate.preferred_name", re.compile(r"\bpreferred name\b|\bnickname\b", re.I)),
    ("candidate.full_name", re.compile(r"\b(full|legal) name\b|^name$", re.I)),
    ("candidate.email", re.compile(r"\be-?mail\b", re.I)),
    ("candidate.phone", re.compile(r"\b(phone|mobile|telephone|cell)\b", re.I)),
    ("candidate.address_line", re.compile(r"\b(street|address line|address)\b", re.I)),
    ("candidate.city", re.compile(r"\bcity\b|\bcurrent location\b", re.I)),
    ("candidate.state", re.compile(r"\bstate\b|\bprovince\b", re.I)),
    ("candidate.postal_code", re.compile(r"\b(zip|postal)\b", re.I)),
    ("candidate.country", re.compile(r"\bcountry\b", re.I)),
    # --- links -------------------------------------------------------------
    ("candidate.linkedin", re.compile(r"\blinkedin\b", re.I)),
    ("candidate.github", re.compile(r"\b(github|git hub)\b", re.I)),
    ("candidate.portfolio", re.compile(r"\b(portfolio|personal (web)?site|website)\b", re.I)),
    # --- education ---------------------------------------------------------
    ("education.school", re.compile(r"\b(school|university|college|institution)\b", re.I)),
    ("education.degree", re.compile(r"\bdegree\b", re.I)),
    ("education.major", re.compile(r"\b(major|discipline|field of study)\b", re.I)),
    ("education.gpa", re.compile(r"\bgpa\b|\bgrade point\b", re.I)),
    (
        "education.graduation_date",
        re.compile(r"\b(graduation|grad) (date|year|month)\b|\bexpected graduation\b", re.I),
    ),
    (
        "education.start_date",
        re.compile(r"\bstart date\b.{0,20}\b(school|university|program)\b", re.I),
    ),
    # --- documents ---------------------------------------------------------
    ("documents.resume", re.compile(r"\b(resume|cv|curriculum vitae)\b", re.I)),
    ("documents.cover_letter", re.compile(r"\bcover letter\b", re.I)),
    ("documents.transcript", re.compile(r"\btranscript\b", re.I)),
    # --- open questions ----------------------------------------------------
    (
        "open.why_company",
        re.compile(r"\bwhy (do you want to |are you interested in )?(work|join|apply)", re.I),
    ),
    (
        "open.additional_info",
        re.compile(r"\b(anything else|additional information|other comments)\b", re.I),
    ),
    # --- logistics ---------------------------------------------------------
    (
        "logistics.start_availability",
        re.compile(r"\b(available|availability|earliest start)\b", re.I),
    ),
    ("logistics.how_did_you_hear", re.compile(r"\bhow did you hear\b|\breferral source\b", re.I)),
)

#: Semantic keys that free text may reasonably be drafted for (§7.8).
_AI_DRAFTABLE: frozenset[str] = frozenset(
    {"open.why_company", "open.additional_info", "logistics.how_did_you_hear"}
)


@dataclass(frozen=True, slots=True)
class FieldSpec:
    """One question as extracted from a form."""

    question_text: str
    field_type: FieldType = FieldType.TEXT
    name: str | None = None
    required: bool = False
    options: tuple[str, ...] = ()
    page_index: int = 0
    locator: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class Answer:
    """A resolved answer plus its provenance."""

    semantic_key: str | None
    value: Any
    source_type: SourceType
    fact_ids: tuple[str, ...] = ()
    confidence: float = 1.0
    note: str = ""

    @property
    def needs_human(self) -> bool:
        return self.source_type in {SourceType.MANUAL_REQUIRED, SourceType.UNRESOLVED}

    @property
    def is_fillable(self) -> bool:
        """Whether the browser may type this answer into the form."""
        return self.value is not None and not self.needs_human


def classify(spec: FieldSpec) -> str | None:
    """Identify what a question is asking, or ``None`` if unrecognised.

    Matches on the visible question text first and the field ``name`` attribute
    second, because the label is what the applicant reads and what a screen
    reader announces, while ``name`` is often an opaque ATS identifier.
    """
    for haystack in (spec.question_text, spec.name or ""):
        if not haystack:
            continue
        for key, pattern in _PATTERNS:
            if pattern.search(haystack):
                return key
    return None


def resolve(
    spec: FieldSpec,
    *,
    facts: dict[str, Any],
    locked_keys: frozenset[str] = frozenset(),
    ai_answers: dict[str, str] | None = None,
) -> Answer:
    """Decide the answer for one field and record where it came from.

    Args:
        spec: the extracted question.
        facts: candidate facts keyed by semantic key.
        locked_keys: which of those facts the user locked.
        ai_answers: model-drafted free text, keyed by semantic key. Ignored for
            anything in :data:`MANUAL_ONLY_KEYS`.
    """
    # Work authorization is settled before anything else, including pattern
    # matching. A combined "authorized to work *without sponsorship*" question
    # matches the sponsorship pattern, and answering it from the sponsorship fact
    # inverts what is being claimed — see app.services.work_authorization.
    if (authorization := _work_authorization(spec, facts, locked_keys)) is not None:
        return authorization

    key = classify(spec)

    if key is None:
        return Answer(
            None,
            None,
            SourceType.UNRESOLVED,
            note="question not recognised; a human must answer it",
        )

    # Policy before data. A manual-only question is not answered from a model or
    # from an unlocked fact even when one happens to be available.
    if key in ALWAYS_MANUAL_KEYS:
        return Answer(
            key,
            None,
            SourceType.MANUAL_REQUIRED,
            note="only the user may answer this, on every application",
        )

    if key in LOCKED_FACT_ANSWERABLE_KEYS:
        if key in facts and key in locked_keys:
            return Answer(
                key,
                facts[key],
                SourceType.LOCKED_FACT,
                fact_ids=(key,),
                note="answered from a locked candidate fact",
            )
        return Answer(
            key,
            None,
            SourceType.MANUAL_REQUIRED,
            note="policy requires a locked candidate fact for this, and none is set",
        )

    if key in facts:
        source = SourceType.LOCKED_FACT if key in locked_keys else SourceType.PROFILE_FACT
        return Answer(key, facts[key], source, fact_ids=(key,))

    if ai_answers and key in ai_answers and key in _AI_DRAFTABLE:
        return Answer(
            key,
            ai_answers[key],
            SourceType.AI_DRAFT,
            confidence=0.7,
            note="drafted by a model; review before submitting",
        )

    return Answer(
        key,
        None,
        SourceType.MANUAL_REQUIRED,
        note="recognised, but no profile fact covers it",
    )


def _work_authorization(
    spec: FieldSpec, facts: dict[str, Any], locked_keys: frozenset[str]
) -> Answer | None:
    """Answer a work-authorization question, or ``None`` if it is not one.

    Kept separate from the pattern table because the decision is not "which key
    is this" but "can this be answered at all", and the two questions have
    different answers for the same text.
    """
    from app.services.work_authorization import Category, decide

    decision = decide(spec.question_text, spec.name, facts=facts, locked_keys=locked_keys)
    if decision.category is Category.UNRELATED:
        return None

    key = _AUTH_KEY_BY_CATEGORY[decision.category]

    if decision.answered:
        return Answer(
            key,
            decision.value,
            SourceType.LOCKED_FACT,
            fact_ids=(decision.fact_key,) if decision.fact_key else (),
            note=decision.reason,
        )
    return Answer(key, None, SourceType.MANUAL_REQUIRED, note=decision.reason)


#: The semantic key recorded against each kind of question. A combined question
#: gets its own key rather than being filed under one of its halves, so the
#: review screen can say what actually happened.
_AUTH_KEY_BY_CATEGORY: dict[Any, str] = {}


def _init_auth_keys() -> None:
    from app.services.work_authorization import Category

    _AUTH_KEY_BY_CATEGORY.update(
        {
            Category.AUTHORIZATION: "auth.work_authorized",
            # Two keys, because they are two questions. "Do you require
            # sponsorship for this role" and "...now or in the future" have
            # different truthful answers for the same person, and a review screen
            # that showed them under one name would hide that.
            Category.SPONSORSHIP_NOW: "auth.requires_sponsorship_now",
            Category.SPONSORSHIP_FUTURE: "auth.requires_sponsorship",
            Category.COMBINED: "auth.work_authorized_without_sponsorship",
        }
    )


_init_auth_keys()


def unresolved_fields(answers: list[Answer]) -> list[Answer]:
    """Answers the user must supply before the application is complete."""
    return [a for a in answers if a.needs_human]
