"""Tests for the hard safety guards.

If any test in this file fails, the build is broken in the one way this project
cannot tolerate: it can now send an application it should not have. Treat a
failure here as a stop-the-line event.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.safety import (
    FORBIDDEN_FLAGS,
    SafetySettings,
    SafetyViolation,
    SubmitRefused,
    assert_safe_to_submit,
    load_safety_settings,
)


class TestSafetySettings:
    def test_defaults_are_all_off(self):
        s = SafetySettings()
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
            load_safety_settings({"CAPTCHA_BYPASS_ENABLED": value})

    def test_reports_every_offender_at_once(self):
        env = dict.fromkeys(FORBIDDEN_FLAGS, "true")
        with pytest.raises(SafetyViolation) as exc:
            load_safety_settings(env)
        for flag in FORBIDDEN_FLAGS:
            assert flag in str(exc.value)

    def test_reads_os_environ_by_default(self, monkeypatch):
        monkeypatch.setenv("CAPTCHA_BYPASS_ENABLED", "true")
        with pytest.raises(SafetyViolation):
            load_safety_settings()

    def test_violation_is_not_a_valueerror(self):
        """Must not be swallowed by generic `except ValueError` handling."""
        assert not issubclass(SafetyViolation, ValueError)


class TestAssertSafeToSubmit:
    """The one choke point before an irreversible click."""

    def _ok(self, **overrides):
        kwargs = {
            "enabled": True,
            "dry_run": False,
            "blocked": False,
            "block_reason": "",
            "captcha_detected": False,
            "resume_attached": True,
            "submitted_today": 0,
            "daily_cap": 20,
        }
        return {**kwargs, **overrides}

    def test_a_complete_application_is_allowed_through(self):
        assert_safe_to_submit(**self._ok())

    def test_a_dry_run_is_not_a_refusal(self):
        """The caller branches on dry_run *after* this agrees the submission was safe.

        Refusing here would collapse "we would have submitted" and "we could not"
        into one outcome, which is the only thing a dry run is for.
        """
        assert_safe_to_submit(**self._ok(dry_run=True))

    @pytest.mark.parametrize(
        ("override", "match"),
        [
            ({"captcha_detected": True}, "CAPTCHA"),
            ({"blocked": True, "block_reason": "3 questions need you"}, "3 questions need you"),
            ({"blocked": True}, "locked fact"),
            ({"resume_attached": False}, "resume"),
            ({"enabled": False}, "AUTO_SUBMIT_ENABLED"),
            ({"daily_cap": 0}, "zero"),
            ({"submitted_today": 20, "daily_cap": 20}, "cap of 20"),
            ({"submitted_today": 21, "daily_cap": 20}, "cap of 20"),
        ],
    )
    def test_each_condition_refuses_on_its_own(self, override, match):
        with pytest.raises(SubmitRefused, match=match):
            assert_safe_to_submit(**self._ok(**override))

    def test_the_most_specific_reason_wins(self):
        """The user reads this on the dashboard, so it has to name the thing to fix."""
        with pytest.raises(SubmitRefused, match="CAPTCHA"):
            assert_safe_to_submit(**self._ok(captcha_detected=True, blocked=True, enabled=False))

    def test_a_refusal_is_not_a_safety_violation(self):
        """A violation kills the process; a refusal is an ordinary outcome."""
        assert not issubclass(SubmitRefused, SafetyViolation)


class TestAutoSubmitIsNoLongerForbidden:
    def test_the_flag_is_not_a_kill_switch_any_more(self):
        """Submitting is the product. It is capped, not made impossible."""
        assert "AUTO_SUBMIT_ENABLED" not in FORBIDDEN_FLAGS

    def test_sending_email_still_is(self):
        assert "AUTO_SEND_EMAIL_ENABLED" in FORBIDDEN_FLAGS

    def test_setting_it_does_not_stop_the_process(self):
        load_safety_settings({"AUTO_SUBMIT_ENABLED": "true"})
