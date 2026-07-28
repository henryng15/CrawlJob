"""Application settings (spec §21).

``get_settings()`` is the only supported way to obtain configuration. It runs the
hard safety guards first, so a misconfigured environment fails at startup rather
than at the moment a dangerous action would be attempted.

Model IDs are configuration, not constants: the spec's sample ``.env`` shipped a
model name that does not exist, and prices change. See
docs/spec/README.md#known-defects-in-this-spec.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import Field, PostgresDsn, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.safety import SafetySettings, load_safety_settings

__all__ = ["Settings", "get_settings"]


class Settings(BaseSettings):
    """Runtime configuration, loaded from the environment and ``.env``."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
    )

    # ---- application ------------------------------------------------------
    app_env: Literal["development", "test", "production"] = "development"
    app_timezone: str = "America/New_York"
    app_base_url: str = "http://localhost:8000"
    app_secret_key: SecretStr = SecretStr("dev-only-not-for-production")
    app_encryption_key: SecretStr = SecretStr("dev-only-not-for-production")

    # ---- storage ----------------------------------------------------------
    database_url: PostgresDsn = PostgresDsn(
        "postgresql+psycopg://internship_ops:internship_ops@localhost:5432/internship_ops"
    )
    data_dir: Path = Path("/data/internship-ops")

    # ---- llm --------------------------------------------------------------
    llm_provider: Literal["anthropic", "null"] = "null"
    anthropic_api_key: SecretStr | None = None
    llm_classification_model: str = "claude-haiku-4-5-20251001"
    llm_writing_model: str = "claude-sonnet-5"
    llm_monthly_budget_usd: float = Field(default=15.0, gt=0)

    # ---- gmail ------------------------------------------------------------
    gmail_credentials_path: Path | None = None
    gmail_token_path: Path | None = None
    gmail_draft_only: Literal[True] = True

    # ---- capacity (§9.3, §15.4) -------------------------------------------
    max_prepared_applications_per_day: int = Field(default=10, ge=1, le=50)
    max_browser_workers: int = Field(default=2, ge=1, le=4)
    max_live_sessions: int = Field(default=2, ge=1, le=4)
    live_session_ttl_hours: int = Field(default=8, ge=1, le=24)

    # ---- outreach (§8.1) --------------------------------------------------
    outreach_initial_daily_limit: int = Field(default=3, ge=0, le=10)
    outreach_max_daily_limit: int = Field(default=5, ge=0, le=10)
    outreach_delay_business_days: int = Field(default=2, ge=1, le=30)
    outreach_max_per_company_30d: int = Field(default=2, ge=1, le=5)
    outreach_max_followups: int = Field(default=1, ge=0, le=2)

    # ---- selection (§16.3) ------------------------------------------------
    minimum_fit_score: float = Field(default=72.0, ge=0, le=100)
    max_role_age_days: int = Field(default=21, ge=1)
    max_active_applications_per_company: int = Field(default=2, ge=1)

    # ---- opt-in sources ---------------------------------------------------
    public_job_scraping_enabled: bool = False

    @field_validator("app_timezone")
    @classmethod
    def _timezone_must_exist(cls, v: str) -> str:
        try:
            ZoneInfo(v)
        except ZoneInfoNotFoundError:
            raise ValueError(f"Unknown timezone {v!r}") from None
        return v

    @model_validator(mode="after")
    def _daily_limits_are_ordered(self) -> Settings:
        if self.outreach_initial_daily_limit > self.outreach_max_daily_limit:
            raise ValueError(
                f"outreach_initial_daily_limit ({self.outreach_initial_daily_limit}) exceeds "
                f"outreach_max_daily_limit ({self.outreach_max_daily_limit})"
            )
        if self.max_live_sessions > self.max_browser_workers:
            raise ValueError(
                f"max_live_sessions ({self.max_live_sessions}) exceeds "
                f"max_browser_workers ({self.max_browser_workers})"
            )
        return self

    @model_validator(mode="after")
    def _production_requires_real_secrets(self) -> Settings:
        """Refuse to run in production with development placeholders."""
        if self.app_env != "production":
            return self
        placeholders = [
            name
            for name in ("app_secret_key", "app_encryption_key")
            if "dev-only" in getattr(self, name).get_secret_value()
        ]
        if placeholders:
            raise ValueError(f"Production requires real values for: {', '.join(placeholders)}")
        if self.llm_provider == "anthropic" and self.anthropic_api_key is None:
            raise ValueError("llm_provider=anthropic requires anthropic_api_key")
        if not self.app_base_url.startswith("https://"):
            raise ValueError(
                "Production app_base_url must be HTTPS via Tailscale Serve, "
                f"got {self.app_base_url!r}"
            )
        return self

    @property
    def timezone(self) -> ZoneInfo:
        """Business-logic timezone. Database timestamps stay UTC (§16.1)."""
        return ZoneInfo(self.app_timezone)

    @property
    def artifacts_dir(self) -> Path:
        return self.data_dir / "artifacts"

    @property
    def secrets_dir(self) -> Path:
        return self.data_dir / "secrets"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached settings, having first proven the kill switches are off.

    The safety check runs before ``Settings`` is constructed so that a hostile or
    careless ``.env`` cannot reach any other part of the system.
    """
    load_safety_settings()
    return Settings()


def get_safety() -> SafetySettings:
    """Return the safety proof. Cheap; re-validates the environment each call."""
    return load_safety_settings()
