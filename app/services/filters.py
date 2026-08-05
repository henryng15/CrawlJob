"""Pre-spend screening (spec §7.3).

The deterministic gate that stands between discovery and every euro the system
can spend. It runs *before* sponsorship analysis, before scoring, and before a
job can consume one of the day's prepared-application slots, because all three
of those cost either money or a slot the user only gets thirty of.

Four checks, in this order:

1. **Dedupe** — already done upstream by :mod:`app.services.dedupe`, which folds
   exact duplicates into the existing row and flags probable ones for a human.
   Nothing here repeats that work; the screen simply never sees a duplicate,
   because duplicates do not carry the ``DISCOVERED`` status the caller selects
   on.
2. **Freshness** — the posting must be newer than the configured window.
3. **Title** — it must be one of the role variants being applied for.
4. **Location** — it must be in the United States, or explicitly remote *within*
   the United States.

Cheapest first, so a stale posting costs one subtraction rather than three
regex passes. Every rejection carries a reason in the user's own words, because
a role that silently never appears is indistinguishable from a bug.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum

__all__ = [
    "DEFAULT_REJECT_TERMS",
    "ScreenResult",
    "ScreenRules",
    "ScreenVerdict",
    "age_reference",
    "classify_us",
    "is_fresh",
    "location_is_us",
    "screen",
    "title_matches",
]


class ScreenVerdict(StrEnum):
    PASS = "PASS"  # noqa: S105 — a verdict, not a credential
    REJECT = "REJECT"


#: The word that makes a posting an internship at all. Written as
#: :func:`app.domain.normalization.normalize_title` leaves it — lowercased, with
#: the season and year already stripped.
_INTERN_WORDS = frozenset({"intern", "interns", "internship", "internships"})

#: What makes an internship a *software* one. A title needs one of these, and
#: boards are inventive enough that listing whole titles does not work: an
#: allowlist of "software engineer intern" and fourteen siblings turned away
#: "Software Developer Intern", "Full Stack Intern", "Front End Engineer Intern"
#: and "Firmware Engineer Intern" — every one of them a job worth applying for.
#:
#: Single words only where the word is software on its own. "back", "front" and
#: "stack" are not: they let in "Front Desk Intern" and "Back Office Intern", so
#: they live in :data:`_SOFTWARE_PHRASES` instead. Nor is "development" —
#: "Business Development Intern" is a sales job — which is why "developer" is
#: here and "development" is not.
_SOFTWARE_WORDS = frozenset(
    {
        "software", "developer", "engineer", "engineering",
        "programmer", "programming", "swe", "sde", "coding",
        "web", "mobile", "android", "ios",
        "firmware", "embedded", "kernel", "compiler",
        "infrastructure", "platform", "cloud", "sre",
        "distributed", "database", "api", "robotics",
    }
)

#: Software signals that only mean software as a whole phrase. Written in the
#: form :func:`app.domain.normalization.normalize_title` leaves them, which is
#: why "backend" appears here as "back end".
_SOFTWARE_PHRASES: tuple[str, ...] = (
    "dev ops",  # normalization splits "DevOps" into two words
    "back end",
    "front end",
    "full stack",
    "software development",
    "application development",
    "product development",
    "game development",
    "site reliability",
    "machine learning",
    "computer science",
    "data engineer",
    "data engineering",
    "systems engineer",
    "systems engineering",
    "embedded systems",
)

#: Terms that disqualify a title no matter what else it matched. Checked first
#: and allowed to overrule everything, so "Senior Software Engineer Intern" is
#: rejected rather than accepted for the three words it happens to contain.
#:
#: The second group is the cost of matching on "engineer" rather than on whole
#: titles: it is the word every engineering discipline uses, so the disciplines
#: that are not this one have to be named. The third is roles that sit next to
#: engineering without being it.
DEFAULT_REJECT_TERMS: tuple[str, ...] = (
    "senior",
    "staff",
    "principal",
    "lead",
    "manager",
    "new grad",
    "new graduate",
    "full time",
    "contract",
    "phd",
    "doctoral",
    # other engineering disciplines
    "electrical",
    "mechanical",
    "chemical",
    "civil",
    "biomedical",
    "aerospace",
    "materials",
    # adjacent, but not engineering
    "product management",
    "program management",
    "project management",
    "marketing",
    "sales",
    "recruiting",
    "accounting",
    "paralegal",
)


@dataclass(frozen=True, slots=True)
class ScreenRules:
    """Screening policy. Defaults match the shipped configuration."""

    max_role_age_hours: int = 24 * 7
    #: Optional narrowing. Empty means any software internship.
    role_titles: tuple[str, ...] = ()
    reject_terms: tuple[str, ...] = DEFAULT_REJECT_TERMS
    require_us: bool = True


@dataclass(frozen=True, slots=True)
class ScreenResult:
    verdict: ScreenVerdict
    reason: str | None = None

    @property
    def passed(self) -> bool:
        return self.verdict is ScreenVerdict.PASS


# ---------------------------------------------------------------- freshness


def age_reference(posted_at: datetime | None, discovered_at: datetime) -> datetime:
    """The timestamp freshness is measured from.

    ``posted_at`` when the board gave one, ``discovered_at`` only when it did
    not. Deliberately **not** ``max()`` of the two: taking the later would let a
    posting published three months ago count as fresh on the day this system
    first happened to look at it, which is exactly the posting the 24-hour rule
    exists to exclude.
    """
    return posted_at if posted_at is not None else discovered_at


def is_fresh(
    *,
    posted_at: datetime | None,
    discovered_at: datetime,
    now: datetime,
    max_age_hours: int,
) -> bool:
    return now - age_reference(posted_at, discovered_at) <= timedelta(hours=max_age_hours)


# -------------------------------------------------------------------- title


def _words(normalized_title: str) -> frozenset[str]:
    return frozenset(normalized_title.split())


def _contains_term(normalized_title: str, term: str) -> bool:
    """Whether ``term`` appears as a whole word or whole phrase.

    Padding both sides means "lead" cannot match inside "leadership" and
    "contract" cannot match inside "contractor", without paying for a regex.
    """
    return f" {term} " in f" {normalized_title} "


def title_matches(normalized_title: str, rules: ScreenRules | None = None) -> bool:
    """Whether the title is a software internship worth looking at.

    Two questions, not a list: does it say "intern", and does it say it is about
    software. Boards write the same role as "Software Engineer Intern", "Intern,
    Software Engineer", "Software Developer Intern" and "Full Stack Intern", and
    an allowlist has to guess every phrasing in advance — the ones it fails to
    guess are simply never seen.

    ``rules.role_titles`` narrows this when set: each entry matches when all of
    its words are present in any order. Empty, the default, means any software
    internship. Either way a reject term overrules the match, and this is only
    the *first* title gate — :func:`app.services.eligibility.evaluate` still
    applies its off-target rules before anything is scored.
    """
    rules = rules or ScreenRules()
    if any(_contains_term(normalized_title, term) for term in rules.reject_terms):
        return False

    present = _words(normalized_title)
    if not present & _INTERN_WORDS:
        return False
    if rules.role_titles:
        return any(_words(variant) <= present for variant in rules.role_titles)
    return bool(present & _SOFTWARE_WORDS) or any(
        _contains_term(normalized_title, phrase) for phrase in _SOFTWARE_PHRASES
    )


# ----------------------------------------------------------------- location

#: Read against the *raw* location text, never the normalized form.
#: ``normalize_location`` folds every remote posting to the bare string
#: "remote" — "Remote (EU)" and "Remote, US" both arrive as "remote" — so by the
#: time a location is normalized the one fact this check needs is already gone.
_US_MARKER = re.compile(
    r"\b(u\.?s\.?a?|u\.?s\.?a|united states|america|americas|stateside)\b",
    re.IGNORECASE,
)

_US_STATE_NAME = re.compile(
    r"\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|"
    r"florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|"
    r"maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|"
    r"nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|"
    r"north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|"
    r"south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|"
    r"wisconsin|wyoming|district of columbia)\b",
    re.IGNORECASE,
)

#: Two-letter state codes, matched **case-sensitively**. Postings write
#: "San Francisco, CA"; lowercase "or", "in", "me" and "hi" are ordinary English
#: words, and matching those would read "Remote or Hybrid" as Oregon.
_US_STATE_CODE = re.compile(
    r"\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|"
    r"MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|"
    r"WV|WI|WY|DC)\b"
)

#: Checked before any US marker, so "Remote - US or Canada" is rejected rather
#: than accepted for the "US" in it. A role open to both is not a US role.
_NON_US = re.compile(
    r"\b(canada|canadian|toronto|vancouver|montreal|ontario|quebec|"
    r"emea|apac|latam|europe|european|eu|uk|u\.k\.|united kingdom|england|"
    r"london|ireland|dublin|germany|berlin|munich|france|paris|netherlands|"
    r"amsterdam|spain|madrid|barcelona|portugal|lisbon|poland|warsaw|krakow|"
    r"sweden|stockholm|norway|denmark|copenhagen|finland|helsinki|"
    r"switzerland|zurich|geneva|austria|vienna|italy|rome|milan|"
    r"czech|prague|romania|bucharest|hungary|budapest|greece|athens|"
    r"india|bangalore|bengaluru|hyderabad|pune|delhi|mumbai|chennai|noida|"
    r"gurgaon|gurugram|singapore|malaysia|indonesia|jakarta|philippines|manila|"
    r"vietnam|hanoi|thailand|bangkok|"
    r"australia|sydney|melbourne|new zealand|auckland|"
    r"japan|tokyo|osaka|korea|seoul|china|beijing|shanghai|shenzhen|"
    r"taiwan|taipei|hong kong|"
    r"israel|tel aviv|turkey|istanbul|"
    r"brazil|sao paulo|mexico|mexico city|argentina|chile|colombia|bogota|"
    r"south africa|nigeria|lagos|egypt|cairo|kenya|nairobi|"
    r"latin america|asia|africa|worldwide|global)\b",
    re.IGNORECASE,
)


def classify_us(location_text: str | None) -> bool | None:
    """``True`` US, ``False`` definitely not, ``None`` when it does not say.

    Reads the **raw** location string, not the normalized one, for the reason
    documented on :data:`_US_MARKER`. A bare "Remote" lands in ``None``: it is
    genuinely unknown, and callers differ on what to do about that.
    """
    if not location_text or not location_text.strip():
        return None
    if _NON_US.search(location_text):
        return False
    if (
        _US_MARKER.search(location_text)
        or _US_STATE_NAME.search(location_text)
        or _US_STATE_CODE.search(location_text)
    ):
        return True
    return None


def location_is_us(location_text: str | None) -> bool:
    """Whether the posting is explicitly in the US, or explicitly Remote-US.

    Treats "does not say" as a no. That is deliberate and it is a real
    trade-off: a US-only role advertised as just "Remote" is turned away. The
    alternative is worse — the system would prepare applications for roles the
    user cannot take, spending both money and daily slots on them, and the
    instruction was "US-based or explicitly Remote-US only". A rejection here is
    recorded with its reason and is reversible; a spent slot is not.
    """
    return classify_us(location_text) is True


# ------------------------------------------------------------------- screen


def screen(
    *,
    normalized_title: str,
    location_text: str | None,
    posted_at: datetime | None,
    discovered_at: datetime,
    now: datetime,
    rules: ScreenRules | None = None,
) -> ScreenResult:
    """Apply the pre-spend checks. Nothing here calls a model or a network.

    Args:
        normalized_title: output of ``normalize_title``.
        location_text: the posting's location **as the board wrote it**.
        posted_at: when the employer published it, when the board says.
        discovered_at: when this system first saw it.
        now: reference time for the freshness check.
        rules: policy; defaults to :class:`ScreenRules`.
    """
    rules = rules or ScreenRules()

    if not is_fresh(
        posted_at=posted_at,
        discovered_at=discovered_at,
        now=now,
        max_age_hours=rules.max_role_age_hours,
    ):
        source = "posted" if posted_at is not None else "first seen"
        age = now - age_reference(posted_at, discovered_at)
        hours = int(age.total_seconds() // 3600)
        return ScreenResult(
            ScreenVerdict.REJECT,
            f"{source} {hours}h ago, older than {rules.max_role_age_hours}h",
        )

    if not title_matches(normalized_title, rules):
        return ScreenResult(
            ScreenVerdict.REJECT,
            f"title {normalized_title!r} is not a targeted role variant",
        )

    if rules.require_us and not location_is_us(location_text):
        shown = (location_text or "").strip() or "not stated"
        return ScreenResult(
            ScreenVerdict.REJECT,
            f"location {shown!r} is not the United States or explicitly Remote-US",
        )

    return ScreenResult(ScreenVerdict.PASS)
