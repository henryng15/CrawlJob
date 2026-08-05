"""Confirming the resume is actually on the form (spec §7.8, §22.4).

``set_input_files`` returning means the call was made. It does not mean the
employer's form is holding the document. The page's own JavaScript may replace the
element, an upload widget may reject the file type, a handler may clear the field —
and Playwright reports none of that, because from its side nothing went wrong.

So the input is read back and the expected filename looked for. Only that turns
"we called the API" into "the browser says the file is there", and only the second
is a fact worth writing into the database as an upload.

The distinction between "the browser says nothing is attached" and "the browser
could not be asked" is deliberate and load-bearing: one is evidence, the other is
ignorance, and neither may be recorded as success.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from app.ats.driver import FillReport, attached_filenames, fill_form
from app.ats.fields import Answer, FieldSpec, FieldType, SourceType


class FakeLocator:
    """A file input that reports whatever the test says it holds."""

    def __init__(self, *, holds: list[str] | None = None, raises: bool = False) -> None:
        self.holds = holds
        self.raises = raises
        self.set_files: list[str] = []

    def count(self) -> int:
        """The driver only uses a locator that resolves to exactly one element."""
        return 1

    def set_input_files(self, path: str) -> None:
        self.set_files.append(path)

    def evaluate(self, script: str) -> Any:
        if self.raises:
            raise RuntimeError("execution context was destroyed")
        return self.holds


class FakePage:
    """Resolves every locator to one element, and detects no CAPTCHA."""

    def __init__(self, target: FakeLocator) -> None:
        self.target = target

    def query_selector_all(self, selector: str) -> list[Any]:
        return []

    def query_selector(self, selector: str) -> Any | None:
        return None

    def get_by_label(self, *args: Any, **kwargs: Any) -> FakeLocator:
        return self.target

    def locator(self, *args: Any, **kwargs: Any) -> FakeLocator:
        return self.target


@pytest.fixture
def resume(tmp_path: Path) -> Path:
    path = tmp_path / "resume.pdf"
    path.write_bytes(b"%PDF-1.7\n")
    return path


def resume_field() -> tuple[FieldSpec, Answer]:
    spec = FieldSpec(question_text="Resume", name="resume", field_type=FieldType.FILE)
    answer = Answer(
        semantic_key="documents.resume",
        value=None,
        source_type=SourceType.MANUAL_REQUIRED,
    )
    return spec, answer


def run(page: FakePage, resume: Path | None) -> FillReport:
    spec, answer = resume_field()
    return fill_form(page, [spec], [answer], resume_path=resume)


class TestReadingTheInputBack:
    def test_the_filenames_the_browser_reports_are_returned(self):
        assert attached_filenames(FakeLocator(holds=["resume.pdf"])) == ["resume.pdf"]

    def test_an_empty_list_means_nothing_is_attached(self):
        assert attached_filenames(FakeLocator(holds=[])) == []

    def test_an_element_that_cannot_be_asked_returns_none(self):
        """Not ``[]``.

        "The browser says the input is empty" and "the browser could not tell me"
        are different facts, and collapsing them would let ignorance be recorded as
        either success or a definite failure.
        """
        assert attached_filenames(FakeLocator(raises=True)) is None

    def test_an_input_with_no_files_property_returns_none(self):
        assert attached_filenames(FakeLocator(holds=None)) is None


class TestAConfirmedAttachment:
    def test_the_report_names_the_file(self, resume: Path):
        report = run(FakePage(FakeLocator(holds=[resume.name])), resume)
        assert report.resume_uploaded == resume
        assert report.resume_unconfirmed == ""

    def test_the_file_was_actually_set(self, resume: Path):
        target = FakeLocator(holds=[resume.name])
        run(FakePage(target), resume)
        assert target.set_files == [str(resume)]

    def test_it_counts_as_filled(self, resume: Path):
        report = run(FakePage(FakeLocator(holds=[resume.name])), resume)
        assert report.filled == ["Resume"]
        assert report.not_found == []


class TestAnUnconfirmedAttachment:
    def test_an_empty_input_after_setting_is_not_an_upload(self, resume: Path):
        """The upload widget swallowed it, or a handler cleared the field."""
        report = run(FakePage(FakeLocator(holds=[])), resume)
        assert report.resume_uploaded is None
        assert "empty after setting" in report.resume_unconfirmed

    def test_a_different_filename_is_not_an_upload(self, resume: Path):
        """Whatever is on the form is not the document that was chosen."""
        report = run(FakePage(FakeLocator(holds=["someone-elses.pdf"])), resume)
        assert report.resume_uploaded is None
        assert "someone-elses.pdf" in report.resume_unconfirmed
        assert resume.name in report.resume_unconfirmed

    def test_a_browser_that_cannot_confirm_is_not_an_upload(self, resume: Path):
        report = run(FakePage(FakeLocator(raises=True)), resume)
        assert report.resume_uploaded is None
        assert "could not confirm" in report.resume_unconfirmed

    def test_the_failure_is_visible_in_the_report(self, resume: Path):
        """Silence would read as a form that simply had no resume field."""
        report = run(FakePage(FakeLocator(holds=[])), resume)
        assert report.errors
        assert report.not_found == ["Resume"]

    def test_the_summary_says_no_resume_was_attached(self, resume: Path):
        report = run(FakePage(FakeLocator(holds=[])), resume)
        assert "no resume attached" in report.summary()

    def test_a_form_with_no_resume_to_attach_reports_no_reason(self):
        """Ordinary, and not worth a warning: many forms ask on a later page."""
        report = run(FakePage(FakeLocator(holds=[])), None)
        assert report.resume_uploaded is None
        assert report.resume_unconfirmed == ""


class TestWhatTheWorkerDoesWithIt:
    """The recording step reads only ``resume_uploaded``.

    Everything above exists so that this one attribute is never set on the strength
    of a call having returned.
    """

    def test_an_unconfirmed_attachment_records_nothing(self, resume: Path):
        report = run(FakePage(FakeLocator(holds=[])), resume)
        assert getattr(report, "resume_uploaded", None) is None

    def test_a_confirmed_one_carries_the_path_to_hash(self, resume: Path):
        report = run(FakePage(FakeLocator(holds=[resume.name])), resume)
        assert report.resume_uploaded is not None
        assert report.resume_uploaded.read_bytes() == b"%PDF-1.7\n"
