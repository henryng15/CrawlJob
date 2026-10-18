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


def test_a_cell_that_is_not_a_link_is_left_alone(monkeypatch) -> None:
    """A hand-typed cell like "." reached urllib and killed the whole sync. It is
    not a posting, so it is neither asked about nor deleted."""
    gone = "https://job-boards.greenhouse.io/acme/jobs/1"
    monkeypatch.setattr(liveness, "_fetch", fake_fetch({gone: (404, "")}))
    monkeypatch.setattr(liveness, "PER_HOST_DELAY_SECONDS", 0)
    assert dead_links([".", "n/a", "see email", gone]) == {gone}


def test_a_malformed_url_is_unknown_not_a_crash() -> None:
    assert check(".") is None


# A column of links is really a column of whatever anyone typed there.
MALFORMED = [
    ".",
    "",
    "   ",
    "n/a",
    "TBD",
    "www.example.com",
    "http://",
    "://broken",
    "http:/one-slash",
    "file:///etc/passwd",
    "data:text/html,hi",
    "mailto:a@b.c",
    "javascript:alert(1)",
    "https://exa mple.com/x",
    "https://éxample.com/a",  # a non-ASCII host, deliberate: not a typo to fix
    "#REF!",
    '=HYPERLINK("x")',
]


def test_no_cell_however_typed_can_end_the_sweep(monkeypatch) -> None:
    """One "." cost three scheduled syncs. Whatever the cell holds, the answer is
    at worst "cannot tell" — never an exception, and never "gone"."""

    def unreachable(*_args, **_kwargs):
        raise OSError("no network in tests")

    monkeypatch.setattr(liveness.urllib.request, "urlopen", unreachable)
    assert [check(value) for value in MALFORMED] == [None] * len(MALFORMED)


def test_a_reply_carrying_no_http_status_is_unknown(monkeypatch) -> None:
    """file: and data: are served by urllib without any status. Comparing that
    None against 200 raised TypeError from outside the fetch's own guard."""

    class Statusless:
        status = None

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self, _size):
            return b""

    monkeypatch.setattr(liveness.urllib.request, "urlopen", lambda *a, **k: Statusless())
    assert check("https://job-boards.greenhouse.io/acme/jobs/1") is None


def _host_queues(count: int) -> list[list[str]]:
    urls = [f"https://jobright.ai/jobs/info/{number}" for number in range(count)]
    return liveness._queues({"jobright.ai": urls})


def test_a_small_host_is_still_probed_one_link_at_a_time() -> None:
    """The original rule, and the one that holds for all but a handful of hosts.
    On 2026-10-17 every host here but jobright.ai was under the threshold."""
    assert len(_host_queues(liveness.PER_HOST_DEPTH)) == 1
    assert len(_host_queues(1)) == 1


def test_a_host_past_the_threshold_is_dealt_into_queues() -> None:
    assert len(_host_queues(liveness.PER_HOST_DEPTH + 1)) == 2
    assert len(_host_queues(507)) == liveness.PER_HOST_WORKERS


def test_the_split_is_capped_however_big_the_host_gets() -> None:
    """Otherwise a host that doubled would double the requests in flight, which is
    the load that made Jobright serve its generic shell."""
    assert len(_host_queues(100_000)) == liveness.PER_HOST_WORKERS


def test_queues_on_one_host_are_within_a_link_of_each_other() -> None:
    """Dealt round-robin, not sliced: the sweep waits for the deepest queue, so a
    block split that left one queue short would buy nothing."""
    lengths = [len(queue) for queue in _host_queues(507)]
    assert max(lengths) - min(lengths) <= 1
    assert sum(lengths) == 507


def test_no_link_is_probed_twice_and_none_is_dropped() -> None:
    queues = _host_queues(507)
    flat = [url for queue in queues for url in queue]
    assert len(flat) == len(set(flat)) == 507


def test_the_deepest_queue_is_handed_out_first() -> None:
    """The pool is WORKERS wide. A long queue scheduled last would extend the whole
    sweep by its own length, which is the mistake splitting it was meant to fix."""
    by_host = {
        "small.example": ["https://small.example/1"],
        "jobright.ai": [f"https://jobright.ai/jobs/info/{n}" for n in range(507)],
        "medium.example": [f"https://medium.example/{n}" for n in range(56)],
    }
    lengths = [len(queue) for queue in liveness._queues(by_host)]
    assert lengths == sorted(lengths, reverse=True)
