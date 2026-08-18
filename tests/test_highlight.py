from job_sync.highlight import HIGHLIGHT, PLAIN, RECRUITER, _is, _requests, _runs


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


def test_the_recruiter_mark_stays_inside_column_i() -> None:
    """Column I only. The row-wide alumni yellow owns A through H, and a mark that
    spilled over would fight it every run."""
    requests = _requests(sheet_id=7, matched={3}, painted=set(), columns=(8, 9), colour=RECRUITER)
    grid = requests[0]["repeatCell"]["range"]
    assert (grid["startColumnIndex"], grid["endColumnIndex"]) == (8, 9)
    assert _colour(requests[0]) == RECRUITER


def test_a_company_list_line_that_is_a_comment_is_not_a_company() -> None:
    from job_sync.highlight import RECRUITER_COMPANIES, recruiter_companies

    assert RECRUITER_COMPANIES.exists(), "data/recruiter_companies.txt is missing"
    companies = recruiter_companies()
    assert companies, "the recruiter list parsed to nothing"
    assert all(tokens for tokens in companies), "a blank or comment line became a company"
