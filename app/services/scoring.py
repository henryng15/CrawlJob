"""Job fit scoring (spec §7.6).

The weights come straight from §7.6, but the split does not: five of the eight
components are computed deterministically here, and only three are asked of a
model.

That split is the point. Level fit, graduation eligibility, location, sponsorship
compatibility and freshness are all facts already in hand — asking a model to
judge them would spend money to introduce variance into an answer we can compute.
What is left needs reading comprehension: how central software engineering is to
the role, how well the user's skills overlap, and whether their projects are
relevant.

Two rules constrain the model's contribution:

* **A high score cannot rescue an ineligible job.** The deterministic filter runs
  first and, when it rejects, the model is never called (§7.6).
* **A judgment score must cite profile facts.** A skills-overlap of 15 with no
  cited fact ids is an assertion, not an assessment, and is zeroed.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from app.services.eligibility import (
    EligibilityResult,
    EligibilityRules,
    Seniority,
    Verdict,
    evaluate,
    graduation_year_fits,
    seniority_of,
)
from app.services.sponsorship import (
    Classification,
    RecommendedAction,
    SponsorshipAnalysis,
    WorkAuthRestriction,
    recommend,
)

__all__ = [
    "WEIGHTS",
    "JobScore",
    "ScoreInput",
    "score",
]

#: Maximum points per component. Three further components — how central software
#: engineering is to the role, skills overlap, and project relevance — used to be
#: judged by a model and carried half the total. They are gone with the model, so
#: the remaining components are rescaled to 100 at the end rather than reweighted
#: here: the point functions stay readable against their own natural maxima.
WEIGHTS: dict[str, float] = {
    "internship_level_fit": 20.0,
    "graduation_eligibility": 10.0,
    "location_fit": 5.0,
    "sponsorship_compatibility": 10.0,
    "application_freshness": 5.0,
}

_TOTAL_WEIGHT = sum(WEIGHTS.values())


@dataclass(frozen=True, slots=True)
class ScoreInput:
    """Everything scoring needs, gathered by the caller."""

    normalized_title: str
    normalized_location: str = ""
    #: The location as the board wrote it. Carried alongside the normalized form
    #: because only the raw text can distinguish Remote-US from Remote-EMEA.
    location_text: str | None = None
    description_text: str | None = None
    season: str | None = None
    posted_at: datetime | None = None
    is_closed: bool = False

    #: Candidate facts consulted read-only (§2.2). Never written here.
    graduation_date: date | None = None
    needs_sponsorship: bool = True
    is_us_citizen: bool = False
    is_permanent_resident: bool = False
    preferred_locations: frozenset[str] = frozenset()
    open_to_remote: bool = True


@dataclass(slots=True)
class JobScore:
    """A total out of 100 with a per-component breakdown (§22.2)."""

    total: float
    components: dict[str, float]
    hard_filter_result: Verdict
    eligibility_reasons: list[str]
    reasons: list[str]

    @property
    def is_eligible(self) -> bool:
        return self.hard_filter_result is not Verdict.REJECT


# ------------------------------------------------------ deterministic parts


def _level_points(normalized_title: str) -> tuple[float, str]:
    match seniority_of(normalized_title):
        case Seniority.INTERN:
            return WEIGHTS["internship_level_fit"], "titled as an internship"
        case Seniority.ENTRY:
            return 6.0, "new-grad role, not an internship"
        case Seniority.UNKNOWN:
            return 4.0, "level could not be determined from the title"
        case _:
            return 0.0, "role is above internship level"


def _graduation_points(graduation: date | None, season: str | None) -> tuple[float, str]:
    if graduation is None:
        return 5.0, "graduation date not on file"
    fits = graduation_year_fits(graduation, season)
    if fits is None:
        return 6.0, "season not stated, so graduation fit is unverified"
    if fits:
        return WEIGHTS["graduation_eligibility"], "still enrolled during the internship"
    return 0.0, "would already have graduated"


def _location_points(
    normalized_location: str, preferred: frozenset[str], open_to_remote: bool
) -> tuple[float, str]:
    maximum = WEIGHTS["location_fit"]
    if not normalized_location:
        return maximum / 2, "location not stated"
    if normalized_location == "remote":
        return (maximum, "remote") if open_to_remote else (1.0, "remote, which is not preferred")
    if not preferred:
        return maximum, "no location preference set"
    if any(p in normalized_location for p in preferred):
        return maximum, f"in a preferred location ({normalized_location})"
    return maximum / 2, f"outside preferred locations ({normalized_location})"


def _sponsorship_points(
    analysis: SponsorshipAnalysis | None, data: ScoreInput
) -> tuple[float, str]:
    maximum = WEIGHTS["sponsorship_compatibility"]
    if analysis is None:
        return maximum / 2, "sponsorship not yet analysed"

    action = recommend(
        analysis,
        candidate_needs_sponsorship=data.needs_sponsorship,
        candidate_is_us_citizen=data.is_us_citizen,
        candidate_is_permanent_resident=data.is_permanent_resident,
    )
    match action:
        case RecommendedAction.SKIP:
            return 0.0, "work-authorization requirement the candidate does not meet"
        case RecommendedAction.MANUAL_REVIEW:
            return 3.0, "sponsorship position needs a human decision"
        case _:
            if analysis.classification is Classification.SPONSORSHIP_AVAILABLE:
                return maximum, "employer states sponsorship is available"
            if analysis.work_authorization_restriction is WorkAuthRestriction.UNKNOWN:
                return maximum * 0.8, "no stated restriction"
            return maximum, "no barrier for this candidate"


def _freshness_points(posted_at: datetime | None, now: datetime) -> tuple[float, str]:
    maximum = WEIGHTS["application_freshness"]
    if posted_at is None:
        return maximum / 2, "posting date unknown"
    age = now - posted_at
    if age <= timedelta(days=3):
        return maximum, f"posted {age.days} days ago"
    if age <= timedelta(days=7):
        return maximum * 0.8, f"posted {age.days} days ago"
    if age <= timedelta(days=14):
        return maximum * 0.5, f"posted {age.days} days ago"
    return maximum * 0.2, f"posted {age.days} days ago"


# ------------------------------------------------------------ ai judgment

_SYSTEM = """\
You assess how well a software engineering internship matches a candidate.

Score only these three components, using the candidate profile supplied:
- core_swe_relevance (0-20): how central software engineering is to the role.
- skills_overlap (0-15): overlap between the required skills and the candidate's.
- experience_relevance (0-15): how relevant their projects and experience are.

Rules:
- Cite the candidate fact ids that justify your scores in fact_references.
- A score you cannot tie to a fact id must be low.
- Judge fit only. Eligibility, location, sponsorship and seniority are decided
  elsewhere and are not yours to weigh.
"""


def score(
    data: ScoreInput,
    *,
    sponsorship: SponsorshipAnalysis | None = None,
    rules: EligibilityRules | None = None,
    now: datetime,
) -> JobScore:
    """Score a job out of 100.

    A job the deterministic filter rejects scores zero: no component may rescue a
    hard ineligibility.

    Args:
        data: the job and the candidate facts it is judged against.
        sponsorship: prior analysis of the employer's stated policy.
        rules: eligibility policy.
        now: reference time for the freshness component.
    """
    eligibility: EligibilityResult = evaluate(
        normalized_title=data.normalized_title,
        normalized_location=data.normalized_location,
        location_text=data.location_text,
        description_text=data.description_text,
        season=data.season,
        posted_at=data.posted_at,
        is_closed=data.is_closed,
        rules=rules,
        now=now,
    )

    if eligibility.verdict is Verdict.REJECT:
        return JobScore(
            total=0.0,
            components=dict.fromkeys(WEIGHTS, 0.0),
            hard_filter_result=Verdict.REJECT,
            eligibility_reasons=list(eligibility.reasons),
            reasons=["ineligible; not scored"],
        )

    reasons: list[str] = []
    components: dict[str, float] = {}

    for name, (points, why) in {
        "internship_level_fit": _level_points(data.normalized_title),
        "graduation_eligibility": _graduation_points(data.graduation_date, data.season),
        "location_fit": _location_points(
            data.normalized_location, data.preferred_locations, data.open_to_remote
        ),
        "sponsorship_compatibility": _sponsorship_points(sponsorship, data),
        "application_freshness": _freshness_points(data.posted_at, now),
    }.items():
        components[name] = points
        reasons.append(f"{name}: {why}")

    for name, maximum in WEIGHTS.items():
        components[name] = max(0.0, min(components.get(name, 0.0), maximum))

    return JobScore(
        total=round(100.0 * sum(components.values()) / _TOTAL_WEIGHT, 2),
        components=components,
        hard_filter_result=eligibility.verdict,
        eligibility_reasons=list(eligibility.warnings),
        reasons=reasons,
    )
