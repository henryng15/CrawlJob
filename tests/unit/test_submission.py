"""Submission detection tests (spec §7.10).

The two error directions are not symmetric, and the tests are weighted
accordingly. A false positive produces a recruiter email claiming an application
that does not exist; a false negative produces a button the user presses.
"""

from __future__ import annotations

import pytest

from app.ats.submission import (
    DetectionMethod,
    Observation,
    Strength,
    collect_signals,
    detect,
    user_confirmed,
)

FORM_URL = "https://boards.greenhouse.io/acme/jobs/123"


def obs(**kw: object) -> Observation:
    defaults = {"url_before": FORM_URL, "url_after": FORM_URL}
    return Observation(**{**defaults, **kw})  # type: ignore[arg-type]


class TestStrongSignals:
    @pytest.mark.parametrize(
        "url",
        [
            "https://boards.greenhouse.io/acme/jobs/123/confirmation",
            "https://jobs.lever.co/acme/abc/thanks/application_received",
            "https://acme.com/careers/thank-you",
            "https://acme.com/apply?submitted=true",
            "https://jobs.ashbyhq.com/acme/success",
        ],
    )
    def test_a_confirmation_url_is_enough_on_its_own(self, url):
        """Server-issued: the page cannot reach it unless the backend accepted."""
        verdict = detect(obs(url_after=url))
        assert verdict.submitted
        assert verdict.confidence >= 0.9

    @pytest.mark.parametrize(
        "text",
        [
            "Your application has been submitted.",
            "Your application was received.",
            "Application submitted successfully",
            "We've received your application and will be in touch.",
            "Thank you for applying to Acme!",
        ],
    )
    def test_explicit_confirmation_text_is_enough(self, text):
        verdict = detect(obs(text_after=text))
        assert verdict.submitted
        assert verdict.strong_count >= 1

    def test_a_submit_request_plus_a_vanished_form_is_strong(self):
        verdict = detect(
            obs(
                network=(("https://boards.greenhouse.io/applications", 200),),
                form_present_after=False,
            )
        )
        assert verdict.submitted
        assert any(s.name == "submit_request_and_form_replaced" for s in verdict.signals)

    def test_a_successful_request_alone_is_not_strong(self):
        """A 2xx on an application endpoint can be a draft save."""
        verdict = detect(obs(network=(("https://boards.greenhouse.io/applications", 200),)))
        assert not verdict.submitted

    def test_a_failed_request_is_not_a_signal(self):
        verdict = detect(
            obs(
                network=(("https://boards.greenhouse.io/applications", 422),),
                form_present_after=False,
            )
        )
        assert not any(s.name == "submit_request_and_form_replaced" for s in verdict.signals)


class TestMediumSignals:
    def test_one_medium_signal_is_not_enough(self):
        """§7.10: one strong, or two medium. Never one medium."""
        verdict = detect(obs(submit_button_present_after=False))
        assert not verdict.submitted
        assert verdict.medium_count == 1
        assert "awaiting confirmation" in verdict.reason

    def test_two_medium_signals_are_enough(self):
        verdict = detect(obs(submit_button_present_after=False, form_present_after=False))
        assert verdict.submitted
        assert verdict.medium_count >= 2

    def test_medium_confidence_is_lower_than_strong(self):
        medium = detect(obs(submit_button_present_after=False, form_present_after=False))
        strong = detect(obs(url_after=FORM_URL + "/confirmation"))
        assert medium.confidence < strong.confidence

    def test_a_title_change_counts(self):
        verdict = detect(
            obs(
                title_before="Apply - Acme",
                title_after="Application received - Acme",
                submit_button_present_after=False,
            )
        )
        assert verdict.submitted

    def test_soft_text_alone_is_medium_not_strong(self):
        verdict = detect(obs(text_after="Thank you."))
        assert verdict.medium_count == 1
        assert verdict.strong_count == 0
        assert not verdict.submitted

    def test_soft_text_is_not_double_counted_with_explicit_text(self):
        """ "Thank you for applying" is one signal, not two."""
        verdict = detect(obs(text_after="Thank you for applying to Acme!"))
        assert not any(s.name == "soft_success_text" for s in verdict.signals)


class TestFalsePositiveResistance:
    def test_nothing_happening_is_not_a_submission(self):
        verdict = detect(obs())
        assert not verdict.submitted
        assert verdict.confidence == 0.0
        assert "no submission signals" in verdict.reason

    def test_visible_validation_errors_veto_everything(self):
        """A rejected form often re-renders and retitles, which mimics success."""
        verdict = detect(
            obs(
                url_after=FORM_URL + "/confirmation",
                text_after="Your application has been submitted.",
                form_present_after=False,
                submit_button_present_after=False,
                errors_visible=True,
            )
        )
        assert not verdict.submitted
        assert "validation errors" in verdict.reason

    def test_navigation_signals_alone_are_never_enough(self):
        """Regression: clicking a nav link changes the URL *and* the title.

        Those are two medium signals, and before the substantive-signal rule they
        cleared the bar and reported a submission that never happened.
        """
        verdict = detect(
            obs(
                url_after="https://boards.greenhouse.io/acme",
                title_before="Apply",
                title_after="Careers at Acme",
            )
        )
        assert verdict.medium_count == 2
        assert verdict.substantive_medium_count == 0
        assert not verdict.submitted
        assert "no sign of submission" in verdict.reason

    def test_one_substantive_signal_plus_navigation_is_enough(self):
        """A real submission leaves a trace on the form itself."""
        verdict = detect(
            obs(
                url_after="https://boards.greenhouse.io/acme/done",
                form_present_after=False,
            )
        )
        assert verdict.submitted

    def test_navigating_to_an_unrelated_page_is_only_medium(self):
        """Closing the tab or clicking a nav link must not read as success."""
        verdict = detect(obs(url_after="https://boards.greenhouse.io/acme"))
        assert verdict.medium_count == 1
        assert not verdict.submitted

    def test_a_page_that_merely_scrolled_is_not_a_submission(self):
        verdict = detect(obs(url_after=FORM_URL + "#eeo-section"))
        assert not verdict.submitted

    def test_a_confirmation_url_that_did_not_change_is_ignored(self):
        """The form was already at that URL; nothing happened."""
        url = "https://acme.com/careers/thank-you"
        verdict = detect(obs(url_before=url, url_after=url))
        assert not any(s.name == "confirmation_url" for s in verdict.signals)


class TestSignalCollection:
    def test_signals_carry_their_detail(self):
        signals = collect_signals(obs(url_after=FORM_URL + "/confirmation"))
        confirmation = next(s for s in signals if s.name == "confirmation_url")
        assert confirmation.detail
        assert confirmation.strength is Strength.STRONG

    def test_url_change_is_not_double_counted_with_a_confirmation_url(self):
        signals = collect_signals(obs(url_after=FORM_URL + "/confirmation"))
        names = [s.name for s in signals]
        assert "confirmation_url" in names
        assert "url_changed" not in names

    def test_every_signal_is_reported_for_the_audit_trail(self):
        verdict = detect(
            obs(
                url_after=FORM_URL + "/confirmation",
                text_after="Your application has been submitted.",
                submit_button_present_after=False,
                form_present_after=False,
                title_before="Apply",
                title_after="Received",
            )
        )
        assert len(verdict.signals) >= 4


class TestUserConfirmation:
    def test_the_fallback_is_certain_and_labelled(self):
        """§7.10: a miss costs the user a button press, not an application."""
        verdict = user_confirmed()
        assert verdict.submitted
        assert verdict.confidence == 1.0
        assert verdict.method is DetectionMethod.USER_CONFIRMED

    def test_automatic_detection_is_labelled_differently(self):
        assert detect(obs()).method is DetectionMethod.AUTOMATIC


class TestRealisticFlows:
    def test_greenhouse_success_page(self):
        verdict = detect(
            Observation(
                url_before="https://boards.greenhouse.io/acme/jobs/123",
                url_after="https://boards.greenhouse.io/acme/jobs/123/confirmation",
                text_after="Thank you for applying to Acme. Your application has been received.",
                title_before="Software Engineer Intern - Acme",
                title_after="Application Confirmation - Acme",
                submit_button_present_after=False,
                form_present_after=False,
                network=(("https://boards.greenhouse.io/applications", 201),),
            )
        )
        assert verdict.submitted
        assert verdict.confidence >= 0.9

    def test_a_form_rejected_for_a_missing_field(self):
        verdict = detect(
            Observation(
                url_before="https://jobs.lever.co/acme/abc/apply",
                url_after="https://jobs.lever.co/acme/abc/apply",
                text_after="Please correct the errors below. Thank you.",
                title_before="Apply",
                title_after="Apply - 1 error",
                network=(("https://jobs.lever.co/applications", 422),),
                errors_visible=True,
            )
        )
        assert not verdict.submitted

    def test_the_user_abandoned_the_form(self):
        verdict = detect(
            Observation(
                url_before="https://jobs.ashbyhq.com/acme/abc/application",
                url_after="https://jobs.ashbyhq.com/acme",
                title_before="Apply",
                title_after="Careers at Acme",
            )
        )
        assert not verdict.submitted, "navigating away is not submitting"
