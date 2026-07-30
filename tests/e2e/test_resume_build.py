"""Building a real PDF from real LaTeX (spec §7.7).

These run the actual compiler. Nothing here is mocked, because the two things
being checked — "did it compile" and "is it one page" — are exactly the two
things a mock would have to invent.

Marked ``latex`` so a machine without TeX skips them cleanly rather than failing:

    uv run pytest -m "not latex"
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from app.config import Settings
from app.services.latex import compile_pdf, engine_available, page_count
from app.services.resume_build import (
    build,
    rank_by_relevance,
    tighten_spacing,
)
from app.services.resume_tex import parse, render

pytestmark = pytest.mark.latex

if engine_available() is None:  # pragma: no cover - depends on the machine
    pytest.skip("no LaTeX engine installed", allow_module_level=True)

JD = (
    "Backend Engineer Intern. You will build REST APIs in Python with FastAPI, "
    "PostgreSQL and Docker, and work on CI/CD pipelines."
)

MINIMAL = r"""
\documentclass[letterpaper,10pt]{article}
\usepackage[top=0.4in,bottom=0.4in,left=0.4in,right=0.4in]{geometry}
\newcommand{\resumeItem}[1]{\item\small{#1}}
\newcommand{\resumeItemListStart}{\begin{itemize}[topsep=5pt]}
\newcommand{\resumeItemListEnd}{\end{itemize}}
\newcommand{\resumeSubHeadingListStart}{\begin{itemize}[itemsep=3pt]}
\usepackage{enumitem}
\begin{document}
\section{Work Experience}
  \resumeItemListStart
    \resumeItem{Built REST APIs in Python with FastAPI and PostgreSQL}
    \resumeItem{Wrote a compiler in Rust for fun}
  \resumeItemListEnd
\end{document}
"""


@pytest.fixture
def settings() -> Settings:
    return Settings(app_env="development", app_secret_key="latex-tests")


@pytest.fixture
def base_tex(settings: Settings) -> str:
    if settings.base_resume_tex is None or not settings.base_resume_tex.is_file():
        pytest.skip("no base resume configured (BASE_RESUME_TEX)")
    return settings.base_resume_tex.read_text(encoding="utf-8")


@pytest.fixture
def base_pdf(settings: Settings) -> Path:
    if settings.base_resume_pdf is None or not settings.base_resume_pdf.is_file():
        pytest.skip("no base resume PDF configured (BASE_RESUME_PDF)")
    return settings.base_resume_pdf


class TestCompiling:
    def test_a_minimal_document_compiles_to_one_page(self, tmp_path: Path):
        result = compile_pdf(MINIMAL, work_dir=tmp_path / "min")
        assert result.ok, result.error
        assert result.pages == 1

    def test_the_page_count_is_read_from_the_pdf(self, tmp_path: Path):
        result = compile_pdf(MINIMAL, work_dir=tmp_path / "min")
        assert page_count(result.pdf_path) == 1

    def test_a_broken_document_fails_without_raising(self, tmp_path: Path):
        """A document that does not compile is an outcome, not an exception."""
        result = compile_pdf(r"\documentclass{article}\begin{document}\undefined",
                             work_dir=tmp_path / "broken")
        assert not result.ok
        assert result.error
        assert result.log_text, "the log is the only thing that says why"

    def test_the_log_is_always_returned(self, tmp_path: Path):
        assert compile_pdf(MINIMAL, work_dir=tmp_path / "m").log_text


class TestTheRealResume:
    def test_it_compiles_to_exactly_one_page(self, base_tex: str, tmp_path: Path):
        result = compile_pdf(base_tex, work_dir=tmp_path / "base")
        assert result.ok, result.error
        assert result.pages == 1

    def test_a_tailored_version_still_compiles(self, base_tex: str, tmp_path: Path):
        document = parse(base_tex)
        tailored = render(document, dropped=frozenset({document.bullets[-1].index}))
        result = compile_pdf(tailored, work_dir=tmp_path / "tailored")
        assert result.ok, result.error
        assert result.pages == 1


class TestRelevance:
    def test_bullets_matching_the_posting_rank_higher(self):
        document = parse(MINIMAL)
        ranked = rank_by_relevance(document.bullets, JD)
        assert "REST APIs" in ranked[0][0].plain
        assert ranked[0][1] > ranked[-1][1]


class TestSpacing:
    def test_the_reductions_apply_to_the_real_template(self, base_tex: str):
        _, changes = tighten_spacing(base_tex)
        assert changes, "the template's spacing knobs must be found"

    def test_only_the_preamble_moves(self, base_tex: str):
        tightened, _ = tighten_spacing(base_tex)
        marker = r"\begin{document}"
        assert tightened.split(marker)[1] == base_tex.split(marker)[1]

    def test_nothing_is_ever_loosened(self, base_tex: str):
        """The template's own comment says raising the leading pushes to two
        pages. Every rule here reduces a length; none increases one."""
        tightened, _ = tighten_spacing(base_tex)
        assert "topsep=2pt" in tightened
        assert "itemsep=1pt" in tightened
        assert r"\linespread{1.0}" in tightened, "the leading is never touched"

    def test_it_buys_real_space(self, base_tex: str, tmp_path: Path):
        """A marginal overflow that tightening rescues.

        Six padded bullets take the real resume to two pages; the same content
        with the spacing reductions comes back to one.
        """
        document = parse(base_tex)
        pad = " additional detail words here to push the line over the edge"
        over = render(
            document,
            replacements={b.index: b.text + pad for b in document.bullets[:6]},
        )
        plain = compile_pdf(over, work_dir=tmp_path / "plain")
        tight = compile_pdf(tighten_spacing(over)[0], work_dir=tmp_path / "tight")

        assert plain.pages == 2
        assert tight.pages == 1


class TestTheAttemptLadder:
    def test_a_resume_that_fits_is_taken_on_the_first_attempt(
        self, base_tex: str, base_pdf: Path, tmp_path: Path
    ):
        outcome = build(base_tex, job_text=JD, work_dir=tmp_path / "ok", base_pdf=base_pdf)
        assert len(outcome.attempts) == 1
        assert outcome.chosen is not None
        assert outcome.chosen.strategy == "tailored"
        assert outcome.pages == 1
        assert not outcome.used_base

    def test_at_most_three_attempts_are_made(
        self, base_tex: str, base_pdf: Path, tmp_path: Path
    ):
        document = parse(base_tex)
        huge = "Engineered a distributed service in Python and FastAPI. " * 8
        outcome = build(
            base_tex,
            job_text=JD,
            work_dir=tmp_path / "over",
            replacements={b.index: huge for b in document.bullets},
            base_pdf=base_pdf,
        )
        assert len(outcome.attempts) == 3

    def test_the_three_strategies_are_tried_in_order(
        self, base_tex: str, base_pdf: Path, tmp_path: Path
    ):
        document = parse(base_tex)
        huge = "Engineered a distributed service in Python and FastAPI. " * 8
        outcome = build(
            base_tex,
            job_text=JD,
            work_dir=tmp_path / "order",
            replacements={b.index: huge for b in document.bullets},
            base_pdf=base_pdf,
        )
        assert [a.strategy for a in outcome.attempts] == [
            "tailored",
            "shortened",
            "tightened",
        ]

    def test_shortening_drops_content_and_tightening_changes_spacing(
        self, base_tex: str, base_pdf: Path, tmp_path: Path
    ):
        document = parse(base_tex)
        huge = "Engineered a distributed service in Python and FastAPI. " * 8
        outcome = build(
            base_tex,
            job_text=JD,
            work_dir=tmp_path / "strategies",
            replacements={b.index: huge for b in document.bullets},
            base_pdf=base_pdf,
        )
        first, second, third = outcome.attempts
        assert len(first.dropped) == 0
        assert len(second.dropped) == 1, "shortening drops the least relevant bullet"
        assert third.spacing_changes, "tightening records what it changed"

    def test_every_attempt_is_kept_even_when_it_failed(
        self, base_tex: str, base_pdf: Path, tmp_path: Path
    ):
        document = parse(base_tex)
        huge = "Engineered a distributed service in Python and FastAPI. " * 8
        outcome = build(
            base_tex,
            job_text=JD,
            work_dir=tmp_path / "kept",
            replacements={b.index: huge for b in document.bullets},
            base_pdf=base_pdf,
        )
        assert all(a.result.pages == 2 for a in outcome.attempts)
        assert all(a.tex for a in outcome.attempts), "the source of each is kept"


class TestFallback:
    def test_three_failures_fall_back_to_the_base_resume(
        self, base_tex: str, base_pdf: Path, tmp_path: Path
    ):
        document = parse(base_tex)
        huge = "Engineered a distributed service in Python and FastAPI. " * 8
        outcome = build(
            base_tex,
            job_text=JD,
            work_dir=tmp_path / "fallback",
            replacements={b.index: huge for b in document.bullets},
            base_pdf=base_pdf,
        )
        assert outcome.used_base
        assert outcome.chosen is None
        assert "did not produce a one-page PDF" in outcome.fallback_reason

    def test_the_fallback_pdf_is_the_canonical_one_byte_for_byte(
        self, base_tex: str, base_pdf: Path, tmp_path: Path
    ):
        """Not recompiled, not regenerated. The exact file the user made."""
        document = parse(base_tex)
        huge = "Engineered a distributed service in Python and FastAPI. " * 8
        outcome = build(
            base_tex,
            job_text=JD,
            work_dir=tmp_path / "identical",
            replacements={b.index: huge for b in document.bullets},
            base_pdf=base_pdf,
        )
        assert outcome.pdf_path is not None
        assert (
            hashlib.sha256(outcome.pdf_path.read_bytes()).hexdigest()
            == hashlib.sha256(base_pdf.read_bytes()).hexdigest()
        )

    def test_a_document_that_cannot_compile_also_falls_back(
        self, base_tex: str, base_pdf: Path, tmp_path: Path
    ):
        document = parse(base_tex)
        broken = {b.index: r"\thisCommandDoesNotExist" for b in document.bullets}
        outcome = build(
            base_tex,
            job_text=JD,
            work_dir=tmp_path / "broken",
            replacements=broken,
            base_pdf=base_pdf,
        )
        assert outcome.used_base
        assert outcome.pdf_path is not None


class TestTheCanonicalFilesAreNeverTouched:
    def test_the_tex_is_unchanged_after_a_build(
        self, settings: Settings, base_tex: str, base_pdf: Path, tmp_path: Path
    ):
        before = settings.base_resume_tex.read_bytes()
        build(base_tex, job_text=JD, work_dir=tmp_path / "a", base_pdf=base_pdf)
        assert settings.base_resume_tex.read_bytes() == before

    def test_the_pdf_is_unchanged_after_a_fallback(
        self, settings: Settings, base_tex: str, base_pdf: Path, tmp_path: Path
    ):
        before = base_pdf.read_bytes()
        document = parse(base_tex)
        huge = "Engineered a distributed service in Python and FastAPI. " * 8
        build(
            base_tex,
            job_text=JD,
            work_dir=tmp_path / "b",
            replacements={b.index: huge for b in document.bullets},
            base_pdf=base_pdf,
        )
        assert base_pdf.read_bytes() == before

    def test_nothing_is_written_outside_the_work_directory(
        self, settings: Settings, base_tex: str, base_pdf: Path, tmp_path: Path
    ):
        canonical_dir = settings.base_resume_tex.parent
        before = {p.name: p.stat().st_mtime for p in canonical_dir.iterdir() if p.is_file()}
        build(base_tex, job_text=JD, work_dir=tmp_path / "c", base_pdf=base_pdf)
        after = {p.name: p.stat().st_mtime for p in canonical_dir.iterdir() if p.is_file()}
        assert before == after
