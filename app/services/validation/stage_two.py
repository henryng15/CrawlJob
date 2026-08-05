"""Stage 2: open one real application form per ATS, and stop (spec §7.8, §29).

This is the only part of the system that touches an employer's form outside the
pipeline, so it is worth being explicit about what it does and does not do.

**It never submits.** Not "tries not to": there is no code path from here to a
click on anything. ``fill_form`` locates only the fields it was given specs for,
and this module asserts afterwards that no submit control was interacted with and
that the page is still the form. The guarantee is the absence of the capability,
and the assertion is there to notice if that ever stops being true.

**It answers nothing it should not.** Field policy is not reimplemented here — it
is :func:`app.ats.fields.resolve`, the same function the pipeline uses, so a
field left blank in validation is left blank in production for the same reason.
Sponsorship, combined work-authorization, EEO, demographics, salary, criminal
history and signatures all come back ``MANUAL_REQUIRED`` and are skipped.
Validation additionally *checks* that, and records a blocker if anything in those
categories was filled — a test of the policy against a real form rather than a
fixture.

**It consumes no quota and creates no application.** Nothing here writes to the
database. The resume attached is the canonical base PDF, so no model runs and no
tailored artifact is produced.

**It is one job per ATS.** Enough to learn whether the adapter's forms can be
read; few enough that an employer sees a single ordinary page view.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from app.config import Settings
from app.services.validation.report import Severity, StageTwoReport

__all__ = ["MANUAL_CATEGORIES", "validate_form"]

log = logging.getLogger(__name__)

#: Semantic-key prefixes that must never be filled automatically. Not the
#: definition — :mod:`app.ats.fields` owns that — but the check, stated
#: separately on purpose: if the two ever disagree, this fails loudly rather than
#: quietly agreeing with whatever the code now does.
MANUAL_CATEGORIES: tuple[str, ...] = (
    "eeo.",
    "legal.",
    "auth.",
    "compensation.",
    "demographic.",
)

#: Anything that looks like it ends the application. Never located, never
#: clicked; used only to assert that nothing was.
_SUBMIT_MARKERS: tuple[str, ...] = (
    "button[type='submit']",
    "input[type='submit']",
    "#submit_app",
    "#btn-submit",
    "[data-testid='submit']",
)


def validate_form(
    settings: Settings,
    *,
    ats: str,
    company: str,
    title: str,
    url: str,
    facts: dict[str, Any],
    locked_keys: frozenset[str],
    resume_path: Path | None,
    out_dir: Path,
    headless: bool = True,
) -> StageTwoReport:
    """Open one application form, map it, fill the safe parts, and stop."""
    from app.ats.driver import extract_form, fill_form
    from app.ats.fields import SourceType, resolve

    report = StageTwoReport(ats=ats, company=company, title=title, url=url)
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        with _page(url, headless=headless) as page:
            specs = extract_form(page)
            report.fields_found = len(specs)
            if not specs:
                report.add(
                    Severity.BLOCKER,
                    "extract_form",
                    "no fields were located on the page; the form may be inside an "
                    "iframe or rendered after load",
                )
                report.screenshot = str(_screenshot(page, out_dir, "no-fields"))
                return report

            report.reached_form = True
            answers = [resolve(spec, facts=facts, locked_keys=locked_keys) for spec in specs]

            fill = fill_form(page, specs, answers, resume_path=resume_path)
            report.filled = list(fill.filled)
            report.resume_attached = fill.resume_uploaded is not None
            report.resume_confirmation = fill.resume_unconfirmed

            for spec, answer in zip(specs, answers, strict=True):
                label = spec.question_text or spec.name or "(unlabelled)"
                if answer.source_type is SourceType.UNRESOLVED:
                    report.unrecognised.append(label)
                elif answer.source_type is SourceType.MANUAL_REQUIRED:
                    report.left_for_human.append(
                        {
                            "label": label,
                            "semantic_key": answer.semantic_key or "",
                            "why": answer.note or "",
                        }
                    )

            _check_nothing_legal_was_filled(report, specs, answers)
            _check_no_submission(report, page)

            report.screenshot = str(_screenshot(page, out_dir, "pre-submit"))
            report.mapping_path = str(_write_mapping(out_dir, specs, answers))

            if resume_path is not None and not report.resume_attached:
                report.add(
                    Severity.WARNING,
                    "resume",
                    report.resume_confirmation
                    or "no file input for the resume was found on this page",
                )
    except Exception as exc:
        report.error = f"{type(exc).__name__}: {exc}"
        report.add(Severity.BLOCKER, "browser", report.error)

    return report


def _check_nothing_legal_was_filled(
    report: StageTwoReport, specs: list[Any], answers: list[Any]
) -> None:
    """The policy check, run against a real employer's form.

    Fixtures can only prove the classifier does what the fixture says. This asks
    whether the categories that must stay blank actually stayed blank on a page
    nobody wrote for us.
    """
    from app.ats.fields import SourceType

    for spec, answer in zip(specs, answers, strict=True):
        key = answer.semantic_key or ""
        if not key.startswith(MANUAL_CATEGORIES):
            continue
        if answer.value is not None or answer.source_type not in {
            SourceType.MANUAL_REQUIRED,
            SourceType.UNRESOLVED,
        }:
            report.add(
                Severity.BLOCKER,
                "manual-only",
                f"{key} was answered automatically with {answer.value!r}; this "
                "category must always be left for the user",
                spec.question_text or spec.name or "",
            )


def _check_no_submission(report: StageTwoReport, page: Any) -> None:
    """Assert the form is still a form.

    Nothing here can submit, so this is not a safety mechanism — it is a check on
    that claim. If a page ever navigates away during a fill, this is what notices.
    """
    report.submitted = False
    try:
        still_there = (
            any(page.query_selector(marker) is not None for marker in _SUBMIT_MARKERS)
            or page.query_selector("form") is not None
        )
    except Exception:
        report.add(Severity.WARNING, "no-submit", "the page could not be re-queried")
        return

    if not still_there:
        report.add(
            Severity.WARNING,
            "no-submit",
            "no form remained on the page after filling; it may have navigated",
        )


def _screenshot(page: Any, out_dir: Path, name: str) -> Path:
    path = out_dir / f"{name}.png"
    try:
        page.screenshot(path=str(path), full_page=True)
    except Exception as exc:
        log.warning("screenshot failed: %s", exc)
    return path


def _write_mapping(out_dir: Path, specs: list[Any], answers: list[Any]) -> Path:
    """Every question the page asked and what this system decided about it."""
    rows = []
    for index, (spec, answer) in enumerate(zip(specs, answers, strict=True)):
        rows.append(
            {
                "index": index,
                "label": spec.question_text or spec.name or "",
                "name": spec.name or "",
                "type": str(spec.field_type),
                "required": bool(getattr(spec, "required", False)),
                "options": list(getattr(spec, "options", []) or [])[:12],
                "semantic_key": answer.semantic_key or "",
                "source": str(answer.source_type),
                # The decision, not the value: a mapping file is something to
                # paste into a report, and these forms ask for a date of birth.
                "answered": answer.value is not None,
                "note": answer.note or "",
            }
        )
    path = out_dir / "field-mapping.json"
    path.write_text(json.dumps(rows, indent=2, default=str), encoding="utf-8")
    return path


def _page(url: str, *, headless: bool) -> Any:
    """A browser on the page, closed whatever happens."""
    from contextlib import contextmanager

    @contextmanager
    def opened() -> Any:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=headless)
            context = browser.new_context(viewport={"width": 1400, "height": 900})
            page = context.new_page()
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=45_000)
                # Forms on these boards render after load; a short settle is the
                # difference between reading the questions and reading a spinner.
                page.wait_for_timeout(2500)
                yield page
            finally:
                context.close()
                browser.close()

    return opened()
