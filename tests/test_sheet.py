from job_sync.config import Settings
from job_sync.sheet import (
    APPLIED,
    EXPIRED,
    HEADERS,
    _census,
    _drop_blocked_rows,
    _drop_duplicate_identities,
    _key,
    _loose_identity,
    _mark_applied,
    _quote_tab,
    _sorted_rows,
    _write,
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
        ["Acme", "SWE Intern", JOBRIGHT, "2026-08-01", "applied"],
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
        ["Acme", "SWE Intern", JOBRIGHT, "2026-08-01", "TRUE"],
        ["Acme", "SWE Intern", GREENHOUSE, "2026-08-02", "FALSE"],
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
    assert [(cells, parse) for cells, parse, _ in api.updates] == [("'Jobs'!A1:D2", "RAW")]


def test_the_checkbox_column_is_written_where_sheets_will_parse_it() -> None:
    """RAW stores the string "TRUE" over the checkbox rather than ticking it, and
    the box would read back unticked on the next run."""
    api = _written([HEADERS + ["Applied"], _row("Acme", "2026-08-01", "TRUE")])
    assert [(cells, parse) for cells, parse, _ in api.updates] == [
        ("'Jobs'!A1:D2", "RAW"),
        ("'Jobs'!E1:E2", "USER_ENTERED"),
    ]
    assert api.updates[1][2] == [["Applied"], ["TRUE"]]


def test_the_iso_date_is_never_offered_to_the_value_parser() -> None:
    """USER_ENTERED across the whole row would turn Date Posted into a date serial,
    and _sort_key reads it as a string."""
    api = _written([HEADERS + ["Applied"], _row("Acme", "2026-08-01", "TRUE")])
    owned = next(rows for _, parse, rows in api.updates if parse == "RAW")
    assert owned[1] == ["Acme", "SWE Intern", "https://jobs.example/Acme", "2026-08-01"]


def test_a_row_appended_this_run_gets_an_empty_checkbox_cell() -> None:
    """A newly crawled row arrives four cells wide. Padding keeps the block
    rectangular, and an empty cell under checkbox validation is an unticked box."""
    api = _written(
        [HEADERS + ["Applied"], _row("Acme", "2026-08-02", "TRUE"), _row("Zeta", "2026-08-01")]
    )
    assert api.updates[1][2] == [["Applied"], ["TRUE"], [""]]


def test_the_tail_of_a_shortened_sheet_is_cleared_before_the_write() -> None:
    api = _written([HEADERS, _row("Acme", "2026-08-01")], clear_to_row=9)
    assert api.cleared == ["'Jobs'!A3:D9"]


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
