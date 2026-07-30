"""The production tailoring path, end to end, with a real compiler (§7.7, §26.2).

This file exists to prove one thing that no unit test can: that the worker the
pipeline actually runs produces its PDF by compiling the user's own LaTeX, and
that the exact bytes it compiled are the bytes recorded, selected, and handed to
the browser.

Nothing about the resume is mocked. The model is (there is no key, and its output
is not what is under test), but the plan it returns goes through provenance
validation, id-keyed placement, pdflatex, the page check, the attempt ladder and
the artifact writer exactly as it would in production.

Marked ``latex``: a machine without TeX skips rather than fails.

    uv run pytest -m "not latex"
"""

from __future__ import annotations

import hashlib
import json
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.db.models import Application, Company, Job, ResumeVersion
from app.domain.normalization import canonicalize_url, url_hash
from app.domain.states import ApplicationState, JobState
from app.domain.tasks import TaskType, idempotency_key
from app.services.latex import engine_available
from app.services.llm.base import BudgetLedger, ModelPricing, NullProvider
from app.services.llm.batch import BatchOutcome, BatchStatus, outcome_from
from app.services.queue import enqueue
from app.services.resume_tex import Bullet as TexBullet
from app.services.resume_tex import parse
from app.worker.handlers import register_pipeline
from app.worker.runtime import Registry, Worker

pytestmark = [pytest.mark.db, pytest.mark.latex]

if engine_available() is None:  # pragma: no cover - depends on the machine
    pytest.skip("no LaTeX engine installed", allow_module_level=True)

NOW = datetime.now(UTC).replace(microsecond=0)

JOB_TEXT = (
    "Backend Engineer Intern. Python, FastAPI, PostgreSQL, Docker, REST APIs, CI/CD."
)

#: Padding that makes a bullet long without making it *different*: the words
#: repeat, so the overlap score that matches it to its base bullet barely moves,
#: and no number, technology or capitalised name is introduced for provenance
#: validation to reject.
PADDING = " working carefully on reliable everyday delivery work" * 40


# --------------------------------------------------------------- the base


@pytest.fixture(scope="module")
def canonical() -> tuple[Path, Path]:
    """The user's own resume, exactly as configured. Read only, never written."""
    settings = Settings(app_env="development", app_secret_key="e2e")
    tex, pdf = settings.base_resume_tex, settings.base_resume_pdf
    if tex is None or not tex.is_file() or pdf is None or not pdf.is_file():
        pytest.skip("no base resume configured (BASE_RESUME_TEX / BASE_RESUME_PDF)")
    return tex, pdf


@pytest.fixture
def settings(tmp_path: Path, canonical: tuple[Path, Path]) -> Settings:
    tex, pdf = canonical
    return Settings(
        app_env="development",
        app_secret_key="tailoring-e2e",
        data_dir=tmp_path / "data",
        base_resume_tex=tex,
        base_resume_pdf=pdf,
    )


@pytest.fixture
def base_bullets(canonical: tuple[Path, Path]) -> list[TexBullet]:
    """Every bullet in the canonical resume, with its id and its entry.

    Plans are built from these, so the operations name real ids and cite facts
    attributed to the entry each bullet sits under — the same shape a model is
    asked for.
    """
    tex, _ = canonical
    return list(parse(tex.read_text(encoding="utf-8")).bullets)


# ------------------------------------------------------------- the worker


class FakeBatchClient:
    def __init__(self) -> None:
        self.batch_id = "batch_e2e_0001"
        self.status_value = BatchStatus(self.batch_id, "ended", succeeded=1)
        self.outcome = BatchOutcome()
        self.submit_calls = 0
        self.requests: list[Any] = []

    def submit(self, requests, *, model, schema, system=None):
        self.submit_calls += 1
        self.requests.extend(requests)
        return self.batch_id

    def status(self, batch_id):
        return self.status_value

    def results(self, batch_id):
        return self.outcome

    def cancel(self, batch_id):
        return "canceling"


@pytest.fixture
def fake_client(monkeypatch: pytest.MonkeyPatch) -> FakeBatchClient:
    client = FakeBatchClient()
    monkeypatch.setattr(
        "app.services.llm.batch_client.AnthropicBatchClient", lambda **_: client
    )
    return client


@pytest.fixture
def provider() -> NullProvider:
    p = NullProvider(budget=BudgetLedger(monthly_cap_usd=15.0))
    p.pricing = {"claude-sonnet-5": ModelPricing(3.0, 15.0)}
    return p


@pytest.fixture
def worker(
    committing_db: sessionmaker[Session], settings: Settings, provider: NullProvider
) -> Worker:
    registry = register_pipeline(
        Registry(), settings=settings, provider_factory=lambda _: provider
    )
    return Worker(
        session_factory=committing_db,
        worker_id="tailoring-e2e",
        registry=registry,
        poll_interval=0.0,
    )


@pytest.fixture
def db(committing_db: sessionmaker[Session]) -> Iterator[Session]:
    session = committing_db()
    try:
        yield session
    finally:
        session.close()


# --------------------------------------------------------------- fixtures


def make_application(db: Session) -> Application:
    company = Company(
        canonical_name="Acme Inc",
        normalized_name=f"acme-{uuid.uuid4().hex[:6]}",
        domain="acme.com",
    )
    db.add(company)
    db.flush()

    url = f"https://boards.greenhouse.io/acme/jobs/{uuid.uuid4().hex[:8]}"
    job = Job(
        company_id=company.id,
        canonical_url=canonicalize_url(url),
        canonical_url_hash=url_hash(url),
        title="Software Engineer Intern",
        normalized_title="software engineer intern",
        dedupe_fingerprint=uuid.uuid4().hex,
        discovered_at=NOW,
        status=JobState.SCORED,
        description_text=JOB_TEXT,
    )
    db.add(job)
    db.flush()

    application = Application(
        job_id=job.id, application_url=url, status=ApplicationState.CREATED
    )
    db.add(application)
    db.commit()
    return application


def store_facts(db: Session, bullets: list[TexBullet], *, pad: bool = False) -> None:
    """One verified fact per base bullet, quoting it exactly.

    Verbatim on purpose: the point of this file is the LaTeX path, so provenance
    validation must pass without becoming the thing under test. Each fact carries
    the employer or project of the bullet it came from, because the provenance
    check compares that against where a rewrite would land.
    """
    from app.services.candidate import Actor, set_fact

    set_fact(db, "candidate.preferred_name", "Hoan", actor=Actor.USER)
    for index, bullet in enumerate(bullets):
        set_fact(
            db,
            f"resume.fact.f{index}",
            {
                "text": bullet.plain + (PADDING if pad else ""),
                "technologies": [],
                "organisation": bullet.entry,
            },
            actor=Actor.USER,
            verified=True,
        )
    db.commit()


def plan_from(bullets: list[TexBullet], *, pad: bool = False) -> dict:
    """A plan that rewrites every bullet in place, by id.

    The operations name the resume's own ids and cite the fact drawn from that
    same bullet, so each rewrite is attributed to the entry it belongs to.
    """
    return {
        "summary": "",
        "summary_fact_ids": [],
        "operations": [
            {
                "bullet_id": bullet.bullet_id,
                "action": "rewrite",
                "text": bullet.plain + (PADDING if pad else ""),
                "fact_ids": [f"f{index}"],
                "section": bullet.section,
                "entry": bullet.entry,
            }
            for index, bullet in enumerate(bullets)
        ],
        "section_order": [],
    }


def plan_rewording(bullets: list[TexBullet], suffix: str) -> dict:
    """A plan whose rewrites are visibly different from what they replace.

    The suffix adds no number, technology or proper noun, so provenance validation
    still passes against the same facts — the point is only to be able to see the
    new wording in the built document.
    """
    plan = plan_from(bullets)
    for operation in plan["operations"]:
        operation["text"] += suffix
    return plan


def succeeded(custom_id: str, payload: dict) -> dict:
    return {
        "custom_id": custom_id,
        "result": {
            "type": "succeeded",
            "message": {
                "content": [
                    {"type": "tool_use", "name": "record_result", "input": payload}
                ],
                "usage": {"input_tokens": 500, "output_tokens": 500},
            },
        },
    }


def drain(worker: Worker, limit: int = 4) -> int:
    ran = 0
    while ran < limit and worker.run_once(now=NOW + timedelta(minutes=1)):
        ran += 1
    return ran


def run_batch(
    worker: Worker,
    db: Session,
    fake_client: FakeBatchClient,
    plan: dict,
    *,
    key: str = "e2e",
) -> Application:
    """Submit and collect one batch, ending with the plan applied."""
    application = make_application(db)
    fake_client.batch_id = f"batch_{key}"
    fake_client.status_value = BatchStatus(fake_client.batch_id, "ended", succeeded=1)
    # Queued before the worker starts, so the submit and the poll it enqueues can
    # run back to back. A spent poll from an earlier batch may be drained along
    # with them; re-running one is harmless, since an applied batch returns at
    # once without touching a resume.
    fake_client.outcome = outcome_from([succeeded(str(application.id), plan)])
    enqueue(
        db,
        task_type=TaskType.SUBMIT_TAILORING_BATCH,
        dedupe_key=idempotency_key(TaskType.SUBMIT_TAILORING_BATCH, key),
        payload={"dedupe_key": key, "application_ids": [str(application.id)]},
        run_at=NOW,
    )
    db.commit()
    drain(worker, limit=6)
    db.expire_all()
    db.refresh(application)
    return application


def selected(db: Session, application: Application) -> ResumeVersion:
    """The version the build chose to send.

    Not "uploaded": no browser runs in this file, so nothing here has reached an
    employer. ``TestTheUploadLifecycle`` covers the difference.
    """
    rows = db.scalars(
        select(ResumeVersion)
        .where(ResumeVersion.application_id == application.id)
        .where(ResumeVersion.is_selected.is_(True))
    ).all()
    assert len(rows) == 1, f"expected exactly one selected resume, found {len(rows)}"
    return rows[0]


def versions(db: Session, application: Application) -> list[ResumeVersion]:
    return list(
        db.scalars(
            select(ResumeVersion)
            .where(ResumeVersion.application_id == application.id)
            .order_by(ResumeVersion.attempt)
        ).all()
    )


# ------------------------------------------------------------------ tests


class TestTheWorkerUsesTheLatexBuilder:
    """The claim this whole change is about."""

    def test_the_selected_pdf_was_compiled_from_the_users_own_tex(
        self, worker, db, fake_client, base_bullets
    ):
        store_facts(db, base_bullets)
        application = run_batch(worker, db, fake_client, plan_from(base_bullets))

        row = selected(db, application)
        source = Path(row.source_path).read_text(encoding="utf-8")
        assert r"\begin{document}" in source, "the artifact is LaTeX, not HTML"
        assert r"\resumeItem" in source, "and it is the user's template"

    def test_the_preamble_of_the_users_template_survives_byte_for_byte(
        self, worker, db, fake_client, base_bullets, canonical
    ):
        """Everything above \\begin{document}: geometry, fonts, every custom
        command. The one property that makes "the template is preserved" a fact
        about the code rather than a claim about it."""
        tex, _ = canonical
        store_facts(db, base_bullets)
        application = run_batch(worker, db, fake_client, plan_from(base_bullets))

        marker = r"\begin{document}"
        built = Path(selected(db, application).source_path).read_text(encoding="utf-8")
        assert built.split(marker)[0] == tex.read_text(encoding="utf-8").split(marker)[0]

    def test_the_compile_log_names_a_real_tex_engine(
        self, worker, db, fake_client, base_bullets
    ):
        """A log is stored, it is from TeX, and it is per attempt."""
        store_facts(db, base_bullets)
        application = run_batch(worker, db, fake_client, plan_from(base_bullets))

        row = selected(db, application)
        assert row.log_path is not None
        log_text = Path(row.log_path).read_text(encoding="utf-8", errors="replace")
        assert "TeX" in log_text

    def test_no_html_renderer_is_left_to_fall_back_to(self):
        """Structural, not behavioural.

        A second renderer that still worked would be reachable by the next person
        who needed a PDF in a hurry, and the two would drift.
        """
        import app.services.resume_import as resume_import

        assert not hasattr(resume_import, "render_pdf")
        assert not hasattr(resume_import, "to_html")

    def test_nothing_in_the_application_imports_weasyprint(self):
        """The HTML renderer's dependency is gone from the source as well.

        Left behind, it would be installed on every deploy and importable by
        anything that wanted a quick PDF.
        """
        root = Path(__file__).resolve().parents[2] / "app"
        offenders = [
            str(path.relative_to(root))
            for path in root.rglob("*.py")
            if "weasyprint" in path.read_text(encoding="utf-8")
        ]
        assert offenders == []


class TestTheSynchronousHandlerTakesTheSamePath:
    """``TAILOR_RESUME`` is the other production entry point.

    It exists for the single application re-run by hand, and it must produce
    exactly the artifacts the batch path produces. Two renderers that agreed
    today would disagree by the time anybody noticed.
    """

    def run_one(self, worker, db, provider, plan: dict) -> Application:
        application = make_application(db)
        provider.queue(plan)
        enqueue(
            db,
            task_type=TaskType.TAILOR_RESUME,
            dedupe_key=idempotency_key(TaskType.TAILOR_RESUME, str(application.id)),
            payload={"application_id": str(application.id)},
            run_at=NOW,
        )
        db.commit()
        drain(worker, limit=2)
        db.expire_all()
        db.refresh(application)
        return application

    def test_it_builds_the_pdf_from_the_users_latex(
        self, worker, db, provider, base_bullets
    ):
        store_facts(db, base_bullets)
        application = self.run_one(worker, db, provider, plan_from(base_bullets))

        row = selected(db, application)
        assert row.kind == "TAILORED"
        assert row.page_count == 1
        assert r"\resumeItem" in Path(row.source_path).read_text(encoding="utf-8")

    def test_it_writes_the_same_attempt_artifacts(
        self, worker, db, provider, settings, base_bullets
    ):
        from app.services.resume_artifacts import resume_dir

        store_facts(db, base_bullets)
        application = self.run_one(worker, db, provider, plan_from(base_bullets))

        attempt = resume_dir(settings, application.id) / "attempt-1"
        for name in ("resume.tex", "resume.pdf", "compile.log", "manifest.json"):
            assert (attempt / name).is_file(), name

    def test_the_application_is_queued_for_a_browser_afterwards(
        self, worker, db, provider, base_bullets
    ):
        store_facts(db, base_bullets)
        application = self.run_one(worker, db, provider, plan_from(base_bullets))
        assert application.status == ApplicationState.BROWSER_QUEUED

    def test_it_falls_back_to_the_base_resume_too(
        self, worker, db, provider, base_bullets, canonical
    ):
        _, pdf = canonical
        store_facts(db, base_bullets, pad=True)
        application = self.run_one(
            worker, db, provider, plan_from(base_bullets, pad=True)
        )

        row = selected(db, application)
        assert row.kind == "BASE"
        assert Path(row.pdf_path).read_bytes() == pdf.read_bytes()

    def test_an_unsupported_claim_blocks_it(self, worker, db, provider, base_bullets):
        store_facts(db, base_bullets)
        invented = {
            "summary": "",
            "summary_fact_ids": [],
            "operations": [
                {
                    "bullet_id": base_bullets[0].bullet_id,
                    "action": "rewrite",
                    "text": "Led a team of 47 engineers at Globex",
                    "fact_ids": ["f0"],
                }
            ],
            "section_order": [],
        }
        # Two: tailor() retries once with the violations fed back.
        provider.queue(invented)
        application = self.run_one(worker, db, provider, invented)

        assert versions(db, application) == []
        assert application.status == ApplicationState.CREATED


class TestOneEntrysWorkNeverAppearsUnderAnother:
    """Driven through the worker, against the user's real resume.

    That resume has four employers and three projects, several of which describe
    similar backend work. The unit tests prove the placement rules; this proves
    they hold on the way through the queue, the batch handler, provenance
    validation, pdflatex and the artifact writer.
    """

    def entries(self, bullets: list[TexBullet]) -> dict[str, list[TexBullet]]:
        grouped: dict[str, list[TexBullet]] = {}
        for bullet in bullets:
            grouped.setdefault(bullet.entry, []).append(bullet)
        return grouped

    def test_a_rewrite_appears_only_under_the_entry_it_names(
        self, worker, db, fake_client, base_bullets
    ):
        target = base_bullets[0]
        store_facts(db, base_bullets)

        marker = "and shipped it under review"
        plan = plan_from(base_bullets)
        for operation in plan["operations"]:
            if operation["bullet_id"] == target.bullet_id:
                operation["text"] += f" {marker}"

        application = run_batch(worker, db, fake_client, plan)
        built = Path(selected(db, application).source_path).read_text(encoding="utf-8")
        assert built.count(marker) == 1, "the wording reached exactly one bullet"

    def test_citing_another_entrys_fact_is_refused_and_the_bullet_kept(
        self, worker, db, fake_client, base_bullets, canonical
    ):
        """The plan asks for one employer's achievement under another's heading.

        The id says where; the citation says whose work it is. When they disagree
        the operation is dropped and the user's own sentence stays.
        """
        grouped = self.entries(base_bullets)
        names = [name for name in grouped if name]
        if len(names) < 2:  # pragma: no cover - depends on the resume
            pytest.skip("the base resume has only one entry")
        here, elsewhere = grouped[names[0]][0], grouped[names[1]][0]

        store_facts(db, base_bullets)
        borrowed = base_bullets.index(elsewhere)
        plan = {
            "summary": "",
            "summary_fact_ids": [],
            "operations": [
                {
                    "bullet_id": here.bullet_id,
                    "action": "rewrite",
                    # Truthful wording, cited to a fact from a different employer.
                    "text": elsewhere.plain,
                    "fact_ids": [f"f{borrowed}"],
                }
            ],
            "section_order": [],
        }

        application = run_batch(worker, db, fake_client, plan)
        built = Path(selected(db, application).source_path).read_text(encoding="utf-8")
        tex, _ = canonical
        assert built == tex.read_text(encoding="utf-8"), "nothing was changed"

    def test_the_refusal_is_recorded_in_the_manifest(
        self, worker, db, fake_client, base_bullets
    ):
        """A silent refusal would look like a model that had nothing to suggest."""
        grouped = self.entries(base_bullets)
        names = [name for name in grouped if name]
        if len(names) < 2:  # pragma: no cover - depends on the resume
            pytest.skip("the base resume has only one entry")
        here, elsewhere = grouped[names[0]][0], grouped[names[1]][0]

        store_facts(db, base_bullets)
        plan = {
            "summary": "",
            "summary_fact_ids": [],
            "operations": [
                {
                    "bullet_id": here.bullet_id,
                    "action": "rewrite",
                    "text": elsewhere.plain,
                    "fact_ids": [f"f{base_bullets.index(elsewhere)}"],
                }
            ],
            "section_order": [],
        }
        application = run_batch(worker, db, fake_client, plan)

        manifest = json.loads(
            Path(selected(db, application).manifest_path).read_text(encoding="utf-8")
        )
        assert manifest["rejected_operations"]
        assert "PROVENANCE_MISMATCH" in manifest["rejected_operations"][0]
        assert names[0] in manifest["rejected_operations"][0]

    def test_an_invented_bullet_id_is_refused(
        self, worker, db, fake_client, base_bullets, canonical
    ):
        store_facts(db, base_bullets)
        plan = {
            "summary": "",
            "summary_fact_ids": [],
            "operations": [
                {
                    "bullet_id": "work-experience.globex.1",
                    "action": "rewrite",
                    "text": base_bullets[0].plain,
                    "fact_ids": ["f0"],
                }
            ],
            "section_order": [],
        }
        application = run_batch(worker, db, fake_client, plan)

        tex, _ = canonical
        built = Path(selected(db, application).source_path).read_text(encoding="utf-8")
        assert built == tex.read_text(encoding="utf-8")
        manifest = json.loads(
            Path(selected(db, application).manifest_path).read_text(encoding="utf-8")
        )
        assert "UNKNOWN_ID" in manifest["rejected_operations"][0]

    def test_the_prompt_the_worker_sent_carried_the_real_ids(
        self, worker, db, fake_client, base_bullets
    ):
        """Otherwise the model could not name a valid id even in principle."""
        store_facts(db, base_bullets)
        run_batch(worker, db, fake_client, plan_from(base_bullets))

        body = "".join(str(m["content"]) for m in fake_client.requests[0].messages)
        for bullet in base_bullets:
            assert bullet.bullet_id in body


class TestOnePageSuccess:
    def test_a_plan_that_fits_is_taken_on_the_first_attempt(
        self, worker, db, fake_client, base_bullets
    ):
        store_facts(db, base_bullets)
        application = run_batch(worker, db, fake_client, plan_from(base_bullets))

        row = selected(db, application)
        assert row.kind == "TAILORED"
        assert row.attempt == 1
        assert row.page_count == 1
        assert row.fallback_reason is None

    def test_the_page_count_is_measured_on_the_stored_pdf(
        self, worker, db, fake_client, base_bullets
    ):
        """Not on a temporary file that was then copied somewhere else."""
        from app.services.latex import page_count

        store_facts(db, base_bullets)
        application = run_batch(worker, db, fake_client, plan_from(base_bullets))

        row = selected(db, application)
        assert page_count(Path(row.pdf_path)) == row.page_count == 1

    def test_the_application_points_at_the_selected_version(
        self, worker, db, fake_client, base_bullets
    ):
        store_facts(db, base_bullets)
        application = run_batch(worker, db, fake_client, plan_from(base_bullets))
        assert application.resume_version_id == selected(db, application).id

    def test_the_tailored_wording_actually_reached_the_document(
        self, worker, db, fake_client, base_bullets
    ):
        """Otherwise this would pass by compiling the base resume unchanged."""
        store_facts(db, base_bullets)
        application = run_batch(
            worker,
            db,
            fake_client,
            plan_rewording(base_bullets, " and delivered it on schedule"),
        )

        source = Path(selected(db, application).source_path).read_text(encoding="utf-8")
        assert "delivered it on schedule" in source


class TestTheRetryLadder:
    def test_an_overflowing_plan_is_retried_three_times(
        self, worker, db, fake_client, base_bullets
    ):
        store_facts(db, base_bullets, pad=True)
        application = run_batch(worker, db, fake_client, plan_from(base_bullets, pad=True))

        attempts = [v for v in versions(db, application) if v.attempt > 0]
        assert [v.attempt for v in attempts] == [1, 2, 3]

    def test_every_attempt_is_kept_including_the_ones_that_failed(
        self, worker, db, fake_client, base_bullets
    ):
        """The Resume Versions page has to answer "why *that* one", and the
        attempts that did not qualify are the answer."""
        store_facts(db, base_bullets, pad=True)
        application = run_batch(worker, db, fake_client, plan_from(base_bullets, pad=True))

        for row in versions(db, application):
            if row.attempt == 0:
                continue
            assert Path(row.source_path).is_file()
            assert Path(row.log_path).is_file()
            assert Path(row.manifest_path).is_file()
            assert row.page_count > 1, "each attempt records what it actually produced"

    def test_the_three_strategies_are_recorded_in_order(
        self, worker, db, fake_client, base_bullets
    ):
        store_facts(db, base_bullets, pad=True)
        application = run_batch(worker, db, fake_client, plan_from(base_bullets, pad=True))

        strategies = [
            json.loads(Path(v.manifest_path).read_text(encoding="utf-8"))["strategy"]
            for v in versions(db, application)
            if v.attempt > 0
        ]
        assert strategies == ["tailored", "shortened", "tightened"]

    def test_the_attempt_cap_is_the_configured_one(
        self, tmp_path, canonical, committing_db, provider, fake_client, db, base_bullets
    ):
        """RESUME_MAX_ATTEMPTS, not a constant buried in the builder."""
        tex, pdf = canonical
        settings = Settings(
            app_env="development",
            app_secret_key="tailoring-e2e",
            data_dir=tmp_path / "data",
            base_resume_tex=tex,
            base_resume_pdf=pdf,
            resume_max_attempts=1,
        )
        worker = Worker(
            session_factory=committing_db,
            worker_id="one-attempt",
            registry=register_pipeline(
                Registry(), settings=settings, provider_factory=lambda _: provider
            ),
            poll_interval=0.0,
        )
        store_facts(db, base_bullets, pad=True)
        application = run_batch(worker, db, fake_client, plan_from(base_bullets, pad=True))

        assert [v.attempt for v in versions(db, application) if v.attempt > 0] == [1]


class TestFallback:
    @pytest.fixture
    def fallen_back(self, worker, db, fake_client, base_bullets) -> Application:
        store_facts(db, base_bullets, pad=True)
        return run_batch(worker, db, fake_client, plan_from(base_bullets, pad=True))

    def test_the_selected_version_is_the_base_resume(self, db, fallen_back):
        row = selected(db, fallen_back)
        assert row.kind == "BASE"
        assert row.attempt == 0
        assert row.page_count == 1

    def test_it_is_the_canonical_pdf_byte_for_byte(self, db, fallen_back, canonical):
        """Not recompiled, not regenerated. The exact file the user made."""
        _, pdf = canonical
        row = selected(db, fallen_back)
        assert Path(row.pdf_path).read_bytes() == pdf.read_bytes()

    def test_the_reason_is_recorded_where_the_user_will_read_it(self, db, fallen_back):
        row = selected(db, fallen_back)
        assert row.fallback_reason
        assert "one-page" in row.fallback_reason

    def test_no_failed_attempt_is_left_marked_as_selected(self, db, fallen_back):
        rows = versions(db, fallen_back)
        assert [r.is_selected for r in rows if r.attempt > 0] == [False, False, False]

    def test_the_application_still_gets_a_usable_resume(self, db, fallen_back):
        """Falling back is not failing. The application proceeds."""
        assert fallen_back.resume_version_id == selected(db, fallen_back).id
        assert Path(selected(db, fallen_back).pdf_path).is_file()


class TestTheHashOfWhatIsUploaded:
    def test_the_recorded_sha256_is_the_sha256_of_the_file_on_disk(
        self, worker, db, fake_client, base_bullets
    ):
        """The whole point of storing it: proof that the PDF in the folder is the
        one the page count was measured on and the one the employer received."""
        store_facts(db, base_bullets)
        application = run_batch(worker, db, fake_client, plan_from(base_bullets))

        row = selected(db, application)
        on_disk = hashlib.sha256(Path(row.pdf_path).read_bytes()).hexdigest()
        assert row.sha256 == on_disk

    def test_the_tex_hash_matches_the_stored_source(
        self, worker, db, fake_client, base_bullets
    ):
        store_facts(db, base_bullets)
        application = run_batch(worker, db, fake_client, plan_from(base_bullets))

        row = selected(db, application)
        source = Path(row.source_path).read_bytes()
        assert row.tex_sha256 == hashlib.sha256(source).hexdigest()

    def test_the_manifest_records_the_same_two_hashes(
        self, worker, db, fake_client, base_bullets
    ):
        store_facts(db, base_bullets)
        application = run_batch(worker, db, fake_client, plan_from(base_bullets))

        row = selected(db, application)
        manifest = json.loads(Path(row.manifest_path).read_text(encoding="utf-8"))
        assert manifest["pdf_sha256"] == row.sha256
        assert manifest["tex_sha256"] == row.tex_sha256

    def test_the_fallback_hash_is_the_canonical_resumes_hash(
        self, worker, db, fake_client, base_bullets, canonical
    ):
        _, pdf = canonical
        store_facts(db, base_bullets, pad=True)
        application = run_batch(worker, db, fake_client, plan_from(base_bullets, pad=True))

        row = selected(db, application)
        assert row.sha256 == hashlib.sha256(pdf.read_bytes()).hexdigest()


class TestTheBrowserUploadsExactlyThatFile:
    def test_the_path_the_browser_reads_is_the_selected_row(
        self, worker, db, fake_client, base_bullets
    ):
        """The browser worker resolves the resume through
        ``application.resume_version_id``. If that points anywhere but the
        selected row, the employer receives a file nobody chose."""
        store_facts(db, base_bullets)
        application = run_batch(worker, db, fake_client, plan_from(base_bullets))

        row = db.get(ResumeVersion, application.resume_version_id)
        assert row.is_selected is True
        assert Path(row.pdf_path).is_file()
        assert Path(row.pdf_path).read_bytes()[:5] == b"%PDF-"

    def test_the_bytes_on_that_path_still_hash_to_the_recorded_value(
        self, worker, db, fake_client, base_bullets
    ):
        store_facts(db, base_bullets)
        application = run_batch(worker, db, fake_client, plan_from(base_bullets))

        row = db.get(ResumeVersion, application.resume_version_id)
        assert hashlib.sha256(Path(row.pdf_path).read_bytes()).hexdigest() == row.sha256


class TestIdempotency:
    def test_polling_the_same_batch_twice_changes_nothing(
        self, worker, db, fake_client, base_bullets
    ):
        """Retrieval is retried. The worker dies after the API call. Neither may
        produce a second PDF or a second row."""
        from app.db.models import LLMBatch

        store_facts(db, base_bullets)
        application = run_batch(worker, db, fake_client, plan_from(base_bullets))
        before = [(v.id, v.attempt, v.sha256) for v in versions(db, application)]

        batch = db.scalars(select(LLMBatch)).one()
        enqueue(
            db,
            task_type=TaskType.POLL_TAILORING_BATCH,
            dedupe_key=idempotency_key(TaskType.POLL_TAILORING_BATCH, str(batch.id), "retry"),
            payload={"batch_id": str(batch.id)},
            run_at=NOW,
        )
        db.commit()
        drain(worker, limit=2)

        db.expire_all()
        assert [(v.id, v.attempt, v.sha256) for v in versions(db, application)] == before

    def test_a_second_run_does_not_overwrite_the_stored_attempts(
        self, worker, db, fake_client, settings, base_bullets
    ):
        store_facts(db, base_bullets)
        application = run_batch(worker, db, fake_client, plan_from(base_bullets))

        from app.services.resume_artifacts import resume_dir

        directory = resume_dir(settings, application.id)
        before = {
            p.relative_to(directory): p.stat().st_mtime
            for p in directory.rglob("*")
            if p.is_file()
        }

        # Everything the poll handler would do a second time.
        from app.services import tailoring
        from app.services.resume import TailoringPlan
        from app.services.resume_import import load_facts

        again = tailoring.apply_plan(
            db,
            settings,
            application=application,
            job=db.get(Job, application.job_id),
            plan=TailoringPlan.model_validate(plan_from(base_bullets)),
            facts=load_facts(db),
            now=NOW,
        )
        db.flush()

        assert again.ok
        assert again.version.id == selected(db, application).id
        after = {
            p.relative_to(directory): p.stat().st_mtime
            for p in directory.rglob("*")
            if p.is_file()
        }
        assert after == before, "historical attempts were rewritten"

    def test_exactly_one_row_claims_to_be_the_selected_one(
        self, worker, db, fake_client, base_bullets
    ):
        store_facts(db, base_bullets)
        application = run_batch(worker, db, fake_client, plan_from(base_bullets))
        rows = versions(db, application)
        assert sum(1 for r in rows if r.is_selected) == 1


class TestOneApplicationsResumeNeverReachesAnother:
    def test_two_applications_get_separate_artifacts(
        self, worker, db, fake_client, settings, base_bullets
    ):
        from app.services.resume_artifacts import resume_dir

        store_facts(db, base_bullets)
        first = run_batch(worker, db, fake_client, plan_from(base_bullets))

        second = run_batch(
            worker,
            db,
            fake_client,
            plan_rewording(base_bullets, " across two teams"),
            key="e2e-2",
        )

        assert resume_dir(settings, first.id) != resume_dir(settings, second.id)
        first_pdf = Path(selected(db, first).pdf_path)
        second_pdf = Path(selected(db, second).pdf_path)
        assert first_pdf.is_relative_to(resume_dir(settings, first.id))
        assert second_pdf.is_relative_to(resume_dir(settings, second.id))

    def test_each_row_is_bound_to_its_own_application(
        self, worker, db, fake_client, base_bullets
    ):
        store_facts(db, base_bullets)
        application = run_batch(worker, db, fake_client, plan_from(base_bullets))
        for row in versions(db, application):
            assert row.application_id == application.id


class TestTheResumeVersionsPageCanServeWhatWasBuilt:
    """The web tests build their rows by hand, so nothing there proves a resume
    the *pipeline* produced is reachable.

    ``/resumes/{id}/view`` confines every path to the artifacts directory — a
    database row is not a capability. That check and the build have to agree
    about where files go, and until now only one side of it was tested.
    """

    def paths_of(self, row: ResumeVersion) -> list[Path]:
        return [
            Path(p)
            for p in (row.pdf_path, row.source_path, row.log_path, row.manifest_path)
            if p
        ]

    def test_every_recorded_path_is_inside_the_artifacts_directory(
        self, worker, db, fake_client, settings, base_bullets
    ):
        store_facts(db, base_bullets)
        application = run_batch(worker, db, fake_client, plan_from(base_bullets))

        root = settings.artifacts_dir.resolve()
        for row in versions(db, application):
            for path in self.paths_of(row):
                assert path.resolve().is_relative_to(root), path
                assert path.is_file(), path

    def test_a_fallback_row_is_reachable_too(
        self, worker, db, fake_client, settings, base_bullets
    ):
        """The base resume is copied into the application's folder rather than
        referenced where it lives, precisely so this holds."""
        store_facts(db, base_bullets, pad=True)
        application = run_batch(worker, db, fake_client, plan_from(base_bullets, pad=True))

        row = selected(db, application)
        root = settings.artifacts_dir.resolve()
        assert Path(row.pdf_path).resolve().is_relative_to(root)
        assert Path(row.source_path).resolve().is_relative_to(root)

    def test_the_page_groups_the_attempts_under_the_application(
        self, worker, db, fake_client, settings, base_bullets
    ):
        """The query the screen runs, against rows the pipeline wrote."""
        from app.web.queries import resume_groups

        store_facts(db, base_bullets)
        application = run_batch(worker, db, fake_client, plan_from(base_bullets))

        groups = resume_groups(db)
        mine = [g for g in groups if g.application_id == application.id]
        assert len(mine) == 1
        assert mine[0].selected is not None
        assert mine[0].selected.id == selected(db, application).id
        assert mine[0].uploaded is None, "no browser has run"
        assert mine[0].awaiting_upload
        assert mine[0].attempts == 1
        assert not mine[0].fell_back


class TestTheCanonicalFilesAreNeverTouched:
    def test_neither_file_changes_during_a_successful_build(
        self, worker, db, fake_client, base_bullets, canonical
    ):
        tex, pdf = canonical
        before = (tex.read_bytes(), pdf.read_bytes())
        store_facts(db, base_bullets)
        run_batch(worker, db, fake_client, plan_from(base_bullets))
        assert (tex.read_bytes(), pdf.read_bytes()) == before

    def test_nothing_in_their_directory_is_written_during_a_fallback(
        self, worker, db, fake_client, base_bullets, canonical
    ):
        tex, _ = canonical
        directory = tex.parent
        before = {p.name: p.stat().st_mtime for p in directory.iterdir() if p.is_file()}

        store_facts(db, base_bullets, pad=True)
        run_batch(worker, db, fake_client, plan_from(base_bullets, pad=True))

        after = {p.name: p.stat().st_mtime for p in directory.iterdir() if p.is_file()}
        assert after == before


class TestBlocking:
    def test_an_unsupported_claim_blocks_and_writes_no_pdf(
        self, worker, db, fake_client, base_bullets
    ):
        """§7.7: it blocks rather than degrading into a weaker bullet."""
        store_facts(db, base_bullets)
        invented = {
            "summary": "",
            "summary_fact_ids": [],
            "operations": [
                {
                    "bullet_id": base_bullets[0].bullet_id,
                    "action": "rewrite",
                    "text": "Led a team of 47 engineers at Globex",
                    "fact_ids": ["f0"],
                }
            ],
            "section_order": [],
        }
        application = run_batch(worker, db, fake_client, invented)

        assert versions(db, application) == []
        assert application.resume_version_id is None

    def test_the_violations_are_written_where_the_review_screen_reads_them(
        self, worker, db, fake_client, settings, base_bullets
    ):
        store_facts(db, base_bullets)
        invented = {
            "summary": "",
            "summary_fact_ids": [],
            "operations": [
                {
                    "bullet_id": base_bullets[0].bullet_id,
                    "action": "rewrite",
                    "text": "Led a team of 47 engineers at Globex",
                    "fact_ids": ["f0"],
                }
            ],
            "section_order": [],
        }
        application = run_batch(worker, db, fake_client, invented)

        sidecar = settings.artifacts_dir / str(application.id) / "resume-validation.json"
        recorded = json.loads(sidecar.read_text(encoding="utf-8"))
        assert recorded["validation"]["passed"] is False
        assert recorded["violations"]

    def test_a_missing_base_resume_blocks_rather_than_inventing_one(
        self, tmp_path, committing_db, provider, fake_client, db, base_bullets
    ):
        settings = Settings(
            app_env="development",
            app_secret_key="no-base",
            data_dir=tmp_path / "data",
            base_resume_tex=tmp_path / "does-not-exist.tex",
            base_resume_pdf=None,
        )
        worker = Worker(
            session_factory=committing_db,
            worker_id="no-base",
            registry=register_pipeline(
                Registry(), settings=settings, provider_factory=lambda _: provider
            ),
            poll_interval=0.0,
        )
        store_facts(db, base_bullets)
        application = run_batch(worker, db, fake_client, plan_from(base_bullets))

        assert versions(db, application) == []
        assert application.resume_version_id is None
