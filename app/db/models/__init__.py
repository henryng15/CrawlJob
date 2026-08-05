"""All ORM models.

Importing this package registers every table on ``Base.metadata``, which is what
Alembic autogenerate reads. A model that is not imported here is invisible to
migrations, so add new modules to the imports below.
"""

from app.db.base import Base
from app.db.models.applications import (
    Application,
    ApplicationField,
    ResumeVersion,
)
from app.db.models.jobs import (
    Company,
    Job,
    JobScore,
    JobSourceLink,
    JobSourceRecord,
    SponsorshipAssessment,
)
from app.db.models.policy import ManualOnlyCompany
from app.db.models.sources import SourceRegistry
from app.db.models.tasks import AuditEvent, CandidateFact, ScheduledTask, TaskRun

__all__ = [
    "Application",
    "ApplicationField",
    "AuditEvent",
    "Base",
    "CandidateFact",
    "Company",
    "Job",
    "JobScore",
    "JobSourceLink",
    "JobSourceRecord",
    "ManualOnlyCompany",
    "ResumeVersion",
    "ScheduledTask",
    "SourceRegistry",
    "SponsorshipAssessment",
    "TaskRun",
]
