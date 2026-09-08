from datetime import date

from job_sync import feeds
from job_sync.feeds import harvest_feeds
from job_sync.sources import Source, parse_rss_jobs, parse_source, role_identity


def test_startup_jobs_rss_extracts_company_from_title_and_uses_guid() -> None:
    xml = """<?xml version="1.0"?>
    <rss><channel>
      <item>
        <title>Software Engineer Intern at Acme Labs</title>
        <link>https://startup.jobs/tracked?utm_source=rss</link>
        <guid>https://startup.jobs/software-engineer-intern-acme-123</guid>
        <pubDate>Wed, 02 Sep 2026 16:14:47 +0000</pubDate>
      </item>
      <item>
        <title>Software Engineer Intern at Acme Labs</title>
        <link>https://startup.jobs/other?utm_source=rss</link>
        <guid>https://startup.jobs/software-engineer-intern-acme-123</guid>
        <pubDate>Wed, 02 Sep 2026 16:14:47 +0000</pubDate>
      </item>
      <item>
        <title>Staff Software Engineer at Acme Labs</title>
        <link>https://startup.jobs/staff-456</link>
      </item>
    </channel></rss>"""

    jobs = parse_rss_jobs(xml, date(2026, 9, 3))

    assert [(job.company, job.role, job.date_posted) for job in jobs] == [
        ("Acme Labs", "Software Engineer Intern", "2026-09-02")
    ]
    assert jobs[0].apply_link.endswith("acme-123")
    assert parse_source(xml, Source("Startup Jobs", "", "rss"), date(2026, 9, 3)) == jobs


def test_role_identity_tolerates_acronym_and_word_reordering_but_keeps_intake() -> None:
    assert role_identity("SWE Intern") == role_identity("Software Engineering Internship")
    assert role_identity("Software Engineer Intern - Summer 2027") == role_identity(
        "Summer 2027 Software Engineering Intern"
    )
    assert role_identity("Software Engineer Intern - Summer 2027") != role_identity(
        "Software Engineer Intern - Winter 2027"
    )
    assert role_identity("Backend Software Engineer Intern") != role_identity(
        "Software Engineer Intern"
    )


def test_optional_feeds_are_quiet_without_credentials_or_company_registry(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.delenv("ADZUNA_APP_ID", raising=False)
    monkeypatch.delenv("ADZUNA_APP_KEY", raising=False)
    monkeypatch.delenv("USAJOBS_API_KEY", raising=False)
    config = tmp_path / "feeds.toml"
    config.write_text(
        "[smartrecruiters]\ncompanies=[]\n[personio]\ncompanies=[]\n[recruitee]\ncompanies=[]\n",
        encoding="utf-8",
    )

    result = harvest_feeds(config, date(2026, 9, 3))

    assert result.jobs == []
    assert result.failures == []
    assert result.skipped == 5


def test_smartrecruiters_parser_keeps_us_target_roles(monkeypatch) -> None:
    monkeypatch.setattr(
        feeds,
        "_json",
        lambda url: {
            "content": [
                {
                    "id": "123",
                    "name": "Software Engineering Intern",
                    "company": {"name": "Acme"},
                    "releasedDate": "2026-09-02T12:00:00Z",
                    "location": {"city": "Austin", "region": "TX", "country": "US"},
                },
                {
                    "id": "456",
                    "name": "Software Engineer Intern",
                    "company": {"name": "Acme"},
                    "releasedDate": "2026-09-02T12:00:00Z",
                    "location": {"city": "London", "country": "GB"},
                },
            ]
        },
    )

    jobs = feeds._smartrecruiters({"smartrecruiters": {"companies": ["acme"]}}, date(2026, 9, 3))

    assert [(job.company, job.role, job.date_posted) for job in jobs] == [
        ("Acme", "Software Engineering Intern", "2026-09-02")
    ]
    assert jobs[0].apply_link == "https://careers.smartrecruiters.com/acme/123"


def test_recruitee_parser_uses_public_offer_fields(monkeypatch) -> None:
    monkeypatch.setattr(
        feeds,
        "_json",
        lambda url: {
            "offers": [
                {
                    "id": 1,
                    "title": "Backend Software Engineer Intern",
                    "slug": "backend-software-engineer-intern",
                    "city": "Boston, MA",
                    "created_at": "2026-09-01T10:00:00Z",
                }
            ]
        },
    )

    jobs = feeds._recruitee({"recruitee": {"companies": ["acme"]}}, date(2026, 9, 3))

    assert jobs[0].date_posted == "2026-09-01"
    assert jobs[0].apply_link.endswith("/o/backend-software-engineer-intern")
