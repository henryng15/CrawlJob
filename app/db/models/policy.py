"""Operator policy lists.

Rows the user curates by hand, which the pipeline reads and obeys. They are not
configuration: the list changes weekly, and a policy that lives in an env file is
a policy that stops being maintained.
"""

from __future__ import annotations

from sqlalchemy import Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, CreatedAtMixin, UUIDMixin

__all__ = ["ManualOnlyCompany"]


class ManualOnlyCompany(UUIDMixin, CreatedAtMixin, Base):
    """A company whose applications are always finished by hand.

    Membership is decided on ``domain``, never on the name. Company names are
    ambiguous in both directions — "RTX" and "Raytheon" are one employer, "X" is
    a whole company — and a policy list that fails open on a near miss is worse
    than no list at all.
    """

    __tablename__ = "manual_only_companies"

    #: The match key: lowercase host, no scheme, no ``www.``, no trailing slash.
    domain: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    #: For display only. Never matched against.
    company_name: Mapped[str] = mapped_column(Text, nullable=False)
    #: Where the row came from, e.g. ``seed_manual.csv``.
    source: Mapped[str] = mapped_column(Text, nullable=False)
