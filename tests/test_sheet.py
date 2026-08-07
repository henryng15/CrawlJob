from job_sync.sheet import HEADERS, _key, _quote_tab
from job_sync.sources import Job, dedupe_jobs, normalize_link


def _job(link: str, date_posted: str = "2026-08-01") -> Job:
    return Job(
        company="Acme", role="Software Engineer Intern", apply_link=link, date_posted=date_posted
    )


def test_quoted_tab_survives_spaces_digits_and_apostrophes() -> None:
    assert _quote_tab("Jobs") == "'Jobs'"
    assert _quote_tab("Job Tracker") == "'Job Tracker'"
    assert _quote_tab("2027 Internships") == "'2027 Internships'"
    assert _quote_tab("Hoan's Jobs") == "'Hoan''s Jobs'"


def test_sheet_key_matches_job_dedupe_key() -> None:
    """A row read back from the sheet must produce the same key as the job that
    wrote it, or every run appends the whole list again."""
    job = _job("https://jobs.example/a/")
    row = [job.company, job.role, job.apply_link, job.date_posted]
    assert _key(row) == job.dedupe_key


def test_sheet_key_ignores_trailing_slash_case_and_whitespace() -> None:
    job = _job("https://Jobs.Example/A")
    assert (
        _key(["Acme", "SWE Intern", "  https://jobs.example/a/  ", "2026-08-01"]) == job.dedupe_key
    )


def test_sheet_key_skips_rows_without_a_link() -> None:
    assert _key(["Acme", "SWE Intern"]) is None
    assert _key(["Acme", "SWE Intern", "   ", "2026-08-01"]) is None
    assert _key(HEADERS) == normalize_link("Link Apply")


def test_dedupe_keeps_first_occurrence_across_sources() -> None:
    jobs = [
        _job("https://jobs.example/a", "2026-08-01"),
        _job("https://jobs.example/a/", "2026-08-02"),
        _job("https://JOBS.example/A", "2026-08-03"),
        _job("https://jobs.example/b", "2026-08-04"),
    ]
    assert [job.date_posted for job in dedupe_jobs(jobs)] == ["2026-08-01", "2026-08-04"]
