"""Turn a task payload into discovery adapters (spec §5.5, §7.2).

Kept apart from the handlers so the mapping from "a row in the source registry"
to "an adapter object" is one readable table rather than a branch inside a task.
"""

from __future__ import annotations

from typing import Any

from app.config import Settings
from app.services.discovery.ats import AshbyAdapter, GreenhouseAdapter, LeverAdapter
from app.services.discovery.base import DiscoveryAdapter
from app.services.discovery.github_feed import GithubMarkdownFeedAdapter

__all__ = ["adapters_for"]


def adapters_for(payload: dict[str, Any], *, settings: Settings) -> list[DiscoveryAdapter]:
    """Build the adapters a ``DISCOVER_SOURCE`` task asks for.

    An unknown kind returns nothing rather than raising, so the handler can bury
    the task with a message naming the payload — which is more useful than a
    traceback from three frames down.
    """
    kind = str(payload.get("kind", "")).lower()

    match kind:
        case "greenhouse":
            return [GreenhouseAdapter(board) for board in _names(payload)]
        case "lever":
            return [LeverAdapter(slug) for slug in _names(payload)]
        case "ashby":
            return [AshbyAdapter(board) for board in _names(payload)]
        case "github_feed":
            # These repositories are published for exactly this use and are read
            # once a day, so they are the one source that needs no opt-in.
            return [
                GithubMarkdownFeedAdapter(
                    repo,
                    path=str(payload.get("path", "README.md")),
                    branch=str(payload.get("branch", "main")),
                    season=payload.get("season"),
                )
                for repo in _names(payload)
            ]
        case _:
            return []


def _names(payload: dict[str, Any]) -> list[str]:
    """Accept either ``board``/``repo``/``slug`` or a list under ``boards``."""
    for key in ("boards", "repos", "slugs", "names"):
        value = payload.get(key)
        if isinstance(value, list):
            return [str(v) for v in value if v]
    for key in ("board", "repo", "slug", "name"):
        value = payload.get(key)
        if isinstance(value, str) and value:
            return [value]
    return []
