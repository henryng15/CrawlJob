# ADR 0001 — Tailored resumes are built with LaTeX, not HTML

**Status:** accepted, 2026-07-29
**Supersedes:** the recommendation in spec §11.5 (Jinja2 HTML → WeasyPrint)
**Applies to:** §7.7 resume tailoring

## Context

§11.5 recommends rendering the tailored resume from structured facts through a
Jinja2 HTML template and WeasyPrint. That was implemented and worked: it produced
selectable text, one column, embedded fonts, and a stable page count.

It also produced **a different document from the user's resume.**

The user's base resume is a LaTeX file they wrote and tuned until it fitted on one
page: `newtxtext` fonts, custom `\resumeSubheading` and `\resumeItem` commands,
`titlesec` section rules, hand-set list padding, and a comment in the preamble
recording that the leading is already at the ceiling for a one-page fit. Rendering
the *facts* extracted from that resume through a generic HTML template throws all
of it away. Every application would have gone out in a layout the user had never
seen, while the file they had actually prepared sat unused on disk.

The requirement, stated directly: preserve the original LaTeX template, layout,
formatting, section order, commands, fonts, spacing style, and visual structure.
Tailoring may only select, reorder, shorten, or truthfully reword existing
content.

That requirement cannot be met by any HTML renderer, because the target document
is not HTML.

## Decision

Tailored resumes are produced by splicing text into the user's own `.tex` and
compiling it with `pdflatex`.

1. `app/services/resume_tex.py` locates the `\resumeItem{...}` bullets in the
   canonical file and can replace the text *inside* those spans. Everything
   outside them is copied byte for byte, so the preamble, geometry, fonts, custom
   commands, section order and skills block are unreachable by construction rather
   than by care. A parse-then-render round trip with no edits is byte-identical.
2. `app/services/latex.py` compiles with `pdflatex -no-shell-escape`, twice, and
   reads the page count from the PDF with `pypdf`.
3. `app/services/resume_build.py` runs at most three attempts — tailored,
   shortened, tightened — and requires exactly one page. If all three fail, the
   canonical PDF is used **byte for byte**, and the reason is recorded.
4. `app/services/tailoring.py::apply_plan` is the only path by which an
   application gets a resume. Both the batch and synchronous handlers call it.

### What was removed

`to_html` and `render_pdf` are deleted from `app/services/resume_import.py`, and
`weasyprint` is removed from `pyproject.toml`, `uv.lock`, the mypy overrides, and
the worker image's system packages. A second renderer that still worked would be
reached for by whoever next needed a PDF in a hurry, and the two would drift.
`tests/e2e/test_tailoring_pipeline.py` asserts that nothing under `app/` mentions
`weasyprint`.

### What this costs

The worker image now needs a TeX installation — `texlive-latex-base`,
`-recommended`, `-extra`, `-fonts-recommended`, `-fonts-extra`, `-lang-english`.
That is roughly 500 MB of image and it is the real price of this decision.

A missing LaTeX package **does not fail loudly**. It fails every build, and every
application silently falls back to the untailored base resume, which looks exactly
like the system working. `internship-ops check-base-resume` exists for this: it
compiles the canonical resume inside the container and exits non-zero if the engine
is missing, the document does not compile, it has no editable bullets, it is longer
than one page, or there is no PDF to fall back to. `deploy/push-base-resume.sh`
runs it after installing the resume.

## §11.5's requirements, against this decision

| Requirement | How it is met |
|---|---|
| selectable text | pdflatex output; verified by extracting text back out of a compiled PDF |
| embedded standard fonts | `newtxtext`, embedded by the engine |
| ATS-readable single-column | the user's template already is; nothing here can change the layout |
| no image-only PDF | pdflatex never produces one |
| stable page count | measured per attempt with `pypdf`, and one page is enforced |
| deterministic rendering | same `.tex` in, same PDF out; both hashed and recorded |
| keep the user's original PDF as the base artifact | it is the fallback, copied byte for byte, and never written to |

Every requirement is met. Only the recommended *mechanism* changed.

## Consequences

- The canonical `.tex` and `.pdf` are read-only. On the server they live in
  `/data/internship-ops/resume`, mounted `:ro`, so overwriting them is impossible
  even from a bug rather than merely forbidden.
- Tailoring is bounded by what the template already contains. There is no
  operation that adds a bullet, a section, or an entry — a plan can only keep,
  reword, or drop what is there. This is a feature: it is the same bound §7.7 puts
  on the content.
- A resume whose base document is already two pages can never be tailored to fit.
  `check-base-resume` refuses it up front rather than letting every application
  fall back.
- Structured facts are still extracted and still gate every claim
  (`app/services/resume.py`). They are the *provenance* layer; they are no longer
  the *rendering* layer.
