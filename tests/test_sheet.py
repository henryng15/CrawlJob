import re
from pathlib import Path

import pytest

from job_sync.config import Settings
from job_sync.sheet import (
    APP_COMPANY_HEADER,
    APP_FIELDS,
    APP_LINK_HEADER,
    APP_PROCESS_HEADER,
    APP_ROLE_HEADER,
    APP_UPDATE_HEADER,
    APPLIED,
    EXPIRED,
    HEADERS,
    PROCESS_STAGES,
    SOURCE,
    STAMP,
    AppLayoutError,
    _census,
    _column,
    _divided,
    _drop_blocked_rows,
    _drop_dead_rows,
    _drop_duplicate_identities,
    _drop_empty_rows,
    _drop_foreign_rows,
    _fill_source,
    _jobs_checkbox_rule,
    _key,
    _last_stage,
    _layout,
    _loose_identity,
    _mark_applied,
    _quote_tab,
    _sorted_rows,
    _stamp,
    _trimmed,
    _unstamped,
    _whole_tab,
    _write,
    app_columns,
)
from job_sync.sources import Job, dedupe_jobs, normalize_link, role_key, role_tokens


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


def _row(company: str, date_posted: str, *extra: str, source: str = "") -> list[str]:
    """A Jobs row. `extra` starts at the Applied checkbox, so every test that says
    "TRUE" still means Applied even though Source now sits between them."""
    return [
        company,
        "SWE Intern",
        f"https://jobs.example/{company}",
        date_posted,
        source,
        *extra,
    ]


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
    """A note typed past the checkboxes must follow its own posting, not stay on the
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


def test_dedup_ignores_only_a_company_legal_suffix_and_role_acronym() -> None:
    rows = [
        ["Acme LLC", "Software Engineer Intern", "https://jobs.example/a", "2026-08-01"],
        ["Acme", "SWE Internship", "https://jobs.example/b", "2026-08-02"],
        ["Acme Robotics", "SWE Internship", "https://jobs.example/c", "2026-08-03"],
    ]

    unique, removed = _drop_duplicate_identities(rows)

    assert [(row[0], row[2]) for row in unique] == [
        ("Acme LLC", "https://jobs.example/a"),
        ("Acme Robotics", "https://jobs.example/c"),
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
    """Existing rows are passed in ahead of new ones, so a note past the
    checkboxes is never traded away for a fresh row describing the same job."""
    rows = [
        ["Acme", "SWE Intern", "https://jobs.example/a", "2026-08-01", "applied"],
        ["Acme", "SWE Intern", "https://jobs.example/b", "2026-08-02"],
    ]
    unique, _ = _drop_duplicate_identities(rows)
    assert unique == [["Acme", "SWE Intern", "https://jobs.example/a", "2026-08-01", "applied"]]


JOBRIGHT = "https://jobright.ai/jobs/info/6a7b2fc0"
GREENHOUSE = "https://job-boards.greenhouse.io/acme/jobs/1"


def test_the_employers_own_board_replaces_a_jobright_row_already_written() -> None:
    """Arrival order alone froze whatever the sheet happened to hold first. A
    jobright.ai row written last month has to lose to the greenhouse URL that
    Simplify carries for the same posting, even though it arrives later."""
    rows = [
        ["Acme", "SWE Intern", JOBRIGHT, "2026-08-01"],
        ["Acme", "SWE Intern", GREENHOUSE, "2026-08-02"],
    ]
    unique, removed = _drop_duplicate_identities(rows)
    assert [row[2] for row in unique] == [GREENHOUSE]
    assert removed == 1


def test_the_better_link_wins_from_either_direction() -> None:
    """Whichever order the two reach the dedupe, the employer's board is kept."""
    rows = [
        ["Acme", "SWE Intern", GREENHOUSE, "2026-08-02"],
        ["Acme", "SWE Intern", JOBRIGHT, "2026-08-01"],
    ]
    unique, _ = _drop_duplicate_identities(rows)
    assert [row[2] for row in unique] == [GREENHOUSE]


def test_an_annotation_is_worth_more_than_a_better_link() -> None:
    """Whoever wrote "applied" applied through that link. Upgrading the URL under
    them would drop the row carrying their note."""
    rows = [
        ["Acme", "SWE Intern", JOBRIGHT, "2026-08-01", "", "applied"],
        ["Acme", "SWE Intern", GREENHOUSE, "2026-08-02"],
    ]
    unique, _ = _drop_duplicate_identities(rows)
    assert [row[2] for row in unique] == [JOBRIGHT]


def test_two_aggregator_rows_still_fall_back_to_arrival() -> None:
    rows = [
        ["Acme", "SWE Intern", JOBRIGHT + "a", "2026-08-01"],
        ["Acme", "SWE Intern", JOBRIGHT + "b", "2026-08-02"],
    ]
    unique, removed = _drop_duplicate_identities(rows)
    assert [row[2] for row in unique] == [JOBRIGHT + "a"]
    assert removed == 1


def test_choosing_a_later_row_does_not_reorder_the_survivors() -> None:
    """The winner takes the loser's place in the sheet, so a run that only
    upgrades a link does not also reshuffle everything around it."""
    rows = [
        ["Beta", "SWE Intern", GREENHOUSE + "b", "2026-08-01"],
        ["Acme", "SWE Intern", JOBRIGHT, "2026-08-02"],
        ["Delta", "SWE Intern", GREENHOUSE + "d", "2026-08-03"],
        ["Acme", "SWE Intern", GREENHOUSE, "2026-08-04"],
    ]
    unique, _ = _drop_duplicate_identities(rows)
    assert [row[0] for row in unique] == ["Beta", "Delta", "Acme"]


def test_dedupe_keeps_first_occurrence_across_sources() -> None:
    jobs = [
        _job("https://jobs.example/a", "2026-08-01"),
        _job("https://jobs.example/a/", "2026-08-02"),
        _job("https://JOBS.example/A", "2026-08-03"),
        _job("https://jobs.example/b", "2026-08-04"),
    ]
    assert [job.date_posted for job in dedupe_jobs(jobs)] == ["2026-08-01", "2026-08-04"]


def test_an_unticked_checkbox_is_not_an_annotation() -> None:
    """Once the checkbox is set up every row carries column E, so reading "FALSE"
    as a note would make the annotation tier say nothing about any row and quietly
    hand every contest back to the link comparison."""
    rows = [
        ["Acme", "SWE Intern", JOBRIGHT, "2026-08-01", "FALSE"],
        ["Acme", "SWE Intern", GREENHOUSE, "2026-08-02", "FALSE"],
    ]
    unique, _ = _drop_duplicate_identities(rows)
    assert [row[2] for row in unique] == [GREENHOUSE]


def test_a_ticked_checkbox_protects_the_link_it_was_ticked_on() -> None:
    """The tick means the application went through that URL, so the aggregator row
    keeps its place even though the employer's own board is otherwise preferred."""
    rows = [
        ["Acme", "SWE Intern", JOBRIGHT, "2026-08-01", "", "TRUE"],
        ["Acme", "SWE Intern", GREENHOUSE, "2026-08-02", "", "FALSE"],
    ]
    unique, _ = _drop_duplicate_identities(rows)
    assert [row[2] for row in unique] == [JOBRIGHT]


class _Request:
    def execute(self) -> None:
        return None


class _FakeValues:
    """Stands in for spreadsheets().values(), recording what would have been sent."""

    def __init__(self) -> None:
        self.updates: list[tuple[str, str, list[list[str]]]] = []
        self.cleared: list[str] = []

    def update(self, spreadsheetId: str, range: str, valueInputOption: str, body: dict) -> _Request:
        self.updates.append((range, valueInputOption, body["values"]))
        return _Request()

    def clear(self, spreadsheetId: str, range: str, body: dict) -> _Request:
        self.cleared.append(range)
        return _Request()


def _written(rows: list[list[str]], clear_to_row: int = 0) -> _FakeValues:
    values_api = _FakeValues()
    settings = Settings(
        sheet_id="sheet-1",
        sheet_tab="Jobs",
        app_tab="App",
        alumni_tab="Alumni",
        service_account_json="{}",
    )
    _write(values_api, settings, "'Jobs'", rows, clear_to_row=clear_to_row)
    return values_api


def test_a_sheet_nobody_has_annotated_is_still_one_write() -> None:
    api = _written([HEADERS, _row("Acme", "2026-08-01")])
    assert [(cells, parse) for cells, parse, _ in api.updates] == [("'Jobs'!A1:E2", "RAW")]


def test_the_checkbox_column_is_written_where_sheets_will_parse_it() -> None:
    """RAW stores the string "TRUE" over the checkbox rather than ticking it, and
    the box would read back unticked on the next run."""
    api = _written([HEADERS + ["Applied"], _row("Acme", "2026-08-01", "TRUE")])
    assert [(cells, parse) for cells, parse, _ in api.updates] == [
        ("'Jobs'!A1:E2", "RAW"),
        ("'Jobs'!F1:F2", "USER_ENTERED"),
    ]
    assert api.updates[1][2] == [["Applied"], ["TRUE"]]


def test_the_iso_date_is_never_offered_to_the_value_parser() -> None:
    """USER_ENTERED across the whole row would turn Date Posted into a date serial,
    and _sort_key reads it as a string."""
    api = _written([HEADERS + ["Applied"], _row("Acme", "2026-08-01", "TRUE")])
    owned = next(rows for _, parse, rows in api.updates if parse == "RAW")
    assert owned[1] == ["Acme", "SWE Intern", "https://jobs.example/Acme", "2026-08-01", ""]


def test_a_row_appended_this_run_gets_an_empty_checkbox_cell() -> None:
    """A newly crawled row arrives four cells wide. Padding keeps the block
    rectangular, and an empty cell under checkbox validation is an unticked box."""
    api = _written(
        [HEADERS + ["Applied"], _row("Acme", "2026-08-02", "TRUE"), _row("Zeta", "2026-08-01")]
    )
    assert api.updates[1][2] == [["Applied"], ["TRUE"], [""]]


def test_jobs_checkbox_rule_covers_every_row_the_sync_wrote() -> None:
    """Jobs must not repeat the old fixed-row checkbox boundary."""
    grid = _jobs_checkbox_rule(sheet_id=7, rows=811)["setDataValidation"]
    assert grid["range"] == {
        "sheetId": 7,
        "startRowIndex": 1,
        "endRowIndex": 812,
        "startColumnIndex": APPLIED,
        "endColumnIndex": EXPIRED + 1,
    }
    assert grid["rule"] == {"condition": {"type": "BOOLEAN"}, "showCustomUi": True}


def test_the_tail_of_a_shortened_sheet_is_cleared_before_the_write() -> None:
    api = _written([HEADERS, _row("Acme", "2026-08-01")], clear_to_row=9)
    assert api.cleared == ["'Jobs'!A3:E9"]


APPLIED_LINK = "https://jobs.example/Acme"
APPLIED_NAME = _loose_identity("Acme", "SWE Intern")


def test_a_row_whose_link_is_in_the_tracker_is_ticked() -> None:
    rows = [_row("Acme", "2026-08-01")]
    assert _mark_applied(rows, {normalize_link(APPLIED_LINK)}, set()) == (1, 0)
    assert rows[0][APPLIED] == "TRUE"


def test_a_link_the_tracker_wrote_with_tracking_params_still_matches() -> None:
    rows = [_row("Acme", "2026-08-01")]
    tracked = normalize_link(APPLIED_LINK + "/?utm_source=Simplify&ref=Simplify")
    assert _mark_applied(rows, {tracked}, set()) == (1, 0)


def test_a_job_applied_to_through_a_different_url_is_ticked_by_name() -> None:
    """The whole reason the second reading exists: the application went through the
    employer's own board, while the Jobs row still carries the aggregator's link."""
    rows = [["Acme", "SWE Intern", JOBRIGHT, "2026-08-01"]]
    assert _mark_applied(rows, set(), {APPLIED_NAME}) == (0, 1)
    assert rows[0][APPLIED] == "TRUE"


def test_a_job_nobody_has_applied_to_is_left_alone() -> None:
    rows = [_row("Zeta", "2026-08-01")]
    assert _mark_applied(rows, {normalize_link(APPLIED_LINK)}, {APPLIED_NAME}) == (0, 0)
    assert rows[0][APPLIED] == ""


def test_a_row_is_padded_so_both_checkbox_columns_always_exist() -> None:
    rows = [_row("Zeta", "2026-08-01")]
    _mark_applied(rows, set(), set())
    assert len(rows[0]) == EXPIRED + 1


def test_a_row_already_ticked_is_not_counted_again() -> None:
    """This runs every two hours. Counting the same row each time would report work
    that never happened and force a write on a sheet nothing changed in."""
    rows = [_row("Acme", "2026-08-01", "TRUE")]
    assert _mark_applied(rows, {normalize_link(APPLIED_LINK)}, set()) == (0, 0)


def test_a_box_reading_false_is_still_ticked() -> None:
    """Applying checkbox validation writes FALSE across the whole range at once, so
    FALSE is the resting state of every row rather than a tick someone took back.
    Sparing it made a function that could never tick anything."""
    rows = [_row("Acme", "2026-08-01", "FALSE")]
    assert _mark_applied(rows, {normalize_link(APPLIED_LINK)}, set()) == (1, 0)
    assert rows[0][APPLIED] == "TRUE"


def test_a_note_on_the_row_leaves_its_checkbox_alone() -> None:
    """The deliberate act FALSE was mistaken for. Somebody disagreeing with a match
    needs a way to say so that survives a sync running every two hours. The note
    lives in column G, past both checkboxes."""
    rows = [_row("Acme", "2026-08-01", "FALSE", "FALSE", "not this req")]
    assert _mark_applied(rows, {normalize_link(APPLIED_LINK)}, {APPLIED_NAME}) == (0, 0)
    assert rows[0][APPLIED] == "FALSE"


def test_the_expired_column_is_not_read_as_a_note() -> None:
    """Column F is a checkbox now, so it reads FALSE on every row it covers. Counting
    that as a note would freeze the auto-tick across the whole sheet — the same fault
    that made the first version of this tick nothing at all."""
    rows = [_row("Acme", "2026-08-01", "FALSE", "FALSE")]
    assert _mark_applied(rows, {normalize_link(APPLIED_LINK)}, set()) == (1, 0)
    assert rows[0][APPLIED] == "TRUE"


def test_an_expired_posting_is_not_ticked_applied() -> None:
    """Expired says the posting is not there to apply to, so there is nothing left
    for the tick to claim about it."""
    rows = [_row("Acme", "2026-08-01", "", "TRUE")]
    assert _mark_applied(rows, {normalize_link(APPLIED_LINK)}, {APPLIED_NAME}) == (0, 0)
    assert rows[0][APPLIED] == ""


def test_expired_rows_are_not_counted_as_still_to_apply_to() -> None:
    rows = [
        _row("Acme", "2026-08-01", "TRUE", "FALSE"),
        _row("Beta", "2026-08-02", "FALSE", "TRUE"),
        _row("Zeta", "2026-08-03", "FALSE", "FALSE"),
        _row("Iota", "2026-08-04", "TRUE", "TRUE"),
    ]
    assert _census(rows) == (2, 2, 1)


def test_a_half_filled_tracker_row_does_not_tick_everything() -> None:
    """An App row missing its role reads as identity ("acme", ""), which would match
    every Jobs row that is also missing one — so neither side may be empty."""
    rows = [["Acme", "", "https://jobs.example/a", "2026-08-01"]]
    assert _mark_applied(rows, set(), {("acme", "")}) == (0, 0)
    assert rows[0][APPLIED] == ""


def test_the_apply_form_and_the_posting_it_belongs_to_are_one_link() -> None:
    """Simplify links Ashby's /application and Lever's /apply; the other trackers
    link the posting a segment above. Two Replit rows in the sheet were this."""
    posting = "https://jobs.ashbyhq.com/replit/7e0dafe8-3eec-442e-aa76-a4d84d779fb1"
    form = posting + "/application?embed=true&utm_source=Simplify&ref=Simplify"
    assert normalize_link(form) == normalize_link(posting)
    lever = "https://jobs.lever.co/belvederetrading/10746b3d"
    assert normalize_link(lever + "/apply") == normalize_link(lever)


def test_a_path_that_is_only_an_apply_segment_is_left_alone() -> None:
    """Stripping the segment must not empty the path of a URL that is nothing else."""
    assert normalize_link("https://example.com/apply") == "https://example.com/apply"


def test_greenhouse_repeating_the_id_in_the_query_is_not_a_second_posting() -> None:
    """gh_jid names the posting only where the path does not; Greenhouse writes it
    in both, and the copy is what made one SpaceX role look like two."""
    bare = "https://boards.greenhouse.io/spacex/jobs/8621757002"
    assert normalize_link(bare + "?gh_jid=8621757002") == normalize_link(bare)


def test_gh_jid_still_survives_where_the_path_does_not_carry_it() -> None:
    """The embedded Greenhouse form has no id in the path, so dropping gh_jid there
    would collapse every posting on that board into one row."""
    embedded = "https://boards.greenhouse.io/embed/job_app?for=acme&gh_jid="
    assert normalize_link(embedded + "111") != normalize_link(embedded + "222")


def test_engineer_and_engineering_are_one_role() -> None:
    assert role_key("Software Engineer Intern") == role_key("Software Engineering Intern")
    assert role_key("Software Development Intern") == role_key("Software Developer Intern")


def test_the_intake_stays_part_of_the_role_for_the_sheet() -> None:
    """Notion runs a Summer and a Winter posting. Merging them would delete an
    opening that is genuinely still to be applied to."""
    assert role_key("SWE Intern (Summer 2027)") != role_key("SWE Intern (Winter 2027)")


def test_two_intakes_are_not_merged_out_of_the_sheet() -> None:
    rows = [
        ["Notion", "Software Engineer Intern (Summer 2027)", "https://a.example/1", "2026-08-01"],
        ["Notion", "Software Engineer Intern (Winter 2027)", "https://a.example/2", "2026-08-02"],
    ]
    unique, removed = _drop_duplicate_identities(rows)
    assert removed == 0
    assert len(unique) == 2


def test_the_tracker_and_the_sheet_may_write_the_role_in_any_order() -> None:
    """Virtu: the App tab says "2027 Internship - Software Engineer" and the Jobs
    row says "Software Engineer Intern". Word order is the last thing they agree on."""
    assert role_tokens("2027 Internship - Software Engineer") == role_tokens(
        "Software Engineer Intern"
    )


def test_a_role_with_a_word_the_other_lacks_is_a_different_job() -> None:
    """The loose reading is unordered, not indiscriminate."""
    assert role_tokens("Frontend Developer Internship") != role_tokens("Software Engineer Intern")


def test_the_virtu_row_is_ticked_from_the_tracker() -> None:
    rows = [["Virtu Financial", "Software Engineer Intern - Software Engineer", "https://v/1", "x"]]
    tracked = {_loose_identity("Virtu Financial", "2027 Internship - Software Engineer")}
    assert _mark_applied(rows, set(), tracked) == (0, 1)
    assert rows[0][APPLIED] == "TRUE"


def test_a_ticked_row_sinks_below_everything_still_to_do() -> None:
    """The point of the checkbox is that what is left unticked is the work, so the
    top of the sheet has to be exactly that list."""
    rows = [
        _row("Applied", "2026-08-09", "TRUE", "FALSE"),
        _row("Open", "2026-08-01", "FALSE", "FALSE"),
        _row("Expired", "2026-08-08", "FALSE", "TRUE"),
        _row("Newer", "2026-08-02", "FALSE", "FALSE"),
    ]
    assert [row[0] for row in _sorted_rows(rows)] == ["Newer", "Open", "Applied", "Expired"]


def test_the_date_order_survives_inside_each_half() -> None:
    rows = [
        _row("OldOpen", "2026-08-01", "FALSE"),
        _row("NewDone", "2026-08-09", "TRUE"),
        _row("NewOpen", "2026-08-05", "FALSE"),
        _row("OldDone", "2026-08-02", "TRUE"),
    ]
    assert [row[0] for row in _sorted_rows(rows)] == ["NewOpen", "OldOpen", "NewDone", "OldDone"]


def test_a_row_with_no_checkbox_column_yet_counts_as_still_to_do() -> None:
    """A newly crawled row arrives four cells wide, and it is certainly not done."""
    rows = [
        _row("Done", "2026-08-09", "TRUE"),
        ["Fresh", "SWE Intern", "https://x/1", "2026-08-01"],
    ]
    assert [row[0] for row in _sorted_rows(rows)] == ["Fresh", "Done"]


def test_a_row_carrying_both_ticks_sinks_once() -> None:
    rows = [_row("Both", "2026-08-09", "TRUE", "TRUE"), _row("Open", "2026-08-01", "FALSE")]
    assert [row[0] for row in _sorted_rows(rows)] == ["Open", "Both"]


def test_a_row_holding_only_a_checkbox_is_not_a_job() -> None:
    """Validation covers the checkbox pair whether or not a job is on the row, and a cleared
    checkbox reads back as FALSE — so A:Z returns every row down to 500."""
    rows = [
        _row("Acme", "2026-08-01", "FALSE", "FALSE"),
        ["", "", "", "", "", "FALSE", "FALSE"],
        ["", "", "", "", "", "FALSE", "FALSE"],
    ]
    live, dropped = _drop_empty_rows(rows)
    assert [row[0] for row in live] == ["Acme"]
    assert dropped == 2


def test_a_job_missing_only_its_date_is_still_a_job() -> None:
    """Emptiness is judged across all the owned columns, not on any one of them."""
    live, dropped = _drop_empty_rows([["Acme", "SWE Intern", "https://x/1", ""]])
    assert dropped == 0
    assert len(live) == 1


def test_the_settled_rows_end_up_last_with_nothing_after_them() -> None:
    """The gap this closes: blank rows sorted as work still to do with no date, so
    they sat between the open jobs and the settled ones."""
    rows = [
        _row("Done", "2026-08-17", "TRUE", "FALSE"),
        ["", "", "", "", "", "FALSE", "FALSE"],
        _row("Open", "2026-08-18", "FALSE", "FALSE"),
    ]
    live, _ = _drop_empty_rows(rows)
    assert [row[0] for row in _sorted_rows(live)] == ["Open", "Done"]


def test_a_blank_row_divides_the_two_halves() -> None:
    rows = [
        _row("Open", "2026-08-18", "FALSE", "FALSE"),
        _row("Done", "2026-08-17", "TRUE", "FALSE"),
    ]
    laid_out, separator = _divided(_sorted_rows(rows))
    assert [row[0] for row in laid_out] == ["Open", "", "Done"]
    # Row 1 is the header, one open row follows, so the divider is row 3.
    assert separator == 3


def test_nothing_to_divide_gets_no_divider() -> None:
    """A sheet with only open rows, or only settled ones, must not grow a stray
    blank line at one end of it."""
    open_only = [_row("A", "2026-08-02", "FALSE"), _row("B", "2026-08-01", "FALSE")]
    done_only = [_row("A", "2026-08-02", "TRUE"), _row("B", "2026-08-01", "TRUE")]
    for rows in (open_only, done_only):
        laid_out, separator = _divided(_sorted_rows(rows))
        assert separator == 0
        assert len(laid_out) == 2


def test_the_divider_is_as_wide_as_the_sheet() -> None:
    """A short row would leave the cells beside it holding whatever sat there before
    the sort moved everything up."""
    rows = [
        _row("Open", "2026-08-18", "FALSE", "FALSE", "a note"),
        _row("Done", "2026-08-17", "TRUE"),
    ]
    laid_out, _ = _divided(_sorted_rows(rows))
    assert laid_out[1] == [""] * 8


def test_the_divider_is_dropped_when_the_sheet_is_read_back() -> None:
    """It holds nothing, so it comes back as one more checkbox-only row and is
    rebuilt from scratch — which is what keeps it in place as the halves resize."""
    laid_out, _ = _divided(
        _sorted_rows([_row("Open", "2026-08-18", "FALSE"), _row("Done", "2026-08-17", "TRUE")])
    )
    live, dropped = _drop_empty_rows(laid_out)
    assert dropped == 1
    assert [row[0] for row in live] == ["Open", "Done"]


def test_a_layout_already_on_the_sheet_is_not_written_again() -> None:
    """The API drops trailing blank cells from every row it returns. Without
    allowing for that, an unchanged sheet reads as changed and gets rewritten five
    times a day; a padded note column is enough to trigger it."""
    written = [["Acme", "SWE Intern", "https://x/1", "2026-08-01", "FALSE", "FALSE", ""]]
    as_read = [["Acme", "SWE Intern", "https://x/1", "2026-08-01", "FALSE", "FALSE"]]
    assert _trimmed(written) == _trimmed(as_read)


def test_the_divider_written_and_the_divider_read_back_are_the_same_row() -> None:
    """It goes out as seven blanks and comes back as nothing at all."""
    assert _trimmed([[""] * 7]) == _trimmed([[]])


def test_a_real_change_still_reads_as_a_change() -> None:
    """The trimming must not be so eager that it hides a row that actually moved."""
    before = [["Acme", "SWE Intern", "https://x/1", "2026-08-01", "FALSE"]]
    after = [["Acme", "SWE Intern", "https://x/1", "2026-08-01", "TRUE"]]
    assert _trimmed(before) != _trimmed(after)


def test_the_caption_sits_one_past_the_expired_checkbox() -> None:
    """H1, and nothing about H1 is arbitrary. Every column past Expired is read as
    an operator's note, so the caption has to start exactly where the notes do or it
    would land on a checkbox; and it has to be row 1 or it would be a note."""
    assert STAMP == EXPIRED + 1
    assert chr(ord("A") + STAMP) == "H"


def test_the_caption_is_text_a_sheet_will_not_read_as_a_date() -> None:
    """It goes out through USER_ENTERED with the rest of the columns past E, which
    parses what it can. A caption that led with the digits would come back a date
    serial and the next run would compare against a number."""
    assert _stamp().startswith("Last updated: ")


def test_a_sheet_whose_only_difference_is_the_caption_reads_as_unchanged() -> None:
    """The whole point of blanking it. The caption differs on every run by
    construction, so a comparison that counted it would rewrite every row of the
    tab, seventeen times a day, to record that nothing had happened."""
    before = HEADERS + ["Applied", "Expired", "Last updated: 09:00 ET, 27 Aug 2026"]
    after = HEADERS + ["Applied", "Expired", "Last updated: 12:45 ET, 27 Aug 2026"]
    assert _trimmed([_unstamped(before)]) == _trimmed([_unstamped(after)])


def test_a_real_change_under_a_new_caption_still_reads_as_a_change() -> None:
    """Blanking the caption must not blank the run's judgement with it."""
    head = HEADERS + ["Applied", "Expired", "Last updated: 09:00 ET, 27 Aug 2026"]
    moved = HEADERS + ["Applied", "Expired", "Last updated: 12:45 ET, 27 Aug 2026"]
    row = ["Acme", "SWE Intern", "https://x/1", "2026-08-01", "ashby", "FALSE", "FALSE"]
    assert _trimmed([_unstamped(head), row]) != _trimmed(
        [_unstamped(moved), row[:5] + ["TRUE", "FALSE"]]
    )


def test_a_job_row_is_never_touched_by_the_caption() -> None:
    """A data row stops at the checkboxes, or carries a note of the operator's in H.
    Neither is the header, and blanking H on one would eat that note."""
    short = ["Acme", "SWE Intern", "https://x/1", "2026-08-01", "ashby", "FALSE", "FALSE"]
    assert _unstamped(short) is short


def test_the_history_reads_from_the_bottom_line() -> None:
    assert _last_stage("Applied: Jul 21, 2026\nOA: Aug 1, 2026") == "oa"


def test_completed_oa_is_read_as_its_own_stage() -> None:
    # "OA" is a prefix of "Completed OA", and the split is on the colon rather than
    # on the words, so the longer name survives whole. The audit compares this
    # against Process: read loosely, a finished assessment would report as UNLOGGED
    # on every row that has one.
    assert _last_stage("Applied: Jul 21, 2026\nOA: Aug 1, 2026\nCompleted OA: Aug 9, 2026") == (
        "completed oa"
    )
    assert "completed oa" in PROCESS_STAGES


def test_a_hand_written_note_between_stages_is_stepped_over() -> None:
    # The cell is free text. A line that names no stage says nothing about where
    # the application stands, so the reading has to look past it rather than stop.
    #
    # The note is in Vietnamese on purpose, and stays that way even though the rest
    # of this repo is English: it is what the operator actually types into the cell.
    # A note the reader cannot parse is exactly the case worth pinning.
    assert _last_stage("Applied: Jul 21, 2026\nnhắc HR ngày 3/8\nOffer: ?") == "offer"


def test_a_stage_with_no_date_yet_still_counts_as_reached() -> None:
    # What the backfill writes for a stage whose date was never recorded. It is
    # the stage that has to match Process; the date is a blank to fill in by hand.
    assert _last_stage("Applied: Jul 21, 2026\nRejected: ?") == "rejected"


def test_an_empty_update_column_names_no_stage() -> None:
    # Second case: a cell holding only an operator's note, in the language they
    # write notes in. It names no stage, so it names no stage.
    assert _last_stage("") == ""
    assert _last_stage("chưa nghe gì") == ""


def test_a_row_the_boards_place_abroad_leaves_the_sheet() -> None:
    """It was written before there was a location filter. Nothing in the sheet can
    tell — the Jobs tab has no location column — so the verdict is carried in from
    the crawl and matched on the same normalised link the dedupe uses."""
    rows = [
        ["Acme", "SWE Intern", "https://jobs.ashbyhq.com/acme/berlin", "2026-08-01"],
        ["Acme", "SWE Intern", "https://jobs.ashbyhq.com/acme/austin", "2026-08-01"],
    ]
    kept, dropped = _drop_foreign_rows(rows, {"https://jobs.ashbyhq.com/acme/berlin"})
    assert dropped == 1
    assert [row[2] for row in kept] == ["https://jobs.ashbyhq.com/acme/austin"]


def test_a_row_you_have_written_on_is_not_taken_away_from_you() -> None:
    """Ticking Applied on a job in London is a decision. This has no business
    overruling it, on the same rule that makes a note in column G stop the
    auto-tick."""
    rows = [
        ["Acme", "SWE Intern", "https://jobs.ashbyhq.com/acme/berlin", "2026-08-01", "", "TRUE"]
    ]
    kept, dropped = _drop_foreign_rows(rows, {"https://jobs.ashbyhq.com/acme/berlin"})
    assert (dropped, len(kept)) == (0, 1)


def test_nothing_to_drop_costs_nothing() -> None:
    rows = [["Acme", "SWE Intern", "https://x/1", "2026-08-01"]]
    assert _drop_foreign_rows(rows, set()) == (rows, 0)


def test_a_row_written_before_the_column_existed_gets_its_source_back() -> None:
    """The migration leaves the cell empty and the link is all that is left to
    recover it from — which is exactly what the crawl can still answer."""
    rows = [_row("Acme", "2026-08-01"), _row("Beta", "2026-08-02")]
    filled = _fill_source(rows, {_key(rows[0]): "Simplify"})
    assert filled == 1
    assert rows[0][SOURCE] == "Simplify"
    assert rows[1][SOURCE] == ""


def test_where_a_row_was_first_seen_is_not_rewritten() -> None:
    """Two trackers carry one posting. Restating the source every run would make
    the column flicker between their names for a row that never changed."""
    rows = [_row("Acme", "2026-08-01", source="Jobright")]
    assert _fill_source(rows, {_key(rows[0]): "Greenhouse"}) == 0
    assert rows[0][SOURCE] == "Jobright"


def test_filling_the_source_squares_off_a_short_row() -> None:
    """The API drops trailing blanks, so a row with no source and no ticks comes
    back four cells wide and has nowhere to put the answer."""
    rows = [["Acme", "SWE Intern", "https://jobs.example/Acme", "2026-08-01"]]
    _fill_source(rows, {})
    assert len(rows[0]) == len(HEADERS)


def test_the_layout_is_read_off_the_header_row() -> None:
    assert _layout(HEADERS + ["Applied", "Expired"]) == "done"
    assert _layout(HEADERS[:4] + ["Applied", "Expired"]) == "old"


def test_a_column_inserted_but_never_named_is_finished_rather_than_repeated() -> None:
    """The state the first migration actually left behind: E blank because a header
    cell inserted into row 1 arrives empty. Inserting again would shift the
    checkboxes a second time and leave two orphan columns."""
    assert _layout(HEADERS[:4] + ["", "Applied", "Expired"]) == "half"


def test_an_unrecognised_fifth_column_is_left_alone() -> None:
    """Inserting a column into a sheet whose shape is not understood would move
    somebody's checkboxes away from the rows they were ticked on."""
    assert _layout(HEADERS[:4] + ["Notes"]) == "unknown"
    assert _layout(HEADERS[:4]) == "unknown"


def test_a_checkbox_that_reached_the_source_column_does_not_look_like_a_source() -> None:
    """FALSE is what a checkbox rule writes into every cell it covers. Reading it
    as a source already recorded is what made the first migration fill 33 rows of
    330."""
    rows = [_row("Acme", "2026-08-01", source="FALSE")]
    assert _fill_source(rows, {_key(rows[0]): "Simplify"}) == 1
    assert rows[0][SOURCE] == "Simplify"


def test_the_update_column_sits_one_past_the_recruiter_checkbox() -> None:
    """These three columns are described from two files, and they drifted once
    already. Alumni and recruiter used to be background colours on the row rather
    than columns of their own; turning them into checkboxes moved Update from J to
    K, and the Python constant stayed at J. audit_app then read the Recruiter
    checkbox as the stage history and reported every staged row UNLOGGED.

    Whatever gets inserted next, this is the relationship that has to hold — and it
    is now asserted as a relationship rather than as three numbers, because the
    numbers are exactly what the Official migration changes. Pinning them here
    would mean the .gs and this file had to land in the same commit, which they
    cannot: the Python ships on the next cron run and the .gs only when somebody
    pastes it. A test that fails for the whole width of that window is a test that
    gets deleted.

    The Python half no longer holds a number to compare against at all — it reads
    row 1 — so what is checked is that the Apps Script still writes these three
    headers, still in this order, still side by side, under the names the Python
    looks them up by."""
    from job_sync.highlight import APP_HEADERS

    script = Path("apps_script/sync_applied_to_app.gs").read_text(encoding="utf-8")
    columns = {}
    for name in ("ALUMNI_COL", "RECRUITER_COL", "UPDATE_COL"):
        found = re.search(rf"\b{name} = (\d+)\b", script)
        assert found, name
        columns[name] = int(found.group(1))
    assert columns["RECRUITER_COL"] == columns["ALUMNI_COL"] + 1
    assert columns["UPDATE_COL"] == columns["RECRUITER_COL"] + 1
    # The names, not the numbers, are what the Python matches on now, so the script
    # writing a different word into any of these three is the breakage to catch.
    for name, header in (
        ("ALUMNI_COL", APP_HEADERS[0]),
        ("RECRUITER_COL", APP_HEADERS[1]),
        ("UPDATE_COL", APP_UPDATE_HEADER),
    ):
        assert re.search(rf"getRange\(1, {name}\)\.setValue\('{header}'\)", script), header


def test_a_jobright_repost_under_a_new_link_does_not_return_as_work() -> None:
    """Jobright republishes the same posting the next day under a fresh
    jobright.ai/jobs/info/<id>. The link layer cannot see that: the two URLs
    normalize to different keys, so `known` treats the repost as a job never seen
    before and appends it.

    The identity layer is what has to catch it, and _preference is what decides
    which copy survives — the ticked one, carrying the application already sent.
    Without this the sheet grows one unticked row per repost for a job already
    applied to, which is the single failure the Applied column exists to prevent."""
    role = "Software Engineering Intern (2027 Start) - Winter"
    applied = ["Databricks", role, "https://jobright.ai/jobs/info/aaa111", "2026-08-20", "", "TRUE"]
    repost = ["Databricks", role, "https://jobright.ai/jobs/info/bbb222", "2026-08-21", "", ""]
    assert _key(applied) != _key(repost), "the repost really does carry a different link"

    unique, removed = _drop_duplicate_identities([applied, repost])
    assert removed == 1
    assert unique == [applied], "the ticked copy is the one that stays"


@pytest.mark.parametrize(
    "reworded",
    [
        "Software Engineer Intern (2027 Start) - Winter",
        "Software Engineering Intern (2027 Start) — Winter",
        "Software Engineering Intern (2027 Start), Winter",
        "Software Engineering Intern (2027 Start) - Winter ",
    ],
)
def test_a_repost_that_rewords_the_title_is_still_one_posting(reworded: str) -> None:
    """A repost is rarely byte-identical. role_key folds away the punctuation, the
    trailing space and the engineer/engineering swap, so all of these still merge.

    What it will not fold is a word appearing or disappearing — "2027 Software
    Engineering Intern - Winter" drops "Start" and becomes a different identity.
    That is deliberate: merging here deletes an opening, so the strict reading is
    the safe one, and _mark_applied's looser reading against the App tab is the
    second net under it."""
    role = "Software Engineering Intern (2027 Start) - Winter"
    applied = ["Databricks", role, "https://jobright.ai/jobs/info/aaa111", "2026-08-20", "", "TRUE"]
    repost = ["Databricks", reworded, "https://jobright.ai/jobs/info/bbb222", "2026-08-21", "", ""]
    unique, removed = _drop_duplicate_identities([applied, repost])
    assert removed == 1, f"{reworded!r} should merge into the row already ticked"
    assert unique == [applied]


def test_the_app_tab_catches_a_repost_the_identity_layer_missed() -> None:
    """The second net. When a repost reworks the title enough to survive the merge,
    it lands as a new unticked row — and _mark_applied then reads the App tab by
    company and role tokens, which tolerates the reordering that role_key will not.

    So the repost still does not present itself as work: it arrives ticked."""
    role = "Software Engineering Intern (Winter 2027 Start)"
    repost = ["Databricks", role, "https://jobright.ai/jobs/info/bbb222", "2026-08-21", "", ""]
    sent = {_loose_identity("Databricks", "Software Engineering Intern (2027 Start) - Winter")}

    by_link, by_name = _mark_applied([repost], set(), sent)
    assert (by_link, by_name) == (0, 1)
    assert repost[APPLIED] == "TRUE"


def _dead(monkeypatch, gone: set[str]) -> list[list[str]]:
    """Stand in for the liveness check, recording which links it was asked about."""
    asked: list[list[str]] = []

    def fake(urls: list[str]) -> set[str]:
        asked.append(list(urls))
        return {url for url in urls if url in gone}

    monkeypatch.setattr("job_sync.sheet.dead_links", fake)
    return asked


def test_a_row_ticked_expired_survives_the_board_taking_the_posting_down(monkeypatch) -> None:
    """The bug this pins cost the sheet its memory.

    Ticking Expired and the board removing the posting are the same event seen
    from two sides, so the liveness check used to delete the tombstone at exactly
    the moment it began to matter. With the row gone its link left `known`, and the
    next repost arrived as fresh unticked work — the job reappearing the morning
    after it was dismissed, which is the one thing Expired exists to prevent."""
    link = "https://jobright.ai/jobs/info/aaa111"
    expired = ["Databricks", "SWE Intern", link, "2026-08-20", "Jobright", "", "TRUE"]
    _dead(monkeypatch, {link})

    live, dropped = _drop_dead_rows([expired])
    assert dropped == 0
    assert live == [expired]


def test_a_row_ticked_applied_survives_it_too(monkeypatch) -> None:
    """Same protection, weaker consequence: an applied row deleted here would be
    ticked again next run from the App tab. Expired has no such second net, which
    is why the rule is written once and covers both."""
    link = "https://jobs.example/acme"
    applied = ["Acme", "SWE Intern", link, "2026-08-20", "Simplify", "TRUE", ""]
    _dead(monkeypatch, {link})

    live, dropped = _drop_dead_rows([applied])
    assert (dropped, live) == (0, [applied])


def test_an_unticked_row_whose_posting_is_gone_still_leaves(monkeypatch) -> None:
    """The protection must not turn the check off. A row nobody has touched is
    what it was written for."""
    gone = "https://jobs.example/gone"
    stale = ["Acme", "SWE Intern", gone, "2026-08-20", "Simplify", "", ""]
    open_ = ["Beta", "SWE Intern", "https://jobs.example/open", "2026-08-20", "Simplify", "", ""]
    _dead(monkeypatch, {gone})

    live, dropped = _drop_dead_rows([stale, open_])
    assert dropped == 1
    assert live == [open_]


def test_a_settled_row_is_never_even_asked_about(monkeypatch) -> None:
    """Liveness is the one step that costs a request per row. Every settled row is
    a request that no longer has to be made, so the saving is real and not a side
    effect worth losing later."""
    settled = ["Acme", "SWE Intern", "https://jobs.example/a", "2026-08-20", "S", "", "TRUE"]
    pending = ["Beta", "SWE Intern", "https://jobs.example/b", "2026-08-20", "S", "", ""]
    asked = _dead(monkeypatch, set())

    _drop_dead_rows([settled, pending])
    assert asked == [["https://jobs.example/b"]]


def test_a_note_protects_a_row_from_the_liveness_check_as_well(monkeypatch) -> None:
    """Column H is the manual override everywhere else in this file, and it has to
    mean the same thing here: write anything and the tool stops touching the row."""
    link = "https://jobs.example/acme"
    noted = ["Acme", "SWE Intern", link, "2026-08-20", "Simplify", "", "", "waiting on referral"]
    _dead(monkeypatch, {link})

    live, dropped = _drop_dead_rows([noted])
    assert (dropped, live) == (0, [noted])


APP_BEFORE = [
    "Property",
    "Company",
    "Application Link",
    "Date Applied",
    "Location (State)",
    "Process",
    "Role",
    "Note",
    "Alumni",
    "Recruiter",
    "Update",
]
# What the Apps Script migration leaves behind: Official at position 9, holding a
# URL pasted by hand, with Alumni, Recruiter and Update each one to the right.
APP_AFTER = APP_BEFORE[:8] + ["Official"] + APP_BEFORE[8:]


def test_every_app_column_this_tool_reads_survives_the_official_insert() -> None:
    """The columns audit_app and the applied check work from, before and after,
    with no release in between. Only Update actually moves — but it moves out of
    the old A:K read, which is what made the last insert report every staged row
    UNLOGGED, and the point of reading row 1 is that nobody has to work out which
    of these move and which do not."""
    wanted = (
        APP_COMPANY_HEADER,
        APP_LINK_HEADER,
        APP_PROCESS_HEADER,
        APP_ROLE_HEADER,
        APP_UPDATE_HEADER,
    )
    assert app_columns(APP_BEFORE, *wanted) == (1, 2, 5, 6, 10)
    assert app_columns(APP_AFTER, *wanted) == (1, 2, 5, 6, 11), "Update is column L now"


def test_the_columns_come_back_in_the_order_they_were_asked_for() -> None:
    """They are unpacked positionally at every call site, so the order is the whole
    contract. Returning them in sheet order would silently swap Company and Link."""
    assert app_columns(APP_BEFORE, "Role", "Company") == (6, 1)


def test_the_required_fields_are_all_found_on_both_layouts() -> None:
    """APP_FIELDS names the columns and finds them from the same tuple, so a MISSING
    finding can never be reported against a column read from somewhere else."""
    assert app_columns(APP_BEFORE, *APP_FIELDS) == (0, 1, 2, 3, 5, 6)
    assert app_columns(APP_AFTER, *APP_FIELDS) == (0, 1, 2, 3, 5, 6)


def test_official_is_not_something_a_row_can_be_missing() -> None:
    """It is pasted by hand days after the row is written. Requiring it would report
    every fresh application as MISSING, which is how a real finding gets ignored."""
    assert "Official" not in APP_FIELDS


def test_a_header_that_is_not_there_is_named_rather_than_guessed_at() -> None:
    """There is always a column at that index and it always holds something, so a
    fallback would look like it worked. Every missing name is collected first, so a
    tab nobody has set up says so once instead of one header per run."""
    with pytest.raises(AppLayoutError) as refused:
        app_columns(["Property", "Company"], "Company", "Alumni", "Recruiter")
    named = str(refused.value).partition(";")[0]
    assert "'Alumni'" in named and "'Recruiter'" in named
    assert "'Company'" not in named


def test_an_empty_tab_is_a_refusal_that_says_so() -> None:
    """Row 1 of nothing is not row 1 of the old layout."""
    with pytest.raises(AppLayoutError) as refused:
        app_columns([], "Company")
    assert "(nothing)" in str(refused.value)


@pytest.mark.parametrize("spelling", ["Company", " Company ", "company", "COMPANY\t", "\nCompany"])
def test_case_and_surrounding_space_do_not_make_it_a_different_column(spelling: str) -> None:
    """A header retyped by hand is the same column to everyone looking at the sheet.
    Refusing over it would make the refusal look like noise."""
    assert app_columns([spelling], "Company") == (0,)


@pytest.mark.parametrize(
    "other", ["Company Notes", "Companies", "Compan", "Old Company", "Com pany"]
)
def test_a_longer_header_is_never_taken_for_the_one_it_starts_with(other: str) -> None:
    """Matching on the whole reduced string, not a prefix. "Alumni Notes" beside the
    Alumni checkbox is the likeliest next edit to this tab, and a prefix match would
    write booleans down it — the hardcoded-index corruption from the other side."""
    with pytest.raises(AppLayoutError):
        app_columns([other], "Company")


def test_the_first_of_two_identical_headers_wins() -> None:
    """A duplicate is a mistake in the sheet, and the leftmost is the one the Apps
    Script writes to and reads back."""
    assert app_columns(["Company", "Role", "Company"], "Company") == (0,)


def test_every_read_of_the_app_tab_asks_for_the_whole_tab() -> None:
    """A1 with no column letters. A width is a second claim about the layout beside
    the one row 1 makes: App!A:K was the full span until Official was inserted, and
    a header outside the range cannot be told apart from one that was never written
    — so a range one column short turns into a refusal for a reason that is untrue."""
    assert _whole_tab("App") == "'App'"
    assert "!" not in _whole_tab("App")
    assert _whole_tab("Job and Update") == "'Job and Update'"


@pytest.mark.parametrize(
    ("index", "letters"),
    [(0, "A"), (8, "I"), (9, "J"), (10, "K"), (25, "Z"), (26, "AA"), (27, "AB")],
)
def test_a_column_past_z_still_names_itself(index: int, letters: str) -> None:
    """The index handed to this is read out of row 1 now rather than counted out by
    hand, so nothing bounds it at 26 any more. One letter returned "[" past Z — a
    range the API rejects, complaining about a bracket instead of about the column
    that moved."""
    assert _column(index) == letters
