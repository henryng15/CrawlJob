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
from app.services.discovery.base import content_hash, employer_host, website_domain
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

#: The same providers as served to an employer who fronts their board with their
#: own hostname, and one carrying an explicit website field. Both shapes exist in
#: the wild and both are the only ways a company domain can be had from an ATS
#: feed — the default payloads above carry no employer hostname anywhere.
GREENHOUSE_CUSTOM_DOMAIN_PAYLOAD = {
    "name": "Initrode",
    "jobs": [
        {
            "id": 111,
            "title": "SWE Intern",
            "absolute_url": "https://careers.initrode.com/jobs/111",
            "location": {"name": "Boston, MA"},
            "content": "<p>Work.</p>",
        }
    ],
}

GREENHOUSE_WITH_WEBSITE_PAYLOAD = {
    "name": "Acme, Inc.",
    "company_website": "https://www.acme.com/about",
    "jobs": [
        {
            "id": 222,
            "title": "SWE Intern",
            "absolute_url": "https://boards.greenhouse.io/acme/jobs/222",
            "location": {"name": "Remote"},
        }
    ],
}

LEVER_CUSTOM_DOMAIN_PAYLOAD = [
    {
        "id": "cccccccc-3333-4444-8555-666666666666",
        "text": "SWE Intern",
        "hostedUrl": "https://jobs.globex.co.uk/cccccccc-3333-4444-8555-666666666666",
        "categories": {"location": "London", "team": "Globex"},
    }
]

ASHBY_WITH_WEBSITE_PAYLOAD = {
    "jobs": [
        {
            "id": "dddddddd-4444-4555-8666-777777777777",
            "title": "SWE Intern",
            "jobUrl": "https://jobs.ashbyhq.com/initech/dddddddd-4444-4555-8666-777777777777",
            "location": "Austin, TX",
            "organizationName": "Initech",
            "organizationWebsite": "https://initech.com",
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

#: The other shape in the wild. speedyapply names the apply column "Posting" and
#: wraps the employer in an anchor to their *homepage* — so a parser that misses
#: "Posting" and falls back to the company cell gets a URL that looks entirely
#: reasonable and is useless. That is exactly what happened: 107 real jobs were
#: stored pointing at nvidia.com and tiktok.com instead of the requisition.
SPEEDYAPPLY_README = """
# 2027 SWE College Jobs

| Company | Position | Location | Salary | Posting | Age |
|---|---|---|---|---|---|
| <a href="https://www.nvidia.com"><strong>NVIDIA</strong></a> | Performance Engineer Intern | St. Louis, MO | $62/hr | <a href="https://nvidia.wd5.myworkdayjobs.com/en-US/nvidiaexternalcareersite/job/US-MO-St-Louis/Perf_JR2015779"><img src="https://i.imgur.com/JpkfjIq.png" alt="Apply"/></a> | 29d |
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

    def test_escaped_markup_is_unescaped_before_the_tags_are_stripped(self):
        """Greenhouse's ``content`` field arrives escaped.

        Found by running stage 1 against three live Greenhouse boards: every one
        of 1,522 postings came back as markup. Stripping first finds no tags —
        they are entities at that point — and the unescape afterwards turns them
        *into* tags, so sponsorship analysis was reading ``<div class=...>`` and
        recording quote offsets into it.
        """
        escaped = (
            "&lt;div class=&quot;intro&quot;&gt;&lt;p&gt;We do not sponsor.&lt;/p&gt;&lt;/div&gt;"
        )
        assert strip_html(escaped) == "We do not sponsor."

    def test_ordinary_markup_is_unaffected(self):
        """Lever and Ashby send real HTML; that path must not change."""
        assert strip_html("<p>Hello <b>there</b></p>") == "Hello there"

    def test_a_literal_less_than_survives(self):
        """Why the unescape is conditional rather than unconditional.

        Unescaping every payload would turn "salary &lt; 100k" in an ordinary
        HTML description into an unterminated tag and swallow the rest of the
        sentence.
        """
        assert strip_html("<p>salary &lt; 100k here</p>") == "salary < 100k here"


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


class TestEmployerHost:
    """``Company.domain`` is the key the manual-only list is joined on.

    Getting it wrong is not a parse bug, it is a policy failure: the gate that
    decides whether a browser may click Submit reads this field.
    """

    @pytest.mark.parametrize(
        ("url", "expected"),
        [
            ("https://careers.acme.com/jobs/1", "careers.acme.com"),
            ("https://www.acme.com/about", "acme.com"),
            ("acme.com", "acme.com"),
            ("https://ACME.com:443/x?y=1", "acme.com"),
            ("https://jobs.globex.co.uk/1", "jobs.globex.co.uk"),
        ],
    )
    def test_reads_the_employers_host(self, url, expected):
        assert employer_host(url) == expected

    @pytest.mark.parametrize(
        "url",
        [
            "https://boards.greenhouse.io/acme/jobs/1",
            "https://job-boards.greenhouse.io/acme/jobs/1",
            "https://acme.greenhouse.io/jobs/1",
            "https://jobs.lever.co/globex/abc",
            "https://jobs.ashbyhq.com/initech/abc",
            "https://acme.wd5.myworkdayjobs.com/en-US/careers/job/R1",
            "https://www.linkedin.com/jobs/view/1",
            "https://careers.icims.com/jobs/1",
        ],
    )
    def test_an_ats_or_aggregator_host_is_never_a_company_domain(self, url):
        """boards.greenhouse.io would be one identity shared by thousands.

        Every Greenhouse employer would collapse onto a single ``Company.domain``,
        so one of them appearing on the manual-only list would hold all of them
        back — and one absent from it would clear all of them for submission.
        """
        assert employer_host(url) is None

    @pytest.mark.parametrize("url", [None, "", "   ", "not a url", "localhost", "https://"])
    def test_nothing_usable_yields_nothing(self, url):
        assert employer_host(url) is None

    def test_a_website_field_is_preferred_and_searched_in_order(self):
        assert website_domain({"company_website": "https://acme.com"}) == "acme.com"
        assert website_domain(None, {}, {"organizationWebsite": "initech.com"}) == "initech.com"
        assert website_domain({"title": "SWE Intern"}) is None

    def test_a_website_field_holding_an_ats_link_is_rejected_too(self):
        """The field is trusted for intent, not for content."""
        assert website_domain({"website": "https://boards.greenhouse.io/acme"}) is None


class TestAdaptersDeriveTheCompanyDomain:
    def test_greenhouse_default_board_yields_no_domain(self):
        """The common case, and it must stay ``None`` rather than become the ATS.

        A Greenhouse board with no custom hostname and no website field simply
        does not say who the employer is in domain terms. Left unset, the
        manual-only gate routes the application to the user, which is the cheap
        failure.
        """
        with GreenhouseAdapter("acme", client=stub_client(GREENHOUSE_PAYLOAD)) as adapter:
            postings = [r.posting for r in adapter.fetch()]
        assert [p.company_domain for p in postings] == [None, None]

    def test_greenhouse_custom_domain_board_yields_the_employer(self):
        with GreenhouseAdapter(
            "initrode", client=stub_client(GREENHOUSE_CUSTOM_DOMAIN_PAYLOAD)
        ) as adapter:
            posting = adapter.fetch()[0].posting
        assert posting.company_domain == "careers.initrode.com"

    def test_greenhouse_prefers_a_board_level_website_field(self):
        with GreenhouseAdapter(
            "acme", client=stub_client(GREENHOUSE_WITH_WEBSITE_PAYLOAD)
        ) as adapter:
            posting = adapter.fetch()[0].posting
        assert posting.company_domain == "acme.com"

    def test_lever_default_board_yields_no_domain(self):
        with LeverAdapter("globex", client=stub_client(LEVER_PAYLOAD)) as adapter:
            posting = adapter.fetch()[0].posting
        assert posting.company_domain is None

    def test_lever_custom_domain_board_yields_the_employer(self):
        with LeverAdapter("globex", client=stub_client(LEVER_CUSTOM_DOMAIN_PAYLOAD)) as adapter:
            posting = adapter.fetch()[0].posting
        assert posting.company_domain == "jobs.globex.co.uk"

    def test_ashby_default_board_yields_no_domain(self):
        with AshbyAdapter("initech", client=stub_client(ASHBY_PAYLOAD)) as adapter:
            posting = adapter.fetch()[0].posting
        assert posting.company_domain is None

    def test_ashby_reads_an_organization_website(self):
        with AshbyAdapter("initech", client=stub_client(ASHBY_WITH_WEBSITE_PAYLOAD)) as adapter:
            posting = adapter.fetch()[0].posting
        assert posting.company_domain == "initech.com"

    def test_no_adapter_ever_reports_an_ats_hostname(self):
        """One assertion covering all three, because one slip is enough."""
        adapters = [
            GreenhouseAdapter("acme", client=stub_client(GREENHOUSE_PAYLOAD)),
            LeverAdapter("globex", client=stub_client(LEVER_PAYLOAD)),
            AshbyAdapter("initech", client=stub_client(ASHBY_PAYLOAD)),
        ]
        domains = []
        for adapter in adapters:
            domains += [r.posting.company_domain for r in adapter.fetch()]
            adapter.close()

        assert not any(
            domain and ("greenhouse" in domain or "lever.co" in domain or "ashbyhq" in domain)
            for domain in domains
        )


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


class TestTheApplyLinkIsTheRequisition:
    """The one field the browser cannot do without.

    A wrong company or a wrong title costs a wasted slot. A wrong *link* costs
    nothing visible at all: the row stores, the screen lists it, and the browser
    opens a marketing page and fills in nothing.
    """

    def build(self, markdown: str) -> GithubMarkdownFeedAdapter:
        return GithubMarkdownFeedAdapter(
            "speedyapply/2027-SWE-College-Jobs",
            client=stub_client(None, text=markdown),
        )

    def test_a_posting_column_is_read(self):
        with self.build(SPEEDYAPPLY_README) as adapter:
            results = adapter.fetch()

        assert len(results) == 1
        assert results[0].posting.application_url.startswith(
            "https://nvidia.wd5.myworkdayjobs.com/"
        )

    def test_the_employers_homepage_is_never_used_as_the_apply_url(self):
        """The company cell is an anchor too, and it is not the application."""
        with self.build(SPEEDYAPPLY_README) as adapter:
            results = adapter.fetch()

        assert "nvidia.com" not in results[0].posting.application_url

    def test_a_schema_with_no_recognised_apply_column_drops_the_row(self):
        """Loudly nothing, rather than quietly wrong.

        A feed that renames its column should lose its rows and show up as a
        discovery run that found none — visible. Falling back to whatever other
        link the row happens to carry is what produced 107 unusable jobs.
        """
        unknown = (
            "| Company | Position | Where To Apply |\n"
            "|---|---|---|\n"
            "| <a href='https://acme.com'>Acme</a> | SWE Intern |"
            " <a href='https://boards.greenhouse.io/acme/jobs/1'>Apply</a> |\n"
        )
        with self.build(unknown) as adapter:
            assert adapter.fetch() == []


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

    def test_a_derived_domain_reaches_the_company_row(self, db: Session):
        """``Company.domain`` is the join key; a domain the adapter found is useless
        if ingestion drops it."""
        with GreenhouseAdapter(
            "initrode", client=stub_client(GREENHOUSE_CUSTOM_DOMAIN_PAYLOAD)
        ) as adapter:
            ingest(db, list(adapter.fetch()), source_name="greenhouse:initrode", now=NOW)

        company = not_none(
            db.scalars(select(Company).where(Company.normalized_name == "initrode")).first()
        )
        assert company.domain == "careers.initrode.com"

    def test_a_board_with_no_employer_hostname_leaves_the_domain_null(self, db: Session):
        """And the manual-only gate then treats that company as manual."""
        with GreenhouseAdapter("acme", client=stub_client(GREENHOUSE_PAYLOAD)) as adapter:
            ingest(db, list(adapter.fetch()), source_name="greenhouse:acme", now=NOW)

        company = not_none(
            db.scalars(select(Company).where(Company.normalized_name == "acme")).first()
        )
        assert company.domain is None

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
