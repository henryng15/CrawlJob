"""Adapter validation, offline (spec §5.6, §28).

The validation command exists to be pointed at real employers' job boards, so
the checks themselves have to be trustworthy before they are believed. These
tests feed the checks known-bad payloads and assert each one is caught — a
validator that quietly passes everything is worse than none, because it is
evidence that is not evidence.

The other half is what validation must *not* do. It runs beside the pipeline,
and that is only true while it stays true: nothing here may queue a task, create
an application, spend quota, or read the pipeline switch. The last test class
checks that structurally rather than by intention.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from app.config import Settings
from app.services.dedupe import NormalizedPosting
from app.services.discovery.base import RawPosting, SourceType
from app.services.validation.report import Severity
from app.services.validation.stage_one import validate_feeds, validate_one

NOW = datetime(2026, 7, 30, 12, 0, tzinfo=UTC)


@pytest.fixture
def settings() -> Settings:
    return Settings(app_env="development", app_secret_key="validation-tests")


def posting(**overrides: Any) -> RawPosting:
    defaults: dict[str, Any] = {
        "company": "Acme",
        "title": "Software Engineer Intern",
        "application_url": "https://boards.greenhouse.io/acme/jobs/12345",
        "location": "New York, NY",
        "description_text": "We are hiring interns to write Python. " * 12,
        "posted_at": NOW - timedelta(days=2),
    }
    fields = {k: overrides.pop(k) for k in list(overrides) if k in defaults}
    return RawPosting(
        posting=NormalizedPosting(**{**defaults, **fields}),
        source_type=SourceType.ATS_API,
        source_name=overrides.pop("source_name", "greenhouse:acme"),
        source_url="https://boards-api.greenhouse.io/v1/boards/acme/jobs",
        external_id=overrides.pop("external_id", "12345"),
        raw_payload=overrides.pop("raw_payload", {"id": 12345}),
        fetched_at=overrides.pop("fetched_at", NOW),
    )


class FakeAdapter:
    """Returns what the test says, twice, so dedupe stability can be checked."""

    source_type = SourceType.ATS_API

    def __init__(self, batches: list[list[RawPosting]] | None = None, **kw: Any) -> None:
        self.board = kw.pop("board", "acme")
        self.batches = batches or [[posting()]]
        self.calls = 0
        self.raises = kw.pop("raises", None)

    @property
    def source_name(self) -> str:
        return f"greenhouse:{self.board}"

    @property
    def url(self) -> str:
        return f"https://boards-api.greenhouse.io/v1/boards/{self.board}/jobs"

    def fetch(self) -> list[RawPosting]:
        if self.raises:
            raise self.raises
        batch = self.batches[min(self.calls, len(self.batches) - 1)]
        self.calls += 1
        return batch


def check(adapter: FakeAdapter, settings: Settings):
    return validate_one(adapter, settings, now=NOW)


def checks(report, name: str) -> list[str]:
    return [f.detail for f in report.findings if f.check == name]


class TestAFeedThatIsFine:
    def test_it_passes(self, settings: Settings):
        assert check(FakeAdapter(), settings).ok

    def test_it_counts_what_it_saw(self, settings: Settings):
        report = check(FakeAdapter([[posting(), posting(
            application_url="https://boards.greenhouse.io/acme/jobs/2"
        )]]), settings)
        assert report.fetched == 2
        assert report.stats["with_posted_at"] == 2
        assert report.stats["with_description"] == 2

    def test_an_eligible_posting_is_offered_to_stage_two(self, settings: Settings):
        """Stage 2 picks from these, so the read-only run has to surface them."""
        report = check(FakeAdapter(), settings)
        assert report.eligible
        assert report.eligible[0]["title"] == "Software Engineer Intern"

    def test_a_posting_that_fails_the_screen_is_not_offered(self, settings: Settings):
        report = check(
            FakeAdapter([[posting(title="Senior Staff Engineer", location="Berlin, Germany")]]),
            settings,
        )
        assert report.eligible == []

    def test_stage_two_candidates_ignore_freshness(self, settings: Settings):
        """A form does not get older. The production count still applies it."""
        old = posting(posted_at=NOW - timedelta(days=9))
        report = check(FakeAdapter([[old]]), settings)

        assert report.stats["passed_screen"] == 0, "too old for the pipeline"
        assert report.eligible, "but its form is still worth opening"


class TestTheChecksCatchWhatTheyClaim:
    def test_a_fetch_failure_is_a_blocker(self, settings: Settings):
        report = check(FakeAdapter(raises=RuntimeError("503")), settings)
        assert not report.ok
        assert "503" in report.fetch_error

    def test_an_unparseable_url_is_a_blocker(self, settings: Settings):
        report = check(FakeAdapter([[posting(application_url="not-a-url")]]), settings)
        assert any(f.severity is Severity.BLOCKER for f in report.findings)
        assert checks(report, "canonical_url")

    def test_an_empty_title_is_a_blocker(self, settings: Settings):
        report = check(FakeAdapter([[posting(title="   ")]]), settings)
        assert checks(report, "title")
        assert not report.ok

    def test_a_timestamp_in_the_future_is_a_blocker(self, settings: Settings):
        """The milliseconds-read-as-seconds bug, which makes everything look new."""
        report = check(FakeAdapter([[posting(posted_at=NOW + timedelta(days=400))]]), settings)
        assert not report.ok
        assert "future" in checks(report, "posted_at")[0]

    def test_a_naive_timestamp_is_a_blocker(self, settings: Settings):
        report = check(
            FakeAdapter([[posting(posted_at=datetime(2026, 7, 1))]]), settings
        )
        assert not report.ok
        assert "naive" in checks(report, "posted_at")[0]

    def test_a_missing_timestamp_is_a_warning_not_a_blocker(self, settings: Settings):
        """Freshness falls back to first-seen, which works but hides age."""
        report = check(FakeAdapter([[posting(posted_at=None)]]), settings)
        assert report.ok
        assert report.warnings

    def test_a_missing_description_is_a_warning(self, settings: Settings):
        report = check(FakeAdapter([[posting(description_text="")]]), settings)
        assert "sponsorship" in checks(report, "description")[0]

    def test_html_left_in_a_description_is_a_warning(self, settings: Settings):
        report = check(
            FakeAdapter([[posting(description_text="<p>Hello</p> " * 40)]]), settings
        )
        assert any("HTML" in d for d in checks(report, "description"))

    def test_a_missing_location_is_a_warning(self, settings: Settings):
        report = check(FakeAdapter([[posting(location="")]]), settings)
        assert checks(report, "location")

    def test_a_missing_external_id_is_a_warning(self, settings: Settings):
        report = check(FakeAdapter([[posting(external_id=None)]]), settings)
        assert checks(report, "external_id")

    def test_an_empty_feed_is_reported_rather_than_passing_silently(
        self, settings: Settings
    ):
        report = check(FakeAdapter([[]]), settings)
        assert report.fetched == 0
        assert checks(report, "fetch")


class TestDedupeStability:
    def test_identical_fetches_are_stable(self, settings: Settings):
        report = check(FakeAdapter(), settings)
        assert report.stats["fingerprint_drift_between_fetches"] == 0

    def test_a_feed_whose_fingerprints_move_is_a_blocker(self, settings: Settings):
        """The failure this catches: the same job rediscovered as new every run."""
        first = [posting(title="Software Engineer Intern")]
        second = [posting(title="Software Engineer Intern II")]
        report = check(FakeAdapter([first, second]), settings)

        assert not report.ok
        assert "rediscovered as new" in checks(report, "dedupe")[0]

    def test_duplicates_within_one_feed_are_noted_not_failed(self, settings: Settings):
        """One role posted in several offices legitimately collapses to one job."""
        same = [
            posting(application_url="https://boards.greenhouse.io/acme/jobs/1"),
            posting(application_url="https://boards.greenhouse.io/acme/jobs/2"),
        ]
        report = check(FakeAdapter([same, same]), settings)
        assert report.ok
        assert report.stats["duplicate_fingerprints_within_feed"] == 1


class TestTheRunAsAWhole:
    def test_every_board_is_reported_separately(self, settings: Settings):
        report = validate_feeds(
            settings,
            {"greenhouse": ("a", "b"), "lever": ("c",)},
            adapter_factory=lambda ats, board: [FakeAdapter(board=board)],
            now=NOW,
        )
        assert len(report.adapters) == 3

    def test_one_bad_board_does_not_hide_the_others(self, settings: Settings):
        def factory(ats: str, board: str) -> list[FakeAdapter]:
            if board == "broken":
                return [FakeAdapter(board=board, raises=RuntimeError("404"))]
            return [FakeAdapter(board=board)]

        report = validate_feeds(
            settings,
            {"greenhouse": ("broken", "fine")},
            adapter_factory=factory,
            now=NOW,
        )
        assert not report.ok
        assert [a.ok for a in report.adapters] == [False, True]

    def test_an_unknown_ats_is_a_blocker_rather_than_a_crash(self, settings: Settings):
        report = validate_feeds(
            settings, {"workday": ("someone",)}, adapter_factory=lambda a, b: [], now=NOW
        )
        assert not report.ok
        assert "no adapter" in report.adapters[0].findings[0].detail

    def test_the_report_serialises(self, settings: Settings):
        import json

        report = validate_feeds(
            settings,
            {"greenhouse": ("a",)},
            adapter_factory=lambda ats, board: [FakeAdapter(board=board)],
            now=NOW,
        )
        assert json.loads(json.dumps(report.as_dict(), default=str))["stage"] == 1


class TestItStaysOutsideThePipeline:
    """The property that makes this safe to point at real employers.

    Checked by reading the module rather than by trusting the docstring: an
    import of the queue or the application state machine is how this would stop
    being true, and it would stop being true silently.
    """

    def sources(self) -> str:
        import app.services.validation.stage_one as one
        import app.services.validation.stage_two as two

        return (
            Path(one.__file__).read_text(encoding="utf-8")
            + Path(two.__file__).read_text(encoding="utf-8")
        )

    @pytest.mark.parametrize(
        "forbidden",
        [
            "app.services.queue",
            "enqueue",
            "ScheduledTask",
            "TaskType",
            "pipeline_enabled",
            "check_gate",
        ],
    )
    def test_it_does_not_reach_into_the_pipeline(self, forbidden: str):
        assert forbidden not in self.sources()

    @pytest.mark.parametrize(
        "forbidden",
        ["max_prepared_applications_per_day", "Application(", "record_build"],
    )
    def test_it_creates_no_application_and_uses_no_quota(self, forbidden: str):
        assert forbidden not in self.sources()

    def test_stage_two_never_clicks(self):
        """No ``.click(`` anywhere. Submitting is not something to be careful
        about here; it is something that is not written down."""
        import app.services.validation.stage_two as two

        source = Path(two.__file__).read_text(encoding="utf-8")
        assert ".click(" not in source
        assert "submit()" not in source


class TestStageTwoPolicyCheck:
    """The check that a real form's legal questions stayed blank."""

    def report_after(self, specs, answers):
        from app.services.validation.report import StageTwoReport
        from app.services.validation.stage_two import _check_nothing_legal_was_filled

        report = StageTwoReport(ats="greenhouse")
        _check_nothing_legal_was_filled(report, specs, answers)
        return report

    def spec(self, label: str):
        from app.ats.fields import FieldSpec

        return FieldSpec(question_text=label, name=label.lower().replace(" ", "_"))

    def answer(self, key: str, value, source):
        from app.ats.fields import Answer

        return Answer(key, value, source)

    def test_a_blank_legal_field_is_fine(self):
        from app.ats.fields import SourceType

        report = self.report_after(
            [self.spec("Are you legally authorized to work?")],
            [self.answer("auth.work_authorized", None, SourceType.MANUAL_REQUIRED)],
        )
        assert report.findings == []

    @pytest.mark.parametrize(
        "key",
        [
            "eeo.gender",
            "eeo.race_ethnicity",
            "legal.signature",
            "auth.work_authorized_without_sponsorship",
            "compensation.expected_salary",
        ],
    )
    def test_a_filled_one_is_a_blocker(self, key: str):
        """If the classifier ever starts answering these, a real run says so."""
        from app.ats.fields import SourceType

        report = self.report_after(
            [self.spec("Something")],
            [self.answer(key, "some value", SourceType.PROFILE_FACT)],
        )
        assert report.blockers
        assert key in report.blockers[0].detail

    def test_an_ordinary_field_is_not_policed(self):
        from app.ats.fields import SourceType

        report = self.report_after(
            [self.spec("First name")],
            [self.answer("candidate.first_name", "Hoan", SourceType.PROFILE_FACT)],
        )
        assert report.findings == []
