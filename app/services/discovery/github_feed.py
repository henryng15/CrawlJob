"""Curated GitHub internship-list adapter (spec §5.5, §7.2).

These repositories publish an internship table in their README. They are a
discovery hint, not a source of truth (§5.5): the row says a job exists, and the
system then follows the link to the employer's own posting to find out whether it
is still open and what it actually says.

Only the normalized fields needed for the workflow are kept. The repositories'
content is not redistributed.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlsplit

from app.services.dedupe import NormalizedPosting
from app.services.discovery.base import DiscoveryAdapter, RawPosting, SourceType, iter_valid

__all__ = ["APPLY_COLUMNS", "GithubMarkdownFeedAdapter", "parse_markdown_table"]

#: Column headers, lowercased, that carry the link to the employer's form. Each
#: curated repository names it differently — SimplifyJobs and vanshb03 use
#: "Application/Link", speedyapply uses "Posting" — and a name missing from this
#: list means every row of that feed is dropped. That is the intended failure:
#: the alternative, guessing at another column, is what put employer homepages
#: in the application_url of 107 jobs.
APPLY_COLUMNS: tuple[str, ...] = (
    "application/link",
    "apply",
    "link",
    "application",
    "posting",
    "job posting",
    "job link",
)

#: A markdown link, `[text](url)`. Rows use these for both company and apply link.
_LINK = re.compile(r"\[([^\]]*)\]\(([^)]+)\)")
_TAG = re.compile(r"<[^>]+>")
#: Rows repeat the company as an arrow when several roles share an employer.
_DITTO = re.compile(r"^[↳⤷\s*_]*$")


def _clean(cell: str) -> str:
    """Strip markdown and HTML decoration from a table cell."""
    cell = _TAG.sub(" ", cell)
    cell = _LINK.sub(r"\1", cell)
    return re.sub(r"[*_`]", "", cell).strip()


def _first_link(cell: str) -> str | None:
    match = _LINK.search(cell)
    if match:
        return match.group(2).strip()
    href = re.search(r'href=["\']([^"\']+)["\']', cell)
    return href.group(1).strip() if href else None


def parse_markdown_table(markdown: str) -> list[dict[str, str]]:
    """Extract rows from every markdown table in ``markdown``.

    Returns dicts keyed by lowercased header. Tolerant by design: these READMEs
    change layout without warning, and a parser that raises would take the whole
    daily discovery run down with it.
    """
    rows: list[dict[str, str]] = []
    headers: list[str] = []
    previous_company = ""

    for line in markdown.splitlines():
        stripped = line.strip()
        if not stripped.startswith("|"):
            headers = []
            continue

        cells = [c.strip() for c in stripped.strip("|").split("|")]

        if not headers:
            headers = [_clean(c).lower() for c in cells]
            continue
        if all(set(c) <= set("-: ") for c in cells if c):
            continue  # separator row
        if len(cells) < len(headers):
            continue

        row = dict(zip(headers, cells, strict=False))
        # Carry the company down through ditto rows, or the extra roles lose it.
        company_cell = row.get("company", "")
        if _DITTO.match(_clean(company_cell)):
            row["company"] = previous_company
        else:
            previous_company = company_cell
        rows.append(row)

    return rows


class GithubMarkdownFeedAdapter(DiscoveryAdapter):
    """Reads an internship table from a repository's README."""

    source_type = SourceType.GITHUB_FEED

    def __init__(
        self,
        repo: str,
        *,
        path: str = "README.md",
        branch: str = "main",
        season: str | None = None,
        **kw: Any,
    ) -> None:
        super().__init__(**kw)
        self.repo = repo
        self.path = path
        self.branch = branch
        #: These lists are season-scoped ("Summer 2027 internships") but rarely say
        #: so in each row, so the caller supplies it.
        self.season = season

    @property
    def source_name(self) -> str:
        return f"github:{self.repo}"

    @property
    def url(self) -> str:
        return f"https://raw.githubusercontent.com/{self.repo}/{self.branch}/{self.path}"

    def fetch(self) -> list[RawPosting]:
        response = self._client.get(self.url)
        response.raise_for_status()
        return self.parse(response.text)

    def parse(self, markdown: str) -> list[RawPosting]:
        postings = []
        for row in parse_markdown_table(markdown):
            company = _clean(row.get("company", ""))
            title = _clean(row.get("role", "") or row.get("position", "") or row.get("title", ""))
            link = _first_link(
                next(
                    (row[name] for name in APPLY_COLUMNS if row.get(name)),
                    "",
                )
            )
            if not (company and title and link):
                # Deliberately no fallback to the company column. It used to be
                # the last resort here, and what it produced was not a missing
                # link but a *plausible wrong* one: speedyapply names its column
                # "Posting", which was not in the list, so all 107 rows were
                # stored with the employer's homepage as the application URL.
                # Nothing downstream can tell nvidia.com from a Workday req, so
                # the browser would have opened a marketing page and filled in
                # nothing. Skipping is loud; a homepage is silent.
                continue

            postings.append(
                self._make(
                    NormalizedPosting(
                        company=company,
                        title=title,
                        application_url=link,
                        location=_clean(row.get("location", "")),
                        source_season=self.season,
                    ),
                    external_id=self._external_id(link),
                    source_url=self.url,
                    raw=dict(row),
                )
            )
        return iter_valid(postings)

    @staticmethod
    def _external_id(link: str) -> str | None:
        """Path of the target URL. Stable enough to detect a republished row."""
        try:
            return urlsplit(link).path or None
        except ValueError:
            return None
