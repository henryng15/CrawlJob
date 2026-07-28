"""Deterministic eligibility filter (spec §7.3, §7.6).

Runs before any model is called, for two reasons. It is free, so it keeps the LLM
budget for roles that could actually be applied to. And it is the layer a high AI
score may never override (§7.6): if the deterministic filter says the user is not
eligible, no amount of model enthusiasm changes that.

Every rejection carries a human-readable reason, because the user will want to
know why a role they saw on a list never reached their queue.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from enum import StrEnum

__all__ = [
    "EligibilityResult",
    "EligibilityRules",
    "Verdict",
    "evaluate",
    "is_internship_title",
    "seniority_of",
]


class Verdict(StrEnum):
    PASS = "PASS"  # noqa: S105 — a verdict, not a credential
    REJECT = "REJECT"
    #: Passed the hard rules but something needs a human before spending money
    #: on it — an unparseable location, an unknown employment term.
    REVIEW = "REVIEW"


class Seniority(StrEnum):
    INTERN = "INTERN"
    ENTRY = "ENTRY"
    SENIOR = "SENIOR"
    UNKNOWN = "UNKNOWN"


# Matched against the normalized title, so these are all lowercase and expanded.
_INTERN = re.compile(r"\b(intern|internship|co op|coop|apprentice|placement)\b")
_SENIOR = re.compile(
    r"\b(senior|staff|principal|lead|manager|director|head|vp|president|"
    r"architect|distinguished|fellow)\b"
)
_ENTRY = re.compile(r"\b(new grad|new graduate|entry level|junior|associate|university grad)\b")

#: Functions the user is targeting (§7.3). Matched on the normalized title, where
#: "SWE" has already been expanded to "software engineer".
_TARGET_FUNCTIONS = re.compile(
    r"\b("
    r"software|developer|dev|engineering|engineer|programmer|"
    r"back end|front end|full stack|web|mobile|ios|android|"
    r"platform|infrastructure|infra|systems|distributed|cloud|"
    r"site reliability|sre|dev ops|security|compiler|embedded|"
    r"data engineer|data engineering|machine learning|ml engineer"
    r")\b"
)

#: Roles that read as engineering but are not what the user is applying for.
_OFF_TARGET = re.compile(
    r"\b("
    r"sales|marketing|recruit|hr|human resources|finance|accounting|legal|"
    r"mechanical|electrical|civil|chemical|biomedical|aerospace|industrial|"
    r"hardware|manufacturing|process|quality assurance technician|"
    r"customer success|business development|supply chain|"
    r"data analyst|business analyst|financial analyst"
    r")\b"
)

#: Degree requirements that would disqualify an undergraduate. Deliberately
#: narrow: "PhD preferred" or "or equivalent experience" must not reject.
_GRADUATE_REQUIRED = re.compile(
    r"(?:"
    r"(?:must (?:be|have)|require[sd]?|requirement:?)\s+(?:a\s+|an\s+)?"
    r"(?:phd|ph\.d|doctora\w*|master'?s?|m\.s\.|msc|graduate degree)"
    r"|"
    # "Master's degree is required" — the noun may sit between the qualification
    # and the verb, so `degree` has to be optional rather than absent.
    r"(?:phd|ph\.d|master'?s?|m\.s\.|msc|graduate)\s+(?:degree\s+)?(?:is\s+)?required"
    r"|currently (?:enrolled in|pursuing) a (?:phd|ph\.d|master'?s?|doctoral)"
    r")",
    re.IGNORECASE,
)

_US_HINTS = re.compile(
    r"\b(us|usa|u s a|united states|remote)\b|"
    r"\b(al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|"
    r"ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|"
    r"wv|wi|wy|dc)\b"
)

#: Countries that appear often enough in feeds to be worth rejecting explicitly.
_NON_US = re.compile(
    r"\b(canada|toronto|vancouver|montreal|ontario|london|uk|united kingdom|"
    r"ireland|dublin|germany|berlin|munich|france|paris|india|bangalore|"
    r"hyderabad|singapore|australia|sydney|japan|tokyo|china|beijing|shanghai|"
    r"israel|tel aviv|netherlands|amsterdam|poland|warsaw|brazil|mexico|spain|"
    r"madrid|barcelona|zurich|switzerland|sweden|stockholm)\b"
)


@dataclass(frozen=True, slots=True)
class EligibilityRules:
    """Configurable filter policy (§16.3, §33)."""

    require_us: bool = True
    require_internship: bool = True
    max_role_age_days: int | None = 21
    #: Seasons the user is applying for, e.g. {"SUMMER_2027"}. None accepts any.
    allowed_seasons: frozenset[str] | None = None
    #: True when the user cannot satisfy a graduate-degree requirement.
    exclude_graduate_only: bool = True


@dataclass(slots=True)
class EligibilityResult:
    verdict: Verdict
    reasons: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return self.verdict is Verdict.PASS

    @property
    def rejected(self) -> bool:
        return self.verdict is Verdict.REJECT


def seniority_of(normalized_title: str) -> Seniority:
    """Classify a title's level.

    Checks senior markers before intern markers, so "Senior Manager, Intern
    Programs" is not read as an internship.
    """
    if _SENIOR.search(normalized_title):
        return Seniority.SENIOR
    if _INTERN.search(normalized_title):
        return Seniority.INTERN
    if _ENTRY.search(normalized_title):
        return Seniority.ENTRY
    return Seniority.UNKNOWN


def is_internship_title(normalized_title: str) -> bool:
    return seniority_of(normalized_title) is Seniority.INTERN


def _looks_us(normalized_location: str) -> bool | None:
    """True, False, or None when the location says nothing useful."""
    if not normalized_location.strip():
        return None
    if _NON_US.search(normalized_location):
        return False
    if _US_HINTS.search(normalized_location):
        return True
    return None


def evaluate(
    *,
    normalized_title: str,
    normalized_location: str = "",
    description_text: str | None = None,
    season: str | None = None,
    posted_at: datetime | None = None,
    is_closed: bool = False,
    rules: EligibilityRules | None = None,
    now: datetime | None = None,
) -> EligibilityResult:
    """Apply the hard rules. Nothing here consults a model.

    Args:
        normalized_title: output of ``normalize_title``.
        normalized_location: output of ``normalize_location``.
        description_text: plain-text job description, when already fetched.
        season: e.g. ``"SUMMER_2027"``.
        posted_at: when the employer published the role.
        is_closed: whether the posting is known to be closed.
        rules: policy; defaults to :class:`EligibilityRules`.
        now: reference time for the age check.

    Returns:
        A result whose ``reasons`` explain any rejection in the user's terms.
    """
    rules = rules or EligibilityRules()
    reasons: list[str] = []
    warnings: list[str] = []

    if is_closed:
        reasons.append("posting is closed")

    level = seniority_of(normalized_title)
    if rules.require_internship and level is not Seniority.INTERN:
        reasons.append(
            "not an internship" if level is Seniority.UNKNOWN else f"role level is {level.value}"
        )

    if _OFF_TARGET.search(normalized_title):
        reasons.append("not a software engineering function")
    elif not _TARGET_FUNCTIONS.search(normalized_title):
        reasons.append("title does not match a targeted engineering function")

    if rules.require_us:
        us = _looks_us(normalized_location)
        if us is False:
            reasons.append("location is outside the United States")
        elif us is None:
            warnings.append("location could not be classified")

    if rules.allowed_seasons is not None:
        if season is None:
            warnings.append("season not stated in the posting")
        elif season not in rules.allowed_seasons:
            reasons.append(f"season {season} is not being applied for")

    if (
        rules.exclude_graduate_only
        and description_text
        and (match := _GRADUATE_REQUIRED.search(description_text))
    ):
        reasons.append(f"requires a graduate degree: {match.group(0).strip()!r}")

    if rules.max_role_age_days is not None and posted_at is not None:
        age = (now or datetime.now(posted_at.tzinfo)) - posted_at
        if age > timedelta(days=rules.max_role_age_days):
            reasons.append(f"posted {age.days} days ago, older than {rules.max_role_age_days}")

    if reasons:
        return EligibilityResult(Verdict.REJECT, reasons, warnings)
    if warnings:
        return EligibilityResult(Verdict.REVIEW, [], warnings)
    return EligibilityResult(Verdict.PASS, [], [])


def graduation_year_fits(graduation: date, season: str | None) -> bool | None:
    """Whether the user is still a student during ``season``.

    Returns ``None`` when the season is unparseable — the caller should treat that
    as "ask", not as "no". Internships are for people who return to school
    afterwards, so a summer graduating *before* the internship generally does not
    fit, and one long after it may be too early for the employer.
    """
    if not season or "_" not in season:
        return None
    try:
        year = int(season.rsplit("_", 1)[1])
    except ValueError:
        return None
    # A summer 2027 internship suits someone graduating December 2027 through
    # roughly mid-2029; earlier means they have already graduated.
    return year < graduation.year or (year == graduation.year and graduation.month >= 6)
