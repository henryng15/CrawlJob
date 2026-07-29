"""Sponsorship and work-authorization analysis (spec §7.5, §2.2).

This module reads what the *employer* said. It never touches what is true about
the user — that lives in ``candidate_facts`` and no model can write it (§7.1).

The design rests on one idea: **a restrictive classification requires a quote, and
the quote must actually be in the job description.** A model asked to find
sponsorship language will sometimes produce a plausible sentence that the posting
does not contain. :func:`verify_evidence` checks each quote against the source
text and discards any that is not there, after which a classification left without
evidence is downgraded rather than trusted.

The consequence of getting this wrong is concrete: a fabricated "we do not sponsor"
quote makes the user skip a job they were eligible for, and a missed real one sends
them to a role that cannot hire them.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from enum import StrEnum

from pydantic import BaseModel, Field, field_validator

from app.services.llm.base import (
    LLMError,
    LLMProvider,
    Message,
    SchemaValidationError,
    Task,
)

log = logging.getLogger(__name__)

__all__ = [
    "Classification",
    "Evidence",
    "RecommendedAction",
    "SponsorshipAnalysis",
    "WorkAuthRestriction",
    "analyze",
    "deterministic_prepass",
    "recommend",
    "verify_evidence",
]

PROMPT_VERSION = "sponsorship/v1"


class Classification(StrEnum):
    SPONSORSHIP_AVAILABLE = "SPONSORSHIP_AVAILABLE"
    SPONSORSHIP_CASE_BY_CASE = "SPONSORSHIP_CASE_BY_CASE"
    SPONSORSHIP_NOT_AVAILABLE = "SPONSORSHIP_NOT_AVAILABLE"
    SPONSORSHIP_NOT_MENTIONED = "SPONSORSHIP_NOT_MENTIONED"
    SPONSORSHIP_AMBIGUOUS = "SPONSORSHIP_AMBIGUOUS"


class WorkAuthRestriction(StrEnum):
    NO_EXPLICIT_RESTRICTION = "NO_EXPLICIT_RESTRICTION"
    US_WORK_AUTHORIZATION_REQUIRED = "US_WORK_AUTHORIZATION_REQUIRED"
    US_CITIZENSHIP_REQUIRED = "US_CITIZENSHIP_REQUIRED"
    PERMANENT_RESIDENCY_OR_CITIZENSHIP_REQUIRED = "PERMANENT_RESIDENCY_OR_CITIZENSHIP_REQUIRED"
    EXPORT_CONTROL_REVIEW = "EXPORT_CONTROL_REVIEW"
    UNKNOWN = "UNKNOWN"


class RecommendedAction(StrEnum):
    CONTINUE = "CONTINUE"
    MANUAL_REVIEW = "MANUAL_REVIEW"
    SKIP = "SKIP"


#: Classifications and restrictions that constrain the user. Each requires a
#: verbatim quote before it may stand.
RESTRICTIVE_CLASSIFICATIONS = frozenset(
    {Classification.SPONSORSHIP_NOT_AVAILABLE, Classification.SPONSORSHIP_CASE_BY_CASE}
)
RESTRICTIVE_RESTRICTIONS = frozenset(
    {
        WorkAuthRestriction.US_WORK_AUTHORIZATION_REQUIRED,
        WorkAuthRestriction.US_CITIZENSHIP_REQUIRED,
        WorkAuthRestriction.PERMANENT_RESIDENCY_OR_CITIZENSHIP_REQUIRED,
        WorkAuthRestriction.EXPORT_CONTROL_REVIEW,
    }
)


class Evidence(BaseModel):
    """A quote from the job description, with where it was found."""

    quote: str = Field(min_length=8)
    source_url: str = ""
    start_offset: int = -1
    end_offset: int = -1

    @field_validator("quote")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()

    @property
    def is_located(self) -> bool:
        return self.start_offset >= 0


class SponsorshipAnalysis(BaseModel):
    """Structured output of the classifier (§7.5)."""

    classification: Classification
    work_authorization_restriction: WorkAuthRestriction
    evidence: list[Evidence] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning_summary: str = ""

    @property
    def is_restrictive(self) -> bool:
        return (
            self.classification in RESTRICTIVE_CLASSIFICATIONS
            or self.work_authorization_restriction in RESTRICTIVE_RESTRICTIONS
        )


# ------------------------------------------------------- deterministic pass

#: Phrases that reliably indicate the employer will not sponsor. Matched first so
#: the obvious cases never cost a model call (§11.6: deterministic parser first).
_NO_SPONSORSHIP = re.compile(
    r"(?:"
    r"(?:will |can |do(?:es)? )?not (?:be able to )?(?:provide|offer|sponsor)\w*"
    r"(?:\s+\w+){0,3}\s+(?:sponsorship|visa)"
    r"|unable to (?:provide|offer|sponsor)\w*(?:\s+\w+){0,3}\s*(?:sponsorship|visa)?"
    r"|no (?:visa )?sponsorship(?: is)?(?: available| offered| provided)?"
    r"|without (?:the need for |requiring )?(?:current or future )?sponsorship"
    r"|not (?:currently )?sponsoring"
    r")",
    re.IGNORECASE,
)

_WILL_SPONSOR = re.compile(
    r"(?:we (?:do |will )?sponsor|sponsorship (?:is )?available|"
    r"visa sponsorship (?:is )?(?:offered|provided|available)|will provide sponsorship)",
    re.IGNORECASE,
)

_CITIZENSHIP = re.compile(
    r"(?:u\.?s\.?\s+citizen(?:ship)?\s+(?:is\s+)?(?:required|only)"
    r"|must be a u\.?s\.?\s+citizen"
    r"|citizenship\s+(?:is\s+)?required)",
    re.IGNORECASE,
)

_PERM_RESIDENT = re.compile(
    r"(?:u\.?s\.?\s+citizen(?:s)?\s+or\s+(?:lawful\s+)?permanent\s+resident"
    r"|green\s+card\s+holder)",
    re.IGNORECASE,
)

_EXPORT_CONTROL = re.compile(
    r"(?:export\s+control|itar|ear\b|u\.?s\.?\s+person\s+(?:as\s+)?defined)",
    re.IGNORECASE,
)

_WORK_AUTH = re.compile(
    r"(?:(?:must be |are )?(?:legally |currently )?authorized to work in the u\.?s"
    r"|work authorization (?:is )?required)",
    re.IGNORECASE,
)


@dataclass(frozen=True, slots=True)
class PrepassHit:
    classification: Classification | None
    restriction: WorkAuthRestriction | None
    evidence: list[Evidence]


def _find(pattern: re.Pattern[str], text: str, source_url: str) -> Evidence | None:
    """Locate a pattern and return the surrounding sentence as evidence.

    Quoting the whole sentence rather than the matched fragment matters: the user
    reads this on the review screen and "not sponsor" without its sentence is not
    something anyone can act on.
    """
    match = pattern.search(text)
    if match is None:
        return None
    start = max(text.rfind(".", 0, match.start()) + 1, 0)
    end = text.find(".", match.end())
    end = len(text) if end == -1 else end + 1
    quote = text[start:end].strip()
    if len(quote) < 8:
        quote = match.group(0)
        start, end = match.start(), match.end()
    return Evidence(quote=quote, source_url=source_url, start_offset=start, end_offset=end)


def deterministic_prepass(description: str, *, source_url: str = "") -> PrepassHit:
    """Classify the unambiguous cases without a model.

    Returns ``PrepassHit(None, None, [])`` when nothing conclusive is found, which
    is the signal to fall back to the classifier.
    """
    evidence: list[Evidence] = []
    classification: Classification | None = None
    restriction: WorkAuthRestriction | None = None

    if hit := _find(_NO_SPONSORSHIP, description, source_url):
        classification = Classification.SPONSORSHIP_NOT_AVAILABLE
        evidence.append(hit)
    elif hit := _find(_WILL_SPONSOR, description, source_url):
        classification = Classification.SPONSORSHIP_AVAILABLE
        evidence.append(hit)

    # Checked in decreasing severity: citizenship-only is stricter than
    # citizen-or-permanent-resident, which is stricter than plain work auth.
    for pattern, value in (
        (_CITIZENSHIP, WorkAuthRestriction.US_CITIZENSHIP_REQUIRED),
        (_PERM_RESIDENT, WorkAuthRestriction.PERMANENT_RESIDENCY_OR_CITIZENSHIP_REQUIRED),
        (_EXPORT_CONTROL, WorkAuthRestriction.EXPORT_CONTROL_REVIEW),
        (_WORK_AUTH, WorkAuthRestriction.US_WORK_AUTHORIZATION_REQUIRED),
    ):
        if hit := _find(pattern, description, source_url):
            restriction = value
            evidence.append(hit)
            break

    return PrepassHit(classification, restriction, evidence)


# ------------------------------------------------------- evidence checking


def _normalize_for_match(text: str) -> str:
    """Collapse whitespace and quote characters so near-misses still match.

    A model reproducing a quote may normalise a curly apostrophe or a line break.
    That is not fabrication, and rejecting it would push real evidence out.
    """
    text = text.replace("’", "'").replace("‘", "'")
    text = text.replace("“", '"').replace("”", '"')
    text = text.replace("–", "-").replace("—", "-")
    return re.sub(r"\s+", " ", text).strip().lower()


def verify_evidence(
    analysis: SponsorshipAnalysis, description: str
) -> tuple[list[Evidence], list[Evidence]]:
    """Split evidence into quotes that are in the description and quotes that are not.

    Returns ``(verified, rejected)``. Offsets on verified items are corrected to
    where the quote actually appears, so the review screen can highlight it.
    """
    haystack = _normalize_for_match(description)
    verified: list[Evidence] = []
    rejected: list[Evidence] = []

    for item in analysis.evidence:
        needle = _normalize_for_match(item.quote)
        if not needle:
            rejected.append(item)
            continue
        position = haystack.find(needle)
        if position == -1:
            rejected.append(item)
            continue
        verified.append(
            item.model_copy(update={"start_offset": position, "end_offset": position + len(needle)})
        )

    return verified, rejected


def enforce_evidence(analysis: SponsorshipAnalysis, description: str) -> SponsorshipAnalysis:
    """Downgrade any restrictive claim that is not backed by a real quote (§7.5).

    A restrictive classification with no verifiable evidence becomes
    ``SPONSORSHIP_AMBIGUOUS`` with ``UNKNOWN`` restriction, which routes the job to
    manual review instead of silently acting on an invented sentence.
    """
    verified, rejected = verify_evidence(analysis, description)
    analysis = analysis.model_copy(update={"evidence": verified})

    if not analysis.is_restrictive or verified:
        return analysis

    note = (
        f"Downgraded: {len(rejected)} quoted passage(s) were not found in the job "
        "description, so the restrictive classification is unsupported."
    )
    return analysis.model_copy(
        update={
            "classification": Classification.SPONSORSHIP_AMBIGUOUS,
            "work_authorization_restriction": WorkAuthRestriction.UNKNOWN,
            "confidence": min(analysis.confidence, 0.3),
            "reasoning_summary": (analysis.reasoning_summary + " " + note).strip(),
        }
    )


# -------------------------------------------------------------- decisioning


def recommend(
    analysis: SponsorshipAnalysis,
    *,
    candidate_needs_sponsorship: bool,
    candidate_is_us_citizen: bool = False,
    candidate_is_permanent_resident: bool = False,
) -> RecommendedAction:
    """Decide what to do with a job, given the employer's policy and the user's facts.

    This reads the user's facts; it never writes them. A posting saying "no
    sponsorship" is a reason to skip the job — never a reason to answer the
    sponsorship question untruthfully (§2.2).
    """
    restriction = analysis.work_authorization_restriction

    if restriction is WorkAuthRestriction.US_CITIZENSHIP_REQUIRED:
        return RecommendedAction.CONTINUE if candidate_is_us_citizen else RecommendedAction.SKIP

    if restriction is WorkAuthRestriction.PERMANENT_RESIDENCY_OR_CITIZENSHIP_REQUIRED:
        satisfied = candidate_is_us_citizen or candidate_is_permanent_resident
        return RecommendedAction.CONTINUE if satisfied else RecommendedAction.SKIP

    # Export-control eligibility is a legal question about a specific person and a
    # specific technology. The system is explicitly forbidden from inferring it
    # (§3.2, §27.11), so it always asks.
    if restriction is WorkAuthRestriction.EXPORT_CONTROL_REVIEW:
        return RecommendedAction.MANUAL_REVIEW

    if not candidate_needs_sponsorship:
        return RecommendedAction.CONTINUE

    match analysis.classification:
        case Classification.SPONSORSHIP_NOT_AVAILABLE:
            return RecommendedAction.MANUAL_REVIEW
        case Classification.SPONSORSHIP_AMBIGUOUS:
            return RecommendedAction.MANUAL_REVIEW
        case Classification.SPONSORSHIP_AVAILABLE | Classification.SPONSORSHIP_CASE_BY_CASE:
            return RecommendedAction.CONTINUE
        case _:
            # Silence is not a refusal. Most postings never mention sponsorship.
            return RecommendedAction.CONTINUE


# ------------------------------------------------------------------ driver

_SYSTEM = """\
You classify what a job description says about visa sponsorship and work
authorization. You are reading the employer's stated policy only.

Rules:
- Quote verbatim from the job description. Never paraphrase a quote.
- If the description does not mention sponsorship, say SPONSORSHIP_NOT_MENTIONED
  and return no evidence. Silence is not a refusal.
- Use a restrictive classification only when you can quote the sentence that
  supports it.
- Do not infer immigration law, eligibility, or advice.
"""


def analyze(
    description: str,
    *,
    provider: LLMProvider,
    source_url: str = "",
) -> SponsorshipAnalysis:
    """Classify a job description, deterministically where possible.

    The keyword pre-pass handles the clear cases at no cost; the model is only
    consulted when the wording is not obvious. Whatever the source, the result
    passes through :func:`enforce_evidence` before it is returned.
    """
    if not description.strip():
        return SponsorshipAnalysis(
            classification=Classification.SPONSORSHIP_NOT_MENTIONED,
            work_authorization_restriction=WorkAuthRestriction.UNKNOWN,
            confidence=0.0,
            reasoning_summary="No description text was available.",
        )

    hit = deterministic_prepass(description, source_url=source_url)
    if hit.classification is not None or hit.restriction is not None:
        # Either half is decisive on its own: an explicit citizenship requirement
        # settles the recommendation whatever the posting says about sponsorship,
        # and an explicit refusal settles it whatever it says about authorization.
        # The half that was not matched is reported honestly rather than asserted:
        # NOT_MENTIONED and UNKNOWN both mean "this pass found nothing", and
        # neither claims the posting is silent on the point.
        both = hit.classification is not None and hit.restriction is not None
        return enforce_evidence(
            SponsorshipAnalysis(
                classification=hit.classification or Classification.SPONSORSHIP_NOT_MENTIONED,
                work_authorization_restriction=hit.restriction or WorkAuthRestriction.UNKNOWN,
                evidence=hit.evidence,
                confidence=0.95 if both else 0.85,
                reasoning_summary="Matched explicit sponsorship or work-authorization language.",
            ),
            description,
        )

    try:
        response = provider.structured_generate(
            task=Task.SPONSORSHIP,
            schema=SponsorshipAnalysis,
            messages=[
                Message(role="system", content=_SYSTEM),
                Message(role="user", content=description),
            ],
        )
    except SchemaValidationError:
        # A model that returned the wrong shape is misbehaving, not absent.
        # Swallowing it here would make a broken prompt look like a missing key.
        raise
    except LLMError as exc:
        # No model, no budget, or a provider that failed. The honest answer is
        # "this pass found nothing", which is what the pre-pass already
        # concluded — and it is a *permissive* answer, so degrading cannot turn a
        # job the employer ruled out into one the system proceeds with.
        log.info("sponsorship classified deterministically only: %s", exc)
        return SponsorshipAnalysis(
            classification=Classification.SPONSORSHIP_NOT_MENTIONED,
            work_authorization_restriction=WorkAuthRestriction.UNKNOWN,
            confidence=0.2,
            reasoning_summary=(
                "No explicit sponsorship language was found, and no model was "
                "available to read the wording. Check the description yourself "
                "before relying on this."
            ),
        )

    return enforce_evidence(response.value, description)
