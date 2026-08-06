"""Finding the page that holds the form (spec §7.9).

Every case here was checked against a live posting with a headless browser
counting inputs, which is why the table is a lookup rather than a rule: nine of
eleven real applications were handed back to the user because the browser opened
a description page and found no questions on it.
"""

from __future__ import annotations

import pytest

from app.ats.apply_url import apply_url, needs_a_click


class TestBoardsWithAFormOfTheirOwn:
    @pytest.mark.parametrize(
        ("posting", "form"),
        [
            (
                "https://jobs.ashbyhq.com/persona.ai/fd514a3f-4138-48d5",
                "https://jobs.ashbyhq.com/persona.ai/fd514a3f-4138-48d5/application",
            ),
            (
                "https://jobs.lever.co/diversified-automation/827a092d",
                "https://jobs.lever.co/diversified-automation/827a092d/apply",
            ),
            (
                "https://jobs.lever.co/acme/abc/",
                "https://jobs.lever.co/acme/abc/apply",
            ),
        ],
    )
    def test_the_form_url_is_derived(self, posting, form):
        assert apply_url(posting) == form

    @pytest.mark.parametrize(
        "already",
        [
            "https://jobs.ashbyhq.com/persona.ai/fd514a3f/application",
            "https://jobs.lever.co/acme/abc/apply",
        ],
    )
    def test_a_form_url_is_left_alone(self, already):
        """A re-queued task carries the URL we navigated to last time."""
        assert apply_url(already) == already

    def test_a_query_string_survives(self):
        assert apply_url("https://jobs.lever.co/acme/abc?lever-source=x") == (
            "https://jobs.lever.co/acme/abc/apply?lever-source=x"
        )

    def test_a_fragment_is_dropped(self):
        assert apply_url("https://jobs.lever.co/acme/abc#details") == (
            "https://jobs.lever.co/acme/abc/apply"
        )


class TestNothingIsGuessedAt:
    @pytest.mark.parametrize(
        "url",
        [
            # Greenhouse serves the form on the posting itself.
            "https://job-boards.greenhouse.io/densityai/jobs/4336452009",
            "https://boards.greenhouse.io/spacex/jobs/8621757002?gh_jid=8621757002",
            # An employer hosting their own page.
            "https://optiver.com/join-us/jobs/8401052002",
            "https://deshaw.com/careers/5906",
            # A board index, not a posting: appending would invent a URL.
            "https://jobs.lever.co/acme",
            "https://jobs.ashbyhq.com/persona.ai",
            # Deeper than a posting — already somewhere specific.
            "https://jobs.lever.co/acme/abc/thanks",
        ],
    )
    def test_an_unknown_or_wrong_shaped_url_is_returned_untouched(self, url):
        """Returning the input is what the system did before this module existed,
        and it is correct everywhere the form is already on the page. A wrong
        guess produces a 404, which reads exactly like an empty form."""
        assert apply_url(url) == url

    def test_it_never_raises(self):
        for nonsense in ("", "not a url", "https://", "mailto:someone@example.com"):
            assert isinstance(apply_url(nonsense), str)


class TestBoardsBehindAButton:
    @pytest.mark.parametrize(
        "url",
        [
            "https://gdit.wd5.myworkdayjobs.com/en-US/external_career_site/job/X_RQ225717",
            "https://ntst.wd1.myworkdayjobs.com/en-US/careers/job/Overland-Park-KS/Y_R015668",
        ],
    )
    def test_workday_is_flagged_as_needing_a_click(self, url):
        """There is no address to jump to — the browser has to press something."""
        assert needs_a_click(url)
        assert apply_url(url) == url

    @pytest.mark.parametrize(
        "url",
        [
            "https://jobs.lever.co/acme/abc",
            "https://job-boards.greenhouse.io/acme/jobs/1",
            "https://jobs.ashbyhq.com/acme/abc",
        ],
    )
    def test_the_others_are_not(self, url):
        assert not needs_a_click(url)
