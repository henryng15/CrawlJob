"""Fake ATS tests (spec §28.3).

The fake ATS is test infrastructure, so it needs its own tests: a fixture that
quietly stops serving the sponsorship question would make the browser tests pass
for the wrong reason.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.ats.fields import MANUAL_ONLY_KEYS, FieldSpec, classify
from browser.fake_ats.app import FORMS, ATSFlavour, create_app, submissions


@pytest.fixture
def client() -> TestClient:
    submissions.clear()
    return TestClient(create_app())


class TestFormRendering:
    @pytest.mark.parametrize("flavour", list(ATSFlavour))
    def test_every_flavour_serves_a_form(self, client: TestClient, flavour: ATSFlavour):
        response = client.get(f"/{flavour.value}/jobs/1")
        assert response.status_code == 200
        assert 'id="application-form"' in response.text
        assert 'id="submit-application"' in response.text

    @pytest.mark.parametrize("flavour", list(ATSFlavour))
    def test_every_field_has_a_label(self, client: TestClient, flavour: ATSFlavour):
        """Semantic locators depend on labels; unlabelled inputs are unfillable."""
        body = client.get(f"/{flavour.value}/jobs/1").text
        for question in FORMS[flavour]:
            assert f'for="{question.name}"' in body, question.name

    def test_the_greenhouse_form_carries_the_eeo_block(self, client: TestClient):
        body = client.get("/greenhouse/jobs/1").text
        for label in ("Gender", "Race / Ethnicity", "protected veteran", "Disability"):
            assert label in body


class TestFixtureCoversTheManualOnlyPolicy:
    def test_the_forms_include_manual_only_questions(self):
        """Otherwise the browser tests could never prove the worker leaves them alone."""
        labels = [q.label for questions in FORMS.values() for q in questions]
        classified = {classify(FieldSpec(question_text=label)) for label in labels}
        covered = classified & MANUAL_ONLY_KEYS

        assert {
            "auth.work_authorized",
            "auth.requires_sponsorship",
            "eeo.gender",
            "eeo.race_ethnicity",
            "eeo.veteran_status",
            "eeo.disability",
            "legal.attestation",
        } <= covered

    def test_the_forms_also_include_ordinary_fillable_questions(self):
        labels = [q.label for q in FORMS[ATSFlavour.GREENHOUSE]]
        classified = {classify(FieldSpec(question_text=label)) for label in labels}
        assert {"candidate.first_name", "candidate.email", "documents.resume"} <= classified


class TestSubmission:
    def test_a_submit_lands_on_a_confirmation_page(self, client: TestClient):
        response = client.post(
            "/greenhouse/jobs/1/applications",
            data={"first_name": "Hoan", "email": "a@b.com"},
            follow_redirects=True,
        )
        assert response.status_code == 200
        assert "Your application has been submitted" in response.text
        assert "/confirmation" in str(response.url)

    def test_the_submitted_values_are_recorded_for_assertions(self, client: TestClient):
        client.post(
            "/greenhouse/jobs/1/applications",
            data={"first_name": "Hoan", "sponsorship": "Yes"},
            follow_redirects=True,
        )
        stored = next(iter(submissions.values()))
        assert stored.fields["first_name"] == "Hoan"
        assert stored.fields["sponsorship"] == "Yes"

    def test_the_confirmation_page_matches_the_detector(self, client: TestClient):
        """The fixture and the detector must agree, or one of them is wrong."""
        from app.ats.submission import Observation, detect

        form_url = "http://testserver/greenhouse/jobs/1"
        response = client.post(
            "/greenhouse/jobs/1/applications", data={"first_name": "H"}, follow_redirects=True
        )
        verdict = detect(
            Observation(
                url_before=form_url,
                url_after=str(response.url),
                text_after=response.text,
                title_before="Software Engineer Intern - Greenhouse",
                title_after="Application Confirmation",
                submit_button_present_after=False,
                form_present_after=False,
            )
        )
        assert verdict.submitted


class TestFaults:
    def test_captcha_fault_adds_a_challenge(self, client: TestClient):
        """The worker must mark this manual, never attempt it (AGENTS.md)."""
        body = client.get("/greenhouse/jobs/1", params={"fault": "captcha"}).text
        assert 'class="captcha"' in body

    def test_selectors_fault_renames_every_input(self, client: TestClient):
        """Simulates the ATS redesign that invalidates a stored replay package."""
        normal = client.get("/greenhouse/jobs/1").text
        renamed = client.get("/greenhouse/jobs/1", params={"fault": "selectors"}).text
        assert 'name="first_name"' in normal
        assert 'name="first_name_v2"' in renamed

    def test_expired_fault_serves_no_form(self, client: TestClient):
        body = client.get("/greenhouse/jobs/1", params={"fault": "expired"}).text
        assert "session has expired" in body
        assert "application-form" not in body

    def test_validation_fault_rejects_the_first_submit(self, client: TestClient):
        response = client.post(
            "/greenhouse/jobs/1/applications",
            params={"fault": "validation"},
            data={"first_name": "H"},
            follow_redirects=True,
        )
        assert 'class="errors"' in response.text
        assert not submissions, "a rejected submission must not be recorded"

    def test_the_validation_fault_is_not_read_as_success(self, client: TestClient):
        """The case that motivated the errors_visible veto in §7.10."""
        from app.ats.submission import Observation, detect

        response = client.post(
            "/greenhouse/jobs/1/applications",
            params={"fault": "validation"},
            data={"first_name": "H"},
            follow_redirects=True,
        )
        verdict = detect(
            Observation(
                url_before="http://testserver/greenhouse/jobs/1",
                url_after=str(response.url),
                text_after=response.text,
                title_before="Software Engineer Intern - Greenhouse",
                title_after="Apply - 1 error",
                errors_visible='class="errors"' in response.text,
            )
        )
        assert not verdict.submitted


class TestHealth:
    def test_health_endpoint(self, client: TestClient):
        assert client.get("/health").json() == {"status": "ok"}
