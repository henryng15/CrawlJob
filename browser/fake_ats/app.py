"""A local fake ATS for end-to-end testing (spec §28.3).

Exists so the browser layer can be exercised without ever touching a real
employer's form. §28.6 forbids testing an adapter against a live application
until it has passed here, and there is no honest way to test submission detection
against a real ATS: the only way to see a confirmation page is to submit.

The forms mirror the *shape* of Greenhouse, Lever and Ashby rather than copying
their markup — the same field labels, the same question types, the same
confirmation behaviour. Faults can be switched on per-request so the failure paths
are testable too:

    /greenhouse/jobs/1?fault=captcha    a CAPTCHA the worker must refuse to solve
    /greenhouse/jobs/1?fault=selectors  renamed inputs, to exercise replay
    /greenhouse/jobs/1?fault=expired    an expired session
    /greenhouse/jobs/1?fault=validation rejects the first submit

Never expose this outside the test network. It accepts anything and stores it in
memory.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.responses import HTMLResponse, RedirectResponse

__all__ = ["ATSFlavour", "Fault", "create_app", "submissions"]


class ATSFlavour(StrEnum):
    GREENHOUSE = "greenhouse"
    LEVER = "lever"
    ASHBY = "ashby"


class Fault(StrEnum):
    NONE = ""
    CAPTCHA = "captcha"
    SELECTORS = "selectors"
    EXPIRED = "expired"
    VALIDATION = "validation"
    SLOW = "slow"


@dataclass(slots=True)
class Submission:
    id: str
    flavour: ATSFlavour
    job_id: str
    fields: dict[str, Any] = field(default_factory=dict)


#: In-memory store. Tests read it to assert what the fill engine actually typed.
submissions: dict[str, Submission] = {}


@dataclass(frozen=True, slots=True)
class Question:
    name: str
    label: str
    kind: str = "text"
    required: bool = False
    options: tuple[str, ...] = ()


#: Common to every flavour. The manual-only questions are present on purpose: a
#: test that never sees them cannot prove the worker leaves them alone.
_BASE: tuple[Question, ...] = (
    Question("first_name", "First Name", required=True),
    Question("last_name", "Last Name", required=True),
    Question("email", "Email", kind="email", required=True),
    Question("phone", "Phone", kind="tel"),
    Question("resume", "Resume/CV", kind="file", required=True),
    Question("linkedin", "LinkedIn Profile", kind="url"),
    Question("github", "GitHub URL", kind="url"),
    Question("school", "School", required=True),
    Question("grad_date", "Expected graduation date", kind="month"),
    Question(
        "work_auth",
        "Are you legally authorized to work in the US?",
        kind="select",
        required=True,
        options=("Yes", "No"),
    ),
    Question(
        "sponsorship",
        "Will you now or in the future require sponsorship?",
        kind="select",
        required=True,
        options=("Yes", "No"),
    ),
    Question("why", "Why do you want to work here?", kind="textarea"),
)

_EEO: tuple[Question, ...] = (
    Question(
        "eeo_gender",
        "Gender",
        kind="select",
        options=("Male", "Female", "Decline to self-identify"),
    ),
    Question(
        "eeo_race",
        "Race / Ethnicity",
        kind="select",
        options=("Asian", "White", "Decline to self-identify"),
    ),
    Question(
        "eeo_veteran",
        "Are you a protected veteran?",
        kind="select",
        options=("Yes", "No", "Decline to self-identify"),
    ),
    Question(
        "eeo_disability",
        "Disability status",
        kind="select",
        options=("Yes", "No", "Decline to self-identify"),
    ),
)

_ATTESTATION: tuple[Question, ...] = (
    Question("certify", "I certify that the information provided is accurate", kind="checkbox"),
)

FORMS: dict[ATSFlavour, tuple[Question, ...]] = {
    ATSFlavour.GREENHOUSE: _BASE + _EEO + _ATTESTATION,
    ATSFlavour.LEVER: _BASE + _ATTESTATION,
    ATSFlavour.ASHBY: _BASE + (Question("salary", "What are your salary expectations?"),) + _EEO,
}


def _render_field(q: Question, fault: Fault) -> str:
    # The selectors fault renames every input, which is exactly what an ATS
    # redesign does to a stored replay package (§7.11).
    name = f"{q.name}_v2" if fault is Fault.SELECTORS else q.name
    required = " required" if q.required else ""
    label = f'<label for="{name}">{q.label}</label>'

    if q.kind == "textarea":
        control = f'<textarea id="{name}" name="{name}"{required}></textarea>'
    elif q.kind == "select":
        options = "".join(f'<option value="{o}">{o}</option>' for o in ("", *q.options))
        control = f'<select id="{name}" name="{name}"{required}>{options}</select>'
    elif q.kind == "checkbox":
        control = f'<input type="checkbox" id="{name}" name="{name}"{required}>'
    else:
        control = f'<input type="{q.kind}" id="{name}" name="{name}"{required}>'

    return f'<div class="field">{label}{control}</div>'


def _page(title: str, body: str) -> HTMLResponse:
    return HTMLResponse(
        f"<!doctype html><html><head><title>{title}</title></head><body>{body}</body></html>"
    )


def create_app() -> FastAPI:
    app = FastAPI(title="Fake ATS", docs_url=None, redoc_url=None)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/{flavour}/jobs/{job_id}", response_class=HTMLResponse)
    def form(flavour: ATSFlavour, job_id: str, fault: Fault = Fault.NONE) -> HTMLResponse:
        if fault is Fault.EXPIRED:
            return _page(
                "Session expired",
                "<h1>Your session has expired</h1><p>Please start again.</p>",
            )

        questions = FORMS[flavour]
        fields = "".join(_render_field(q, fault) for q in questions)

        captcha = (
            '<div class="captcha"><label for="captcha">Verify you are human</label>'
            '<input id="captcha" name="captcha" required></div>'
            if fault is Fault.CAPTCHA
            else ""
        )

        return _page(
            f"Software Engineer Intern - {flavour.value.title()}",
            f"<h1>Software Engineer Intern</h1>"
            f'<form id="application-form" method="post" '
            f'action="/{flavour.value}/jobs/{job_id}/applications?fault={fault.value}" '
            f'enctype="multipart/form-data">'
            f"{fields}{captcha}"
            f'<button type="submit" id="submit-application">Submit Application</button>'
            f"</form>",
        )

    @app.post("/{flavour}/jobs/{job_id}/applications", response_model=None)
    async def submit(
        request: Request,
        flavour: ATSFlavour,
        job_id: str,
        fault: Fault = Fault.NONE,
    ) -> Response:
        payload = await request.form()
        values = {
            k: (v if isinstance(v, str) else getattr(v, "filename", "")) for k, v in payload.items()
        }

        if fault is Fault.VALIDATION:
            return _page(
                "Apply - 1 error",
                '<div class="errors" role="alert">Please correct the errors below.</div>'
                '<form id="application-form">'
                '<button id="submit-application">Submit</button>'
                "</form>",
            )

        submission_id = str(uuid.uuid4())
        submissions[submission_id] = Submission(submission_id, flavour, job_id, values)

        return RedirectResponse(
            f"/{flavour.value}/jobs/{job_id}/confirmation?id={submission_id}", status_code=303
        )

    @app.get("/{flavour}/jobs/{job_id}/confirmation", response_class=HTMLResponse)
    def confirmation(flavour: ATSFlavour, job_id: str, id: str = "") -> HTMLResponse:
        return _page(
            "Application Confirmation",
            f"<h1>Thank you for applying</h1>"
            f"<p>Your application has been submitted.</p>"
            f'<p class="reference">Reference: {id}</p>',
        )

    return app


app = create_app()
