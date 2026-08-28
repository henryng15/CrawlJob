import pytest

from job_sync.config import Settings
from job_sync.highlight import (
    APP_HEADERS,
    HIGHLIGHT,
    PLAIN,
    RECRUITER,
    _boxes,
    _checkbox,
    _checkbox_columns,
    _is,
    _mark_contacts,
    _requests,
    _runs,
    _state,
)
from job_sync.sheet import AppLayoutError


def _colour(request: dict) -> dict:
    return request["repeatCell"]["cell"]["userEnteredFormat"]["backgroundColor"]


def _span(request: dict) -> tuple[int, int]:
    grid = request["repeatCell"]["range"]
    return (grid["startRowIndex"], grid["endRowIndex"])


def test_consecutive_rows_become_one_request() -> None:
    """A directory of 349 rows with matches scattered through it must not turn into
    349 API requests."""
    assert _runs({1, 2, 3, 9, 20, 21}) == [(1, 4), (9, 10), (20, 22)]


def test_no_rows_is_no_requests() -> None:
    assert _runs(set()) == []


def test_a_row_already_the_right_colour_is_left_alone() -> None:
    """The sync runs five times a day. Repainting what is already painted would
    rewrite the whole tab's formatting every time for nothing."""
    assert (
        _requests(sheet_id=7, matched={2, 3}, painted={2, 3}, columns=(0, 6), colour=HIGHLIGHT)
        == []
    )


def test_a_row_that_stopped_matching_is_cleared() -> None:
    requests = _requests(sheet_id=7, matched=set(), painted={4}, columns=(0, 6), colour=HIGHLIGHT)
    assert [_colour(r) for r in requests] == [PLAIN]
    assert [_span(r) for r in requests] == [(4, 5)]


def test_a_new_match_is_painted_without_touching_the_rest() -> None:
    requests = _requests(sheet_id=7, matched={2, 5}, painted={2}, columns=(0, 6), colour=HIGHLIGHT)
    assert [(_span(r), _colour(r)) for r in requests] == [((5, 6), HIGHLIGHT)]


def test_clearing_and_painting_happen_in_one_pass() -> None:
    requests = _requests(sheet_id=7, matched={9}, painted={4}, columns=(0, 8), colour=HIGHLIGHT)
    assert [(_span(r), _colour(r)) for r in requests] == [((4, 5), PLAIN), ((9, 10), HIGHLIGHT)]


def test_only_the_tools_own_yellow_counts_as_painted() -> None:
    """Everything else on the tab is somebody's own mark, and a run that ate those
    could not be repeated safely."""
    assert _is(HIGHLIGHT, HIGHLIGHT)
    assert _is({"red": 1.0, "green": 0.8980392, "blue": 0.6}, HIGHLIGHT)  # what Sheets returns
    assert not _is({"red": 0.85, "green": 0.92, "blue": 0.83}, HIGHLIGHT)  # a green cell by hand
    assert not _is(None, HIGHLIGHT)
    assert not _is({}, HIGHLIGHT)


def test_a_cell_sheets_reports_with_missing_channels_is_not_a_match() -> None:
    """Sheets omits a channel that is zero, so a bare red cell arrives as {"red": 1}."""
    assert not _is({"red": 1.0}, HIGHLIGHT)


def test_the_two_marks_never_read_each_other_as_their_own_work() -> None:
    """Row-wide yellow probes column A, recruiter red probes column I. If either
    accepted the other's colour it would clear a mark it did not make."""
    assert not _is(RECRUITER, HIGHLIGHT)
    assert not _is(HIGHLIGHT, RECRUITER)


def test_the_old_recruiter_red_is_lifted_from_where_the_checkbox_now_sits() -> None:
    """Both App marks are checkboxes now, so the run matches nothing in colour and
    the red can only be cleared. It has to be: column I is the Alumni box today,
    and a checkbox on a red cell reads as a warning nobody wrote."""
    requests = _requests(sheet_id=7, matched=set(), painted={3}, columns=(8, 9), colour=RECRUITER)
    grid = requests[0]["repeatCell"]["range"]
    assert (grid["startColumnIndex"], grid["endColumnIndex"]) == (8, 9)
    assert _colour(requests[0]) == PLAIN


def test_a_company_list_line_that_is_a_comment_is_not_a_company() -> None:
    from job_sync.highlight import RECRUITER_COMPANIES, recruiter_companies

    assert RECRUITER_COMPANIES.exists(), "data/recruiter_companies.txt is missing"
    companies = recruiter_companies()
    assert companies, "the recruiter list parsed to nothing"
    assert all(tokens for tokens in companies), "a blank or comment line became a company"


class _Request:
    def execute(self) -> None:
        return None


class _FakeValues:
    """spreadsheets().values(), holding what the two checkbox columns already say."""

    def __init__(self, held: list[list[str]]) -> None:
        self.held = held
        self.updates: list[tuple[str, str, list[list[str]]]] = []

    def get(self, spreadsheetId: str, range: str):
        request = _Request()
        request.execute = lambda: {"values": self.held}  # type: ignore[method-assign]
        return request

    def update(self, spreadsheetId: str, range: str, valueInputOption: str, body: dict) -> _Request:
        self.updates.append((range, valueInputOption, body["values"]))
        return _Request()


_SETTINGS = Settings(
    sheet_id="sheet-1",
    sheet_tab="Jobs",
    app_tab="App",
    alumni_tab="Alumni",
    service_account_json="{}",
)


# The App tab as it stands, and as the Apps Script migration is about to leave it:
# Official is inserted at position 9 and pushes the two checkboxes to J and K.
BEFORE = [
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
AFTER = BEFORE[:8] + ["Official"] + BEFORE[8:]


def _marked(held, alumni, recruiters, rows=3, heading=BEFORE):
    """The two-column view each test writes, laid into a whole App row.

    `held` names the Alumni and Recruiter cells and nothing else; where those land
    is decided by the header, which is the entire point of every test below."""
    at = list(heading).index("Alumni") if "Alumni" in heading else 0
    api = _FakeValues([list(heading)] + [[""] * at + list(row) for row in held])
    return api, _mark_contacts(api, _SETTINGS, rows, alumni, recruiters)


def test_an_unticked_box_reads_the_same_however_the_sheet_spells_it() -> None:
    """Three spellings of one state: FALSE from a box that was never ticked,
    nothing from a row the validation has not reached, and a row the API cut short
    because its trailing cells were blank."""
    assert _boxes([["FALSE", "FALSE"], [], ["TRUE"]], 3, (0, 1)) == [
        ["FALSE", "FALSE"],
        ["FALSE", "FALSE"],
        ["TRUE", "FALSE"],
    ]


def test_a_run_that_matches_what_the_sheet_says_writes_nothing() -> None:
    api, ticks = _marked([["TRUE", "FALSE"], ["FALSE", "FALSE"], ["FALSE", "TRUE"]], {1}, {3})
    assert (ticks.ready, ticks.wrote) == (True, False)
    assert api.updates == []


def test_a_new_match_ticks_the_box_and_only_states_the_two_columns() -> None:
    api, ticks = _marked([["FALSE", "FALSE"]] * 3, {2}, set())
    assert ticks.wrote is True
    cells, parse, values = api.updates[0]
    assert (cells, parse) == ("'App'!I2:J4", "USER_ENTERED")
    assert values == [["FALSE", "FALSE"], ["TRUE", "FALSE"], ["FALSE", "FALSE"]]


def test_the_tool_unticks_what_no_longer_matches() -> None:
    """The columns are computed, not typed. An alumnus who has moved on has to
    stop showing up, which means a run states both answers rather than only the
    ones it found."""
    _, ticks = _marked([["TRUE", "FALSE"]] * 3, set(), set())
    assert ticks.wrote is True


def test_a_missing_source_leaves_its_column_exactly_as_it_stands() -> None:
    """A missing Alumni tab is not an empty one. Reading no matches out of a tab
    that is not there and writing that down would clear the column."""
    api, ticks = _marked([["TRUE", "FALSE"], ["TRUE", "TRUE"], ["FALSE", "TRUE"]], None, None)
    assert ticks.wrote is False
    assert api.updates == []


def test_one_missing_source_does_not_freeze_the_other_column() -> None:
    api, ticks = _marked([["TRUE", "FALSE"]] * 3, None, {2})
    assert ticks.wrote is True
    assert api.updates[0][2] == [["TRUE", "FALSE"], ["TRUE", "TRUE"], ["TRUE", "FALSE"]]


def test_a_tab_with_no_applications_is_not_written_to() -> None:
    api, ticks = _marked([], set(), set(), rows=0)
    assert ticks.wrote is False
    assert api.updates == []


def test_the_state_of_a_box_with_nothing_to_say_is_what_it_already_said() -> None:
    assert _state(None, 1, "TRUE") == "TRUE"
    assert _state(set(), 1, "TRUE") == "FALSE"
    assert _state({1}, 1, "FALSE") == "TRUE"


def test_nothing_is_written_until_the_two_headers_are_there() -> None:
    """The sync runs on a cron. Before setupAppColumns has run, column J still
    holds whatever it held before — for one day, the Update history — and writing
    FALSE down it on the assumption it is a checkbox would erase that."""
    api, ticks = _marked([["FALSE", "FALSE"]] * 3, {1}, {2}, heading=("", "Update"))
    assert (ticks.ready, ticks.wrote) == (False, False)
    assert api.updates == []


def test_a_tab_that_has_never_had_the_columns_is_left_alone() -> None:
    api, ticks = _marked([["FALSE", "FALSE"]] * 3, {1}, {2}, heading=())
    assert (ticks.ready, ticks.wrote) == (False, False)
    assert api.updates == []


def test_the_checkbox_rule_covers_exactly_the_rows_the_ticks_go_into() -> None:
    """The bare word FALSE is a boolean written past where the rule reaches. The
    rule is set from the same row count as the write so the two cannot part."""
    grid = _checkbox(sheet_id=7, rows=82, columns=(8, 9))["setDataValidation"]["range"]
    assert (grid["startRowIndex"], grid["endRowIndex"]) == (1, 83)
    assert (grid["startColumnIndex"], grid["endColumnIndex"]) == (8, 10)


def test_the_rule_is_a_checkbox_and_draws_one() -> None:
    rule = _checkbox(sheet_id=7, rows=1, columns=(8, 9))["setDataValidation"]["rule"]
    assert rule["condition"]["type"] == "BOOLEAN"
    assert rule["showCustomUi"] is True


def test_the_layout_the_tab_has_today_puts_the_ticks_in_i_and_j() -> None:
    """The sheet as it stands. Nothing about reading the header row is allowed to
    move a write that was landing correctly before any of this."""
    api, ticks = _marked([["FALSE", "FALSE"]] * 3, {2}, set())
    assert ticks.columns == (8, 9)
    assert api.updates[0][0] == "'App'!I2:J4"


def test_the_official_column_moves_the_ticks_to_j_and_k_on_its_own() -> None:
    """The failure this whole module was rewritten for. Official is inserted at
    position 9 and holds a URL pasted by hand; a run still holding 8 and 9 writes
    FALSE over every one of those URLs and ticks Alumni out of the Recruiter data.

    No Python release has to accompany the insert — the run reads row 1 and lands
    on J and K the first time it sees them there."""
    api, ticks = _marked([["FALSE", "FALSE"]] * 3, {2}, set(), heading=AFTER)
    assert ticks.columns == (9, 10), "Alumni and Recruiter are columns 10 and 11 now"
    cells, parse, values = api.updates[0]
    assert (cells, parse) == ("'App'!J2:K4", "USER_ENTERED")
    assert values == [["FALSE", "FALSE"], ["TRUE", "FALSE"], ["FALSE", "FALSE"]]


def test_what_was_pasted_into_official_is_never_read_as_a_checkbox() -> None:
    """The other half of the same failure: a run that found the columns must also
    not carry the column before them into the comparison. A URL in Official is not
    the word TRUE, so reading it as one would make every run look like it had work
    to do and rewrite both columns for ever."""
    held = [["https://careers.example.com/1", "TRUE", "FALSE"]] * 3
    at = AFTER.index("Official")
    api = _FakeValues([AFTER] + [[""] * at + row for row in held])
    ticks = _mark_contacts(api, _SETTINGS, 3, {1, 2, 3}, set())
    assert (ticks.ready, ticks.wrote) == (True, False)
    assert api.updates == []


def test_a_header_that_moved_is_found_and_one_that_is_missing_is_not_guessed() -> None:
    """A guess is always available here and always plausible, which is exactly why
    there is none. Column 9 holds something on every layout this tab has ever had."""
    assert _checkbox_columns(BEFORE) == (8, 9)
    assert _checkbox_columns(AFTER) == (9, 10)
    with pytest.raises(AppLayoutError) as refused:
        _checkbox_columns([column for column in AFTER if column != "Recruiter"])
    named, _, echoed = str(refused.value).partition(";")
    assert "'Recruiter'" in named, "the refusal has to say which header it wanted"
    assert "'Alumni'" not in named, "and not the ones it found"
    assert "'Official'" in echoed, "row 1 is quoted back so the sheet can be compared to it"


def test_an_empty_tab_names_both_headers_rather_than_reading_row_one_of_nothing() -> None:
    with pytest.raises(AppLayoutError) as refused:
        _checkbox_columns([])
    assert "'Alumni'" in str(refused.value) and "'Recruiter'" in str(refused.value)


def test_the_two_checkboxes_have_to_be_side_by_side() -> None:
    """Both are stated in one two-column write and covered by one validation rule.
    Separate them and that write lands on whatever ended up between them."""
    split = ["Alumni", "Note", "Recruiter"]
    with pytest.raises(AppLayoutError) as refused:
        _checkbox_columns(split)
    assert "side by side" in str(refused.value)


@pytest.mark.parametrize("spelling", ["Alumni", " Alumni ", "alumni", " ALUMNI\n", "\tAlumni"])
def test_a_header_retyped_by_hand_is_still_the_same_column(spelling: str) -> None:
    """Case and surrounding space are cosmetic. Stopping the sync over them would
    teach whoever runs it that the refusal is noise, which is how a fallback gets
    added back."""
    assert _checkbox_columns([spelling, "Recruiter"]) == (0, 1)


@pytest.mark.parametrize("other", ["Alumni Notes", "Alumni?", "Alum", "Ex-Alumni", "Alumni2"])
def test_a_different_word_is_a_different_column(other: str) -> None:
    """The likeliest next edit to this tab is somebody adding a notes column beside
    the checkbox. Matching it on a prefix would tick booleans down their notes —
    the same corruption the hardcoded index caused, reached from the other side."""
    with pytest.raises(AppLayoutError):
        _checkbox_columns([other, "Recruiter"])


def test_nothing_is_written_where_the_headers_cannot_be_found() -> None:
    """A refusal, not a fallback: the run says which header it could not find and
    leaves both columns exactly as they stand."""
    api, ticks = _marked([["TRUE", "FALSE"]] * 3, {1}, {2}, heading=["Property", "Company"])
    assert (ticks.ready, ticks.wrote, ticks.columns) == (False, False, None)
    assert api.updates == []


def test_the_checkbox_rule_follows_the_columns_the_ticks_were_written_to() -> None:
    """The rule and the write are laid over the same two indices, taken from the
    same reading of row 1. Two independent readings could straddle the migration
    and leave the rule one column from the booleans, which is the bare word FALSE
    all over again."""
    _, ticks = _marked([["FALSE", "FALSE"]] * 3, {1}, set(), heading=AFTER)
    grid = _checkbox(sheet_id=7, rows=3, columns=ticks.columns)["setDataValidation"]["range"]
    assert (grid["startColumnIndex"], grid["endColumnIndex"]) == (9, 11)


def test_the_two_headers_are_the_words_the_apps_script_writes() -> None:
    """Matching is on the whole word, so the Python and the .gs have to agree on it
    exactly — a rename on either side is a silent no-op on this one."""
    assert APP_HEADERS == ("Alumni", "Recruiter")
