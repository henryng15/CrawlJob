"""Placing a tailoring plan by bullet id (spec §7.7).

The failure this file exists for has a specific shape. Two entries on a resume
describe similar work — two backend internships, two Python projects. A tailoring
plan rewrites one of them. If placement is decided by which existing bullet the
new wording most resembles, the rewrite can land on the *other* entry: every
sentence still true, the PDF still one page, and the resume now says the candidate
did at employer B what they did at employer A.

That is not a bug you find by reading the output. It is only visible to somebody
who knows the candidate's history, which is the one thing an employer does not
have.

So placement is by id and nothing else. ``TestSimilarWordingAcrossEntries`` is the
class that proves it, and it is written so that the wording deliberately favours
the wrong answer.
"""

from __future__ import annotations

import pytest

from app.services.resume import Action, BulletOp, ResumeFact, TailoringPlan
from app.services.resume_edits import (
    RejectionKind,
    latex_escape,
    plan_edits,
    similarity,
)
from app.services.resume_tex import parse, render

BASE = r"""
\documentclass{article}
\newcommand{\resumeItem}[1]{\item\small{#1}}
\newcommand{\resumeSubheading}[4]{\item#1 #2 #3 #4}
\newcommand{\resumeProjectHeadingDesc}[3]{\item#1 #2 #3}
\newcommand{\resumeItemListStart}{\begin{itemize}}
\newcommand{\resumeItemListEnd}{\end{itemize}}
\begin{document}
\section{Education}
    \resumeSubheading
      {Kenyon College\textmd{ - Gambier, OH}}{May 2028}
      {Bachelor of Arts in Mathematics}{GPA: 4.0}
      \resumeItemListStart
        \resumeItem{Coursework: algorithms, databases, operating systems}
      \resumeItemListEnd
\section{Work Experience}
    \resumeSubheading
      {Todd}{June 2026}
      {Software Engineer Intern}{}
      \resumeItemListStart
        \resumeItem{Built a \textbf{Python} service handling payment webhooks}
        \resumeItem{Rebuilt the CI/CD deploy pipeline for PostgreSQL}
      \resumeItemListEnd
    \resumeSubheading
      {IpserLabs}{March 2026}
      {Software Engineer Intern}{}
      \resumeItemListStart
        \resumeItem{Built a Python service handling websocket events}
        \resumeItem{Modelled a Java servlet command layer in XML}
      \resumeItemListEnd
    \resumeSubheading
      {Kenyon College}{August 2025}
      {Software Engineer Intern}{}
      \resumeItemListStart
        \resumeItem{Developed in-browser Python execution components}
      \resumeItemListEnd
\section{Projects}
    \resumeProjectHeadingDesc
      {\textbf{ThesisLedger} $|$ \emph{Django REST, Celery}}{}
      {Equity-research assistant}
      \resumeItemListStart
        \resumeItem{Built a RAG pipeline in Python over pgvector}
        \resumeItem{Split analysis into async microservices on Celery}
      \resumeItemListEnd
\end{document}
"""

#: Facts are whole achievements; the resume's bullets are shortened versions of
#: them. So a fact carries the figures and names a rewrite may legitimately put
#: back — which is what makes "this claim is supported here" a real distinction
#: rather than one no fixture ever satisfies.
FACTS = {
    "todd.1": ResumeFact(
        id="todd.1",
        text=(
            "Built a Python service handling Stripe payment webhooks idempotently, "
            "cutting failures 40% over 4000 replays"
        ),
        organisation="Todd",
        technologies=frozenset({"python"}),
    ),
    "ipser.1": ResumeFact(
        id="ipser.1",
        text="Built a Python service handling 7 typed websocket events",
        organisation="IpserLabs",
        technologies=frozenset({"python", "java"}),
    ),
    "thesis.1": ResumeFact(
        id="thesis.1",
        text="Built a RAG pipeline over pgvector for 5 claims",
        organisation="ThesisLedger",
    ),
    #: No organisation. The kind of fact whose employer nobody checked.
    "loose.1": ResumeFact(
        id="loose.1",
        text="Wrote Python, shipped 4000 webhooks on Kubernetes for Stripe",
        organisation=None,
        technologies=frozenset({"python", "kubernetes"}),
    ),
}


@pytest.fixture
def document():
    return parse(BASE)


def op(bullet_id: str, action: Action = Action.KEEP, **kw) -> BulletOp:
    return BulletOp(bullet_id=bullet_id, action=action, **kw)


def plan(*ops: BulletOp) -> TailoringPlan:
    return TailoringPlan(operations=list(ops))


def edits(document, *ops: BulletOp, facts=None, allowed=None):
    return plan_edits(
        document, plan(*ops), facts=FACTS if facts is None else facts, allowed_bullets=allowed
    )


class TestTheIdsThemselves:
    def test_each_bullet_has_a_unique_id(self, document):
        ids = [b.bullet_id for b in document.bullets]
        assert len(set(ids)) == len(ids)

    def test_an_id_names_its_section_entry_and_position(self, document):
        assert document.by_id()["work-experience.todd.2"].plain.startswith("Rebuilt the CI/CD")

    def test_the_same_employer_in_two_sections_gets_two_ids(self, document):
        """"Kenyon College" is both a degree and a job on this resume.

        Without the section in the id, a rewrite meant for the coursework line
        could land on an internship bullet.
        """
        by_id = document.by_id()
        assert "education.kenyon-college.1" in by_id
        assert "work-experience.kenyon-college.1" in by_id
        assert by_id["education.kenyon-college.1"].section == "Education"
        assert by_id["work-experience.kenyon-college.1"].section == "Work Experience"

    def test_a_project_id_uses_the_project_name(self, document):
        assert "projects.thesisledger.1" in document.by_id()

    def test_the_entry_name_excludes_the_location_and_the_stack(self, document):
        by_id = document.by_id()
        assert by_id["education.kenyon-college.1"].entry == "Kenyon College"
        assert by_id["projects.thesisledger.1"].entry == "ThesisLedger"

    def test_ids_are_stable_across_parses(self, document):
        assert [b.bullet_id for b in parse(BASE).bullets] == [
            b.bullet_id for b in document.bullets
        ]


class TestSimilarWordingAcrossEntries:
    """The reason placement is by id.

    Todd's first bullet and IpserLabs' first bullet both read "Built a Python
    service handling ...". Any resemblance-based placement has to choose between
    them, and choosing wrong moves an achievement between employers.
    """

    REWRITE = "Built a Python service handling Stripe payment webhooks idempotently"

    def test_the_wording_is_genuinely_ambiguous(self, document):
        """Stated as a fact about the fixture, so the test below means something."""
        by_id = document.by_id()
        todd = similarity(by_id["work-experience.todd.1"].plain, self.REWRITE)
        ipser = similarity(by_id["work-experience.ipserlabs.1"].plain, self.REWRITE)
        assert todd > 0.25 and ipser > 0.25, "both are plausible matches by wording"

    def test_a_rewrite_lands_on_the_id_it_names_and_nowhere_else(self, document):
        result = edits(
            document,
            op(
                "work-experience.todd.1",
                Action.REWRITE,
                text=self.REWRITE,
                fact_ids=["todd.1"],
            ),
        )
        by_id = document.by_id()
        assert set(result.replacements) == {by_id["work-experience.todd.1"].index}
        assert by_id["work-experience.ipserlabs.1"].index not in result.replacements

    def test_the_other_entry_is_untouched_in_the_rendered_document(self, document):
        result = edits(
            document,
            op(
                "work-experience.todd.1",
                Action.REWRITE,
                text=self.REWRITE,
                fact_ids=["todd.1"],
            ),
        )
        out = render(document, dropped=result.dropped, replacements=result.replacements)
        # IpserLabs still says exactly what the user wrote.
        assert "Built a Python service handling websocket events" in out
        assert out.count("Stripe payment webhooks") == 1

    def test_citing_the_other_employers_fact_is_refused(self, document):
        """The one case the id alone cannot catch.

        A model that picks Todd's id while describing IpserLabs work gives itself
        away in the citation, and that is where it is stopped.
        """
        result = edits(
            document,
            op(
                "work-experience.todd.1",
                Action.REWRITE,
                text=self.REWRITE,
                fact_ids=["ipser.1"],
            ),
        )
        assert result.replacements == {}
        assert result.rejections[0].kind is RejectionKind.PROVENANCE_MISMATCH
        assert "IpserLabs" in result.rejections[0].detail
        assert "Todd" in result.rejections[0].detail

    def test_a_project_fact_cannot_be_written_under_an_employer(self, document):
        result = edits(
            document,
            op(
                "work-experience.todd.1",
                Action.REWRITE,
                text="Built a RAG pipeline in Python over pgvector for payments",
                fact_ids=["thesis.1"],
            ),
        )
        assert result.replacements == {}
        assert result.rejections[0].kind is RejectionKind.PROVENANCE_MISMATCH

    def test_an_employer_fact_cannot_be_written_under_a_project(self, document):
        result = edits(
            document,
            op(
                "projects.thesisledger.1",
                Action.REWRITE,
                text="Built a Python service handling payment webhooks",
                fact_ids=["todd.1"],
            ),
        )
        assert result.replacements == {}
        assert result.rejections[0].kind is RejectionKind.PROVENANCE_MISMATCH

    def test_the_two_kenyon_entries_cannot_be_confused(self, document):
        """A coursework rewrite citing the internship, and the reverse."""
        for bullet_id in ("education.kenyon-college.1", "work-experience.kenyon-college.1"):
            result = edits(
                document,
                op(
                    bullet_id,
                    Action.REWRITE,
                    text="Built a Python service handling payment webhooks",
                    fact_ids=["todd.1"],
                ),
            )
            assert result.replacements == {}, bullet_id
            assert result.rejections[0].kind is RejectionKind.PROVENANCE_MISMATCH


class TestRejections:
    def test_an_unknown_id_is_refused(self, document):
        result = edits(document, op("work-experience.globex.1", Action.DROP))
        assert result.rejections[0].kind is RejectionKind.UNKNOWN_ID
        assert result.dropped == frozenset()

    def test_a_duplicate_id_refuses_both_operations(self, document):
        """Which one was meant is not knowable, so neither is guessed at."""
        result = edits(
            document,
            op("work-experience.todd.1", Action.DROP),
            op(
                "work-experience.todd.1",
                Action.REWRITE,
                text="Built a Python service for payments",
                fact_ids=["todd.1"],
            ),
        )
        assert {r.kind for r in result.rejections} == {RejectionKind.DUPLICATE_ID}
        assert result.dropped == frozenset()
        assert result.replacements == {}

    def test_a_wrong_section_echo_is_refused(self, document):
        result = edits(
            document,
            op(
                "work-experience.todd.1",
                Action.REWRITE,
                text="Built a Python service for payments",
                fact_ids=["todd.1"],
                section="Projects",
            ),
        )
        assert result.rejections[0].kind is RejectionKind.CROSS_SECTION

    def test_a_wrong_entry_echo_is_refused(self, document):
        result = edits(
            document,
            op(
                "work-experience.todd.1",
                Action.REWRITE,
                text="Built a Python service for payments",
                fact_ids=["todd.1"],
                entry="IpserLabs",
            ),
        )
        assert result.rejections[0].kind is RejectionKind.CROSS_SECTION
        assert "IpserLabs" in result.rejections[0].detail

    def test_a_correct_echo_is_accepted(self, document):
        result = edits(
            document,
            op(
                "work-experience.todd.1",
                Action.REWRITE,
                text="Built a Python service for Stripe payments",
                fact_ids=["todd.1"],
                section="Work Experience",
                entry="Todd",
            ),
        )
        assert result.replacements
        assert result.rejections == ()

    def test_an_absent_echo_is_not_held_against_the_operation(self, document):
        """An omitted cross-check is not evidence of anything; a wrong one is."""
        result = edits(
            document,
            op(
                "work-experience.todd.1",
                Action.REWRITE,
                text="Built a Python service for Stripe payments",
                fact_ids=["todd.1"],
            ),
        )
        assert result.replacements and result.rejections == ()

    def test_an_empty_rewrite_is_refused_rather_than_deleting(self, document):
        result = edits(document, op("work-experience.todd.1", Action.REWRITE, text=""))
        assert result.rejections[0].kind is RejectionKind.EMPTY_REWRITE
        assert result.replacements == {}
        assert result.dropped == frozenset()

    def test_wording_that_failed_provenance_validation_is_refused(self, document):
        result = edits(
            document,
            op(
                "work-experience.todd.1",
                Action.REWRITE,
                text="Scaled the platform to 4 million users",
                fact_ids=["todd.1"],
            ),
            allowed=set(),
        )
        assert result.rejections[0].kind is RejectionKind.PROVENANCE_MISMATCH
        assert result.replacements == {}

    def test_an_unattributed_fact_may_reword_a_bullet(self, document):
        """A fact with no organisation contradicts nothing, so rewording is fine.

        Refusing unscoped facts outright would make rewriting impossible for any
        resume imported before organisations were recorded.
        """
        result = edits(
            document,
            op(
                "work-experience.todd.1",
                Action.REWRITE,
                # Says less, and nothing new: no figure, technology or name that
                # the original did not already carry.
                text="Built a Python service that handled payment webhooks",
                fact_ids=["loose.1"],
            ),
        )
        assert result.replacements and result.rejections == ()


class TestUnscopedFactsCannotAddClaims:
    """An unattributed fact cannot say which entry it belongs to.

    So it cannot be the authority for putting a new figure, technology or name on
    an employer's or project's bullet — a fact stored without an organisation is
    exactly the one whose organisation nobody checked. It may still reword, because
    rewording asserts nothing new.
    """

    def rewrite(self, document, text: str, fact: str = "loose.1"):
        return edits(
            document,
            op("work-experience.todd.1", Action.REWRITE, text=text, fact_ids=[fact]),
        )

    def test_a_new_figure_is_refused(self, document):
        result = self.rewrite(document, "Built a Python service handling 4000 webhooks")
        assert result.replacements == {}
        assert result.rejections[0].kind is RejectionKind.UNSCOPED_CLAIM
        assert "4000" in result.rejections[0].detail

    def test_a_new_technology_is_refused(self, document):
        result = self.rewrite(document, "Built a Python and Kubernetes service")
        assert result.replacements == {}
        assert result.rejections[0].kind is RejectionKind.UNSCOPED_CLAIM
        assert "kubernetes" in result.rejections[0].detail

    def test_a_new_name_is_refused(self, document):
        result = self.rewrite(document, "Built a Python service for Stripe payments")
        assert result.replacements == {}
        assert result.rejections[0].kind is RejectionKind.UNSCOPED_CLAIM

    def test_the_rejection_names_the_entry_it_protected(self, document):
        result = self.rewrite(document, "Built a Python service for Stripe payments")
        assert "under Todd" in result.rejections[0].detail

    def test_shortening_is_still_allowed(self, document):
        result = self.rewrite(document, "Built a Python service")
        assert result.replacements and result.rejections == ()

    def test_rewording_the_same_claims_is_still_allowed(self, document):
        result = self.rewrite(
            document, "Handled payment webhooks in a Python service"
        )
        assert result.replacements and result.rejections == ()

    def test_a_properly_scoped_fact_may_still_add_a_claim(self, document):
        """The rule is about what an *unscoped* fact can authorise.

        A fact attributed to this employer says the work happened here, and the
        provenance validator has already checked the figure against its text.
        """
        result = self.rewrite(
            document, "Built a Python service handling 4000 webhooks", fact="todd.1"
        )
        assert result.replacements and result.rejections == ()

    def test_a_scoped_fact_only_supports_what_it_says(self, document):
        """Todd's fact is cited, and it does support the figure it carries."""
        result = edits(
            document,
            op(
                "work-experience.todd.1",
                Action.REWRITE,
                text="Built a Python service handling 4000 replays",
                fact_ids=["todd.1"],
            ),
        )
        assert result.replacements and result.rejections == ()


class TestClaimPiggybacking:
    """The hole a per-operation check left open.

    Cite one properly scoped fact next to an unscoped one, and a coarse rule that
    asked only "does any cited fact name this employer" waved the whole rewrite
    through. The unscoped fact could then carry in a metric or a name that nothing
    attributed to this employer supported — while the rewrite looked, from the
    citation list, perfectly well sourced.

    So each new claim is matched against the facts scoped to *this* entry, one at a
    time. A scoped fact establishes what that fact says and no more.
    """

    def rewrite(self, document, text: str, *fact_ids: str):
        return edits(
            document,
            op(
                "work-experience.todd.1",
                Action.REWRITE,
                text=text,
                fact_ids=list(fact_ids),
            ),
        )

    def test_an_unscoped_fact_cannot_ride_along_with_a_scoped_one(self, document):
        """The regression itself.

        ``todd.1`` is scoped here and says nothing about Kubernetes; ``loose.1``
        mentions it and belongs to nobody. Together they must not put Kubernetes on
        a Todd bullet.
        """
        result = self.rewrite(
            document,
            "Built a Python service on Kubernetes handling payment webhooks",
            "todd.1",
            "loose.1",
        )
        assert result.replacements == {}
        assert result.rejections[0].kind is RejectionKind.UNSCOPED_CLAIM
        assert "kubernetes" in result.rejections[0].detail

    def test_the_supported_part_of_the_same_citation_is_not_what_saves_it(
        self, document
    ):
        """Both facts are cited and one claim from each is present.

        The Stripe half is genuinely supported by Todd's fact. The Kubernetes half
        is not supported by anything scoped here, and one unsupported claim is
        enough to refuse the rewrite — §7.7 blocks, it does not keep the good half.
        """
        result = self.rewrite(
            document,
            "Built a Python service on Kubernetes for Stripe payments",
            "todd.1",
            "loose.1",
        )
        assert result.replacements == {}
        detail = result.rejections[0].detail
        assert "kubernetes" in detail
        assert "stripe" not in detail.lower(), "the supported half is not the complaint"

    def test_a_figure_from_an_unscoped_fact_cannot_ride_along(self, document):
        """``loose.1`` says 4000; so does ``todd.1``, but of replays, not requests.

        The number is the claim, and it is in Todd's fact — so this one is allowed.
        The next test is the same shape with a number that is not.
        """
        result = self.rewrite(
            document, "Built a Python service handling 4000 webhooks", "todd.1", "loose.1"
        )
        assert result.replacements, "4000 is in Todd's own fact"

    def test_a_figure_in_neither_scoped_fact_is_refused(self, document):
        result = self.rewrite(
            document, "Built a Python service handling 9000 webhooks", "todd.1", "loose.1"
        )
        assert result.replacements == {}
        assert "9000" in result.rejections[0].detail

    def test_another_employers_fact_cannot_lend_a_claim_either(self, document):
        """The same rule across employers.

        ``ipser.1`` is cited alongside ``todd.1`` and carries "7 typed websocket
        events". On a Todd bullet, IpserLabs' figure is not Todd's.
        """
        result = self.rewrite(
            document,
            "Built a Python service handling 7 payment webhooks",
            "todd.1",
            "ipser.1",
        )
        assert result.replacements == {}
        assert result.rejections[0].kind is RejectionKind.UNSCOPED_CLAIM
        assert "7" in result.rejections[0].detail

    def test_a_technology_only_the_other_employer_used_is_refused(self, document):
        result = self.rewrite(
            document, "Built a Java service handling payment webhooks", "todd.1", "ipser.1"
        )
        assert result.replacements == {}
        assert "java" in result.rejections[0].detail

    def test_citing_more_facts_never_makes_a_claim_more_supported(self, document):
        """Adding citations is not a way to launder a claim.

        The same unsupported wording is refused whether it cites one fact or four.
        """
        text = "Built a Python service on Kubernetes handling payment webhooks"
        alone = self.rewrite(document, text, "todd.1")
        crowded = self.rewrite(document, text, "todd.1", "loose.1", "ipser.1", "thesis.1")

        assert alone.replacements == {} and crowded.replacements == {}
        assert alone.rejections[0].kind is crowded.rejections[0].kind

    def test_an_unscoped_fact_still_supports_pure_rewording(self, document):
        """The narrowness the rule keeps.

        Nothing new is claimed, so there is nothing for a scoped fact to have to
        support — and refusing this would make resumes imported before
        organisations were recorded untailorable.
        """
        result = self.rewrite(
            document, "Handled payment webhooks in a Python service", "loose.1"
        )
        assert result.replacements and result.rejections == ()

    def test_the_rejection_says_which_entry_found_no_support(self, document):
        result = self.rewrite(
            document, "Built a Python service on Kubernetes", "todd.1", "loose.1"
        )
        detail = result.rejections[0].detail
        assert "under Todd" in detail
        assert "no cited fact about Todd supports" in detail

    def test_a_bullet_with_no_entry_is_not_covered_by_this_rule(self):
        """There is no employer or project to misattribute the claim to.

        The wording still had to pass provenance validation to get here, so the
        claim is supported by *some* verified fact — it just cannot be pinned to an
        entry, because the bullet is not in one.
        """
        loose = parse(
            r"""\documentclass{article}
\newcommand{\resumeItem}[1]{\item#1}
\newcommand{\resumeItemListStart}{\begin{itemize}}
\begin{document}
\section{Summary}
  \resumeItemListStart
    \resumeItem{Builds backend services}
    \resumeItem{Writes tests}
\end{document}
"""
        )
        result = plan_edits(
            loose,
            plan(
                op(
                    "summary.1",
                    Action.REWRITE,
                    text="Builds backend services handling 4000 requests",
                    fact_ids=["loose.1"],
                )
            ),
            facts=FACTS,
        )
        assert result.replacements
        assert result.rejections == ()

    def test_a_refused_operation_leaves_the_bullet_as_written(self, document):
        result = edits(
            document,
            op(
                "work-experience.todd.1",
                Action.REWRITE,
                text="Built a Python service handling websockets",
                fact_ids=["ipser.1"],
            ),
        )
        out = render(document, dropped=result.dropped, replacements=result.replacements)
        assert out == BASE, "a refusal must change nothing at all"

    def test_the_refusals_are_recorded_for_the_manifest(self, document):
        result = edits(document, op("nope.1", Action.DROP))
        assert result.rejected_ids == ("nope.1",)
        assert "refused" in result.note


class TestActions:
    def test_a_keep_changes_nothing(self, document):
        result = edits(document, op("work-experience.todd.1", Action.KEEP))
        assert result.replacements == {} and result.dropped == frozenset()
        assert result.applied["work-experience.todd.1"] == 1

    def test_a_drop_removes_the_named_bullet(self, document):
        by_id = document.by_id()
        result = edits(document, op("work-experience.todd.2", Action.DROP))
        assert result.dropped == frozenset({by_id["work-experience.todd.2"].index})

    def test_a_bullet_nobody_mentioned_is_kept(self, document):
        """The safe default. Silence is not permission to remove."""
        result = edits(document, op("work-experience.todd.1", Action.KEEP))
        assert result.dropped == frozenset()

    def test_an_empty_plan_keeps_the_whole_resume(self, document):
        result = plan_edits(document, TailoringPlan(), facts=FACTS)
        assert result.dropped == frozenset() and result.replacements == {}
        assert "kept as written" in result.note

    def test_dropping_the_last_bullet_of_an_entry_is_refused(self, document):
        """A job title with nothing under it reads as broken, not concise."""
        result = edits(document, op("work-experience.kenyon-college.1", Action.DROP))
        assert result.dropped == frozenset()
        assert result.rejections[0].kind is RejectionKind.NOT_DROPPABLE

    def test_dropping_education_is_refused(self, document):
        result = edits(document, op("education.kenyon-college.1", Action.DROP))
        assert result.dropped == frozenset()
        assert result.rejections[0].kind is RejectionKind.NOT_DROPPABLE

    def test_an_unchanged_rewrite_leaves_the_markup_alone(self, document):
        """Round-tripping identical text would strip the \\textbf the user put
        there — a formatting change nobody asked for."""
        identical = document.by_id()["work-experience.todd.1"].plain
        result = edits(
            document,
            op("work-experience.todd.1", Action.REWRITE, text=identical, fact_ids=["todd.1"]),
        )
        assert result.replacements == {}
        assert "work-experience.todd.1" in result.applied


class TestSimilarityIsOnlyDiagnostic:
    def test_the_overlap_is_recorded_beside_each_rewrite(self, document):
        result = edits(
            document,
            op(
                "work-experience.todd.1",
                Action.REWRITE,
                text="Built a Python service for Stripe payments",
                fact_ids=["todd.1"],
            ),
        )
        assert 0.0 < result.drift["work-experience.todd.1"] <= 1.0

    def test_a_rewrite_with_no_overlap_at_all_is_still_applied(self, document):
        """Because resemblance has no vote.

        A truthful bullet that shares no vocabulary with the one it replaces is a
        legitimate rewrite — the id said where it goes, and the citation said it
        belongs to this employer.
        """
        result = edits(
            document,
            op(
                "work-experience.todd.1",
                Action.REWRITE,
                text="Shipped idempotent fulfilment for Todd checkout flows",
                fact_ids=["todd.1"],
            ),
        )
        assert result.replacements, "similarity must not gate placement"
        assert result.drift["work-experience.todd.1"] < 0.3


class TestEscaping:
    def test_a_percent_is_escaped(self):
        """The one that deletes content instead of failing.

        Unescaped, everything after the ``%`` is a comment — the bullet ends
        mid-sentence and the PDF gives no sign anything went missing.
        """
        assert latex_escape("cut latency 40% under load") == r"cut latency 40\% under load"

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("A&B Consulting", r"A\&B Consulting"),
            ("read_write access", r"read\_write access"),
            ("issue #42", r"issue \#42"),
            ("saved $3k", r"saved \$3k"),
            ("x^2 growth", r"x\^{}2 growth"),
            ("about ~50 users", r"about \~{}50 users"),
        ],
    )
    def test_every_special_character_is_handled(self, raw, expected):
        assert latex_escape(raw) == expected

    def test_a_backslash_cannot_smuggle_in_a_command(self):
        """Plan text is data. A model that emits ``\\input{/etc/passwd}`` must
        produce a bullet that reads like that, not a document that does it."""
        out = latex_escape(r"\input{/etc/passwd}")
        assert r"\input{" not in out
        assert "textbackslash" in out

    def test_braces_are_escaped_after_the_backslash(self):
        """Order matters: escaping braces first would then escape the
        backslashes of the brace escapes."""
        assert latex_escape("{a}") == r"\{a\}"

    def test_whitespace_is_collapsed(self):
        assert latex_escape("  two   words \n here ") == "two words here"

    def test_escaping_happens_on_the_way_into_the_document(self, document):
        result = edits(
            document,
            op(
                "work-experience.todd.1",
                Action.REWRITE,
                text="Built a Python service, cutting failures 40% at Todd",
                fact_ids=["todd.1"],
            ),
        )
        spliced = next(iter(result.replacements.values()))
        assert r"40\%" in spliced


class TestTheTemplateSurvives:
    def test_the_preamble_is_untouched_by_any_edit(self, document):
        result = edits(
            document,
            op(
                "work-experience.todd.1",
                Action.REWRITE,
                text="Built a Python service for Stripe payments",
                fact_ids=["todd.1"],
            ),
            op("work-experience.todd.2", Action.DROP),
        )
        out = render(document, dropped=result.dropped, replacements=result.replacements)
        marker = r"\begin{document}"
        assert out.split(marker)[0] == BASE.split(marker)[0]

    def test_every_heading_survives(self, document):
        result = edits(document, op("work-experience.todd.2", Action.DROP))
        out = render(document, dropped=result.dropped, replacements=result.replacements)
        for heading in ("Education", "Work Experience", "Projects"):
            assert heading in out
        for entry in ("Todd", "IpserLabs", "ThesisLedger", "Kenyon College"):
            assert entry in out

    def test_a_resume_with_no_bullets_is_left_alone(self):
        empty = parse(r"\documentclass{article}\begin{document}Nothing\end{document}")
        result = plan_edits(empty, plan(op("anything.1", Action.DROP)), facts=FACTS)
        assert result.dropped == frozenset() and result.replacements == {}
