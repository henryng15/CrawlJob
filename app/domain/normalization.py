"""Normalization primitives for deduplication (spec §7.4).

Deduplication runs before any LLM call, resume generation, or browser work, so
everything here is deterministic and cheap. No network, no model, no I/O.

The functions are deliberately conservative. Over-normalizing merges two genuinely
different roles into one and silently drops an application the user wanted; under-
normalizing costs a duplicate that the fingerprint layer will usually catch anyway.
When in doubt, keep the distinction.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from enum import StrEnum
from typing import Final
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

__all__ = [
    "AtsType",
    "canonicalize_url",
    "dedupe_fingerprint",
    "detect_ats",
    "extract_requisition_id",
    "extract_season",
    "normalize_company",
    "normalize_location",
    "normalize_title",
    "url_hash",
]


class AtsType(StrEnum):
    GREENHOUSE = "GREENHOUSE"
    LEVER = "LEVER"
    ASHBY = "ASHBY"
    WORKDAY = "WORKDAY"
    UNKNOWN = "UNKNOWN"


# ------------------------------------------------------------------ company

#: Stripped from the end of a company name. Order matters: longest first, so
#: "Co Ltd" is removed whole rather than leaving a dangling "co".
_LEGAL_SUFFIXES: Final[tuple[str, ...]] = (
    "co ltd",
    "pty ltd",
    "incorporated",
    "corporation",
    "limited",
    "holdings",
    "company",
    "gmbh",
    "s a r l",
    "s a",
    "b v",
    "n v",
    "a b",
    "oy",
    "plc",
    "pbc",
    "llc",
    "llp",
    "lp",
    "ltd",
    "inc",
    "corp",
    "co",
)

_PUNCT = re.compile(r"[^\w\s]")
_WS = re.compile(r"\s+")


def _fold(text: str) -> str:
    """Lowercase, strip accents, drop punctuation, collapse whitespace."""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = _PUNCT.sub(" ", text.lower())
    return _WS.sub(" ", text).strip()


def normalize_company(name: str) -> str:
    """Fold a company name to a comparison key.

    ``"Stripe, Inc."`` and ``"stripe"`` both become ``"stripe"``. Suffixes are
    stripped repeatedly so ``"Foo Holdings Ltd"`` reduces to ``"foo"``.

    A name that is *only* a legal suffix is returned folded but unstripped, so
    that a company literally called "Co" does not normalize to the empty string.
    """
    folded = _fold(name)
    if not folded:
        return ""

    changed = True
    while changed:
        changed = False
        for suffix in _LEGAL_SUFFIXES:
            if folded == suffix:
                return folded
            if folded.endswith(" " + suffix):
                folded = folded[: -(len(suffix) + 1)].strip()
                changed = True
                break
    return folded


# -------------------------------------------------------------------- title

#: Multi-word forms, replaced before the string is split into words. Folding turns
#: "Co-op" into "co op", so a per-word alias table can never match it.
_TITLE_PHRASE_ALIASES: Final[tuple[tuple[str, str], ...]] = (
    ("co op", "intern"),
    ("software development engineer", "software engineer"),
)

_TITLE_ALIASES: Final[dict[str, str]] = {
    "swe": "software engineer",
    "sde": "software engineer",
    "sw": "software",
    "eng": "engineer",
    "engr": "engineer",
    "internship": "intern",
    "coop": "intern",
    "jr": "junior",
    "sr": "senior",
    "fullstack": "full stack",
    "backend": "back end",
    "frontend": "front end",
    "devops": "dev ops",
}

_YEAR = re.compile(r"\b20\d{2}\b")
_SEASON_WORDS: Final[tuple[str, ...]] = ("summer", "fall", "autumn", "winter", "spring")


def normalize_title(title: str) -> str:
    """Fold a job title to a comparison key.

    Removes the season and year — ``"Software Engineer Intern, Summer 2027"`` and
    ``"Software Engineer Intern"`` describe the same role, and the season is
    tracked separately by :func:`extract_season` so it can still take part in the
    fingerprint. Abbreviations are expanded so ``"SWE Intern"`` matches
    ``"Software Engineer Intern"``.
    """
    folded = _YEAR.sub(" ", _fold(title))
    padded = f" {_WS.sub(' ', folded).strip()} "
    for phrase, replacement in _TITLE_PHRASE_ALIASES:
        padded = padded.replace(f" {phrase} ", f" {replacement} ")
    words = [_TITLE_ALIASES.get(w, w) for w in padded.split() if w not in _SEASON_WORDS]
    return " ".join(words)


def extract_season(text: str) -> str | None:
    """Return a season label such as ``"SUMMER_2027"``, or ``None``.

    Reads the first season word and the first four-digit year, which handles both
    ``"Summer 2027 Internship"`` and ``"Internship - 2027 Summer"``.
    """
    folded = _fold(text)
    season = next((w for w in _SEASON_WORDS if w in folded.split()), None)
    year = _YEAR.search(folded)
    if season is None or year is None:
        return None
    season = "fall" if season == "autumn" else season
    return f"{season.upper()}_{year.group()}"


# ----------------------------------------------------------------- location

_US_STATES: Final[dict[str, str]] = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
    "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
    "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID",
    "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
    "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
    "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
    "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
    "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK",
    "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT",
    "vermont": "VT", "virginia": "VA", "washington": "WA", "west virginia": "WV",
    "wisconsin": "WI", "wyoming": "WY", "district of columbia": "DC",
}  # fmt: skip

_REMOTE = re.compile(r"\b(remote|anywhere|distributed|work from home|wfh)\b")


def normalize_location(location: str) -> str:
    """Fold a location string to a comparison key.

    ``"San Francisco, California"`` and ``"san francisco, ca"`` both become
    ``"san francisco ca"``. Anything mentioning remote work normalizes to
    ``"remote"`` regardless of the city attached to it, because "Remote (SF)" and
    "Remote - San Francisco" are the same posting in practice.
    """
    if not _fold(location):
        return ""
    if _REMOTE.search(_fold(location)):
        return "remote"

    # Split on commas before folding. Locations are conventionally "City, State,
    # Country", and only a segment that is *entirely* a state name is a state —
    # otherwise "New York, New York" folds the city into "ny ny".
    segments = [seg for seg in (_fold(s) for s in location.split(",")) if seg]
    if not segments:
        return ""
    head, *rest = segments
    return " ".join([head, *(_US_STATES.get(seg, seg).lower() for seg in rest)])


# ---------------------------------------------------------------------- url

#: Query parameters that identify the referrer, not the job. Prefix match on
#: ``utm_`` covers the whole family.
_TRACKING_PARAMS: Final[frozenset[str]] = frozenset(
    {
        "gh_src",
        "lever-source",
        "lever-origin",
        "source",
        "src",
        "ref",
        "referrer",
        "fbclid",
        "gclid",
        "msclkid",
        "mc_cid",
        "mc_eid",
        "trk",
        "trackingid",
        "campaign",
    }
)

#: Query parameters that identify the job itself and must survive canonicalization.
_MEANINGFUL_PARAMS: Final[frozenset[str]] = frozenset({"gh_jid", "ashby_jid", "for", "token"})


def canonicalize_url(url: str) -> str:
    """Return a comparison-stable form of an application URL.

    Lowercases the scheme and host, drops ``www.``, forces https, removes the
    fragment, strips tracking parameters, and sorts what remains. Path case is
    preserved because some ATS job slugs are case-sensitive.
    """
    parts = urlsplit(url.strip())
    if not parts.netloc:
        raise ValueError(f"Not an absolute URL: {url!r}")

    host = parts.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    host = host.removesuffix(":443").removesuffix(":80")

    path = parts.path.rstrip("/") or "/"

    kept = [
        (k, v)
        for k, v in parse_qsl(parts.query, keep_blank_values=False)
        if k.lower() in _MEANINGFUL_PARAMS
        or (not k.lower().startswith("utm_") and k.lower() not in _TRACKING_PARAMS)
    ]
    query = urlencode(sorted(kept))

    return urlunsplit(("https", host, path, query, ""))


def url_hash(url: str) -> str:
    """Stable hash of a canonical URL, for a unique index."""
    return hashlib.sha256(canonicalize_url(url).encode()).hexdigest()


# ----------------------------------------------------------------- ats type

_ATS_HOSTS: Final[tuple[tuple[re.Pattern[str], AtsType], ...]] = (
    (re.compile(r"(^|\.)(job-boards|boards)\.greenhouse\.io$"), AtsType.GREENHOUSE),
    (re.compile(r"(^|\.)greenhouse\.io$"), AtsType.GREENHOUSE),
    (re.compile(r"(^|\.)lever\.co$"), AtsType.LEVER),
    (re.compile(r"(^|\.)ashbyhq\.com$"), AtsType.ASHBY),
    (re.compile(r"\.myworkdayjobs\.com$"), AtsType.WORKDAY),
    (re.compile(r"\.myworkdaysite\.com$"), AtsType.WORKDAY),
)


def detect_ats(url: str) -> AtsType:
    """Identify the ATS from a URL.

    Falls back to query-parameter detection so that a company's own careers page
    embedding a Greenhouse or Ashby form is still recognised.
    """
    parts = urlsplit(url.strip())
    host = parts.netloc.lower().split(":")[0]
    if host.startswith("www."):
        host = host[4:]

    for pattern, ats in _ATS_HOSTS:
        if pattern.search(host):
            return ats

    params = {k.lower() for k, _ in parse_qsl(parts.query)}
    if "gh_jid" in params:
        return AtsType.GREENHOUSE
    if "ashby_jid" in params:
        return AtsType.ASHBY
    return AtsType.UNKNOWN


_REQ_PATTERNS: Final[dict[AtsType, tuple[re.Pattern[str], ...]]] = {
    AtsType.GREENHOUSE: (
        re.compile(r"/jobs/(\d+)"),
        re.compile(r"[?&]gh_jid=(\d+)"),
        re.compile(r"[?&]token=(\d+)"),
    ),
    AtsType.LEVER: (
        re.compile(r"/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"),
    ),
    AtsType.ASHBY: (
        re.compile(r"/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"),
        re.compile(r"[?&]ashby_jid=([0-9a-f-]{36})"),
    ),
    AtsType.WORKDAY: (re.compile(r"_(R-?\d+)\b", re.IGNORECASE),),
}


def extract_requisition_id(url: str, ats: AtsType | None = None) -> str | None:
    """Pull the employer's requisition identifier out of an application URL.

    This is the strongest deduplication signal available (§7.4 priority 1): the
    same requisition reached through three different aggregators yields the same
    id. Returns ``None`` when the URL carries no recognisable id, which is normal
    for career-site landing pages.
    """
    ats = ats or detect_ats(url)
    lowered = url.lower()
    for pattern in _REQ_PATTERNS.get(ats, ()):
        if match := pattern.search(lowered):
            return match.group(1)
    return None


# ------------------------------------------------------------- fingerprint


def dedupe_fingerprint(
    *,
    company: str,
    title: str,
    location: str,
    season: str | None = None,
) -> str:
    """Fingerprint for priority-4 matching: company + title + location + season.

    This is the weakest of the deduplication signals and is only consulted after
    requisition id and canonical URL have both failed to match. A collision here
    produces ``DUPLICATE_PROBABLE``, which requires human review rather than a
    silent drop (§7.4).
    """
    payload = "\x1f".join(
        (
            normalize_company(company),
            normalize_title(title),
            normalize_location(location),
            season or "",
        )
    )
    return hashlib.sha256(payload.encode()).hexdigest()
