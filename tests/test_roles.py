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
