from job_sync.sheet import (
    HEADERS,
    _drop_blocked_rows,
    _drop_duplicate_identities,
    _key,
    _quote_tab,
    _sorted_rows,
)
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


def _row(company: str, date_posted: str, *extra: str) -> list[str]:
    return [company, "SWE Intern", f"https://jobs.example/{company}", date_posted, *extra]


def test_rows_sort_newest_posting_first() -> None:
    rows = [
        _row("Beta", "2026-07-04"),
        _row("Acme", "2026-08-06"),
        _row("Delta", "2026-07-20"),
    ]
    assert [row[3] for row in _sorted_rows(rows)] == ["2026-08-06", "2026-07-20", "2026-07-04"]


def test_same_date_breaks_the_tie_on_company() -> None:
    rows = [_row("Zeta", "2026-08-01"), _row("Acme", "2026-08-01"), _row("Mid", "2026-08-01")]
    assert [row[0] for row in _sorted_rows(rows)] == ["Zeta", "Mid", "Acme"]


def test_sorting_carries_extra_operator_columns_with_the_row() -> None:
    """A note typed into column E must follow its own posting, not stay on the
    line number it happened to occupy before the sort."""
    rows = [_row("Beta", "2026-07-04", "applied"), _row("Acme", "2026-08-06", "rejected")]
    assert _sorted_rows(rows) == [
        _row("Acme", "2026-08-06", "rejected"),
        _row("Beta", "2026-07-04", "applied"),
    ]


def test_sorting_tolerates_a_row_missing_its_date() -> None:
    rows = [["Acme", "SWE Intern", "https://jobs.example/a"], _row("Beta", "2026-08-01")]
    assert [row[0] for row in _sorted_rows(rows)] == ["Beta", "Acme"]


def test_blocked_employers_are_removed_from_the_sheet() -> None:
    """Not merely left out of new writes — rows written before the block have to
    go too, under whichever name the tracker filed them."""
    rows = [
        _row("Acme", "2026-08-01"),
        _row("TikTok", "2026-08-02"),
        _row("ByteDance", "2026-08-03"),
        _row("Bytedance Inc", "2026-08-04"),
        _row("TikTok / ByteDance", "2026-08-05"),
        _row("Beta", "2026-08-06"),
    ]
    live, removed = _drop_blocked_rows(rows)
    assert [row[0] for row in live] == ["Acme", "Beta"]
    assert removed == 4


def test_one_row_survives_per_company_and_role() -> None:
    """The same posting arrives under two links often enough that the link alone
    cannot decide it: Lever's /apply suffix, a Jobright mirror of a company board."""
    rows = [
        ["Acme", "Software Engineer Intern", "https://jobs.lever.co/acme/1", "2026-08-01"],
        ["Acme", "software engineer intern", "https://jobright.ai/jobs/info/xyz", "2026-08-02"],
        ["Acme", "Data Engineer Intern", "https://jobs.lever.co/acme/2", "2026-08-03"],
        ["Beta", "Software Engineer Intern", "https://jobs.lever.co/beta/1", "2026-08-04"],
    ]
    unique, removed = _drop_duplicate_identities(rows)
    assert [(row[0], row[3]) for row in unique] == [
        ("Acme", "2026-08-01"),
        ("Acme", "2026-08-03"),
        ("Beta", "2026-08-04"),
    ]
    assert removed == 1


def test_punctuation_between_trackers_does_not_make_two_rows() -> None:
    """Observed live: RTX, Figma and Zipline each reached the sheet twice, once
    with a dash and once in parentheses. Medtronic used an en dash, Amazon a comma."""
    rows = [
        ["RTX", "Software Engineer Intern - Summer 2027", "https://a.example/1", "2026-08-01"],
        ["RTX", "Software Engineer Intern (Summer 2027)", "https://b.example/2", "2026-08-02"],
        [
            "Medtronic",
            "Software Engineering Intern – Summer 2027",
            "https://c.example/3",
            "2026-08-03",
        ],
        [
            "Medtronic",
            "Software Engineering Intern, Summer 2027",
            "https://d.example/4",
            "2026-08-04",
        ],
    ]
    unique, removed = _drop_duplicate_identities(rows)
    assert [row[0] for row in unique] == ["RTX", "Medtronic"]
    assert removed == 2


def test_a_row_missing_company_or_role_is_never_merged_away() -> None:
    """What cannot be read cannot be deleted — the rule the liveness check follows."""
    rows = [
        ["", "", "https://jobs.example/a", "2026-08-01"],
        ["", "", "https://jobs.example/b", "2026-08-02"],
        ["Acme", "", "https://jobs.example/c", "2026-08-03"],
        ["Acme", "", "https://jobs.example/d", "2026-08-04"],
    ]
    unique, removed = _drop_duplicate_identities(rows)
    assert len(unique) == 4
    assert removed == 0


def test_an_annotated_row_outranks_the_duplicate_arriving_after_it() -> None:
    """Existing rows are passed in ahead of new ones, so a note in column E is
    never traded away for a fresh row describing the same job."""
    rows = [
        ["Acme", "SWE Intern", "https://jobs.example/a", "2026-08-01", "applied"],
        ["Acme", "SWE Intern", "https://jobs.example/b", "2026-08-02"],
    ]
    unique, _ = _drop_duplicate_identities(rows)
    assert unique == [["Acme", "SWE Intern", "https://jobs.example/a", "2026-08-01", "applied"]]


def test_dedupe_keeps_first_occurrence_across_sources() -> None:
    jobs = [
        _job("https://jobs.example/a", "2026-08-01"),
        _job("https://jobs.example/a/", "2026-08-02"),
        _job("https://JOBS.example/A", "2026-08-03"),
        _job("https://jobs.example/b", "2026-08-04"),
    ]
    assert [job.date_posted for job in dedupe_jobs(jobs)] == ["2026-08-01", "2026-08-04"]
