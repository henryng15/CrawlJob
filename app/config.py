"""Application settings (spec §21).

``get_settings()`` is the only supported way to obtain configuration. It runs the
hard safety guards first, so a misconfigured environment fails at startup rather
than at the moment a dangerous action would be attempted.

Model IDs are configuration, not constants: the spec's sample ``.env`` shipped a
model name that does not exist, and prices change. See
docs/spec/README.md#known-defects-in-this-spec.
"""

from __future__ import annotations

from datetime import time
from functools import lru_cache
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import Field, PostgresDsn, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.safety import SafetySettings, load_safety_settings
from app.services.filters import DEFAULT_REJECT_TERMS, DEFAULT_ROLE_TITLES, ScreenRules

__all__ = ["Settings", "get_settings"]


def _parse_terms(raw: str) -> tuple[str, ...]:
    """Parse a comma-separated override list, lowercased and de-duplicated.

    Order is preserved so a reader of ``.env`` sees the list they wrote. Empty
    entries are dropped rather than becoming a term that matches everything.
    """
    seen: dict[str, None] = {}
    for piece in raw.split(","):
        if term := " ".join(piece.lower().split()):
            seen[term] = None
    return tuple(seen)


def _parse_times(raw: str) -> tuple[time, ...]:
    """Parse ``"08:00,14:00"`` into sorted, de-duplicated times.

    Raises rather than falling back to a default: a typo here silently changes
    when — or whether — the day's work happens, and a system that quietly runs
    at the wrong hour is worse than one that refuses to start.
    """
    parsed: set[time] = set()
    for piece in raw.split(","):
        piece = piece.strip()
        if not piece:
            continue
        try:
            parsed.add(time.fromisoformat(piece))
        except ValueError:
            raise ValueError(
                f"Invalid orchestration time {piece!r}; expected 24-hour HH:MM"
            ) from None
    if not parsed:
        raise ValueError("orchestration_times must list at least one HH:MM time")
    return tuple(sorted(parsed))


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

    # ---- web session (§23.2) ----------------------------------------------
    admin_username: str = "admin"
    #: Argon2 hash, never a password. Generate with:
    #:     uv run internship-ops hash-password
    admin_password_hash: str = ""
    #: Idle timeout, not absolute: the cookie is re-signed on every request, so
    #: an active session survives and an abandoned one does not (§23.2).
    session_idle_timeout_minutes: int = Field(default=60, ge=5, le=1440)
    session_cookie_secure: bool = False

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

    # ---- pipeline gates ---------------------------------------------------
    #: The master switch, and it defaults to off. Discovery, tailoring, browser
    #: preparation and outreach all refuse to run while this is false, so a
    #: freshly deployed instance prepares nothing until it is turned on
    #: deliberately. Backups, cleanup and expiry keep running regardless —
    #: pausing the pipeline must not stop the jobs that protect existing data.
    pipeline_enabled: bool = False
    #: A declaration that the base resume is ready to tailor from. It is checked
    #: *alongside* the database, never instead of it: a flag can be set by
    #: someone who has not looked, and today's lesson is that a screen agreeing
    #: with a flag is what makes a broken thing hard to find.
    base_resume_status: Literal["MISSING", "READY"] = "MISSING"

    # ---- orchestration ----------------------------------------------------
    #: Local wall-clock times, comma-separated. Each is a separate run with its
    #: own idempotency key; the daily quota is shared across all of them.
    orchestration_times_raw: str = Field(
        default="08:00,14:00", validation_alias="ORCHESTRATION_TIMES"
    )

    # ---- capacity (§9.3, §15.4) -------------------------------------------
    #: Applications prepared per calendar day in the business timezone, across
    #: every orchestration run, not per run.
    max_prepared_applications_per_day: int = Field(default=30, ge=1, le=100)
    #: How long a prepared application waits for you before it expires. Expiry
    #: is a state change, never a delete: the resume, answers, screenshots and
    #: audit trail all survive so it can be restored later.
    prepared_application_ttl_hours: int = Field(default=24, ge=1, le=168)
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
    #: Freshness window. Measured against ``posted_at`` when the board gives one,
    #: and against ``first_seen_at`` only when it does not — never the later of
    #: the two, which would let a months-old posting look new on the day we
    #: happened to notice it.
    max_role_age_hours: int = Field(default=24, ge=1)
    max_active_applications_per_company: int = Field(default=2, ge=1)
    #: Role variants to apply for, comma-separated, written in normalized form
    #: (see ``DEFAULT_ROLE_TITLES``). Empty keeps the shipped list.
    role_title_variants_raw: str = Field(default="", validation_alias="ROLE_TITLE_VARIANTS")
    #: Terms that disqualify a title even when it matched a variant above.
    #: Empty keeps the shipped list.
    role_reject_terms_raw: str = Field(default="", validation_alias="ROLE_REJECT_TERMS")

    # ---- opt-in sources ---------------------------------------------------
    public_job_scraping_enabled: bool = False

    @field_validator("orchestration_times_raw")
    @classmethod
    def _orchestration_times_parse(cls, v: str) -> str:
        _parse_times(v)  # raises on a typo, at startup rather than at 08:00
        return v

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
        if not self.admin_password_hash:
            raise ValueError(
                "Production requires admin_password_hash. Generate one with: "
                "uv run internship-ops hash-password"
            )
        if not self.session_cookie_secure:
            # Production is HTTPS-only via Tailscale Serve, so a cookie without
            # Secure would be sent over any plaintext path an attacker can force.
            raise ValueError("Production requires session_cookie_secure=true")
        return self

    @property
    def timezone(self) -> ZoneInfo:
        """Business-logic timezone. Database timestamps stay UTC (§16.1)."""
        return ZoneInfo(self.app_timezone)

    @property
    def orchestration_times(self) -> tuple[time, ...]:
        """The configured run times, sorted and de-duplicated."""
        return _parse_times(self.orchestration_times_raw)

    @property
    def screen_rules(self) -> ScreenRules:
        """The pre-spend screening policy (§7.3).

        Built here rather than in the handler so the whole policy has one origin,
        and an operator who overrides the role list in ``.env`` changes what is
        screened everywhere at once.
        """
        return ScreenRules(
            max_role_age_hours=self.max_role_age_hours,
            role_titles=_parse_terms(self.role_title_variants_raw) or DEFAULT_ROLE_TITLES,
            reject_terms=_parse_terms(self.role_reject_terms_raw) or DEFAULT_REJECT_TERMS,
        )

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
