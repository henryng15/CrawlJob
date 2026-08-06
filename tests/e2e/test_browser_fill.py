"""End-to-end browser tests against the fake ATS (Milestone 0, §7.8, §28.4).

These drive a real Chromium through Playwright against a real HTTP server, and
they are the only place the whole auto lane is exercised end to end: extract,
resolve, fill, click Submit, read the confirmation page. Everything else can be
made to pass with a mock that agrees with the code.

Marked ``browser`` so the fast loop can skip them:

    uv run pytest -m "not browser"
"""

from __future__ import annotations

import socket
import threading
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
import uvicorn

from app.ats.driver import (
    FillReport,
    detect_captcha,
    extract_form,
    fill_form,
    find_submit_control,
    looks_like_a_form,
    submit_form,
    wait_for_form,
)
from app.ats.fields import FieldSpec, FieldType, SourceType, resolve
from app.worker.browser import _open_the_form
from browser.fake_ats.app import create_app, submissions

pytest.importorskip("playwright.sync_api", reason="playwright is an optional extra")
from playwright.sync_api import Browser, Page, sync_playwright

pytestmark = pytest.mark.browser

FACTS = {
    "candidate.first_name": "Hoan",
    "candidate.last_name": "Nguyen",
    "candidate.email": "nguyen15@kenyon.edu",
    "candidate.phone": "+1-555-0100",
    "candidate.github": "https://github.com/henryng15",
    "candidate.linkedin": "https://linkedin.com/in/example",
    "education.school": "Kenyon College",
    # Work-authorization answers come from the locked candidate fact, never from
    # a semantic key the resolver invented (§7.8).
    "work_authorization.is_authorized": True,
    "work_authorization.requires_future_sponsorship": True,
}
LOCKED = frozenset(
    {"work_authorization.is_authorized", "work_authorization.requires_future_sponsorship"}
)


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@pytest.fixture(scope="module")
def ats_url() -> Iterator[str]:
    """Serve the fake ATS on loopback for the duration of the module."""
    port = _free_port()
    config = uvicorn.Config(create_app(), host="127.0.0.1", port=port, log_level="error")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    import time

    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    else:  # pragma: no cover - only on a very slow machine
        pytest.fail("fake ATS did not start")

    yield f"http://127.0.0.1:{port}"

    server.should_exit = True
    thread.join(timeout=5)


@pytest.fixture(scope="module")
def browser() -> Iterator[Browser]:
    with sync_playwright() as playwright:
        instance = playwright.chromium.launch(headless=True)
        yield instance
        instance.close()


@pytest.fixture
def page(browser: Browser) -> Iterator[Page]:
    context = browser.new_context()
    current = context.new_page()
    yield current
    context.close()


@pytest.fixture
def resume(tmp_path: Path) -> Path:
    path = tmp_path / "resume.pdf"
    path.write_bytes(b"%PDF-1.4\n% a placeholder for upload tests\n")
    return path


@pytest.fixture(autouse=True)
def clean_submissions() -> Iterator[None]:
    """The fake ATS keeps submissions in one module-level dict.

    Cleared around every test so "did this test submit anything" is answerable,
    which is the assertion the dry-run tests rest on.
    """
    submissions.clear()
    yield
    submissions.clear()


def prepare(
    page: Page,
    url: str,
    resume_path: Path | None = None,
    *,
    facts: dict[str, Any] = FACTS,
    locked: frozenset[str] = LOCKED,
) -> tuple[list[FieldSpec], list, FillReport]:
    """Extract, resolve and fill — the worker's whole pass before the click."""
    page.goto(url)
    specs = extract_form(page)
    answers = [resolve(s, facts=facts, locked_keys=locked) for s in specs]
    report = fill_form(page, specs, answers, resume_path=resume_path)
    return specs, answers, report


class TestMilestoneZero:
    """The acceptance criteria for Milestone 0 that do not need ARM64."""

    def test_chromium_launches_and_loads_a_form(self, page: Page, ats_url: str):
        page.goto(f"{ats_url}/greenhouse/jobs/1")
        assert page.query_selector("#application-form") is not None

    def test_a_fixture_form_is_filled(self, page: Page, ats_url: str, resume: Path):
        _, _, report = prepare(page, f"{ats_url}/greenhouse/jobs/1", resume)
        assert report.filled, report.summary()
        assert not report.errors, report.errors

    def test_file_upload_works(self, page: Page, ats_url: str, resume: Path):
        """The resume is an artifact the worker produced, not a candidate fact."""
        prepare(page, f"{ats_url}/greenhouse/jobs/1", resume)
        assert page.eval_on_selector("#resume", "el => el.files.length") == 1

    def test_the_report_names_the_file_that_reached_the_form(
        self, page: Page, ats_url: str, resume: Path
    ):
        """The only place this fact can be established.

        "We built a PDF" and "the employer has the PDF" are different claims, and
        the database records the second one from here — so it has to come back with
        a real browser having really set a real file input.
        """
        _, _, report = prepare(page, f"{ats_url}/greenhouse/jobs/1", resume)
        assert report.resume_uploaded == resume
        assert page.eval_on_selector("#resume", "el => el.files.length") == 1

    def test_no_resume_means_no_upload_rather_than_an_error(self, page: Page, ats_url: str):
        _, _, report = prepare(page, f"{ats_url}/greenhouse/jobs/1", None)
        assert not report.errors
        assert page.eval_on_selector("#resume", "el => el.files.length") == 0

    def test_no_resume_is_reported_as_nothing_uploaded(self, page: Page, ats_url: str):
        """So nothing downstream can record an upload that did not happen."""
        _, _, report = prepare(page, f"{ats_url}/greenhouse/jobs/1", None)
        assert report.resume_uploaded is None
        assert "no resume attached" in report.summary()


class TestExtraction:
    def test_every_question_is_extracted_with_its_label(self, page: Page, ats_url: str):
        page.goto(f"{ats_url}/greenhouse/jobs/1")
        specs = extract_form(page)
        labels = {s.question_text for s in specs}

        assert "First Name" in labels
        assert "Will you now or in the future require sponsorship?" in labels
        assert "Gender" in labels

    def test_field_types_are_recognised(self, page: Page, ats_url: str):
        page.goto(f"{ats_url}/greenhouse/jobs/1")
        by_label = {s.question_text: s for s in extract_form(page)}

        assert by_label["Email"].field_type == "email"
        assert by_label["Resume/CV"].field_type == "file"
        assert by_label["Gender"].field_type == "select"
        assert by_label["Why do you want to work here?"].field_type == "textarea"

    def test_select_options_are_captured(self, page: Page, ats_url: str):
        page.goto(f"{ats_url}/greenhouse/jobs/1")
        by_label = {s.question_text: s for s in extract_form(page)}
        assert set(by_label["Gender"].options) >= {"Male", "Female", "Decline to self-identify"}

    def test_required_fields_are_flagged(self, page: Page, ats_url: str):
        page.goto(f"{ats_url}/greenhouse/jobs/1")
        by_label = {s.question_text: s for s in extract_form(page)}
        assert by_label["First Name"].required
        assert not by_label["Phone"].required


class TestFillRespectsPolicy:
    def test_ordinary_fields_are_filled_from_profile_facts(
        self, page: Page, ats_url: str, resume: Path
    ):
        prepare(page, f"{ats_url}/greenhouse/jobs/1", resume)
        assert page.input_value("#first_name") == "Hoan"
        assert page.input_value("#email") == "nguyen15@kenyon.edu"

    def test_a_locked_fact_fills_the_work_authorization_dropdown(
        self, page: Page, ats_url: str, resume: Path
    ):
        """The one permitted source for a legally sensitive answer (§7.8)."""
        prepare(page, f"{ats_url}/greenhouse/jobs/1", resume)
        assert page.input_value("#work_auth") == "Yes"

    def test_the_sponsorship_dropdown_is_answered_from_the_matching_fact(
        self, page: Page, ats_url: str, resume: Path
    ):
        """The fake ATS asks the "now or in the future" form of the question.

        So it is the future fact that answers it — not the one about this role,
        which for a student on CPT says the opposite and would be a false
        statement here.
        """
        prepare(page, f"{ats_url}/greenhouse/jobs/1", resume)
        assert page.input_value("#sponsorship") == "Yes"

    def test_the_eeo_block_is_left_untouched(self, page: Page, ats_url: str, resume: Path):
        """§7.8: the system may prefill a locked EEO preference, never infer one.

        No such preference is set here, so every EEO field must stay empty.
        """
        _, _, report = prepare(page, f"{ats_url}/greenhouse/jobs/1", resume)
        for selector in ("#eeo_gender", "#eeo_race", "#eeo_veteran", "#eeo_disability"):
            assert page.input_value(selector) == ""
        assert "Gender" in report.skipped_manual

    def test_the_attestation_checkbox_is_not_ticked(self, page: Page, ats_url: str, resume: Path):
        """Only the user may certify that the information is accurate."""
        prepare(page, f"{ats_url}/greenhouse/jobs/1", resume)
        assert page.is_checked("#certify") is False

    def test_manual_fields_are_reported_as_work_remaining(
        self, page: Page, ats_url: str, resume: Path
    ):
        _, _, report = prepare(page, f"{ats_url}/greenhouse/jobs/1", resume)
        assert len(report.skipped_manual) >= 4

    def test_the_salary_question_is_left_for_the_user(self, page: Page, ats_url: str, resume: Path):
        prepare(page, f"{ats_url}/ashby/jobs/1", resume)
        assert page.input_value("#salary") == ""


class TestBlocking:
    """Which unanswered questions stop an application, and which do not.

    The old rule — any skipped field blocks — put every Greenhouse form in the
    manual queue, because every Greenhouse form has an optional question. The new
    rule reads ``required`` off the employer's own markup.
    """

    def test_an_optional_empty_field_does_not_block(self, page: Page, ats_url: str, resume: Path):
        """The EEO block and the attestation are optional here, and stay empty."""
        _, _, report = prepare(page, f"{ats_url}/greenhouse/jobs/1", resume)

        assert "Gender" in report.skipped_manual
        assert page.input_value("#eeo_gender") == ""
        assert not report.blocked, report.summary()
        assert report.blocking_questions == []
        assert report.block_reason == ""

    def test_a_missing_required_field_blocks_and_names_the_question(
        self, page: Page, ats_url: str, resume: Path
    ):
        """The name goes to the dashboard verbatim, so it has to be the employer's.

        "School" is what the user will look for on the page when they open it —
        ``education.school`` is not.
        """
        without_school = {k: v for k, v in FACTS.items() if k != "education.school"}
        _, _, report = prepare(page, f"{ats_url}/greenhouse/jobs/1", resume, facts=without_school)

        assert report.blocked
        assert report.blocking_questions == ["School"]
        assert "School" in report.block_reason

    def test_an_unanswerable_required_field_blocks_even_though_others_filled(
        self, page: Page, ats_url: str, resume: Path
    ):
        """Nothing locked means the two work-authorization questions block."""
        _, _, report = prepare(page, f"{ats_url}/greenhouse/jobs/1", resume, locked=frozenset())

        assert report.filled, "the ordinary fields should still have been filled"
        assert set(report.blocking_questions) == {
            "Are you legally authorized to work in the US?",
            "Will you now or in the future require sponsorship?",
        }


class TestSubmitting:
    """The click, and reading what the employer's page says came of it."""

    def test_a_complete_form_is_submitted_and_detected(
        self, page: Page, ats_url: str, resume: Path
    ):
        _, _, report = prepare(page, f"{ats_url}/greenhouse/jobs/1", resume)
        assert not report.blocked, report.summary()

        outcome = submit_form(page, dry_run=False)

        assert outcome.clicked
        assert outcome.submitted, outcome.reason
        assert len(submissions) == 1, "the employer did not record an application"
        assert next(iter(submissions.values())).fields["first_name"] == "Hoan"

    def test_the_verdict_rests_on_the_confirmation_page_not_on_having_clicked(
        self, page: Page, ats_url: str, resume: Path
    ):
        prepare(page, f"{ats_url}/greenhouse/jobs/1", resume)
        outcome = submit_form(page, dry_run=False)

        assert outcome.verdict is not None
        assert outcome.verdict.strong_count >= 1
        assert "confirmation" in page.url

    def test_a_validation_fault_is_not_reported_as_success(
        self, page: Page, ats_url: str, resume: Path
    ):
        """The ATS rejects the first submit and re-renders with an error banner.

        A re-render changes the URL and the title, which is exactly what success
        looks like — so this is the case a naive detector gets wrong, and the case
        that would bury a job the user never applied for.
        """
        prepare(page, f"{ats_url}/greenhouse/jobs/1?fault=validation", resume)
        outcome = submit_form(page, dry_run=False)

        assert outcome.clicked
        assert not outcome.submitted, outcome.reason
        assert not submissions, "the employer never accepted this application"

    def test_a_dry_run_locates_the_control_but_never_clicks(
        self, page: Page, ats_url: str, resume: Path
    ):
        prepare(page, f"{ats_url}/greenhouse/jobs/1", resume)
        before = page.url
        outcome = submit_form(page, dry_run=True)

        assert outcome.dry_run
        assert not outcome.clicked
        assert outcome.control == "Submit Application"
        assert outcome.verdict is None
        assert not submissions, "a dry run posted an application"
        assert page.url == before

    def test_the_form_is_still_there_after_a_dry_run(self, page: Page, ats_url: str, resume: Path):
        """The proof that nothing happened, taken from the page rather than a flag."""
        prepare(page, f"{ats_url}/greenhouse/jobs/1", resume)
        submit_form(page, dry_run=True)

        assert page.query_selector("#application-form") is not None
        assert page.query_selector("#submit-application") is not None
        assert page.input_value("#first_name") == "Hoan"

    def test_a_page_with_no_submit_control_is_refused(self, page: Page, ats_url: str):
        page.goto(f"{ats_url}/greenhouse/jobs/1?fault=expired")
        outcome = submit_form(page, dry_run=False)

        assert not outcome.clicked
        assert "no submit control" in outcome.reason

    def test_two_plausible_controls_are_refused_rather_than_guessed(self, page: Page):
        """A click cannot be taken back, so ambiguity is answered with a refusal."""
        page.set_content(
            "<form><button type='submit'>Submit</button><button>Apply with LinkedIn</button></form>"
        )
        control, reason = find_submit_control(page)
        outcome = submit_form(page, dry_run=False)

        assert control is None
        assert "2 possible submit controls" in reason
        assert not outcome.clicked


class TestCaptcha:
    def test_a_captcha_is_detected(self, page: Page, ats_url: str):
        page.goto(f"{ats_url}/greenhouse/jobs/1?fault=captcha")
        assert detect_captcha(page)

    def test_a_clean_form_reports_no_captcha(self, page: Page, ats_url: str):
        page.goto(f"{ats_url}/greenhouse/jobs/1")
        assert not detect_captcha(page)

    def test_a_captcha_sends_the_application_to_a_human(
        self, page: Page, ats_url: str, resume: Path
    ):
        """AGENTS.md: never bypass. The only response is to stop and ask."""
        _, _, report = prepare(page, f"{ats_url}/greenhouse/jobs/1?fault=captcha", resume)
        assert report.captcha_detected
        assert report.blocked
        assert "CAPTCHA" in report.block_reason


class TestARenamedForm:
    def test_a_renamed_form_is_still_fillable_via_label_locators(
        self, page: Page, ats_url: str, resume: Path
    ):
        page.goto(f"{ats_url}/greenhouse/jobs/1?fault=selectors")
        specs = extract_form(page)
        answers = [resolve(s, facts=FACTS, locked_keys=LOCKED) for s in specs]
        report = fill_form(page, specs, answers, resume_path=resume)

        assert page.input_value("#first_name_v2") == "Hoan"
        assert not report.errors


class TestExpiredSession:
    def test_an_expired_page_yields_no_fields(self, page: Page, ats_url: str):
        page.goto(f"{ats_url}/greenhouse/jobs/1?fault=expired")
        assert extract_form(page) == []


class TestAllFlavours:
    @pytest.mark.parametrize("flavour", ["greenhouse", "lever", "ashby"])
    def test_each_form_fills_without_errors(
        self, page: Page, ats_url: str, resume: Path, flavour: str
    ):
        _, _, report = prepare(page, f"{ats_url}/{flavour}/jobs/1", resume)

        assert report.filled
        assert not report.errors, report.errors
        assert not submissions or flavour not in {s.flavour for s in submissions.values()}

    @pytest.mark.parametrize("flavour", ["greenhouse", "lever", "ashby"])
    def test_no_manual_only_field_is_ever_filled(
        self, page: Page, ats_url: str, resume: Path, flavour: str
    ):
        from app.ats.fields import MANUAL_ONLY_KEYS

        _, answers, _ = prepare(page, f"{ats_url}/{flavour}/jobs/1", resume)
        for answer in answers:
            if answer.semantic_key in MANUAL_ONLY_KEYS:
                assert answer.source_type in {
                    SourceType.LOCKED_FACT,
                    SourceType.MANUAL_REQUIRED,
                }, answer


class TestPageShapesThatCostRealApplications:
    """Nine of the first eleven real applications were handed back to the user
    because the browser read a page and concluded the employer asked nothing.

    Each page here reproduces one of those, so the fix cannot quietly regress.
    """

    def test_a_form_with_no_form_element_is_still_read(self, page: Page, ats_url: str):
        """Ashby renders 35 inputs and two file pickers with no ``<form>`` tag.

        Insisting on one read that application as having zero questions.
        """
        page.goto(f"{ats_url}/shapes/no-form-element")
        specs = extract_form(page)

        assert len(specs) == 4
        assert {s.question_text for s in specs} >= {"Name", "Email", "Resume"}
        assert any(s.field_type is FieldType.FILE for s in specs)

    def test_a_form_built_after_load_is_waited_for(self, page: Page, ats_url: str):
        """Lever, Ashby and Workday all build theirs from JavaScript."""
        page.goto(f"{ats_url}/shapes/late-render", wait_until="domcontentloaded")

        assert extract_form(page) == [], "nothing has rendered yet — this is the old bug"
        assert wait_for_form(page)
        assert len(extract_form(page)) == 4

    def test_labels_come_from_the_container_when_there_is_no_label_element(
        self, page: Page, ats_url: str
    ):
        """Lever gives one field in nineteen a ``<label for>``. Without this,
        eighteen questions arrive unlabelled, which is to say unanswerable."""
        page.goto(f"{ats_url}/shapes/labels-by-container")
        labels = {s.question_text for s in extract_form(page)}

        assert "Full name ✱" in labels
        assert "Current location ✱" in labels
        assert "" not in labels

    def test_a_search_box_is_not_an_application_form(self, page: Page, ats_url: str):
        """An iCIMS description page carries one input: a site search.

        Treating it as the form meant the Apply link was never followed, and the
        application was reported as having one unanswerable question called
        "Search sri.com".
        """
        page.goto(f"{ats_url}/shapes/search-box-only")
        assert not looks_like_a_form(page)

    def test_a_form_inside_an_iframe_is_found(self, page: Page, ats_url: str):
        """iCIMS serves the application in an iframe and leaves a search box on
        the outer page. Reading only the top document found the search box."""
        page.goto(f"{ats_url}/shapes/form-in-iframe")
        page.wait_for_timeout(1_000)
        labels = {s.question_text for s in extract_form(page)}

        assert {"Name", "Email", "Resume"} <= labels

    def test_an_apply_link_is_followed_to_the_form(self, page: Page, ats_url: str):
        """The whole point: land on a description page, end up on the form."""
        page.goto(f"{ats_url}/shapes/search-box-only")
        _open_the_form(page)

        assert "no-form-element" in page.url
        assert len(extract_form(page)) == 4


class TestAChallengeIsNotThePresenceOfTooling:
    """Every modern ATS ships anti-abuse tooling. Almost none of it challenges
    anyone.

    Measured on the three boards that make up 63% of the auto lane: Ashby has an
    invisible reCAPTCHA, Lever invisible hCaptcha frames, Greenhouse the visible
    "protected by reCAPTCHA" badge. A person fills in all three without ever
    being asked to identify a bus. Refusing all three is not caution — it is
    answering a different question than the one asked, and it left the auto lane
    with nothing in it.
    """

    def test_the_greenhouse_badge_is_not_a_challenge(self, page: Page, ats_url: str):
        page.goto(f"{ats_url}/shapes/recaptcha-badge")
        assert not detect_captcha(page)

    def test_an_invisible_widget_is_not_a_challenge(self, page: Page, ats_url: str):
        page.goto(f"{ats_url}/shapes/invisible-captcha")
        assert not detect_captcha(page)

    def test_a_form_behind_a_badge_is_still_filled(self, page: Page, ats_url: str, resume: Path):
        """The point of the distinction: this application proceeds."""
        page.goto(f"{ats_url}/shapes/recaptcha-badge")
        specs = extract_form(page)
        answers = [resolve(s, facts=FACTS, locked_keys=LOCKED) for s in specs]
        report = fill_form(page, specs, answers, resume_path=resume)

        assert not report.captcha_detected
        assert not report.blocked
        assert report.resume_uploaded == resume

    def test_a_real_challenge_still_stops_everything(self, page: Page, ats_url: str):
        """Unchanged, and it must stay that way. Nothing here solves,
        outsources or evades a challenge that is actually shown."""
        page.goto(f"{ats_url}/greenhouse/jobs/1?fault=captcha")
        assert detect_captcha(page)
