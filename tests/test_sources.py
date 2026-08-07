from datetime import date

from job_sync.sources import Job, clean_text, dedupe_jobs, normalize_link, parse_jobs


def test_parse_and_filter_markdown_rows() -> None:
    markdown = """| Company | Role | Apply | Added |
| --- | --- | --- | --- |
| Acme | Cloud Engineer Intern | [Apply](https://jobs.example/a) | 2026-08-01 |
| Other | Product Manager Intern | [Apply](https://jobs.example/b) | 2026-08-01 |
"""
    jobs = parse_jobs(markdown, date(2026, 8, 6))
    assert [(job.company, job.date_posted) for job in jobs] == [("Acme", "2026-08-01")]


def test_parse_html_link_and_age() -> None:
    markdown = """| Company | Position | Posting | Age |
| --- | --- | --- | --- |
| <a href="https://example.com"><strong>Acme</strong></a> | Software Engineer Intern | <a href="https://jobs.example/a"><img /></a> | 2d |
"""
    jobs = parse_jobs(markdown, date(2026, 8, 6))
    assert jobs[0].company == "Acme"
    assert jobs[0].apply_link == "https://jobs.example/a"
    assert jobs[0].date_posted == "2026-08-04"


def test_parse_html_table() -> None:
    markdown = """<table><tr><th>Company</th><th>Role</th><th>Application</th><th>Age</th></tr>
<tr><td><strong>Acme</strong></td><td>DevOps Intern</td><td><a href="https://jobs.example/a">Apply</a></td><td>1d</td></tr></table>"""
    jobs = parse_jobs(markdown, date(2026, 8, 6))
    assert [(job.company, job.apply_link) for job in jobs] == [("Acme", "https://jobs.example/a")]


def test_dedupe_across_sources_by_apply_link() -> None:
    first = Job("Acme", "Software Engineer Intern", "https://jobs.example/a", "2026-08-01")
    duplicate = Job("Acme Inc.", "SWE Intern", "https://jobs.example/a/", "2026-08-02")
    assert dedupe_jobs([first, duplicate]) == [first]


def test_repeat_marker_inherits_the_company_above() -> None:
    markdown = """| Company | Role | Apply | Added |
| --- | --- | --- | --- |
| 🔥 TikTok | Software Engineer Intern | [Apply](https://jobs.example/a) | 2026-08-01 |
| ↳ | Backend Software Engineer Intern | [Apply](https://jobs.example/b) | 2026-08-01 |
| ↳ | Machine Learning Engineer Intern | [Apply](https://jobs.example/c) | 2026-08-01 |
| Sargent & Lundy | Software Engineer Intern | [Apply](https://jobs.example/d) | 2026-08-01 |
"""
    jobs = parse_jobs(markdown, date(2026, 8, 6))
    assert [job.company for job in jobs] == ["TikTok", "TikTok", "TikTok", "Sargent & Lundy"]


def test_repeat_marker_survives_a_dropped_row_in_between() -> None:
    """The row the marker points at may itself be filtered out; it still names
    the company."""
    markdown = """| Company | Role | Apply | Added |
| --- | --- | --- | --- |
| TikTok | Product Manager Intern | [Apply](https://jobs.example/a) | 2026-08-01 |
| ↳ | Software Engineer Intern | [Apply](https://jobs.example/b) | 2026-08-01 |
"""
    jobs = parse_jobs(markdown, date(2026, 8, 6))
    assert [(job.company, job.role) for job in jobs] == [("TikTok", "Software Engineer Intern")]


def test_a_row_never_reaches_the_sheet_without_a_company() -> None:
    markdown = """| Company | Role | Apply | Added |
| --- | --- | --- | --- |
| ↳ | Software Engineer Intern | [Apply](https://jobs.example/a) | 2026-08-01 |
|  | Software Engineer Intern | [Apply](https://jobs.example/b) | 2026-08-01 |
| 🔥 | Software Engineer Intern | [Apply](https://jobs.example/c) | 2026-08-01 |
"""
    assert parse_jobs(markdown, date(2026, 8, 6)) == []


def test_emoji_decorations_do_not_split_one_company_in_two() -> None:
    assert clean_text("🔥 TikTok") == clean_text("TikTok") == "TikTok"
    assert clean_text("Copart ✅") == clean_text("Copart 🛂") == "Copart"


def test_tracking_params_do_not_hide_a_duplicate() -> None:
    """Simplify tags its links, speedyapply does not. Same job, one row."""
    simplify = (
        "https://lifeattiktok.com/search/7670281449668905269?utm_source=Simplify&ref=Simplify"
    )
    speedyapply = "https://lifeattiktok.com/search/7670281449668905269"
    assert normalize_link(simplify) == normalize_link(speedyapply)


def test_an_id_carrying_param_is_not_a_tracking_param() -> None:
    """gh_jid names the posting; dropping it would merge every Greenhouse job at
    one company into a single row."""
    first = "https://careers.example.com/jobs?gh_jid=8072713&utm_source=Simplify"
    second = "https://careers.example.com/jobs?gh_jid=9999999&utm_source=Simplify"
    assert normalize_link(first) != normalize_link(second)


def test_normalize_link_ignores_host_case_www_and_trailing_slash() -> None:
    variants = [
        "https://www.jobs.example/a/",
        "https://Jobs.Example/a",
        "https://jobs.example/a?utm_medium=email",
    ]
    assert len({normalize_link(v) for v in variants}) == 1
