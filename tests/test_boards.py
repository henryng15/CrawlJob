import json

from job_sync.boards import (
    EXTRA_FILE,
    BoardResult,
    _display,
    _in_country,
    extra_boards,
    harvest,
    load_boards,
    parse_board,
    split_board,
)


def test_greenhouse_dates_a_row_from_when_it_was_first_published() -> None:
    """Not updated_at. That moves whenever someone fixes a typo in the description,
    and the sheet sorts on this column — a corrected typo would jump a month-old
    posting back to the top of the list of things still to apply to."""
    payload = {
        "jobs": [
            {
                "title": "Software Engineer Intern",
                "company_name": "Moloco",
                "absolute_url": "https://job-boards.greenhouse.io/moloco/jobs/1",
                "first_published": "2026-08-05T00:24:02-04:00",
                "updated_at": "2026-08-12T14:35:22-04:00",
            }
        ]
    }
    (job,) = parse_board("greenhouse", "moloco", payload)
    assert (job.company, job.role, job.date_posted) == (
        "Moloco",
        "Software Engineer Intern",
        "2026-08-05",
    )


def test_greenhouse_falls_back_to_updated_at_when_never_published() -> None:
    payload = {
        "jobs": [
            {
                "title": "Software Engineer Intern",
                "absolute_url": "https://job-boards.greenhouse.io/acme/jobs/1",
                "first_published": None,
                "updated_at": "2026-08-12T14:35:22-04:00",
            }
        ]
    }
    (job,) = parse_board("greenhouse", "acme", payload)
    assert job.date_posted == "2026-08-12"
    # No company_name on the row, so the slug has to stand in for one.
    assert job.company == "Acme"


def test_lever_counts_milliseconds_not_seconds() -> None:
    payload = [
        {
            "text": "Software Engineering Intern",
            "hostedUrl": "https://jobs.lever.co/acme/abc",
            "createdAt": 1785888000000,
        }
    ]
    (job,) = parse_board("lever", "acme", payload)
    assert job.date_posted == "2026-08-05"


def test_lever_prefers_the_posting_over_the_form_hanging_off_it() -> None:
    payload = [
        {
            "text": "Software Engineer Intern",
            "hostedUrl": "https://jobs.lever.co/acme/abc",
            "applyUrl": "https://jobs.lever.co/acme/abc/apply",
            "createdAt": 1785888000000,
        }
    ]
    (job,) = parse_board("lever", "acme", payload)
    assert job.apply_link == "https://jobs.lever.co/acme/abc"


def test_an_unreadable_lever_date_leaves_the_column_empty_rather_than_wrong() -> None:
    payload = [
        {
            "text": "Software Engineer Intern",
            "hostedUrl": "https://jobs.lever.co/acme/abc",
            "createdAt": None,
        }
    ]
    (job,) = parse_board("lever", "acme", payload)
    assert job.date_posted == ""


def test_ashby_skips_a_posting_the_employer_has_unlisted() -> None:
    """isListed false is a role taken off the board but not deleted. Following it
    sends an application into a posting nobody is reading."""
    payload = {
        "jobs": [
            {
                "title": "Software Engineer Intern",
                "jobUrl": "https://jobs.ashbyhq.com/etched/1",
                "publishedAt": "2026-08-01T05:03:53.978+00:00",
                "isListed": False,
            },
            {
                "title": "Software Engineer Intern, Compilers",
                "jobUrl": "https://jobs.ashbyhq.com/etched/2",
                "publishedAt": "2026-08-02T05:03:53.978+00:00",
                "isListed": True,
            },
        ]
    }
    jobs = parse_board("ashby", "etched", payload)
    assert [job.apply_link for job in jobs] == ["https://jobs.ashbyhq.com/etched/2"]


def test_a_board_full_of_full_time_roles_yields_nothing() -> None:
    """These boards are every job the company has open, not an internship list.
    The role filter is what makes them a source rather than a firehose."""
    payload = {
        "jobs": [
            {
                "title": "Staff Software Engineer",
                "jobUrl": "https://x/1",
                "publishedAt": "2026-08-01",
            },
            {
                "title": "Recruiting Coordinator",
                "jobUrl": "https://x/2",
                "publishedAt": "2026-08-01",
            },
            {"title": "Marketing Intern", "jobUrl": "https://x/3", "publishedAt": "2026-08-01"},
        ]
    }
    assert parse_board("ashby", "acme", payload) == []


def test_a_posting_with_no_link_is_not_a_row() -> None:
    """A link is what dedupe, the liveness check and the Applied tick all key on.
    Without one there is nothing to write but a hole."""
    payload = {"jobs": [{"title": "Software Engineer Intern", "publishedAt": "2026-08-01"}]}
    assert parse_board("ashby", "acme", payload) == []


def test_a_payload_of_the_wrong_shape_is_not_an_exception() -> None:
    """Fifteen thousand boards means some of them answer with something else. One
    of those must cost a board, not the crawl."""
    assert parse_board("greenhouse", "acme", ["not", "a", "dict"]) == []
    assert parse_board("lever", "acme", {"unexpected": True}) == []


def test_a_role_outside_the_us_is_named_rather_than_merely_skipped() -> None:
    """The sheet has no location column, so a row already written cannot work out
    on its own that it should go. The board is the only thing that knows, and only
    while the posting is up — so the link comes back with the crawl."""
    payload = {
        "jobs": [
            {
                "title": "Software Engineer Intern",
                "jobUrl": "https://jobs.ashbyhq.com/acme/berlin",
                "publishedAt": "2026-08-01",
                "location": "Berlin",
            },
            {
                "title": "Software Engineer Intern",
                "jobUrl": "https://jobs.ashbyhq.com/acme/austin",
                "publishedAt": "2026-08-01",
                "location": "Austin, TX",
            },
        ]
    }
    keep, foreign = split_board("ashby", "acme", payload)
    assert [job.apply_link for job in keep] == ["https://jobs.ashbyhq.com/acme/austin"]
    assert foreign == {"https://jobs.ashbyhq.com/acme/berlin"}


def test_a_second_office_in_the_us_keeps_an_otherwise_foreign_row() -> None:
    payload = {
        "jobs": [
            {
                "title": "Software Engineer Intern",
                "jobUrl": "https://jobs.ashbyhq.com/acme/1",
                "publishedAt": "2026-08-01",
                "location": "London",
                "secondaryLocations": [{"location": "Boston, MA"}],
            }
        ]
    }
    keep, foreign = split_board("ashby", "acme", payload)
    assert len(keep) == 1
    assert foreign == set()


def test_lever_is_read_from_its_country_code_before_its_prose() -> None:
    """The one unambiguous location field any of these three APIs has."""
    assert _in_country("US") and _in_country("us")
    assert not _in_country("GB")
    # Absent is unsaid, and unsaid is kept.
    assert _in_country(None) and _in_country("")


def test_a_slug_reads_as_a_company_name() -> None:
    assert _display("windborne-systems") == "Windborne Systems"
    assert _display("15five") == "15Five"


def test_no_board_list_is_the_feature_switched_off(tmp_path) -> None:
    """The Markdown trackers are the floor this stands on. A checkout that has
    never run discovery still syncs."""
    assert load_boards(tmp_path / "absent.json", tmp_path / "absent.txt") == []


def test_a_board_list_drops_rows_naming_an_ats_this_build_cannot_read(tmp_path) -> None:
    path = tmp_path / "boards.json"
    path.write_text(
        json.dumps({"daily": [["ashby", "etched"], ["workday", "acme"], ["lever", ""]]}),
        encoding="utf-8",
    )
    assert load_boards(path, tmp_path / "absent.txt") == [("ashby", "etched")]


def test_asking_no_boards_makes_no_requests() -> None:
    assert harvest([]) == BoardResult()


def test_the_boards_are_asked_on_every_run() -> None:
    """They used to be asked on two of the five runs, to hold the traffic down. On
    a ninety-minute schedule that gating would have made the schedule a gesture:
    the trackers are five Markdown files a volunteer edits once or twice a day, so
    a run reading only those finds what the run before it already had. The boards
    are the half that changes hourly, and the only half that reports the date a
    posting went up.

    The cost is asserted rather than described, so that raising the run count is a
    decision somebody makes on purpose."""
    from job_sync.main import WORKING_HOURS

    runs_a_day = 7
    assert 5_000 < len(load_boards()) * runs_a_day < 8_000
    assert len(WORKING_HOURS) == 11, "the window is the working day, not the run count"


def test_a_board_can_be_written_down_by_hand(tmp_path) -> None:
    """The escape hatch for a board nothing upstream knows. Verition's is real,
    open and hiring, and Common Crawl has never fetched it once — with no
    enumeration API on any of the three ATSes, a person noticing is the only route
    it has."""
    path = tmp_path / "extra.txt"
    path.write_text(
        "# a comment\n\ngreenhouse:veritiongroupllc\n  ashby : etched \nnonsense\n",
        encoding="utf-8",
    )
    assert extra_boards(path) == [("greenhouse", "veritiongroupllc"), ("ashby", "etched")]


def test_the_hand_written_list_survives_a_rebuild_of_the_shortlist(tmp_path) -> None:
    """Kept in its own file precisely so the weekly rebuild cannot drop one."""
    shortlist = tmp_path / "boards.json"
    shortlist.write_text(json.dumps({"daily": [["ashby", "etched"]]}), encoding="utf-8")
    assert ("greenhouse", "veritiongroupllc") in load_boards(shortlist)


def test_the_shipped_hand_list_is_readable_and_carries_verition() -> None:
    assert EXTRA_FILE.exists(), "job_sync/data/extra_boards.txt is missing"
    assert ("greenhouse", "veritiongroupllc") in extra_boards()


def test_a_board_in_both_lists_is_asked_once(tmp_path) -> None:
    shortlist = tmp_path / "boards.json"
    shortlist.write_text(
        json.dumps({"daily": [["greenhouse", "veritiongroupllc"]]}), encoding="utf-8"
    )
    assert load_boards(shortlist).count(("greenhouse", "veritiongroupllc")) == 1
