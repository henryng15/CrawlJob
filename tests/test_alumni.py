from job_sync.alumni import HIGHLIGHT, PLAIN, _is_highlight, _requests, _runs


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
    assert _requests(sheet_id=7, matched={2, 3}, painted={2, 3}, width=6) == []


def test_a_row_that_stopped_matching_is_cleared() -> None:
    requests = _requests(sheet_id=7, matched=set(), painted={4}, width=6)
    assert [_colour(r) for r in requests] == [PLAIN]
    assert [_span(r) for r in requests] == [(4, 5)]


def test_a_new_match_is_painted_without_touching_the_rest() -> None:
    requests = _requests(sheet_id=7, matched={2, 5}, painted={2}, width=6)
    assert [(_span(r), _colour(r)) for r in requests] == [((5, 6), HIGHLIGHT)]


def test_clearing_and_painting_happen_in_one_pass() -> None:
    requests = _requests(sheet_id=7, matched={9}, painted={4}, width=8)
    assert [(_span(r), _colour(r)) for r in requests] == [((4, 5), PLAIN), ((9, 10), HIGHLIGHT)]


def test_only_the_tools_own_yellow_counts_as_painted() -> None:
    """Everything else on the tab is somebody's own mark, and a run that ate those
    could not be repeated safely."""
    assert _is_highlight(HIGHLIGHT)
    assert _is_highlight({"red": 1.0, "green": 0.8980392, "blue": 0.6})  # what Sheets returns
    assert not _is_highlight({"red": 0.85, "green": 0.92, "blue": 0.83})  # a green cell by hand
    assert not _is_highlight(None)
    assert not _is_highlight({})


def test_a_cell_sheets_reports_with_missing_channels_is_not_a_match() -> None:
    """Sheets omits a channel that is zero, so a bare red cell arrives as {"red": 1}."""
    assert not _is_highlight({"red": 1.0})
