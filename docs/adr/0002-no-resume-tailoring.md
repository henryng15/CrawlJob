# ADR 0002 — The resume is not tailored per job

**Status:** accepted, 2026-08-05
**Supersedes:** [ADR 0001](0001-latex-resume-rendering.md), and §7.7's tailoring requirement
**Applies to:** §7.7, §38 step 4

## Context

§7.7 asks for a resume tailored to each posting: extract the user's resume into
cited facts, ask a model to rewrite bullets against the job description, validate
that every claim traces to a fact, splice the result into the user's own `.tex`,
compile, and fall back to the base document when it will not fit one page.

That was built and it worked. It also cost, in `app/`:

- a facts registry with a verification step the user had to sit through;
- a provenance validator (invented metrics, technologies, organisations,
  inflated ownership) and its retry ladder;
- a LaTeX parser that spliced text into `\resumeItem` byte ranges;
- a three-attempt build ladder — tailored, shortened, spacing-tightened — with a
  page check on each;
- a pin tying a plan to the exact resume bytes it was planned against;
- a TeX installation in the worker image, most of a gigabyte, rebuilt on every
  deploy.

Roughly 2,000 lines of application code and 3,000 of tests, plus a model call
per application on the writing model — the expensive one.

## Decision

The user keeps one PDF. Every application uploads it unchanged.

Preparing an application copies that file into the application's own artifact
folder, hashes the copy, and records the row the browser uploads.

## Consequences

**Lost.** Bullets are no longer reordered or reworded toward a posting. For a
one-page SWE intern resume aimed at one kind of role, the rewrite was mostly
reordering the same sentences — and the user judged the gain not worth the
machinery.

**Gained.** No model writes anything that goes to an employer, so the entire
class of "the resume said something I did not say" is gone by construction
rather than by validation. There is nothing to verify, so `verify-facts`
disappears and setup drops a manual step. The worker image loses TeX. Tailoring
was the only stage with no offline path; now the whole pipeline runs without an
API key.

**Kept.** The per-application copy and its hash. Without it, "which resume went
to this employer in August" stops being answerable the moment the user edits
their PDF — and that question survives the reason tailoring existed.

**§38 step 4** read "inspect the exact tailored resume". It now reads as
inspecting the exact resume that will be uploaded, which is the same guarantee
about a simpler object.
