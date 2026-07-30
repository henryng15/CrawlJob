"""Compiling LaTeX to PDF, and counting the pages (spec §7.7).

Two jobs, both small, both worth isolating: the tailoring pipeline needs to know
whether a document compiled and whether it came out on one page, and neither
question should require the pipeline to know anything about TeX.

Compilation runs twice. ``hyperref`` and ``fancyhdr`` write auxiliary files on
the first pass and read them on the second, and a one-pass build can report a
page count that the finished document does not have — which is the one number
this module exists to report correctly.

Everything happens in a directory the caller owns, and the engine is invoked with
``-no-shell-escape``. A resume is a document the user wrote, but it is also a
file that will be compiled unattended a few hundred times, and ``\\write18``
turns a document into a program.
"""

from __future__ import annotations

import logging
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

__all__ = [
    "ENGINES",
    "CompileResult",
    "compile_pdf",
    "engine_available",
    "page_count",
]

log = logging.getLogger(__name__)

#: In preference order. pdflatex first because it is what the base resume was
#: built with — its log names it, and changing engine changes line breaking,
#: which changes where the page ends.
ENGINES: tuple[str, ...] = ("pdflatex", "xelatex", "lualatex")

#: Long enough for a resume on a slow free-tier core, short enough that a
#: pathological document cannot hold a worker for ever.
_TIMEOUT_SECONDS = 120


@dataclass(frozen=True, slots=True)
class CompileResult:
    ok: bool
    pdf_path: Path | None
    log_text: str
    pages: int = 0
    engine: str = ""
    #: Set when the failure is worth showing the user rather than just logging.
    error: str = ""


def engine_available(name: str | None = None) -> str | None:
    """The first usable LaTeX engine, or ``None`` if TeX is not installed."""
    candidates = (name,) if name else ENGINES
    for candidate in candidates:
        if candidate and shutil.which(candidate):
            return candidate
    return None


def page_count(pdf_path: Path) -> int:
    """Pages in a PDF, or 0 if it cannot be read.

    ``pypdf`` rather than shelling out to ``pdfinfo``: it is already a
    dependency, and a subprocess per attempt is a subprocess that can hang.
    """
    try:
        from pypdf import PdfReader

        return len(PdfReader(str(pdf_path)).pages)
    except Exception:
        log.warning("could not read the page count of %s", pdf_path.name)
        return 0


def compile_pdf(
    tex_source: str,
    *,
    work_dir: Path,
    stem: str = "resume",
    engine: str | None = None,
    passes: int = 2,
) -> CompileResult:
    """Compile ``tex_source`` inside ``work_dir`` and report what happened.

    Never raises for a LaTeX error: a document that does not compile is an
    outcome the pipeline handles by falling back, not an exception it should have
    to catch. The log is returned whole, because when a tailored resume fails to
    build the log is the only thing that says why.
    """
    chosen = engine_available(engine)
    if chosen is None:
        return CompileResult(
            False,
            None,
            "",
            error="no LaTeX engine is installed (looked for: " + ", ".join(ENGINES) + ")",
        )

    work_dir.mkdir(parents=True, exist_ok=True)
    tex_path = work_dir / f"{stem}.tex"
    tex_path.write_text(tex_source, encoding="utf-8")

    log_text = ""
    for attempt in range(1, passes + 1):
        try:
            completed = subprocess.run(  # noqa: S603 - fixed argv, no shell
                [
                    chosen,
                    "-interaction=nonstopmode",
                    "-no-shell-escape",
                    "-halt-on-error",
                    f"-jobname={stem}",
                    tex_path.name,
                ],
                cwd=work_dir,
                capture_output=True,
                text=True,
                timeout=_TIMEOUT_SECONDS,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return CompileResult(
                False, None, log_text, engine=chosen, error=f"{chosen} timed out"
            )

        # The .log file is far more useful than stdout, which is mostly banner.
        produced = work_dir / f"{stem}.log"
        log_text = (
            produced.read_text(encoding="utf-8", errors="replace")
            if produced.is_file()
            else completed.stdout + completed.stderr
        )

        if completed.returncode != 0:
            return CompileResult(
                False,
                None,
                log_text,
                engine=chosen,
                error=f"{chosen} exited {completed.returncode} on pass {attempt}",
            )

    pdf_path = work_dir / f"{stem}.pdf"
    if not pdf_path.is_file():
        return CompileResult(
            False, None, log_text, engine=chosen, error=f"{chosen} produced no PDF"
        )

    return CompileResult(
        True, pdf_path, log_text, pages=page_count(pdf_path), engine=chosen
    )
