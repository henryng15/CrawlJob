"""Editing a LaTeX resume without touching its template (spec §7.7).

The property these tests exist for: everything outside a ``\\resumeItem`` body is
byte-identical after a tailoring pass. Not "looks the same" — identical. That is
what makes "the template is preserved" checkable rather than a claim.

They run against the user's real resume when it is configured, and against a
minimal fixture otherwise, so the suite is not silently skipped on a machine that
does not have it.
"""

from __future__ import annotations

import pytest

from app.services.resume_tex import find_bullets, parse, render

FIXTURE = r"""
\documentclass[letterpaper,10pt]{article}
\usepackage{geometry}
\newcommand{\resumeItem}[1]{\item\small{#1}}
\newcommand{\resumeSubItem}[1]{\resumeItem{#1}\vspace{-4pt}}
\newcommand{\resumeItemListStart}{\begin{itemize}[topsep=5pt]}
\newcommand{\resumeItemListEnd}{\end{itemize}}
\begin{document}
\section{Work Experience}
  \resumeItemListStart
    \resumeItem{Built \textbf{services} in \textbf{Python} with 99\% uptime}
    \resumeItem{Shipped a \href{https://example.com}{\uline{thing}} that worked}
  \resumeItemListEnd
\section{Projects}
  \resumeItemListStart
    \resumeItem{Wrote a parser}
    % \resumeItem{An old bullet the user commented out}
    \resumeItem{Wrote a compiler}
  \resumeItemListEnd
\end{document}
"""


class TestFindingBullets:
    def test_every_live_bullet_is_found(self):
        assert len(find_bullets(FIXTURE)) == 4

    def test_the_command_definition_is_not_mistaken_for_a_bullet(self):
        r"""``\newcommand{\resumeSubItem}[1]{\resumeItem{#1}...}`` contains a
        literal ``\resumeItem{#1}``.

        Editing it would rewrite the command rather than a line of the resume —
        the exact class of damage this module exists to prevent.
        """
        assert all(bullet.text != "#1" for bullet in find_bullets(FIXTURE))

    def test_a_commented_out_bullet_stays_out(self):
        """The user already decided that one is not on the resume."""
        assert all("commented out" not in b.text for b in find_bullets(FIXTURE))

    def test_bullets_know_their_section(self):
        sections = {b.section for b in find_bullets(FIXTURE)}
        assert sections == {"Work Experience", "Projects"}

    def test_bullets_know_their_list(self):
        """So shortening can avoid emptying one."""
        grouped = parse(FIXTURE).by_list()
        assert sorted(len(v) for v in grouped.values()) == [2, 2]

    def test_nested_braces_do_not_end_a_bullet_early(self):
        r"""``\textbf{...}`` and ``\href{...}{...}`` both nest.

        A non-greedy regex stops at the first ``}``, which is in the middle of a
        word, and the resulting document does not compile.
        """
        bullets = find_bullets(FIXTURE)
        assert "uptime" in bullets[0].text
        assert bullets[1].text.count("{") == bullets[1].text.count("}")


class TestPlainText:
    def test_markup_is_stripped_for_reading(self):
        bullet = find_bullets(FIXTURE)[0]
        assert bullet.plain == "Built services in Python with 99% uptime"

    def test_a_link_reduces_to_its_visible_text(self):
        assert "thing that worked" in find_bullets(FIXTURE)[1].plain


class TestRendering:
    def test_no_edits_is_byte_identical(self):
        """The strongest form of "the template is preserved"."""
        document = parse(FIXTURE)
        assert render(document) == FIXTURE

    def test_replacing_a_bullet_changes_only_that_bullet(self):
        document = parse(FIXTURE)
        out = render(document, replacements={0: "Something else entirely"})

        assert "Something else entirely" in out
        assert "Shipped a" in out, "the other bullets are untouched"
        assert out.split(r"\begin{document}")[0] == FIXTURE.split(r"\begin{document}")[0]

    def test_dropping_a_bullet_removes_the_whole_call(self):
        document = parse(FIXTURE)
        out = render(document, dropped=frozenset({0}))

        assert "99\\% uptime" not in out
        assert r"\resumeItem{}" not in out, "no empty bullet is left behind"
        assert len(find_bullets(out)) == 3

    def test_the_preamble_survives_every_edit(self):
        document = parse(FIXTURE)
        out = render(
            document,
            dropped=frozenset({0, 2}),
            replacements={1: "New text", 3: "More new text"},
        )
        assert out.split(r"\begin{document}")[0] == FIXTURE.split(r"\begin{document}")[0]

    def test_section_headings_and_order_survive(self):
        out = render(parse(FIXTURE), dropped=frozenset({0, 2}))
        assert out.index(r"\section{Work Experience}") < out.index(r"\section{Projects}")

    def test_the_list_scaffolding_survives(self):
        """Three occurrences each: the ``\\newcommand`` plus its two uses."""
        out = render(parse(FIXTURE), dropped=frozenset({0}))
        assert out.count(r"\resumeItemListStart") == 3
        assert out.count(r"\resumeItemListEnd") == 3

    def test_a_commented_bullet_is_untouched_by_a_drop(self):
        out = render(parse(FIXTURE), dropped=frozenset({2, 3}))
        assert "An old bullet the user commented out" in out


class TestTheRealResume:
    """Run against the user's actual file when it is configured."""

    @pytest.fixture
    def source(self) -> str:
        from app.config import Settings

        settings = Settings(app_env="development", app_secret_key="tex-tests")
        if settings.base_resume_tex is None or not settings.base_resume_tex.is_file():
            pytest.skip("no base resume configured (BASE_RESUME_TEX)")
        return settings.base_resume_tex.read_text(encoding="utf-8")

    def test_its_bullets_are_found(self, source: str):
        assert len(find_bullets(source)) > 5

    def test_a_round_trip_is_byte_identical(self, source: str):
        assert render(parse(source)) == source

    def test_editing_it_leaves_the_preamble_alone(self, source: str):
        document = parse(source)
        out = render(document, dropped=frozenset({document.bullets[-1].index}))
        marker = r"\begin{document}"
        assert out.split(marker)[0] == source.split(marker)[0]

    def test_the_skills_block_is_never_touched(self, source: str):
        """It is not made of bullets, so nothing can reach it."""
        document = parse(source)
        out = render(document, dropped=frozenset(b.index for b in document.bullets[:3]))
        assert "Technical Skills" in out
