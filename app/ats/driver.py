"""Playwright form driver (spec §7.8, §5.7, Milestone 0).

Extracts a form's questions, fills the answers policy allows, uploads the resume,
and — when nothing is blocking — clicks Submit. :func:`submit_form` is the only
place in the system where that click may happen, and it refuses whenever the page
offers anything other than exactly one submit control.

Two rules shape everything here:

**Only required fields block.** An unanswered optional question is a form the user
chose not to embellish; an unanswered *required* one is a form that cannot legally
be filed on their behalf. Treating both as blocking is what kept the auto-submit
rate at zero, so :class:`FillReport` reports them separately.

**Never guess.** Locators are tried in the order :mod:`app.ats.locators` builds
them — accessible label first, CSS selector last — because that order is what
survives an ATS redesign. When no locator resolves the field is reported unfilled rather
than written into a best-guess element, and when the answer is not available the
application goes to the user rather than being invented.

Playwright is imported lazily so that importing this module, and running the rest
of the suite, does not require a browser to be installed.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol

from app.ats.fields import Answer, FieldSpec, FieldType
from app.ats.locators import LocatorStrategy, Strategy, build_locators
from app.ats.submission import Observation, SubmissionVerdict, detect

if TYPE_CHECKING:  # pragma: no cover - typing only
    from playwright.sync_api import Locator, Page

log = logging.getLogger(__name__)

__all__ = [
    "CAPTCHA_MARKERS",
    "ERROR_MARKERS",
    "SUBMIT_NAME",
    "FillReport",
    "SubmitOutcome",
    "attached_filenames",
    "detect_captcha",
    "extract_form",
    "fill_form",
    "find_submit_control",
    "submit_form",
]

#: Selectors that mean a human must take over. The system never attempts these
#: (AGENTS.md: no CAPTCHA bypass, ever).
CAPTCHA_MARKERS: tuple[str, ...] = (
    "iframe[src*='recaptcha']",
    "iframe[src*='hcaptcha']",
    "iframe[title*='challenge']",
    "[data-sitekey]",
    ".g-recaptcha",
    ".h-captcha",
    ".captcha",
    "#cf-challenge-running",
)

_TYPE_BY_INPUT: dict[str, FieldType] = {
    "text": FieldType.TEXT,
    "email": FieldType.EMAIL,
    "tel": FieldType.PHONE,
    "url": FieldType.URL,
    "number": FieldType.NUMBER,
    "date": FieldType.DATE,
    "month": FieldType.DATE,
    "file": FieldType.FILE,
    "checkbox": FieldType.CHECKBOX,
    "radio": FieldType.RADIO,
}


class SupportsQuery(Protocol):
    """The slice of Playwright's Page this module uses."""

    def query_selector_all(self, selector: str) -> list[Any]: ...
    def query_selector(self, selector: str) -> Any | None: ...


@dataclass(slots=True)
class FillReport:
    """What one fill pass achieved, and whether it may be submitted.

    The three per-field lists are the audit trail: every question, and what became
    of it. ``blocking_questions`` is the much shorter subset that actually stops
    the application — a required question with no answer, or a required field the
    page did not yield an element for. An optional question left empty appears in
    ``skipped_manual`` and nowhere else, because a form that omits a cover letter
    is a complete form.
    """

    filled: list[str] = field(default_factory=list)
    skipped_manual: list[str] = field(default_factory=list)
    not_found: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    #: The question texts a human must answer before this can be submitted. Shown
    #: verbatim on the dashboard, so they are the labels the user will read on the
    #: employer's own page rather than internal semantic keys.
    blocking_questions: list[str] = field(default_factory=list)
    captcha_detected: bool = False
    #: The resume file the browser **confirmed** is attached to a file input.
    #: ``None`` means no resume reached the form: the field was absent, setting it
    #: raised, or reading the input back afterwards did not show the file. It is
    #: recorded here rather than assumed by the caller, because "we produced a PDF"
    #: and "the employer has the PDF" are different claims and only the browser
    #: knows the second one.
    resume_uploaded: Path | None = None
    #: Why the attachment was not confirmed, when it was not. Empty on success and
    #: when there was no resume to attach in the first place.
    resume_unconfirmed: str = ""

    @property
    def blocked(self) -> bool:
        """Whether this application must go to the user instead of being sent."""
        return bool(self.captcha_detected or self.blocking_questions)

    @property
    def block_reason(self) -> str:
        """One sentence for the dashboard. Empty when nothing is blocking."""
        if self.captcha_detected:
            # AGENTS.md: never attempted, never outsourced, never worked around.
            return "The form carries a CAPTCHA, which only you can solve."
        if not self.blocking_questions:
            return ""
        count = len(self.blocking_questions)
        shown = ", ".join(self.blocking_questions[:3])
        more = f", and {count - 3} more" if count > 3 else ""
        return (
            f"{count} required question{'' if count == 1 else 's'} "
            f"could not be answered from your locked facts: {shown}{more}."
        )

    def summary(self) -> str:
        return (
            f"{len(self.filled)} filled, {len(self.skipped_manual)} left for the user, "
            f"{len(self.not_found)} not located"
            + (f", {len(self.blocking_questions)} blocking" if self.blocking_questions else "")
            + (", CAPTCHA present" if self.captcha_detected else "")
            + ("" if self.resume_uploaded else ", no resume attached")
        )


def attached_filenames(target: Any) -> list[str] | None:
    """The filenames the browser reports on a file input.

    ``None`` means the question could not be asked — an element that does not
    support evaluation, or a browser that errored. That is deliberately different
    from ``[]``, which is the browser stating that nothing is attached: one is
    ignorance, the other is a fact, and only the second is evidence.
    """
    try:
        names = target.evaluate("el => el.files ? Array.from(el.files).map(f => f.name) : null")
    except Exception as exc:  # pragma: no cover - depends on the page
        log.warning("could not read back the file input: %s", type(exc).__name__)
        return None
    if names is None:
        return None
    if not isinstance(names, list):  # pragma: no cover - defensive
        return None
    return [str(name) for name in names]


def _confirm_attachment(target: Any, resume_path: Path) -> str:
    """Check the expected file is on the input. Returns why not, or "" if it is.

    ``set_input_files`` returning is not proof: the element may have been replaced
    by the page's own JavaScript, an upload widget may reject the type, or the
    handler may clear the field. Reading the input back turns "we called the API"
    into "the browser says the file is there", which is the claim the database
    records.
    """
    names = attached_filenames(target)
    if names is None:
        return "the browser could not confirm the attachment"
    if not names:
        return "the file input is empty after setting it"
    if resume_path.name not in names:
        return f"the input holds {', '.join(names)} rather than {resume_path.name}"
    return ""


#: A challenge that is presented regardless of what is on the page. Cloudflare's
#: interstitial replaces the document, so there is nothing else to look at.
_INTERSTITIAL = "#cf-challenge-running"

#: The "protected by reCAPTCHA" badge. It is an iframe matching
#: ``iframe[src*='recaptcha']``, it is visible, and it asks the user for
#: nothing — it is a legal notice with a logo on it.
_BADGE = ".grecaptcha-badge"


def detect_captcha(page: SupportsQuery) -> bool:
    """Whether a challenge is being **presented** to a human on this page.

    Not the same question as "does this page use anti-abuse tooling", and the
    difference decides whether the auto lane exists at all. Measured on the three
    boards that make up 63% of it:

    * Ashby — an invisible reCAPTCHA iframe. Not visible, no challenge shown.
    * Lever — invisible hCaptcha frames. Not visible, no challenge shown.
    * Greenhouse — the visible 256x60 "protected by reCAPTCHA" badge.

    A human fills in all three and is never asked to identify a bus. Treating
    the presence of the tooling as a challenge refused every one of them, which
    is not caution — it is answering a different question than the one asked.

    This changes nothing about the rule in AGENTS.md. A challenge that *is*
    shown still ends the attempt, and the system still has no code that solves,
    outsources or evades one: no stealth flags, no solver, no token injection.
    If an invisible check scores us badly, the employer's form rejects the
    submission and :func:`submit_form` reads that off the page — the verdict
    rests on the confirmation, never on having clicked.
    """
    if page.query_selector(_INTERSTITIAL) is not None:
        return True
    for marker in CAPTCHA_MARKERS:
        if marker == _INTERSTITIAL:
            continue
        found: list[Any] = _quiet(lambda m=marker: page.query_selector_all(m), [])
        if any(_is_a_challenge(element) for element in found):
            return True
    return False


def _is_a_challenge(element: Any) -> bool:
    """Whether this marker is something a person is being asked to solve."""
    if not _quiet(element.is_visible, False):
        return False
    # The badge is visible on every Greenhouse form and asks for nothing.
    if _quiet(lambda: element.evaluate(f"el => !!el.closest('{_BADGE}')"), False):
        return False
    # A zero-height container is a placeholder the widget was never drawn into;
    # Lever renders two of them on a form nobody is challenged on.
    box: Any = _quiet(element.bounding_box, None)
    if box is None:
        return False
    return bool(box["height"] > 0)


#: How long to wait for a form to appear before deciding there is not one.
#: Ashby, Lever and Workday render theirs from JavaScript after the document is
#: ready, and reading the page at ``domcontentloaded`` found zero fields on nine
#: of eleven real applications.
FORM_RENDER_TIMEOUT_MS = 15_000

_FIELD_SELECTOR = "input, select, textarea"


#: How many real fields make a page an application form rather than a page that
#: happens to contain an input. An iCIMS description page carries a "Search
#: sri.com" box and nothing else; treating that as the form meant the Apply
#: button was never pressed, and the application was reported as having one
#: unanswerable question called "Search sri.com".
MINIMUM_FORM_FIELDS = 4


def looks_like_a_form(page: Any) -> bool:
    """Whether this document is plausibly an application form.

    A file input settles it on its own — a page asking for a document is asking
    for a résumé. Otherwise it takes several fields, because one or two is a
    search box, a newsletter signup or a cookie preference.
    """
    if _quiet(lambda: len(page.query_selector_all("input[type=file]")), 0):
        return True
    fields: list[Any] = _quiet(lambda: page.query_selector_all(_FIELD_SELECTOR), [])
    real = [
        f
        for f in fields
        if (f.get_attribute("type") or "text").lower()
        not in {"hidden", "submit", "button", "image", "reset", "search"}
    ]
    return len(real) >= MINIMUM_FORM_FIELDS


def wait_for_form(page: Page, *, timeout_ms: int = FORM_RENDER_TIMEOUT_MS) -> bool:
    """Wait for a form to render. ``False`` if none ever does.

    Not an error: a posting page with no form is the ordinary case for Ashby and
    Lever, whose apply form lives at a different URL, and for Workday, whose
    form is behind a button. The caller decides what to do about it.
    """
    deadline = timeout_ms
    while deadline > 0:
        if any(looks_like_a_form(document) for document in _documents(page)):
            # One more beat: the first input appearing does not mean the last
            # one has.
            page.wait_for_timeout(1_500)
            return True
        page.wait_for_timeout(500)
        deadline -= 500
    return False


def extract_form(page: Page, *, form_selector: str = "form") -> list[FieldSpec]:
    """Read every question on a form into :class:`FieldSpec` objects.

    Labels are resolved from ``<label for>``, then ``aria-label``, then the
    placeholder — the same order a screen reader would use, and the order that
    gives a stable question text for the field taxonomy to classify.

    ``form_selector`` is a preference, not a requirement. Ashby renders 35
    inputs and two file pickers with no ``<form>`` element anywhere on the page,
    so insisting on one read that application as having no questions at all.
    Falling back to the whole document is what makes Ashby and every other
    React-rendered board readable; the field taxonomy is what keeps the extra
    inputs from being answered.
    """
    documents = _documents(page)
    specs: list[FieldSpec] = []
    for document in documents:
        specs.extend(_extract_one(document, form_selector))
    return specs


def _documents(page: Page) -> list[Any]:
    """The page, plus any frame that holds a form.

    iCIMS serves the application inside an ``<iframe>`` and leaves the outer
    page holding a site search box. Reading only the top document found one
    field there — the search box — and called it the application.
    """
    documents: list[Any] = [page]
    frames: list[Any] = _quiet(lambda: list(page.frames), [])
    main = _quiet(lambda: page.main_frame, None)
    for frame in frames:
        if frame is main:
            continue
        if _quiet(lambda f=frame: len(f.query_selector_all(_FIELD_SELECTOR)), 0):
            documents.append(frame)
    return documents


def _quiet[T](call: Any, default: T) -> T:
    """A cross-frame read that fails is a frame we cannot see into, not an error."""
    try:
        return call()  # type: ignore[no-any-return]
    except Exception:  # pragma: no cover - depends on the page
        return default


def _extract_one(page: Any, form_selector: str) -> list[FieldSpec]:
    specs: list[FieldSpec] = []
    root: Any = page.query_selector(form_selector) or page

    for element in root.query_selector_all(_FIELD_SELECTOR):
        input_type = (element.get_attribute("type") or "text").lower()
        if input_type in {"hidden", "submit", "button", "image", "reset"}:
            continue

        name = element.get_attribute("name")
        element_id = element.get_attribute("id")
        tag = (element.evaluate("el => el.tagName") or "").lower()

        if tag == "textarea":
            field_type = FieldType.TEXTAREA
        elif tag == "select":
            field_type = (
                FieldType.MULTISELECT
                if element.get_attribute("multiple") is not None
                else FieldType.SELECT
            )
        else:
            field_type = _TYPE_BY_INPUT.get(input_type, FieldType.TEXT)

        label = _label_for(page, element, element_id)
        options = tuple(
            (o.get_attribute("value") or o.inner_text()).strip()
            for o in element.query_selector_all("option")
            if (o.get_attribute("value") or o.inner_text()).strip()
        )

        specs.append(
            FieldSpec(
                question_text=label,
                field_type=field_type,
                name=name,
                required=element.get_attribute("required") is not None,
                options=options,
                locator={"css": f"#{element_id}"} if element_id else {},
            )
        )

    return specs


#: Read the question text the way a screen reader would, in the browser rather
#: than over five round trips from Python.
#:
#: The last clause is the one that matters in practice. Lever renders 19 fields
#: and gives exactly one of them a ``<label for>``: the rest are wrapped in an
#: ``<li>`` whose first line of text is the question. Without it a Lever
#: application is 18 unlabelled fields, which is to say 18 unanswerable ones.
_LABEL_JS = """
el => {
  const clean = s => (s || '').replace(/\\s+/g, ' ').trim();
  if (el.id) {
    const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
    if (l && clean(l.innerText)) return clean(l.innerText);
  }
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const text = by.split(/\\s+/)
      .map(i => document.getElementById(i))
      .filter(Boolean)
      .map(n => clean(n.innerText))
      .join(' ');
    if (clean(text)) return clean(text);
  }
  const wrapper = el.closest('label');
  if (wrapper && clean(wrapper.innerText)) return clean(wrapper.innerText);
  for (const a of ['aria-label', 'placeholder', 'title']) {
    const v = el.getAttribute(a);
    if (clean(v)) return clean(v);
  }
  // Boards that group a question and its inputs in one container, with the
  // question as the container's first line.
  const group = el.closest('li, fieldset, [class*="question"], [class*="field"]');
  if (group) {
    const first = clean((group.innerText || '').split('\\n')[0]);
    // A container holding the whole form would return the form's first line,
    // which is a heading rather than this field's question.
    if (first && first.length <= 160) return first;
  }
  return '';
}
"""


def _label_for(page: Page, element: Any, element_id: str | None) -> str:
    """The question text for one field, or "" when the page gives none.

    ``page`` and ``element_id`` are unused now that the lookup happens inside
    the browser; they stay in the signature because callers pass them and the
    parameters document what the JS above has access to.
    """
    del page, element_id
    try:
        return str(element.evaluate(_LABEL_JS) or "").strip()
    except Exception:  # pragma: no cover - a detached node during a re-render
        return ""


def _resolve_locator(page: Page, locator: LocatorStrategy) -> Locator | None:
    """Turn one recorded strategy into a Playwright locator, if it resolves."""
    try:
        match locator.strategy:
            case Strategy.ACCESSIBLE_LABEL:
                found = page.get_by_label(locator.value, exact=False)
            case Strategy.ARIA_ROLE_NAME if locator.role:
                found = page.get_by_role(locator.role, name=locator.value)  # type: ignore[arg-type]
            case Strategy.NAME_ATTRIBUTE:
                found = page.locator(f'[name="{locator.value}"]')
            case Strategy.CSS_SELECTOR:
                found = page.locator(locator.value)
            case _:
                return None
    except Exception:  # a malformed selector must not abort the whole fill
        return None

    return found if found.count() == 1 else None


def fill_form(
    page: Page,
    specs: list[FieldSpec],
    answers: list[Answer],
    *,
    resume_path: Path | None = None,
) -> FillReport:
    """Fill every field policy allows, and leave the rest alone.

    Manual and unresolved answers are recorded as work for the user and never
    typed. A field whose locators do not resolve is reported rather than guessed
    at: writing an answer into the wrong element produces a form that looks
    plausible and is wrong, which is the hardest kind of error for a reviewer to
    catch.

    Whether that work *blocks* the submission is decided by ``spec.required``
    alone, so an employer's optional cover letter costs nothing and their required
    school name costs everything.
    """
    report = FillReport(captcha_detected=detect_captcha(page))

    def block(spec: FieldSpec, label: str) -> None:
        if spec.required and label not in report.blocking_questions:
            report.blocking_questions.append(label)

    for spec, answer in zip(specs, answers, strict=True):
        label = spec.question_text or spec.name or "(unlabelled)"

        # The resume is an artifact this worker produced, not a candidate fact, so
        # resolve() has nothing to offer for it. Only the resume field is handled
        # this way: a cover-letter or transcript upload is still the user's job,
        # and attaching a resume to one would be worse than leaving it empty.
        is_resume_upload = (
            spec.field_type is FieldType.FILE
            and answer.semantic_key == "documents.resume"
            and resume_path is not None
        )

        if not is_resume_upload and (answer.needs_human or answer.value is None):
            report.skipped_manual.append(label)
            block(spec, label)
            continue

        target = None
        for locator in build_locators(spec):
            target = _resolve_locator(page, locator)
            if target is not None:
                break

        if target is None:
            report.not_found.append(label)
            block(spec, label)
            continue

        try:
            _apply(target, spec, answer, resume_path)
            report.filled.append(label)
            if is_resume_upload and resume_path is not None:
                # Set, then read back. ``set_input_files`` returning says the call
                # was made; only the input's own file list says the employer's form
                # is actually holding the document. Anything short of the expected
                # filename leaves the version selected-but-not-uploaded.
                reason = _confirm_attachment(target, resume_path)
                if reason:
                    report.resume_unconfirmed = reason
                    report.errors.append(f"{label}: {reason}")
                    report.not_found.append(label)
                    block(spec, label)
                else:
                    report.resume_uploaded = resume_path
        except Exception as exc:
            report.errors.append(f"{label}: {type(exc).__name__}: {exc}")
            report.not_found.append(label)
            block(spec, label)
            if is_resume_upload:
                report.resume_unconfirmed = f"{type(exc).__name__} while attaching it"

    return report


def _apply(target: Locator, spec: FieldSpec, answer: Answer, resume_path: Path | None) -> None:
    match spec.field_type:
        case FieldType.FILE:
            if resume_path is None:
                raise ValueError("a file field was reached with no resume to upload")
            target.set_input_files(str(resume_path))
        case FieldType.CHECKBOX:
            target.set_checked(bool(answer.value))
        case FieldType.SELECT | FieldType.MULTISELECT:
            target.select_option(_option_for(answer.value, spec.options))
        case FieldType.RADIO:
            target.check()
        case _:
            target.fill(str(answer.value))


#: Names that mean "this button files the application". Matched against a
#: control's accessible name, so it catches the ``<button>Submit Application
#: </button>`` that carries no ``type`` attribute at all.
SUBMIT_NAME: re.Pattern[str] = re.compile(r"submit|apply|send application", re.I)

#: Where a submit control may live. Deliberately narrow — a link styled as a
#: button is not clicked, because "Apply on company site" is one of those.
_SUBMIT_CANDIDATES = "button, input[type='submit'], input[type='button']"

#: Markers an ATS uses to render a rejected form. Their presence vetoes a
#: submitted verdict (§7.10), so a validation failure cannot read as success.
ERROR_MARKERS: tuple[str, ...] = (
    "[role='alert']",
    ".errors",
    ".error",
    ".field-error",
    "[aria-invalid='true']",
)


@dataclass(frozen=True, slots=True)
class SubmitOutcome:
    """What came of one attempt to submit.

    ``clicked`` and ``verdict.submitted`` answer different questions and both are
    recorded: the first is what this process did, the second is what the employer's
    page says happened. A click with no verdict is a click whose result we could
    not read, which is not the same as a failure.
    """

    #: Whether the Submit control was actually clicked.
    clicked: bool
    #: Whether this run was configured never to click.
    dry_run: bool
    #: One sentence: why we refused, or what the page said afterwards.
    reason: str
    #: The accessible name of the control, once one was resolved unambiguously.
    control: str = ""
    #: The page before and after, as :func:`app.ats.submission.detect` reads it.
    observation: Observation | None = None
    #: ``None`` when nothing was clicked, so there is nothing to judge.
    verdict: SubmissionVerdict | None = None

    @property
    def submitted(self) -> bool:
        return self.verdict is not None and self.verdict.submitted


def find_submit_control(page: SupportsQuery) -> tuple[Any, str]:
    """The one control that submits this form, or ``None`` and why not.

    Returns the element and its accessible name, or ``(None, reason)``. Two
    plausible Submit buttons is the case that must never be guessed at: the click
    cannot be undone, and clicking the wrong one either does nothing or files
    something the user never saw. So anything but exactly one match refuses.
    """
    matches: list[tuple[Any, str]] = []
    for element in page.query_selector_all(_SUBMIT_CANDIDATES):
        if not _is_visible(element):
            continue
        name = _accessible_name(element)
        if _is_submit_typed(element) or SUBMIT_NAME.search(name):
            matches.append((element, name or "(unnamed)"))

    if not matches:
        return None, "no submit control is present on the page"
    if len(matches) > 1:
        offered = ", ".join(name for _, name in matches)
        return None, f"the page offers {len(matches)} possible submit controls ({offered})"
    return matches[0]


def submit_form(page: Page, *, dry_run: bool) -> SubmitOutcome:
    """Click Submit and read what the employer's page says came of it.

    The only place in the system where an application is filed. Everything that
    decides *whether* to call it — the required-field rule, the daily cap, the
    manual-only employer list — lives in the caller; everything that decides
    whether it *worked* lives in :mod:`app.ats.submission`. This function only
    does the clicking and the looking, and holds no database or queue state.

    Args:
        page: the filled form.
        dry_run: locate the control, read the page, log it — but do not click.
    """
    control, control_name = find_submit_control(page)
    if control is None:
        return SubmitOutcome(
            clicked=False, dry_run=dry_run, reason=f"refusing to submit: {control_name}"
        )

    before = _read(page)

    if dry_run:
        # Everything above ran, so a dry run still proves the control exists and
        # is unambiguous — which is most of what can go wrong.
        log.info("dry run: located submit control %r on %s", control_name, before.url)
        return SubmitOutcome(
            clicked=False,
            dry_run=True,
            reason="dry run: the submit control was located but not clicked",
            control=control_name,
            observation=_observation(before, before, ()),
        )

    network: list[tuple[str, int]] = []

    def record(response: Any) -> None:
        network.append((str(response.url), int(response.status)))

    # Playwright reports every response on the page, including the one the form
    # POSTs to, which is the only way _SUBMIT_ENDPOINTS can ever see a status.
    page.on("response", record)
    try:
        control.click()
        _settle(page)
    finally:
        page.remove_listener("response", record)

    observation = _observation(before, _read(page), tuple(network))
    verdict = detect(observation)
    log.info("submitted=%s (%s)", verdict.submitted, verdict.reason)
    return SubmitOutcome(
        clicked=True,
        dry_run=False,
        reason=verdict.reason,
        control=control_name,
        observation=observation,
        verdict=verdict,
    )


@dataclass(frozen=True, slots=True)
class _Reading:
    """One look at the page, taken before and after the click."""

    url: str
    title: str
    text: str
    form_present: bool
    submit_present: bool
    errors_visible: bool


def _read(page: Page, *, form_selector: str = "form") -> _Reading:
    return _Reading(
        url=page.url,
        title=_quietly(page.title, ""),
        text=_quietly(lambda: page.inner_text("body"), ""),
        form_present=page.query_selector(form_selector) is not None,
        submit_present=find_submit_control(page)[0] is not None,
        errors_visible=_errors_visible(page),
    )


def _observation(
    before: _Reading, after: _Reading, network: tuple[tuple[str, int], ...]
) -> Observation:
    return Observation(
        url_before=before.url,
        url_after=after.url,
        text_after=after.text,
        title_before=before.title,
        title_after=after.title,
        submit_button_present_before=before.submit_present,
        submit_button_present_after=after.submit_present,
        form_present_before=before.form_present,
        form_present_after=after.form_present,
        network=network,
        errors_visible=after.errors_visible,
    )


def _settle(page: Page, *, timeout_ms: float = 10_000) -> None:
    """Wait for the page to finish reacting to the click.

    Both waits are best-effort: a page that keeps a socket open never reaches
    ``networkidle``, and giving up on the wait is not the same as the submission
    having failed — the reading afterwards decides that.
    """
    for state in ("load", "networkidle"):
        try:
            page.wait_for_load_state(state, timeout=timeout_ms)
        except Exception as exc:  # pragma: no cover - timing dependent
            log.debug("page did not reach %s: %s", state, type(exc).__name__)


def _errors_visible(page: SupportsQuery) -> bool:
    for marker in ERROR_MARKERS:
        element = page.query_selector(marker)
        if element is not None and _is_visible(element):
            return True
    return False


def _is_visible(element: Any) -> bool:
    """Whether the browser is showing this element.

    Unknown counts as visible: an element we cannot ask about still counts toward
    ambiguity, and the safe direction there is refusing to click.
    """
    return bool(_quietly(element.is_visible, True))


def _is_submit_typed(element: Any) -> bool:
    return (element.get_attribute("type") or "").strip().lower() == "submit"


def _accessible_name(element: Any) -> str:
    """What a screen reader would announce for a control, near enough."""
    for source in (
        element.get_attribute("aria-label"),
        element.get_attribute("value"),
        _quietly(element.inner_text, ""),
        element.get_attribute("title"),
    ):
        if source and str(source).strip():
            return str(source).strip()
    return ""


def _quietly[T](call: Callable[[], T], default: T) -> T:
    try:
        return call()
    except Exception:  # pragma: no cover - depends on the page
        return default


def _option_for(value: Any, options: tuple[str, ...]) -> str:
    """Map an answer onto one of the select's actual options.

    A boolean answer to "Do you require sponsorship?" has to become the literal
    "Yes" or "No" the form offers, and matching is case-insensitive because forms
    are inconsistent about it.
    """
    wanted = ("yes" if value else "no") if isinstance(value, bool) else str(value).strip().lower()

    for option in options:
        if option.strip().lower() == wanted:
            return option
    return str(value)
