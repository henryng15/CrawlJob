from job_sync import liveness
from job_sync.liveness import check, dead_links, workday_api


def fake_fetch(responses: dict[str, tuple[int, str]]):
    """Answer by URL; anything unlisted is a host that would not respond."""

    def _fetch(url, method, accept, read_bytes):
        return responses.get(url)

    return _fetch


def test_workday_api_points_at_the_json_behind_the_page() -> None:
    page = (
        "https://salesforce.wd12.myworkdayjobs.com/External_Career_Site/job/"
        "California---San-Francisco/Intern---Software-Engineer_JR310650"
    )
    assert workday_api(page) == (
        "https://salesforce.wd12.myworkdayjobs.com/wday/cxs/salesforce/External_Career_Site/job/"
        "California---San-Francisco/Intern---Software-Engineer_JR310650"
    )


def test_workday_api_handles_a_locale_prefix_and_drops_the_query() -> None:
    page = "https://ngc.wd1.myworkdayjobs.com/en-US/Careers/job/Florida/Intern_R123?src=Simplify"
    assert workday_api(page) == (
        "https://ngc.wd1.myworkdayjobs.com/wday/cxs/ngc/Careers/job/Florida/Intern_R123"
    )


def test_a_non_workday_link_has_no_api() -> None:
    assert workday_api("https://job-boards.greenhouse.io/acme/jobs/1") is None


def test_workday_is_judged_by_its_api_not_its_page(monkeypatch) -> None:
    page = "https://moog.wd5.myworkdayjobs.com/Careers/job/NY/Intern_R1"
    monkeypatch.setattr(liveness, "_fetch", fake_fetch({workday_api(page): (404, "")}))
    assert check(page) is False

    monkeypatch.setattr(liveness, "_fetch", fake_fetch({workday_api(page): (200, "{}")}))
    assert check(page) is True


def test_jobright_placeholder_title_means_the_posting_is_gone(monkeypatch) -> None:
    url = "https://jobright.ai/jobs/info/000000000000000000000000"
    monkeypatch.setattr(liveness, "_fetch", fake_fetch({url: (200, "<title>Jobright.ai</title>")}))
    assert check(url) is False

    real = "<title>Software Engineer Project Intern</title>"
    monkeypatch.setattr(liveness, "_fetch", fake_fetch({url: (200, real)}))
    assert check(url) is True


def test_a_jobright_page_with_no_title_is_unknown_not_dead(monkeypatch) -> None:
    """Reading only the first few KB can miss the tag; that is ignorance, not
    evidence the posting is gone."""
    url = "https://jobright.ai/jobs/info/abc"
    monkeypatch.setattr(liveness, "_fetch", fake_fetch({url: (200, "<html><head>")}))
    assert check(url) is None


def test_plain_boards_are_judged_by_status(monkeypatch) -> None:
    url = "https://www.workatastartup.com/jobs/94993"
    monkeypatch.setattr(liveness, "_fetch", fake_fetch({url: (404, "")}))
    assert check(url) is False

    monkeypatch.setattr(liveness, "_fetch", fake_fetch({url: (200, "")}))
    assert check(url) is True


def test_a_blocked_or_unreachable_host_is_unknown(monkeypatch) -> None:
    """403 and a timeout both mean "could not ask", and an unanswered question
    must never delete a row."""
    url = "https://jobs.smartrecruiters.com/acme/1"
    monkeypatch.setattr(liveness, "_fetch", fake_fetch({url: (429, "")}))
    assert check(url) is None

    monkeypatch.setattr(liveness, "_fetch", fake_fetch({}))
    assert check(url) is None


def test_dead_links_requires_a_second_opinion(monkeypatch) -> None:
    """Jobright served its generic shell for 41 live postings under load. One
    dead-looking answer is not enough to delete a row."""
    url = "https://job-boards.greenhouse.io/acme/jobs/1"
    calls = {"n": 0}

    def flaky(*_args, **_kwargs):
        calls["n"] += 1
        return (404, "") if calls["n"] == 1 else (200, "")

    monkeypatch.setattr(liveness, "_fetch", flaky)
    monkeypatch.setattr(liveness, "PER_HOST_DELAY_SECONDS", 0)
    assert dead_links([url]) == set()
    assert calls["n"] == 2, "the second opinion was never asked for"


def test_dead_links_deletes_only_what_stays_dead(monkeypatch) -> None:
    gone = "https://job-boards.greenhouse.io/acme/jobs/1"
    live = "https://job-boards.greenhouse.io/acme/jobs/2"
    monkeypatch.setattr(liveness, "_fetch", fake_fetch({gone: (404, ""), live: (200, "")}))
    monkeypatch.setattr(liveness, "PER_HOST_DELAY_SECONDS", 0)
    assert dead_links([gone, live, gone]) == {gone}


def test_no_links_means_no_requests(monkeypatch) -> None:
    monkeypatch.setattr(liveness, "_fetch", fake_fetch({}))
    assert dead_links([]) == set()
