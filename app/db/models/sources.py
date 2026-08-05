"""The source registry (spec §22.6, §5.5).

Which job boards to watch. A table rather than configuration because the user
adds and removes companies constantly, and editing an env file to follow one more
employer is the kind of friction that makes a tool go unused.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, CheckConstraint, Index, Integer, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDMixin

__all__ = ["KINDS", "SourceRegistry"]

#: The adapters that exist. A typo here would produce a source that is scheduled
#: every day and fails every day, so the database refuses one.
KINDS: tuple[str, ...] = ("greenhouse", "lever", "ashby", "github_feed")


class SourceRegistry(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "source_registry"
    __table_args__ = (
        UniqueConstraint("kind", "identifier", name="uq_source_registry_identity"),
        CheckConstraint("kind IN (" + ", ".join(repr(k) for k in KINDS) + ")", name="kind_valid"),
        Index("ix_source_registry_enabled", "enabled"),
    )

    #: greenhouse | lever | ashby | github_feed
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    #: Board id, company slug, or "owner/repo".
    identifier: Mapped[str] = mapped_column(Text, nullable=False)
    #: What to call it on screen. The identifier is often an opaque slug.
    label: Mapped[str | None] = mapped_column(Text)

    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    #: Extra adapter arguments — branch and path for a GitHub feed, season, and so on.
    options: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    last_fetched_at: Mapped[datetime | None] = mapped_column()
    #: Read on the settings screen. A source that has failed every run for a week
    #: is usually a board that moved, and silence about it wastes weeks.
    consecutive_failures: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(Text)
