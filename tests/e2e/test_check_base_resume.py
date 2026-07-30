"""``internship-ops check-base-resume`` (spec §7.7, §25).

This command is the only thing standing between the user and the quietest
failure this system has: a base resume the container cannot compile. Nothing
crashes, no task dies — every application just falls back to the untailored PDF,
which looks exactly like the system working.

So the tests here are almost all about the failing cases. Each one has to exit
non-zero and say what is wrong, because it runs during a deploy and its exit code
is what the operator sees.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.cli.main import main
from app.config import Settings
from app.services.latex import engine_available

pytestmark = pytest.mark.latex

if engine_available() is None:  # pragma: no cover - depends on the machine
    pytest.skip("no LaTeX engine installed", allow_module_level=True)

ONE_PAGE = r"""\documentclass[letterpaper,10pt]{article}
\usepackage{enumitem}
\newcommand{\resumeItem}[1]{\item\small{#1}}
\begin{document}
\section{Work Experience}
\begin{itemize}
  \resumeItem{Built a FastAPI service}
  \resumeItem{Contributed to a PostgreSQL migration}
\end{itemize}
\end{document}
"""

NO_BULLETS = r"""\documentclass{article}
\begin{document}
Just prose, with nothing tailoring is allowed to touch.
\end{document}
"""

TWO_PAGES = (
    r"\documentclass{article}"
    r"\newcommand{\resumeItem}[1]{#1\par}"
    r"\begin{document}"
    + r"\resumeItem{Built a service and wrote about it at some length.}" * 220
    + r"\end{document}"
)


def run(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> int:
    monkeypatch.setattr("app.config.get_settings", lambda: settings)
    return main(["check-base-resume"])


def settings_for(tmp_path: Path, tex: str | None, *, pdf: bool = True) -> Settings:
    tex_path = tmp_path / "resume.tex"
    if tex is not None:
        tex_path.write_text(tex, encoding="utf-8")

    pdf_path = tmp_path / "resume.pdf"
    if pdf:
        from pypdf import PdfWriter

        writer = PdfWriter()
        writer.add_blank_page(width=612, height=792)
        with pdf_path.open("wb") as handle:
            writer.write(handle)

    return Settings(
        app_env="development",
        app_secret_key="check-base-resume",
        data_dir=tmp_path / "data",
        base_resume_tex=tex_path,
        base_resume_pdf=pdf_path,
    )


class TestItPasses:
    def test_a_one_page_resume_with_bullets_is_accepted(self, tmp_path, monkeypatch):
        assert run(monkeypatch, settings_for(tmp_path, ONE_PAGE)) == 0

    def test_it_reports_what_it_found(self, tmp_path, monkeypatch, capsys):
        run(monkeypatch, settings_for(tmp_path, ONE_PAGE))
        out = capsys.readouterr().out
        assert "2 editable" in out
        assert "1 page(s)" in out


class TestItFails:
    def test_a_missing_tex_is_refused(self, tmp_path, monkeypatch):
        assert run(monkeypatch, settings_for(tmp_path, None)) == 1

    def test_a_resume_with_no_bullets_is_refused(self, tmp_path, monkeypatch, capsys):
        """Tailoring would have nothing it may change, so every application
        would go out as the same untouched document."""
        assert run(monkeypatch, settings_for(tmp_path, NO_BULLETS)) == 1
        assert "nothing it may change" in capsys.readouterr().err

    def test_a_document_that_does_not_compile_is_refused(self, tmp_path, monkeypatch, capsys):
        broken = ONE_PAGE.replace(r"\begin{document}", r"\thisIsNotACommand\begin{document}")
        assert run(monkeypatch, settings_for(tmp_path, broken)) == 1
        assert "did not compile" in capsys.readouterr().err

    def test_a_base_resume_longer_than_one_page_is_refused(
        self, tmp_path, monkeypatch, capsys
    ):
        """Tailoring only ever removes. If the starting point is two pages,
        nothing it can do will make an application fit."""
        assert run(monkeypatch, settings_for(tmp_path, TWO_PAGES)) == 1
        assert "longer than one page" in capsys.readouterr().err

    def test_a_missing_fallback_pdf_is_refused(self, tmp_path, monkeypatch, capsys):
        """A build that runs out of attempts would have nothing to send."""
        assert run(monkeypatch, settings_for(tmp_path, ONE_PAGE, pdf=False)) == 1
        assert "fall back to" in capsys.readouterr().err
