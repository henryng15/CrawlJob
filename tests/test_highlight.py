from job_sync.config import Settings
from job_sync.highlight import (
    HIGHLIGHT,
    PLAIN,
    RECRUITER,
    _boxes,
    _is,
    _mark_contacts,
    _requests,
    _runs,
    _state,
)


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


def _marked(held, alumni, recruiters, rows=3, heading=("Alumni", "Recruiter")):
    api = _FakeValues([list(heading)] + held)
    changed = _mark_contacts(api, _SETTINGS, rows, alumni, recruiters)
    return api, changed


def test_an_unticked_box_reads_the_same_however_the_sheet_spells_it() -> None:
    """Three spellings of one state: FALSE from a box that was never ticked,
    nothing from a row the validation has not reached, and a row the API cut short
    because its trailing cells were blank."""
    assert _boxes([["FALSE", "FALSE"], [], ["TRUE"]], 3) == [
        ["FALSE", "FALSE"],
        ["FALSE", "FALSE"],
        ["TRUE", "FALSE"],
    ]


def test_a_run_that_matches_what_the_sheet_says_writes_nothing() -> None:
    api, changed = _marked([["TRUE", "FALSE"], ["FALSE", "FALSE"], ["FALSE", "TRUE"]], {1}, {3})
    assert changed is False
    assert api.updates == []


def test_a_new_match_ticks_the_box_and_only_states_the_two_columns() -> None:
    api, changed = _marked([["FALSE", "FALSE"]] * 3, {2}, set())
    assert changed is True
    cells, parse, values = api.updates[0]
    assert (cells, parse) == ("'App'!I2:J4", "USER_ENTERED")
    assert values == [["FALSE", "FALSE"], ["TRUE", "FALSE"], ["FALSE", "FALSE"]]


def test_the_tool_unticks_what_no_longer_matches() -> None:
    """The columns are computed, not typed. An alumnus who has moved on has to
    stop showing up, which means a run states both answers rather than only the
    ones it found."""
    _, changed = _marked([["TRUE", "FALSE"]] * 3, set(), set())
    assert changed is True


def test_a_missing_source_leaves_its_column_exactly_as_it_stands() -> None:
    """A missing Alumni tab is not an empty one. Reading no matches out of a tab
    that is not there and writing that down would clear the column."""
    api, changed = _marked([["TRUE", "FALSE"], ["TRUE", "TRUE"], ["FALSE", "TRUE"]], None, None)
    assert changed is False
    assert api.updates == []


def test_one_missing_source_does_not_freeze_the_other_column() -> None:
    api, changed = _marked([["TRUE", "FALSE"]] * 3, None, {2})
    assert changed is True
    assert api.updates[0][2] == [["TRUE", "FALSE"], ["TRUE", "TRUE"], ["TRUE", "FALSE"]]


def test_a_tab_with_no_applications_is_not_written_to() -> None:
    api, changed = _marked([], set(), set(), rows=0)
    assert changed is False
    assert api.updates == []


def test_the_state_of_a_box_with_nothing_to_say_is_what_it_already_said() -> None:
    assert _state(None, 1, "TRUE") == "TRUE"
    assert _state(set(), 1, "TRUE") == "FALSE"
    assert _state({1}, 1, "FALSE") == "TRUE"


def test_nothing_is_written_until_the_two_headers_are_there() -> None:
    """The sync runs on a cron. Before setupAppColumns has run, column J still
    holds whatever it held before — for one day, the Update history — and writing
    FALSE down it on the assumption it is a checkbox would erase that."""
    api, changed = _marked([["FALSE", "FALSE"]] * 3, {1}, {2}, heading=("", "Update"))
    assert changed is False
    assert api.updates == []


def test_a_tab_that_has_never_had_the_columns_is_left_alone() -> None:
    api, changed = _marked([["FALSE", "FALSE"]] * 3, {1}, {2}, heading=())
    assert changed is False
    assert api.updates == []
