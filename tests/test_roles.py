import pytest

from job_sync.roles import is_target_role


@pytest.mark.parametrize(
    "role",
    [
        "Software Engineering Intern",
        "Software Engineer Internship",
        "SWE Intern",
        "Cloud Engineer Intern",
        "DevOps Engineering Co-op",
        "Forward Deployed Software Engineer Intern",
        "Platform Engineer Intern",
        "Backend Software Developer Intern",
        "ML Platform Engineer Internship",
    ],
)
def test_target_roles(role: str) -> None:
    assert is_target_role(role)


@pytest.mark.parametrize("role", ["Software Engineer", "Product Manager Intern"])
def test_non_target_roles(role: str) -> None:
    assert not is_target_role(role)


def test_a_family_word_now_carries_a_non_technical_role_in_with_it() -> None:
    """ "Cloud Sales Intern" used to be a deliberate negative. Once `cloud` counts on
    its own it comes in, and this pins that as a chosen cost rather than a slip.

    The instruction was to accept anything naming these families, and the sales
    internship at a cloud company is what that buys along the way: one row to read
    and skip. Narrowing it back means an exclusion list — sales, marketing,
    recruiting — which would also start refusing "Sales Engineering Intern"."""
    assert is_target_role("Cloud Sales Intern")


def test_finance_calls_an_internship_a_summer_analyst() -> None:
    """Banks and trading firms never use the word intern. Verition posted "2027
    Technology Internship (US)" and the same desk elsewhere posts "Technology
    Summer Analyst" — one applicant, one role, and one of them was invisible."""
    assert is_target_role("Technology Summer Analyst")
    assert is_target_role("2027 Technology Internship (US)")
    assert is_target_role("Summer 2027 Technology Analyst")


def test_a_summer_analyst_outside_technology_is_not_this_tracker_s_job() -> None:
    """The widened internship reading is only safe because the role half still has
    to agree. Without that, every bank's whole summer programme arrives."""
    assert not is_target_role("Investment Banking Summer 2027 Analyst")
    assert not is_target_role("Equity Research Summer Analyst")
    assert not is_target_role("Summer 2027 Sales Analyst")


def test_a_full_time_graduate_programme_is_not_an_internship() -> None:
    """ "Analyst Program" with no summer and no intern is the graduate scheme."""
    assert not is_target_role("Technology Analyst Program")


def test_technology_alone_counts_as_the_discipline() -> None:
    """Finance names the function rather than the discipline, so there is no second
    word to anchor on. The cost is admitting the odd marketing-technology role."""
    assert is_target_role("Technology Intern")
    assert not is_target_role("Chemical Engineering Intern")
    assert not is_target_role("Marketing Intern")


def test_a_family_name_on_its_own_is_enough() -> None:
    """An employer who writes "Cloud Intern" means exactly what this tracker wants.
    Demanding they also write "engineer" only filtered out the terse ones."""
    for role in (
        "Cloud Intern",
        "Infrastructure Engineering Intern",
        "DevOps Intern",
        "Technology Intern",
        "Software Intern",
        "MLOps Co-op",
        "ML Intern",
    ):
        assert is_target_role(role), role


def test_the_ai_family_is_read_the_way_employers_write_it() -> None:
    for role in (
        "AI Summer Analyst",
        "Generative AI Ph.D. Research Intern",
        "Deep Learning Computer Architecture Intern",
        "Machine Learning Intern",
        "LLM Research Intern",
    ):
        assert is_target_role(role), role


def test_the_intake_half_is_what_keeps_the_loosening_affordable() -> None:
    """Every family name below is now enough on its own, so nothing but the
    internship test stands between this tracker and every senior role at every
    company on the list."""
    for role in (
        "Cloud Solutions Architect",
        "Head of AI",
        "Senior Machine Learning Engineer",
        "MLOps Engineer",
        "Director, Technology",
    ):
        assert not is_target_role(role), role


def test_a_word_that_merely_contains_a_family_name_is_not_one() -> None:
    assert not is_target_role("Air Quality Intern")
    assert not is_target_role("Mail Room Intern")
