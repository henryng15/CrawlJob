"""Tests for application settings (spec §21)."""

from __future__ import annotations

from typing import Any

import pytest
from pydantic import ValidationError

from app.config import Settings, get_settings
from app.safety import SafetyViolation


def build(**overrides: Any) -> Settings:
    """Construct Settings from a kwargs mapping.

    pydantic-settings declares reserved keyword-only parameters on ``__init__``,
    so a ``**dict`` splat does not type-check at the call site. Funnelling every
    test through here keeps that suppression in one place.
    """
    return Settings(**overrides)


PROD: dict[str, Any] = {
    "app_env": "production",
    "app_base_url": "https://internship-ops.example.ts.net",
    "app_secret_key": "a-real-secret",
    "app_encryption_key": "a-real-key",
}


@pytest.fixture(autouse=True)
def _isolate_env(monkeypatch, tmp_path):
    """Keep the developer's real .env and environment out of these tests."""
    for var in (
        "APP_ENV",
        "APP_BASE_URL",
        "APP_SECRET_KEY",
        "APP_ENCRYPTION_KEY",
        "LLM_PROVIDER",
        "ANTHROPIC_API_KEY",
        "AUTO_SUBMIT_ENABLED",
        "AUTO_SEND_EMAIL_ENABLED",
        "CAPTCHA_BYPASS_ENABLED",
        "LINKEDIN_AUTOMATION_ENABLED",
    ):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.chdir(tmp_path)  # no .env file to pick up
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


class TestDefaults:
    def test_development_defaults_load(self):
        s = build()
        assert s.app_env == "development"
        assert s.llm_provider == "null", "must not call a paid API by default"
        assert s.max_prepared_applications_per_day == 10
        assert s.outreach_delay_business_days == 2

    def test_gmail_is_draft_only_and_cannot_be_changed(self):
        assert build().gmail_draft_only is True
        with pytest.raises(ValidationError):
            build(gmail_draft_only=False)

    def test_settings_are_frozen(self):
        s = build()
        with pytest.raises(ValidationError):
            s.max_live_sessions = 99  # type: ignore[misc]

    def test_model_ids_are_real(self):
        """The spec's sample .env shipped `claude-sonnet-4-6`, which does not exist."""
        s = build()
        assert s.llm_writing_model == "claude-sonnet-5"
        assert s.llm_classification_model.startswith("claude-haiku-4-5")

    def test_derived_paths(self, tmp_path):
        s = build(data_dir=tmp_path)
        assert s.artifacts_dir == tmp_path / "artifacts"
        assert s.secrets_dir == tmp_path / "secrets"


class TestValidation:
    def test_unknown_timezone_rejected(self):
        with pytest.raises(ValidationError, match="Unknown timezone"):
            build(app_timezone="Mars/Olympus_Mons")

    def test_timezone_property_resolves(self):
        assert build().timezone.key == "America/New_York"

    def test_initial_daily_limit_cannot_exceed_max(self):
        with pytest.raises(ValidationError, match="exceeds"):
            build(outreach_initial_daily_limit=5, outreach_max_daily_limit=3)

    def test_live_sessions_cannot_exceed_workers(self):
        """Two live sessions on a 12 GB VM is the documented ceiling (§15.5)."""
        with pytest.raises(ValidationError, match="exceeds"):
            build(max_live_sessions=4, max_browser_workers=2)

    @pytest.mark.parametrize(
        ("field", "value"),
        [
            ("llm_monthly_budget_usd", 0),
            ("minimum_fit_score", 101),
            ("max_browser_workers", 0),
            ("outreach_delay_business_days", 0),
            ("max_prepared_applications_per_day", 0),
        ],
    )
    def test_out_of_range_values_rejected(self, field, value):
        with pytest.raises(ValidationError):
            build(**{field: value})


class TestProductionHardening:
    def test_production_config_is_valid(self):
        assert build(**PROD).app_env == "production"

    @pytest.mark.parametrize("field", ["app_secret_key", "app_encryption_key"])
    def test_placeholder_secrets_rejected_in_production(self, field):
        with pytest.raises(ValidationError, match=field):
            build(**{**PROD, field: "dev-only-not-for-production"})

    def test_placeholders_are_fine_in_development(self):
        assert build(app_env="development").app_env == "development"

    def test_production_requires_https(self):
        with pytest.raises(ValidationError, match="HTTPS"):
            build(**{**PROD, "app_base_url": "http://internship-ops.example.ts.net"})

    def test_anthropic_provider_requires_a_key(self):
        with pytest.raises(ValidationError, match="anthropic_api_key"):
            build(**{**PROD, "llm_provider": "anthropic"})

    def test_anthropic_provider_with_key_is_valid(self):
        s = build(**{**PROD, "llm_provider": "anthropic", "anthropic_api_key": "sk-ant-x"})
        assert s.llm_provider == "anthropic"

    def test_secrets_are_not_leaked_by_repr(self):
        """Secrets must not reach logs or error reports (§23.5)."""
        s = build(**{**PROD, "llm_provider": "anthropic", "anthropic_api_key": "sk-ant-SECRET"})
        assert "sk-ant-SECRET" not in repr(s)
        assert "a-real-secret" not in repr(s)


class TestGetSettings:
    def test_runs_safety_guards_before_building_settings(self, monkeypatch):
        monkeypatch.setenv("AUTO_SUBMIT_ENABLED", "true")
        with pytest.raises(SafetyViolation):
            get_settings()

    def test_result_is_cached(self):
        assert get_settings() is get_settings()
