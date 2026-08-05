"""End-to-end browser tests against the fake ATS (Milestone 0, §7.8, §28.4).

These drive a real Chromium through Playwright against a real HTTP server. They
are the acceptance criteria for Milestone 0 locally; the ARM64 half still needs
the OCI instance.

Marked ``browser`` so the fast loop can skip them:

    uv run pytest -m "not browser"
"""

from __future__ import annotations

import socket
import threading
from collections.abc import Iterator
from pathlib import Path

import pytest
import uvicorn

from app.ats.driver import detect_captcha, extract_form, fill_form
from app.ats.fields import SourceType, resolve
from app.ats.replay import build_package, check_replayable
from app.ats.submission import Observation, detect
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


def prepare(page: Page, url: str, resume_path: Path | None = None):
    """Extract, resolve and fill — the worker's whole pre-review pass."""
    page.goto(url)
    specs = extract_form(page)
    answers = [resolve(s, facts=FACTS, locked_keys=LOCKED) for s in specs]
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

    def test_the_sponsorship_dropdown_is_left_for_the_user(
        self, page: Page, ats_url: str, resume: Path
    ):
        """Known, locked, and still not typed in.

        The user asked for sponsorship questions to stay blank so they can read
        each employer's phrasing themselves.
        """
        _, _, report = prepare(page, f"{ats_url}/greenhouse/jobs/1", resume)
        assert page.input_value("#sponsorship") == ""
        assert "Will you now or in the future require sponsorship?" in report.skipped_manual

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
        assert report.needs_human
        assert len(report.skipped_manual) >= 4

    def test_the_salary_question_is_left_for_the_user(self, page: Page, ats_url: str, resume: Path):
        prepare(page, f"{ats_url}/ashby/jobs/1", resume)
        assert page.input_value("#salary") == ""


class TestNeverSubmits:
    def test_the_form_is_not_submitted(self, page: Page, ats_url: str, resume: Path):
        """The hard rule. Filling a form must never post it."""
        submissions.clear()
        prepare(page, f"{ats_url}/greenhouse/jobs/1", resume)

        assert not submissions, "the fill pass posted an application"
        assert page.url.rstrip("/") == f"{ats_url}/greenhouse/jobs/1"

    def test_the_submit_button_is_still_there_afterwards(
        self, page: Page, ats_url: str, resume: Path
    ):
        prepare(page, f"{ats_url}/greenhouse/jobs/1", resume)
        assert page.query_selector("#submit-application") is not None

    def test_detection_reports_nothing_submitted_after_a_fill(
        self, page: Page, ats_url: str, resume: Path
    ):
        url = f"{ats_url}/greenhouse/jobs/1"
        title_before = page.title() if page.url != "about:blank" else ""
        prepare(page, url, resume)

        verdict = detect(
            Observation(
                url_before=url,
                url_after=page.url,
                text_after=page.inner_text("body"),
                title_before=title_before or page.title(),
                title_after=page.title(),
                submit_button_present_after=page.query_selector("#submit-application") is not None,
                form_present_after=page.query_selector("#application-form") is not None,
            )
        )
        assert not verdict.submitted


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
        assert report.needs_human


class TestReplayAgainstARealPage:
    def test_a_package_built_from_a_live_page_replays_against_it(
        self, page: Page, ats_url: str, resume: Path
    ):
        from datetime import UTC, datetime

        url = f"{ats_url}/greenhouse/jobs/1"
        specs, answers, _ = prepare(page, url, resume)
        package = build_package(
            application_id="app-1",
            application_url=url,
            ats_type="GREENHOUSE",
            specs=specs,
            answers=answers,
            created_at=datetime.now(UTC),
        )

        page.goto(url)
        assert check_replayable(package, extract_form(page)).can_replay

    def test_a_renamed_form_still_replays_because_labels_are_unchanged(
        self, page: Page, ats_url: str, resume: Path
    ):
        """Renaming inputs breaks CSS selectors but not accessible labels."""
        from datetime import UTC, datetime

        url = f"{ats_url}/greenhouse/jobs/1"
        specs, answers, _ = prepare(page, url, resume)
        package = build_package(
            application_id="app-1",
            application_url=url,
            ats_type="GREENHOUSE",
            specs=specs,
            answers=answers,
            created_at=datetime.now(UTC),
        )

        page.goto(f"{url}?fault=selectors")
        assert check_replayable(package, extract_form(page)).can_replay

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
