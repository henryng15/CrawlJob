"""Declarative base, naming conventions, and shared column types (spec §12).

Two decisions worth stating up front:

**Status columns are TEXT with a CHECK constraint**, not native PostgreSQL enums.
The status vocabularies in §13 will grow, and adding a value to a PG enum inside a
transaction that also uses it is a known operational hazard. A CHECK constraint
generated from the Python ``StrEnum`` gives the same protection and migrates with
an ordinary ``ALTER``.

**Primary keys are generated in Python**, not by the database. Workers need the id
before the INSERT lands so that artifact paths and idempotency keys can be built
without a round trip.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, MetaData, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

__all__ = [
    "Base",
    "CreatedAtMixin",
    "TimestampMixin",
    "UUIDMixin",
    "enum_check",
    "enum_column",
    "utcnow",
]

#: Deterministic constraint names so Alembic autogenerate produces stable
#: migrations and a downgrade can always find what to drop.
NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)

    type_annotation_map = {  # noqa: RUF012 — SQLAlchemy reads this as a plain dict
        dict[str, Any]: JSONB,
        list[Any]: JSONB,
        datetime: DateTime(timezone=True),
    }

    def __repr__(self) -> str:
        ident = getattr(self, "id", None)
        return f"<{type(self).__name__} {ident}>"


def utcnow() -> datetime:
    """Current UTC time. Database timestamps are always UTC (§16.1)."""
    from datetime import UTC

    return datetime.now(UTC)


class UUIDMixin:
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


class CreatedAtMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class TimestampMixin(CreatedAtMixin):
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


def enum_column(
    *,
    name: str,
    nullable: bool = False,
    default: StrEnum | None = None,
    index: bool = False,
) -> Mapped[str]:
    """A TEXT column holding a ``StrEnum`` value.

    Pair every call with :func:`enum_check` in the model's ``__table_args__``.
    The constraint cannot live here: a ``CheckConstraint`` passed to a column
    attaches to the *column*, and Alembic autogenerate reads ``table.constraints``,
    so an inline constraint is silently dropped from the migration.
    """
    return mapped_column(
        name,
        Text,
        nullable=nullable,
        default=default.value if default is not None else None,
        index=index,
    )


def enum_check(enum_cls: type[StrEnum], column: str) -> CheckConstraint:
    """A CHECK constraint restricting ``column`` to the members of ``enum_cls``.

    A NULL value passes, matching SQL's usual treatment of CHECK, so this is safe
    on nullable columns.
    """
    allowed = ", ".join(repr(member.value) for member in enum_cls)
    return CheckConstraint(f"{column} IN ({allowed})", name=f"{column}_valid")
