"""Stage 1: fetch the live feeds and check what came back (spec §5.6, §7.2).

Read-only in the strongest sense — an HTTP GET against a public posting endpoint
and nothing else. No database, no queue, no quota, no model. It can be run at any
time on a paused instance without consequence, which is the point: the questions
it answers are the ones you want answered *before* anything writes.

What it checks, and why each one is here rather than left to the type system:

**The URL canonicalises.** Everything downstream keys on the canonical form, so a
posting whose URL does not parse is not a degraded posting, it is one that cannot
be deduplicated or applied to.

**The timestamp is present and sane.** §7.3 screens on freshness using
``posted_at`` when there is one. A feed that omits it silently falls back to
"when we first saw it", which quietly turns a two-year-old posting into a fresh
one. A timestamp in the future is a parsing error — usually seconds read as
milliseconds.

**The title, location and description are present.** These are the three inputs
to the pre-spend screen and to sponsorship analysis. An empty description means
sponsorship cannot be assessed at all.

**Deduplication is stable.** Fetching twice and comparing fingerprints is the
only way to catch a feed whose ordering or ids move around; a fingerprint that
changes between fetches would make the same job arrive as a new one every day.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from app.config import Settings
from app.services.discovery.base import DiscoveryAdapter, RawPosting
from app.services.validation.report import AdapterReport, Severity, StageOneReport

__all__ = ["DEFAULT_BOARDS", "validate_feeds", "validate_one"]

log = logging.getLogger(__name__)

#: Boards used when none are given. Each was checked to exist, to return
#: postings, and — for at least one per ATS — to carry an intern role, so a run
#: says something about the adapter rather than about one employer having nothing
#: open this month. Slugs are not guessable from a company name: ``lever/ramp``
#: and ``greenhouse/doordash`` are both 404s.
DEFAULT_BOARDS: dict[str, tuple[str, ...]] = {
    "greenhouse": ("cloudflare", "stripe", "figma"),
    "lever": ("palantir", "matchgroup"),
    "ashby": ("ramp", "openai", "linear"),
}

#: A posting older than this is not wrong, but a feed where *everything* is this
#: old is usually a stale mirror rather than a live board.
_STALE = timedelta(days=365)

#: Descriptions shorter than this cannot carry sponsorship language, so the
#: analysis step would be reading nothing.
_MIN_DESCRIPTION = 200


def validate_feeds(
    settings: Settings,
    boards: dict[str, tuple[str, ...]] | None = None,
    *,
    adapter_factory: Any = None,
    now: datetime | None = None,
) -> StageOneReport:
    """Fetch every configured board and report on each.

    Args:
        boards: ``{"greenhouse": ("stripe", ...), ...}``. Defaults to
            :data:`DEFAULT_BOARDS`.
        adapter_factory: injectable for tests, so the checks can be exercised
            against fixed payloads with no network.
    """
    from app.worker.sources import adapters_for

    moment = now or datetime.now(UTC)
    report = StageOneReport(started_at=moment)

    for ats, names in (boards or DEFAULT_BOARDS).items():
        for board in names:
            if adapter_factory is not None:
                adapters = adapter_factory(ats, board)
            else:
                adapters = adapters_for({"kind": ats, "name": board}, settings=settings)
            if not adapters:
                entry = AdapterReport(ats=ats, board=board)
                entry.add(Severity.BLOCKER, "adapter", f"no adapter for kind {ats!r}")
                report.adapters.append(entry)
                continue
            for adapter in adapters:
                report.adapters.append(validate_one(adapter, settings, now=moment))
    return report


def validate_one(
    adapter: DiscoveryAdapter, settings: Settings, *, now: datetime | None = None
) -> AdapterReport:
    """Fetch one board twice and check every posting that came back."""
    moment = now or datetime.now(UTC)
    entry = AdapterReport(
        ats=type(adapter).__name__.replace("Adapter", "").lower(),
        board=str(getattr(adapter, "board", "") or getattr(adapter, "company_slug", "?")),
        source_name=adapter.source_name,
        url=getattr(adapter, "url", ""),
    )

    try:
        first = list(adapter.fetch())
    except Exception as exc:
        entry.fetch_error = f"{type(exc).__name__}: {exc}"
        entry.add(Severity.BLOCKER, "fetch", entry.fetch_error)
        return entry

    entry.fetched = len(first)
    if not first:
        entry.add(
            Severity.WARNING,
            "fetch",
            "the feed returned no postings; nothing could be checked",
        )
        return entry

    for posting in first:
        _check_posting(entry, posting, now=moment)

    _check_dedupe(entry, adapter, first)
    _check_screen(entry, settings, first, now=moment)
    _summarise(entry, first, now=moment)
    return entry


def _check_posting(entry: AdapterReport, item: RawPosting, *, now: datetime) -> None:
    posting = item.posting
    subject = (posting.title or "(untitled)")[:60]

    if not posting.title.strip():
        entry.add(Severity.BLOCKER, "title", "empty title", subject)

    try:
        canonical = posting.canonical_url
        if not canonical:
            raise ValueError("empty")
    except Exception as exc:
        entry.add(
            Severity.BLOCKER,
            "canonical_url",
            f"{posting.application_url!r} does not canonicalise: {exc}",
            subject,
        )
        return

    if not canonical.startswith("https://"):
        entry.add(Severity.WARNING, "canonical_url", f"not https: {canonical}", subject)

    if item.external_id is None:
        entry.add(
            Severity.WARNING,
            "external_id",
            "no stable id in the feed; dedupe falls back to the URL",
            subject,
        )

    posted = posting.posted_at
    if posted is None:
        entry.add(
            Severity.WARNING,
            "posted_at",
            "no timestamp; freshness will use when we first saw it",
            subject,
        )
    else:
        if posted.tzinfo is None:
            entry.add(Severity.BLOCKER, "posted_at", "naive datetime", subject)
        elif posted > now + timedelta(hours=1):
            entry.add(
                Severity.BLOCKER,
                "posted_at",
                f"timestamp is in the future ({posted.isoformat()}); "
                "usually seconds parsed as milliseconds",
                subject,
            )

    if not (posting.location or "").strip():
        entry.add(Severity.WARNING, "location", "no location", subject)

    description = posting.description_text or ""
    if not description.strip():
        entry.add(
            Severity.WARNING,
            "description",
            "empty; sponsorship analysis would have nothing to read",
            subject,
        )
    elif len(description) < _MIN_DESCRIPTION:
        entry.add(
            Severity.NOTE,
            "description",
            f"only {len(description)} characters",
            subject,
        )
    elif "<" in description and ">" in description and "</" in description:
        entry.add(
            Severity.WARNING,
            "description",
            "still contains HTML tags after stripping",
            subject,
        )


def _fingerprints(postings: list[RawPosting]) -> list[str]:
    """Fingerprints, skipping postings malformed enough to raise.

    Those are already recorded as blockers; letting one of them abort the pass
    would hide every finding after it.
    """
    out = []
    for item in postings:
        try:
            out.append(item.posting.fingerprint)
        except Exception as exc:
            log.debug("skipping a malformed posting for fingerprinting: %s", exc)
            continue
    return out


def _check_dedupe(entry: AdapterReport, adapter: DiscoveryAdapter, first: list[RawPosting]) -> None:
    """Fingerprints must be stable across fetches and unique within one."""
    fingerprints = _fingerprints(first)
    duplicates = len(fingerprints) - len(set(fingerprints))
    entry.stats["duplicate_fingerprints_within_feed"] = duplicates
    if duplicates:
        # Not a fault: one role posted in several offices legitimately collapses.
        entry.add(
            Severity.NOTE,
            "dedupe",
            f"{duplicates} posting(s) share a fingerprint with another in the same "
            "feed; they would collapse to one job",
        )

    # Skipping what will not canonicalise, rather than letting it raise: one
    # malformed posting has already been reported as a blocker, and it must not
    # also stop the rest of the feed from being checked. A validator that gives up
    # on the first bad row tells you about one problem and hides the others.
    urls = []
    for item in first:
        try:
            urls.append(item.posting.canonical_url)
        except Exception as exc:
            log.debug("skipping a malformed URL: %s", exc)
            continue
    entry.stats["duplicate_urls_within_feed"] = len(urls) - len(set(urls))

    try:
        second = list(adapter.fetch())
    except Exception as exc:
        entry.add(Severity.WARNING, "dedupe", f"second fetch failed: {exc}")
        return

    before = set(_fingerprints(first))
    after = set(_fingerprints(second))
    drifted = before.symmetric_difference(after)
    entry.stats["fingerprint_drift_between_fetches"] = len(drifted)
    if drifted:
        entry.add(
            Severity.BLOCKER,
            "dedupe",
            f"{len(drifted)} fingerprint(s) changed between two fetches seconds "
            "apart; the same job would be rediscovered as new every run",
        )


def _check_screen(
    entry: AdapterReport,
    settings: Settings,
    postings: list[RawPosting],
    *,
    now: datetime,
) -> None:
    """Run the pre-spend screen, and separately pick what stage 2 could open.

    Two different questions, so two different answers.

    ``passed_screen`` is the production number: title, US location **and** the
    24-hour freshness window. It says how much of this board the pipeline would
    act on today.

    ``eligible`` is what stage 2 may open, and deliberately ignores freshness. A
    posting from last week has the same application form as one from this
    morning, and stage 2 asks about the form. Requiring a same-day posting would
    usually leave the browser check with nothing to run against, for a reason
    that has nothing to do with what it is checking.
    """
    from app.domain.normalization import normalize_title
    from app.services.filters import ScreenRules, screen

    #: Freshness effectively disabled — a decade — so title and location decide.
    #: Every other rule is the production one.
    form_rules = ScreenRules(max_role_age_hours=24 * 365 * 10)

    passed = 0
    eligible: list[dict[str, str]] = []
    for item in postings:
        posting = item.posting
        try:
            normalized = normalize_title(posting.title)
            production = screen(
                normalized_title=normalized,
                location_text=posting.location,
                posted_at=posting.posted_at,
                discovered_at=item.fetched_at,
                now=now,
            )
            for_form = screen(
                normalized_title=normalized,
                location_text=posting.location,
                posted_at=posting.posted_at,
                discovered_at=item.fetched_at,
                now=now,
                rules=form_rules,
            )
        except Exception as exc:
            entry.add(
                Severity.WARNING,
                "screen",
                f"{type(exc).__name__}: {exc}",
                posting.title[:60],
            )
            continue

        passed += bool(production.passed)
        if for_form.passed:
            eligible.append(
                {
                    "title": posting.title,
                    "company": posting.company,
                    "location": posting.location or "",
                    "url": posting.application_url,
                    "posted_at": posting.posted_at.isoformat() if posting.posted_at else "",
                }
            )

    entry.stats["passed_screen"] = passed
    entry.stats["suitable_for_stage_two"] = len(eligible)
    entry.eligible = eligible


def _summarise(entry: AdapterReport, postings: list[RawPosting], *, now: datetime) -> None:
    # Aware only. A naive timestamp is already a blocker, and comparing one here
    # would raise and take the rest of the summary with it.
    stamped = [
        p.posting.posted_at
        for p in postings
        if p.posting.posted_at and p.posting.posted_at.tzinfo is not None
    ]
    entry.stats["with_posted_at"] = len(stamped)
    entry.stats["with_description"] = sum(
        1 for p in postings if (p.posting.description_text or "").strip()
    )
    entry.stats["with_location"] = sum(1 for p in postings if (p.posting.location or "").strip())
    if stamped:
        newest = max(stamped)
        entry.stats["newest_posting"] = newest.isoformat()
        entry.stats["oldest_posting"] = min(stamped).isoformat()
        if now - newest > _STALE:
            entry.add(
                Severity.WARNING,
                "freshness",
                f"the newest posting is {(now - newest).days} days old; "
                "this looks like a stale mirror rather than a live board",
            )
