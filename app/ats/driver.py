"""Playwright form driver (spec §7.8, §5.7, Milestone 0).

Extracts a form's questions, fills the answers policy allows, uploads the resume,
and stops. There is no code path from here to a Submit click: ``fill_form`` never
locates a submit control, and ``assert_safe_to_review`` runs before the slot is
handed to the user.

Locators are tried in the order :mod:`app.ats.replay` records them — accessible
label first, CSS selector last — because that order is what survives an ATS
redesign. When no locator resolves, the field is reported unfilled rather than
being written into a best-guess element.

Playwright is imported lazily so that importing this module, and running the rest
of the suite, does not require a browser to be installed.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol

from app.ats.fields import Answer, FieldSpec, FieldType, SourceType
from app.ats.replay import LocatorStrategy, Strategy, build_locators

if TYPE_CHECKING:  # pragma: no cover - typing only
    from playwright.sync_api import Locator, Page

__all__ = ["CAPTCHA_MARKERS", "FillReport", "detect_captcha", "extract_form", "fill_form"]

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
    """What one fill pass achieved."""

    filled: list[str] = field(default_factory=list)
    skipped_manual: list[str] = field(default_factory=list)
    not_found: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    captcha_detected: bool = False

    @property
    def needs_human(self) -> bool:
        return bool(self.skipped_manual or self.not_found or self.captcha_detected)

    def summary(self) -> str:
        return (
            f"{len(self.filled)} filled, {len(self.skipped_manual)} left for the user, "
            f"{len(self.not_found)} not located"
            + (", CAPTCHA present" if self.captcha_detected else "")
        )


def detect_captcha(page: SupportsQuery) -> bool:
    """Whether the page carries a challenge a human must solve.

    A positive result sends the application to the manual queue. The system does
    not attempt, outsource, or work around it.
    """
    return any(page.query_selector(marker) is not None for marker in CAPTCHA_MARKERS)


def extract_form(page: Page, *, form_selector: str = "form") -> list[FieldSpec]:
    """Read every question on a form into :class:`FieldSpec` objects.

    Labels are resolved from ``<label for>``, then ``aria-label``, then the
    placeholder — the same order a screen reader would use, and the order that
    gives a stable question text for the field taxonomy to classify.
    """
    specs: list[FieldSpec] = []
    form = page.query_selector(form_selector)
    if form is None:
        return specs

    for element in form.query_selector_all("input, select, textarea"):
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


def _label_for(page: Page, element: Any, element_id: str | None) -> str:
    if element_id:
        label = page.query_selector(f'label[for="{element_id}"]')
        if label is not None:
            return str(label.inner_text()).strip()
    for attribute in ("aria-label", "placeholder", "title"):
        if value := element.get_attribute(attribute):
            return str(value).strip()
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
    """
    report = FillReport(captcha_detected=detect_captcha(page))

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

        if not is_resume_upload:
            if answer.source_type in {SourceType.MANUAL_REQUIRED, SourceType.UNRESOLVED}:
                report.skipped_manual.append(label)
                continue
            if answer.value is None:
                report.skipped_manual.append(label)
                continue

        target = None
        for locator in build_locators(spec):
            target = _resolve_locator(page, locator)
            if target is not None:
                break

        if target is None:
            report.not_found.append(label)
            continue

        try:
            _apply(target, spec, answer, resume_path)
            report.filled.append(label)
        except Exception as exc:
            report.errors.append(f"{label}: {type(exc).__name__}: {exc}")
            report.not_found.append(label)

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
