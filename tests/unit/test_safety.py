"""Tests for the hard safety guards (spec §29).

If any test in this file fails, the build is broken in the one way the project
cannot tolerate. Treat a failure here as a stop-the-line event.
"""

from __future__ import annotations

from typing import Any, ClassVar

import pytest
from pydantic import ValidationError

from app.safety import (
    FORBIDDEN_FLAGS,
    SafetySettings,
    SafetyViolation,
    assert_gmail_service_has_no_send,
    assert_safe_to_create_draft,
    assert_safe_to_review,
    load_safety_settings,
)

PRE_SUBMIT = frozenset({"READY_FOR_REVIEW", "LIVE_REVIEW_READY"})


class TestSafetySettings:
    def test_defaults_are_all_off(self):
        s = SafetySettings()
        assert s.auto_submit_enabled is False
        assert s.auto_send_email_enabled is False
        assert s.captcha_bypass_enabled is False
        assert s.linkedin_automation_enabled is False

    @pytest.mark.parametrize("field", [f.lower() for f in FORBIDDEN_FLAGS])
    def test_cannot_be_constructed_as_true(self, field):
        with pytest.raises(ValidationError):
            SafetySettings(**{field: True})

    def test_is_frozen(self):
        s = SafetySettings()
        with pytest.raises(ValidationError):
            s.auto_submit_enabled = True  # type: ignore[misc, assignment]


class TestLoadSafetySettings:
    def test_empty_environment_is_safe(self):
        assert load_safety_settings({}) == SafetySettings()

    @pytest.mark.parametrize("value", ["false", "FALSE", "False", "0", "no", "off", "", "  "])
    @pytest.mark.parametrize("flag", FORBIDDEN_FLAGS)
    def test_explicit_falsey_values_accepted(self, flag, value):
        assert load_safety_settings({flag: value}) == SafetySettings()

    @pytest.mark.parametrize("value", ["true", "1", "yes", "TRUE", "on"])
    @pytest.mark.parametrize("flag", FORBIDDEN_FLAGS)
    def test_truthy_values_refuse_to_start(self, flag, value):
        with pytest.raises(SafetyViolation, match=flag):
            load_safety_settings({flag: value})

    @pytest.mark.parametrize("value", ["maybe", "yes please", "disabled?", "2", "null"])
    def test_unrecognised_values_fail_closed(self, value):
        """An unparseable value is an attempt to enable, not something to ignore."""
        with pytest.raises(SafetyViolation):
            load_safety_settings({"AUTO_SUBMIT_ENABLED": value})

    def test_reports_every_offender_at_once(self):
        env = dict.fromkeys(FORBIDDEN_FLAGS, "true")
        with pytest.raises(SafetyViolation) as exc:
            load_safety_settings(env)
        for flag in FORBIDDEN_FLAGS:
            assert flag in str(exc.value)

    def test_reads_os_environ_by_default(self, monkeypatch):
        monkeypatch.setenv("AUTO_SUBMIT_ENABLED", "true")
        with pytest.raises(SafetyViolation):
            load_safety_settings()

    def test_violation_is_not_a_valueerror(self):
        """Must not be swallowed by generic `except ValueError` handling."""
        assert not issubclass(SafetyViolation, ValueError)


class TestGmailHasNoSend:
    def test_draft_only_service_passes(self):
        class DraftOnlyGmail:
            def create_draft(self): ...
            def update_draft(self): ...

        assert_gmail_service_has_no_send(DraftOnlyGmail())

    @pytest.mark.parametrize("name", ["send", "send_draft", "send_message", "drafts_send"])
    def test_any_send_shaped_attribute_is_rejected(self, name):
        service = type("Gmail", (), {name: lambda self: None})()
        with pytest.raises(SafetyViolation, match=name):
            assert_gmail_service_has_no_send(service)

    def test_a_disabled_send_method_still_fails(self):
        """Presence is the violation. Refusing at call time is not good enough."""

        class Gmail:
            def send(self):
                raise NotImplementedError("disabled")

        with pytest.raises(SafetyViolation):
            assert_gmail_service_has_no_send(Gmail())


class TestAssertSafeToReview:
    def test_clean_pre_submit_state_passes(self):
        assert_safe_to_review(
            has_clicked_submit=False,
            application_status="READY_FOR_REVIEW",
            allowed_pre_submit_states=PRE_SUBMIT,
        )

    def test_submit_click_blocks_review(self):
        with pytest.raises(SafetyViolation, match="never submit"):
            assert_safe_to_review(
                has_clicked_submit=True,
                application_status="READY_FOR_REVIEW",
                allowed_pre_submit_states=PRE_SUBMIT,
            )

    def test_post_submit_status_blocks_review(self):
        with pytest.raises(SafetyViolation, match="not a pre-submit state"):
            assert_safe_to_review(
                has_clicked_submit=False,
                application_status="SUBMITTED",
                allowed_pre_submit_states=PRE_SUBMIT,
            )


class TestAssertSafeToCreateDraft:
    OK: ClassVar[dict[str, Any]] = {
        "application_status": "SUBMITTED",
        "submitted_at": "2026-07-01T00:00:00Z",
        "outreach_due": True,
        "is_suppressed": False,
        "within_rate_limit": True,
    }

    def test_all_conditions_met_passes(self):
        assert_safe_to_create_draft(**self.OK)

    @pytest.mark.parametrize(
        ("override", "match"),
        [
            ({"application_status": "READY_FOR_REVIEW"}, "confirmed submission"),
            ({"application_status": "SUBMISSION_UNCERTAIN"}, "confirmed submission"),
            ({"submitted_at": None}, "no submitted_at"),
            ({"outreach_due": False}, "not yet due"),
            ({"is_suppressed": True}, "suppressed"),
            ({"within_rate_limit": False}, "limit reached"),
        ],
    )
    def test_each_condition_blocks_independently(self, override, match):
        with pytest.raises(SafetyViolation, match=match):
            assert_safe_to_create_draft(**{**self.OK, **override})
