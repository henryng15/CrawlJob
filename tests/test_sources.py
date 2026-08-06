from datetime import date

from job_sync.sources import Job, dedupe_jobs, parse_jobs


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
