"""Small helpers shared by tests."""

from __future__ import annotations

__all__ = ["not_none"]


def not_none[T](value: T | None, message: str = "expected a value, got None") -> T:
    """Assert a value is present and narrow its type.

    Query helpers return ``T | None``. In a test a ``None`` is a failure, so
    asserting once here is both the check and the type narrowing, and keeps mypy
    strict over the test suite instead of switching it off.
    """
    assert value is not None, message
    return value
