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


@pytest.mark.parametrize(
    "role", ["Software Engineer", "Product Manager Intern", "Cloud Sales Intern"]
)
def test_non_target_roles(role: str) -> None:
    assert not is_target_role(role)


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
