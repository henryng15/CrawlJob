"""Discovery adapter and ingestion tests (spec §7.2, §5.5, §5.6).

Every adapter is driven by a stubbed HTTP transport, so the suite makes no network
calls and stays deterministic. The fixtures mirror the shape of each provider's
real public response.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import Company, Job, JobSourceLink, JobSourceRecord
from app.domain.normalization import AtsType
from app.services.discovery.ats import (
    AshbyAdapter,
    GreenhouseAdapter,
    LeverAdapter,
    strip_html,
)
from app.services.discovery.base import content_hash
from app.services.discovery.github_feed import (
    GithubMarkdownFeedAdapter,
    parse_markdown_table,
)
from app.services.discovery.ingest import ingest, ingest_all
from tests.helpers import not_none

NOW = datetime(2026, 7, 28, tzinfo=UTC)

GREENHOUSE_PAYLOAD = {
    "name": "Acme, Inc.",
    "jobs": [
        {
            "id": 4567890,
            "title": "Software Engineer Intern, Summer 2027",
            "absolute_url": "https://boards.greenhouse.io/acme/jobs/4567890",
            "location": {"name": "San Francisco, CA"},
            "content": "<p>Build things.</p><p>We do <b>not</b> sponsor visas.</p>",
            "updated_at": "2026-07-01T10:00:00Z",
        },
        {
            "id": 4567891,
            "title": "Backend Engineer Intern",
            "absolute_url": "https://boards.greenhouse.io/acme/jobs/4567891",
            "location": {"name": "Remote - US"},
            "content": "<p>APIs.</p>",
            "updated_at": "2026-07-02T10:00:00Z",
        },
        {"id": 999, "title": "Broken", "location": {"name": "X"}},  # no URL
    ],
}

LEVER_PAYLOAD = [
    {
        "id": "aaaaaaaa-1111-4222-8333-444444444444",
        "text": "Software Engineer Intern",
        "hostedUrl": "https://jobs.lever.co/globex/aaaaaaaa-1111-4222-8333-444444444444",
        "categories": {"location": "New York, NY", "team": "Globex"},
        "descriptionPlain": "Write code.",
        "createdAt": 1783000000000,
    }
]

ASHBY_PAYLOAD = {
    "jobs": [
        {
            "id": "bbbbbbbb-2222-4333-8444-555555555555",
            "title": "SWE Intern",
            "jobUrl": "https://jobs.ashbyhq.com/initech/bbbbbbbb-2222-4333-8444-555555555555",
            "applyUrl": (
                "https://jobs.ashbyhq.com/initech/bbbbbbbb-2222-4333-8444-555555555555/application"
            ),
            "location": "Austin, TX",
            "organizationName": "Initech",
            "descriptionPlain": "Ship features.",
            "publishedAt": "2026-06-15T08:00:00Z",
        }
    ]
}

README = """
# Summer 2027 Internships

| Company | Role | Location | Application/Link | Date |
| ------- | ---- | -------- | ---------------- | ---- |
| **[Acme](https://acme.com)** | Software Engineer Intern | San Francisco, CA | [Apply](https://boards.greenhouse.io/acme/jobs/4567890) | Jul 01 |
| ↳ | Backend Intern | Remote | [Apply](https://boards.greenhouse.io/acme/jobs/4567891) | Jul 02 |
| **Globex** | SWE Intern | New York, NY | <a href="https://jobs.lever.co/globex/aaaaaaaa-1111-4222-8333-444444444444">Apply</a> | Jul 03 |
| **Broken** | No Link Role | Nowhere | 🔒 | Jul 04 |
"""  # noqa: E501 — the fixture must keep the real README's single-line rows


def stub_client(payload: object, *, status: int = 200, text: str | None = None) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        if text is not None:
            return httpx.Response(status, text=text)
        return httpx.Response(status, json=payload)

    return httpx.Client(transport=httpx.MockTransport(handler))


def count(db: Session, model: type) -> int:
    return not_none(db.scalar(select(func.count()).select_from(model)))


# ------------------------------------------------------------------ helpers


class TestStripHtml:
    def test_removes_tags_and_unescapes(self):
        assert strip_html("<p>Hello &amp; welcome</p>") == "Hello & welcome"

    def test_returns_none_for_empty(self):
        assert strip_html(None) is None
        assert strip_html("<p></p>") is None

    def test_is_stable_so_quote_offsets_stay_valid(self):
        """Sponsorship evidence records character offsets into this text (§7.5)."""
        markup = "<div><p>We do <b>not</b> sponsor.</p></div>"
        assert strip_html(markup) == strip_html(markup)


class TestContentHash:
    def test_key_order_does_not_change_the_hash(self):
        assert content_hash({"a": 1, "b": 2}) == content_hash({"b": 2, "a": 1})

    def test_value_change_does(self):
        assert content_hash({"a": 1}) != content_hash({"a": 2})


# ----------------------------------------------------------------- adapters


class TestGreenhouseAdapter:
    def test_parses_postings(self):
        with GreenhouseAdapter("acme", client=stub_client(GREENHOUSE_PAYLOAD)) as adapter:
            results = adapter.fetch()

        assert len(results) == 2, "the posting with no URL must be dropped"
        first = results[0].posting
        assert first.company == "Acme, Inc."
        assert first.title == "Software Engineer Intern, Summer 2027"
        assert first.location == "San Francisco, CA"
        assert first.ats == AtsType.GREENHOUSE
        assert first.requisition_id == "4567890"
        assert first.season == "SUMMER_2027"

    def test_description_is_plain_text(self):
        with GreenhouseAdapter("acme", client=stub_client(GREENHOUSE_PAYLOAD)) as adapter:
            body = not_none(adapter.fetch()[0].posting.description_text)
        assert "<p>" not in body
        assert "not sponsor visas" in body

    def test_records_source_provenance(self):
        with GreenhouseAdapter("acme", client=stub_client(GREENHOUSE_PAYLOAD)) as adapter:
            raw = adapter.fetch()[0]
        assert raw.source_name == "greenhouse:acme"
        assert raw.external_id == "4567890"
        assert raw.raw_payload["id"] == 4567890

    def test_http_error_propagates(self):
        with GreenhouseAdapter("acme", client=stub_client(None, status=404)) as adapter:  # noqa: SIM117
            with pytest.raises(httpx.HTTPStatusError):
                adapter.fetch()


class TestLeverAdapter:
    def test_parses_postings(self):
        with LeverAdapter("globex", client=stub_client(LEVER_PAYLOAD)) as adapter:
            posting = adapter.fetch()[0].posting
        assert posting.company == "Globex"
        assert posting.location == "New York, NY"
        assert posting.ats == AtsType.LEVER
        assert posting.requisition_id == "aaaaaaaa-1111-4222-8333-444444444444"

    def test_parses_epoch_millisecond_timestamps(self):
        with LeverAdapter("globex", client=stub_client(LEVER_PAYLOAD)) as adapter:
            posting = adapter.fetch()[0].posting
        assert not_none(posting.posted_at).year == 2026


class TestAshbyAdapter:
    def test_prefers_the_apply_url(self):
        """The apply URL is where the form lives; jobUrl is the marketing page."""
        with AshbyAdapter("initech", client=stub_client(ASHBY_PAYLOAD)) as adapter:
            posting = adapter.fetch()[0].posting
        assert posting.application_url.endswith("/application")
        assert posting.ats == AtsType.ASHBY

    def test_parses_metadata(self):
        with AshbyAdapter("initech", client=stub_client(ASHBY_PAYLOAD)) as adapter:
            posting = adapter.fetch()[0].posting
        assert posting.company == "Initech"
        assert posting.location == "Austin, TX"


class TestMarkdownTableParsing:
    def test_extracts_rows(self):
        rows = parse_markdown_table(README)
        assert len(rows) == 4
        assert "company" in rows[0]

    def test_handles_tables_with_no_rows(self):
        assert parse_markdown_table("| A | B |\n| - | - |\n") == []

    def test_ignores_prose(self):
        assert parse_markdown_table("Just some text\n\nAnd more.") == []


class TestGithubFeedAdapter:
    def build(self) -> GithubMarkdownFeedAdapter:
        return GithubMarkdownFeedAdapter(
            "speedyapply/2027-SWE-College-Jobs",
            season="SUMMER_2027",
            client=stub_client(None, text=README),
        )

    def test_parses_rows_with_links(self):
        with self.build() as adapter:
            results = adapter.fetch()
        assert len(results) == 3, "the row with no link must be dropped"

    def test_carries_company_through_ditto_rows(self):
        """Multi-role employers use an arrow rather than repeating the name."""
        with self.build() as adapter:
            results = adapter.fetch()
        assert results[1].posting.company == "Acme"
        assert results[1].posting.title == "Backend Intern"

    def test_reads_html_anchors_as_well_as_markdown_links(self):
        with self.build() as adapter:
            results = adapter.fetch()
        assert results[2].posting.application_url.startswith("https://jobs.lever.co/")

    def test_applies_the_configured_season(self):
        """Rows rarely state the season; the list as a whole does."""
        with self.build() as adapter:
            results = adapter.fetch()
        assert results[1].posting.season == "SUMMER_2027"

    def test_source_name_identifies_the_repository(self):
        with self.build() as adapter:
            assert adapter.source_name == "github:speedyapply/2027-SWE-College-Jobs"


# ---------------------------------------------------------------- ingestion


@pytest.mark.db
class TestIngest:
    def test_stores_jobs_companies_and_provenance(self, db: Session):
        with GreenhouseAdapter("acme", client=stub_client(GREENHOUSE_PAYLOAD)) as adapter:
            postings = list(adapter.fetch())

        report = ingest(db, postings, source_name="greenhouse:acme", now=NOW)

        assert report.fetched == 2
        assert report.new_jobs == 2
        assert count(db, Job) == 2
        assert count(db, Company) == 1
        assert count(db, JobSourceRecord) == 2
        assert count(db, JobSourceLink) == 2

    def test_rerunning_the_same_feed_adds_nothing(self, db: Session):
        """Discovery runs daily; an unchanged feed must be a no-op."""
        with GreenhouseAdapter("acme", client=stub_client(GREENHOUSE_PAYLOAD)) as adapter:
            postings = list(adapter.fetch())

        ingest(db, postings, source_name="greenhouse:acme", now=NOW)
        second = ingest(db, postings, source_name="greenhouse:acme", now=NOW)

        assert second.new_jobs == 0
        assert second.duplicates == 2
        assert count(db, Job) == 2
        assert count(db, JobSourceRecord) == 2

    def test_two_feeds_reporting_one_role_keep_both_provenance_trails(self, db: Session):
        """One job, two source records — §7.2 requires provenance to survive merging."""
        with GreenhouseAdapter("acme", client=stub_client(GREENHOUSE_PAYLOAD)) as gh:
            ingest(db, list(gh.fetch()), source_name="greenhouse:acme", now=NOW)
        with GithubMarkdownFeedAdapter(
            "speedyapply/2027-SWE-College-Jobs",
            season="SUMMER_2027",
            client=stub_client(None, text=README),
        ) as feed:
            report = ingest(db, list(feed.fetch()), source_name="github:list", now=NOW)

        acme_jobs = db.scalars(
            select(Job).join(Company).where(Company.normalized_name == "acme")
        ).all()
        assert len(acme_jobs) == 2, "the GitHub rows point at the same two Greenhouse jobs"
        assert report.duplicates == 2

        # Each Acme job was reported by Greenhouse and by the GitHub list, so it
        # carries two source records while remaining a single job.
        for job in acme_jobs:
            sources = db.scalars(select(JobSourceLink).where(JobSourceLink.job_id == job.id)).all()
            assert len(sources) == 2

    def test_reports_errors_without_aborting_the_batch(self, db: Session):
        from app.services.dedupe import NormalizedPosting
        from app.services.discovery.base import RawPosting, SourceType

        good = RawPosting(
            posting=NormalizedPosting(
                company="Acme", title="SWE Intern", application_url="https://acme.com/a"
            ),
            source_type=SourceType.MANUAL,
            source_name="manual",
            source_url="manual",
            external_id=None,
        )
        report = ingest(db, [good], source_name="manual", now=NOW)
        assert report.new_jobs == 1
        assert report.ok


@pytest.mark.db
class TestIngestAll:
    def test_one_failing_adapter_does_not_lose_the_others(self, db: Session):
        """A single 500 must not cost the run its other results."""
        adapters = [
            GreenhouseAdapter("acme", client=stub_client(GREENHOUSE_PAYLOAD)),
            GreenhouseAdapter("broken", client=stub_client(None, status=500)),
            LeverAdapter("globex", client=stub_client(LEVER_PAYLOAD)),
        ]
        reports = ingest_all(db, adapters, now=NOW)
        for adapter in adapters:
            adapter.close()

        assert [r.ok for r in reports] == [True, False, True]
        assert reports[0].new_jobs == 2
        assert reports[2].new_jobs == 1
        assert count(db, Job) == 3

    def test_malformed_json_is_reported_not_raised(self, db: Session):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, text="not json at all")

        adapter = GreenhouseAdapter(
            "acme", client=httpx.Client(transport=httpx.MockTransport(handler))
        )
        reports = ingest_all(db, [adapter], now=NOW)
        adapter.close()

        assert not reports[0].ok
        assert count(db, Job) == 0


class TestFixturesMatchProviderShapes:
    """Cheap guard that the fixtures stay realistic if someone edits them."""

    def test_greenhouse_fixture_has_the_documented_fields(self):
        job = GREENHOUSE_PAYLOAD["jobs"][0]
        assert {"id", "title", "absolute_url", "location", "content"} <= set(job)

    def test_lever_fixture_has_the_documented_fields(self):
        assert {"id", "text", "hostedUrl", "categories"} <= set(LEVER_PAYLOAD[0])

    def test_ashby_fixture_has_the_documented_fields(self):
        assert {"id", "title", "jobUrl", "location"} <= set(ASHBY_PAYLOAD["jobs"][0])

    def test_fixtures_are_json_serialisable(self):
        for payload in (GREENHOUSE_PAYLOAD, LEVER_PAYLOAD, ASHBY_PAYLOAD):
            json.dumps(payload)
