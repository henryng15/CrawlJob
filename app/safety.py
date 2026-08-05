"""Hard safety guards.

This system submits job applications on the user's behalf. That is an action it
cannot take back — an employer who receives a half-answered application has
received it — so every route to a Submit click passes through
:func:`assert_safe_to_submit` in this file.

The guards live here rather than in ``config.py`` so that importing them cannot
drag in database or provider configuration, and so that a reviewer can read the
entire enforcement surface in one file.

Design notes:

* Three kill-switch flags remain typed ``Literal[False]``: the system never sends
  email, never touches a CAPTCHA, never automates LinkedIn. There is no code path
  that produces a ``True``; a config file that asks for one raises at import of
  the application, not at the moment the dangerous action would run.
* ``AUTO_SUBMIT_ENABLED`` is deliberately *not* among them any more. Submitting is
  the product. It is guarded by a daily cap and a dry-run default instead of by an
  impossibility.
* Parsing fails closed. An unrecognised value such as ``CAPTCHA_BYPASS_ENABLED=yes
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
    "SubmitRefused",
    "assert_safe_to_submit",
    "load_safety_settings",
]


class SafetyViolation(RuntimeError):
    """Raised when configuration or state would breach a hard safety rule.

    This is deliberately not a subclass of ``ValueError`` or any exception the
    application catches broadly. It must terminate the process.
    """


#: Environment variables that may only ever be false. Ordered for stable errors.
#: ``AUTO_SUBMIT_ENABLED`` used to head this list; it is now an ordinary setting
#: on ``Settings``, because submitting is what the system is for.
FORBIDDEN_FLAGS: Final[tuple[str, ...]] = (
    "AUTO_SEND_EMAIL_ENABLED",
    "CAPTCHA_BYPASS_ENABLED",
    "LINKEDIN_AUTOMATION_ENABLED",
)

#: The only spellings accepted as "off". Everything else fails closed.
_FALSEY: Final[frozenset[str]] = frozenset({"false", "0", "no", "off", ""})


class SafetySettings(BaseModel):
    """Immutable proof that every kill switch is off.

    Constructing this model is the only way to obtain that proof, and the field
    types make ``SafetySettings(captcha_bypass_enabled=True)`` a validation error.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    auto_send_email_enabled: Literal[False] = False
    captcha_bypass_enabled: Literal[False] = False
    linkedin_automation_enabled: Literal[False] = False


def load_safety_settings(env: Mapping[str, str] | None = None) -> SafetySettings:
    """Validate the environment and return the safety proof.

    Call this once during application startup, before any worker or browser is
    constructed.

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
            "See AGENTS.md."
        )

    return SafetySettings()


class SubmitRefused(RuntimeError):
    """The application must not be submitted, and the reason is not a bug.

    Separate from :class:`SafetyViolation` because the two want opposite
    handling. A violation means the configuration is wrong and the process should
    die. A refusal is an ordinary outcome — the daily cap is reached, a required
    answer is missing — and the application simply moves to ``NEEDS_ME`` with the
    message attached for the user to read.
    """


def assert_safe_to_submit(
    *,
    enabled: bool,
    dry_run: bool,
    blocked: bool,
    block_reason: str,
    captcha_detected: bool,
    resume_attached: bool,
    submitted_today: int,
    daily_cap: int,
) -> None:
    """The single choke point before a Submit click.

    Every condition here has to hold at the moment of the click rather than when
    the application was queued, because the queue is minutes old and the page is
    live. The order runs cheapest-first and, more importantly, most-specific
    first: the user reading ``needs_me_reason`` on the dashboard should be told
    the actual thing to fix, not "auto-submit is off".

    ``dry_run`` is not checked here. Refusing on it would collapse two different
    outcomes — "we would have submitted this" and "we could not" — into one, and
    the entire value of a dry run is telling those apart. The caller does the
    dry-run branch after this function has agreed the submission was safe.

    Raises:
        SubmitRefused: with a sentence meant for the user, not for a log.
    """
    if captcha_detected:
        raise SubmitRefused("this form is behind a CAPTCHA, so it has to be done by hand")
    if blocked:
        raise SubmitRefused(block_reason or "a required question had no locked fact behind it")
    if not resume_attached:
        raise SubmitRefused("the browser could not confirm your resume reached the form")
    if not enabled:
        raise SubmitRefused("auto-submit is switched off (AUTO_SUBMIT_ENABLED)")
    if daily_cap <= 0:
        raise SubmitRefused("the daily submit cap is set to zero")
    if submitted_today >= daily_cap:
        raise SubmitRefused(f"today's cap of {daily_cap} submitted applications is reached")
