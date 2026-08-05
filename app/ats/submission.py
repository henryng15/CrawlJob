"""Submission detection (spec §7.10).

Clicking Submit is not the same as having applied. The click may hit a validation
error, a session that expired while the form was being filled, or a page that
silently saved a draft. So the worker clicks and then *reads the employer's page*
to find out what happened, and that reading is what this module performs.

Getting it wrong is costly in both directions, and the errors are not symmetric:

* **A false positive** marks an application ``SUBMITTED`` that was never filed.
  The user never sees it again, and never applies for that job.
* **A false negative** leaves an application in ``NEEDS_ME``. The user opens the
  link, sees it went through, and presses "Mark Submitted".

So the threshold is deliberately high — one strong signal, or two medium ones
(§7.10) — and the fallback for a miss is a button, not a guess.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import IntEnum, StrEnum

__all__ = [
    "DetectionMethod",
    "Observation",
    "Signal",
    "Strength",
    "SubmissionVerdict",
    "collect_signals",
    "detect",
]


class Strength(IntEnum):
    MEDIUM = 1
    STRONG = 2


class DetectionMethod(StrEnum):
    #: The page was read after our own click and said the application landed.
    AUTOMATIC = "AUTOMATIC"
    #: The user pressed "Mark Submitted" (§7.10 fallback).
    USER_CONFIRMED = "USER_CONFIRMED"


@dataclass(frozen=True, slots=True)
class Signal:
    name: str
    strength: Strength
    detail: str = ""

    @property
    def is_navigational(self) -> bool:
        return self.name in NAVIGATIONAL_SIGNALS


#: Signals that only say "the page changed". Closing a tab or clicking a nav link
#: produces both of them at once, which would otherwise clear the two-medium bar
#: and report a submission that never happened.
NAVIGATIONAL_SIGNALS: frozenset[str] = frozenset({"url_changed", "title_changed"})


#: URL fragments that only appear after a successful submission on the supported
#: ATS platforms. A URL match is strong because it is server-issued: the page
#: cannot reach it without the backend having accepted the application.
_CONFIRMATION_URLS: tuple[re.Pattern[str], ...] = (
    re.compile(r"/confirmation\b", re.I),
    re.compile(r"/application_?(submitted|received|complete)", re.I),
    re.compile(r"/thank[-_]?you\b", re.I),
    re.compile(r"[?&]submitted=true", re.I),
    re.compile(r"/success\b", re.I),
)

#: Explicit confirmation sentences. Strong: an employer only says this once the
#: application exists.
_CONFIRMATION_TEXT: tuple[re.Pattern[str], ...] = (
    re.compile(r"\byour application (has been|was) (submitted|received)\b", re.I),
    re.compile(r"\bapplication (submitted|received) successfully\b", re.I),
    re.compile(r"\bwe(?:'ve| have) received your application\b", re.I),
    re.compile(r"\bthank you for (applying|your application)\b", re.I),
    re.compile(r"\byour application is complete\b", re.I),
)

#: Weaker phrasing that often but not always means success.
_SOFT_TEXT: tuple[re.Pattern[str], ...] = (
    re.compile(r"\bthank you\b", re.I),
    re.compile(r"\bwe(?:'ll| will) be in touch\b", re.I),
    re.compile(r"\bnext steps\b", re.I),
)

#: Endpoints an ATS posts an application to. A 2xx here is strong evidence, but
#: only alongside a DOM change — a 200 on its own can be a draft save.
_SUBMIT_ENDPOINTS: tuple[re.Pattern[str], ...] = (
    re.compile(r"/applications?\b", re.I),
    re.compile(r"/apply\b", re.I),
    re.compile(r"/submit\b", re.I),
    re.compile(r"/application_form", re.I),
)


@dataclass(frozen=True, slots=True)
class Observation:
    """The page before and after the Submit click, plus what the network did."""

    url_before: str
    url_after: str
    text_after: str = ""
    title_before: str = ""
    title_after: str = ""
    submit_button_present_before: bool = True
    submit_button_present_after: bool = True
    form_present_before: bool = True
    form_present_after: bool = True
    #: ``(url, status)`` for requests observed during the click.
    network: tuple[tuple[str, int], ...] = ()
    errors_visible: bool = False


@dataclass(slots=True)
class SubmissionVerdict:
    submitted: bool
    confidence: float
    signals: list[Signal] = field(default_factory=list)
    method: DetectionMethod = DetectionMethod.AUTOMATIC
    reason: str = ""

    @property
    def strong_count(self) -> int:
        return sum(1 for s in self.signals if s.strength is Strength.STRONG)

    @property
    def medium_count(self) -> int:
        return sum(1 for s in self.signals if s.strength is Strength.MEDIUM)

    @property
    def substantive_medium_count(self) -> int:
        """Medium signals about the form itself, rather than about navigation."""
        return sum(
            1 for s in self.signals if s.strength is Strength.MEDIUM and not s.is_navigational
        )


def _matches(patterns: tuple[re.Pattern[str], ...], haystack: str) -> str | None:
    for pattern in patterns:
        if match := pattern.search(haystack):
            return match.group(0)
    return None


def collect_signals(obs: Observation) -> list[Signal]:
    """Gather every submission signal visible in ``obs``."""
    signals: list[Signal] = []

    if obs.url_after != obs.url_before and (hit := _matches(_CONFIRMATION_URLS, obs.url_after)):
        signals.append(Signal("confirmation_url", Strength.STRONG, hit))

    if hit := _matches(_CONFIRMATION_TEXT, obs.text_after):
        signals.append(Signal("confirmation_text", Strength.STRONG, hit))

    submit_ok = any(
        200 <= status < 300 and _matches(_SUBMIT_ENDPOINTS, url) for url, status in obs.network
    )
    form_gone = obs.form_present_before and not obs.form_present_after
    if submit_ok and form_gone:
        # Neither half is conclusive alone: a 2xx can be a draft save, and a form
        # can vanish because the page re-rendered.
        signals.append(Signal("submit_request_and_form_replaced", Strength.STRONG))

    if obs.submit_button_present_before and not obs.submit_button_present_after:
        signals.append(Signal("submit_button_gone", Strength.MEDIUM))
    if form_gone:
        signals.append(Signal("form_replaced", Strength.MEDIUM))
    if not _matches(_CONFIRMATION_TEXT, obs.text_after) and _matches(_SOFT_TEXT, obs.text_after):
        signals.append(Signal("soft_success_text", Strength.MEDIUM))
    if obs.title_after and obs.title_after != obs.title_before:
        signals.append(Signal("title_changed", Strength.MEDIUM, obs.title_after))
    if obs.url_after != obs.url_before and not any(s.name == "confirmation_url" for s in signals):
        signals.append(Signal("url_changed", Strength.MEDIUM))

    return signals


def detect(obs: Observation) -> SubmissionVerdict:
    """Decide whether the application was submitted.

    Called on the page the worker is looking at just after it clicked Submit
    itself. Knowing a click was issued is not evidence of anything — this asks
    only what the employer's page now shows — so the bar is unchanged from when
    the same function watched the user click: one strong signal, or two medium
    ones of which at least one is about the form rather than about navigation
    (§7.10).

    That last clause exists because navigating away from a form produces a URL
    change and a title change together — two medium signals, and a reported
    submission that never happened. A real submission leaves a trace on the form:
    the button goes, the form is replaced, or the page says something.

    Visible validation errors veto the whole thing: a rejected form often
    re-renders and retitles, which otherwise mimics success closely. That is the
    common case now that the worker submits — a required question the fill pass
    could not see must come back as "not submitted", not as a guess.
    """
    signals = collect_signals(obs)
    verdict = SubmissionVerdict(submitted=False, confidence=0.0, signals=signals)

    if obs.errors_visible:
        verdict.reason = "validation errors are visible on the page"
        return verdict

    if verdict.strong_count >= 1:
        verdict.submitted = True
        verdict.confidence = min(0.9 + 0.03 * (len(signals) - 1), 0.99)
        verdict.reason = f"{verdict.strong_count} strong signal(s)"
        return verdict

    if verdict.medium_count >= 2 and verdict.substantive_medium_count >= 1:
        verdict.submitted = True
        verdict.confidence = min(0.6 + 0.05 * verdict.medium_count, 0.85)
        verdict.reason = f"{verdict.medium_count} medium signals"
        return verdict

    if verdict.medium_count >= 2:
        verdict.confidence = 0.3
        verdict.reason = "the page changed but the form shows no sign of submission"
        return verdict

    verdict.confidence = 0.3 if signals else 0.0
    verdict.reason = (
        "only one weak signal; awaiting confirmation"
        if signals
        else "no submission signals observed"
    )
    return verdict


def user_confirmed() -> SubmissionVerdict:
    """The fallback when detection misses: the user says so (§7.10)."""
    return SubmissionVerdict(
        submitted=True,
        confidence=1.0,
        method=DetectionMethod.USER_CONFIRMED,
        reason="the user marked this application as submitted",
    )
