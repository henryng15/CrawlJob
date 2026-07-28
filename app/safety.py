"""Hard safety guards (spec §29).

These enforce the two rules in AGENTS.md that are never negotiable:

1. The system never clicks Submit on an application.
2. The system never sends an email; it only creates Gmail drafts.

The guards live here rather than in ``config.py`` so that importing them cannot
drag in database or provider configuration, and so that a reviewer can read the
entire enforcement surface in one file.

Design notes:

* The four kill-switch flags are typed ``Literal[False]``. There is no code path
  that produces a ``True``; a config file that asks for one raises at import of
  the application, not at the moment the dangerous action would run.
* Parsing fails closed. An unrecognised value such as ``AUTO_SUBMIT_ENABLED=yes
  please`` is treated as an attempt to enable, not as noise to ignore.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from typing import Final, Literal

from pydantic import BaseModel, ConfigDict

__all__ = [
    "FORBIDDEN_FLAGS",
    "SafetySettings",
    "SafetyViolation",
    "assert_gmail_service_has_no_send",
    "assert_safe_to_create_draft",
    "assert_safe_to_review",
    "load_safety_settings",
]


class SafetyViolation(RuntimeError):
    """Raised when configuration or state would breach a hard safety rule.

    This is deliberately not a subclass of ``ValueError`` or any exception the
    application catches broadly. It must terminate the process.
    """


#: Environment variables that may only ever be false. Ordered for stable errors.
FORBIDDEN_FLAGS: Final[tuple[str, ...]] = (
    "AUTO_SUBMIT_ENABLED",
    "AUTO_SEND_EMAIL_ENABLED",
    "CAPTCHA_BYPASS_ENABLED",
    "LINKEDIN_AUTOMATION_ENABLED",
)

#: The only spellings accepted as "off". Everything else fails closed.
_FALSEY: Final[frozenset[str]] = frozenset({"false", "0", "no", "off", ""})


class SafetySettings(BaseModel):
    """Immutable proof that every kill switch is off.

    Constructing this model is the only way to obtain that proof, and the field
    types make ``SafetySettings(auto_submit_enabled=True)`` a validation error.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    auto_submit_enabled: Literal[False] = False
    auto_send_email_enabled: Literal[False] = False
    captcha_bypass_enabled: Literal[False] = False
    linkedin_automation_enabled: Literal[False] = False


def load_safety_settings(env: Mapping[str, str] | None = None) -> SafetySettings:
    """Validate the environment and return the safety proof.

    Call this once during application startup, before any worker, browser slot,
    or Gmail client is constructed.

    Raises:
        SafetyViolation: if any forbidden flag is set to anything other than an
            explicit falsey value.
    """
    source = os.environ if env is None else env
    offenders: list[str] = []

    for flag in FORBIDDEN_FLAGS:
        if flag not in source:
            continue
        if source[flag].strip().lower() not in _FALSEY:
            offenders.append(f"{flag}={source[flag]!r}")

    if offenders:
        raise SafetyViolation(
            "Refusing to start: these settings are permanently disabled and cannot "
            "be enabled by configuration — " + ", ".join(offenders) + ". "
            "See AGENTS.md and docs/spec/29-hard-safety-guards-in-code.md."
        )

    return SafetySettings()


def assert_gmail_service_has_no_send(service: object) -> None:
    """Fail if a Gmail client exposes any way to transmit mail (spec §7.14).

    The MVP Gmail interface must not merely refuse to send — the capability must
    be absent, so that a future refactor cannot re-expose it by flipping a flag.
    """
    forbidden = ("send", "send_draft", "send_message", "drafts_send")
    found = [name for name in forbidden if hasattr(service, name)]
    if found:
        raise SafetyViolation(
            f"{type(service).__name__} exposes forbidden send capability: {found}. "
            "The Gmail service must only create and update drafts."
        )


def assert_safe_to_review(
    *,
    has_clicked_submit: bool,
    application_status: str,
    allowed_pre_submit_states: frozenset[str],
) -> None:
    """Guard the handoff to human review (spec §29).

    Called immediately before a browser slot is exposed over noVNC.
    """
    if has_clicked_submit:
        raise SafetyViolation(
            "Adapter reported a Submit click. The system must never submit an "
            "application; only the user may."
        )
    if application_status not in allowed_pre_submit_states:
        raise SafetyViolation(
            f"Application status {application_status!r} is not a pre-submit state. "
            f"Expected one of {sorted(allowed_pre_submit_states)}."
        )


def assert_safe_to_create_draft(
    *,
    application_status: str,
    submitted_at: object,
    outreach_due: bool,
    is_suppressed: bool,
    within_rate_limit: bool,
) -> None:
    """Guard recruiter outreach (spec §29, §8.2).

    Every condition here has caused real-world harm when skipped: emailing about
    an application that was never submitted, emailing someone who asked not to be
    contacted, or emailing faster than a human plausibly would.
    """
    if application_status != "SUBMITTED":
        raise SafetyViolation(
            f"Cannot draft outreach for application in state {application_status!r}; "
            "outreach requires a confirmed submission."
        )
    if submitted_at is None:
        raise SafetyViolation("Application is marked SUBMITTED but has no submitted_at timestamp.")
    if not outreach_due:
        raise SafetyViolation("Outreach is not yet due; the business-day delay has not elapsed.")
    if is_suppressed:
        raise SafetyViolation("Recruiter is suppressed; refusing to create a draft.")
    if not within_rate_limit:
        raise SafetyViolation("Daily or per-company outreach limit reached; refusing to draft.")
