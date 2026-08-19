"""Find which ATS job boards are worth asking every day, and write them down.

The daily sync cannot ask fifteen thousand boards five times a day — that is half
a month's Actions minutes spent on employers who have never taken an intern. So
the work splits in two, by how likely a board is to be interesting rather than by
how many there are:

  * This script, run weekly, asks every board once and keeps the ones that are
    advertising an internship of any discipline today. A company that runs an
    internship programme at all is the one that might post a software one next
    week; a company that has never run one is not.
  * job_sync/boards.py, run daily, asks only that shortlist.

So a new posting at a company that already interns is caught within a day, and a
company starting its first ever programme within a week. That is the trade, and
it is stated here rather than hidden in a number.

Board slugs come from two places, both of them lists of names rather than scrapes
of anybody's site:

  * Feashliaa/job-board-aggregator, harvested from Common Crawl's index of public
    ATS URLs. Data licensed CC BY-NC 4.0 — attribution is written into the output
    file, and this tracker is personal and non-commercial.
  * yc-oss/api, rebuilt daily from Y Combinator's own Algolia index. Only its
    slugs not already covered above are probed, so it costs little.

Run:  uv run python scripts/discover_boards.py
"""

from __future__ import annotations

import json
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from job_sync.boards import BOARDS, USER_AGENT, extra_boards, parse_board, read_board
from job_sync.roles import INTERNSHIP_RE
from job_sync.sources import fetch_source, load_sources, parse_jobs

TARGET = Path(__file__).resolve().parent.parent / "job_sync" / "data" / "ats_boards.json"
SOURCES = Path(__file__).resolve().parent.parent / "sources.toml"
CRAWL = (
    "https://raw.githubusercontent.com/Feashliaa/job-board-aggregator/main/data/{}_companies.json"
)
YC = "https://yc-oss.github.io/api/companies/hiring.json"
ATTRIBUTION = [
    (
        "Board slugs: Feashliaa/job-board-aggregator (Common Crawl index of public"
        " ATS URLs), data licensed CC BY-NC 4.0"
        " — https://github.com/Feashliaa/job-board-aggregator"
    ),
    (
        "Y Combinator slugs: yc-oss/api, built from YC's own Algolia index"
        " — https://github.com/yc-oss/api"
    ),
]
# Higher than the daily crawl's: this runs once a week, on its own workflow, and
# has fifteen thousand boards to get through rather than a few hundred.
WORKERS = 24


def _json(url: str, cap: int = 32 * 1024 * 1024) -> object | None:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urlopen(request, timeout=60) as response:
            return json.loads(response.read(cap))
    except Exception as error:  # noqa: BLE001 - one missing list must not end the run
        print(f"  WARNING: {url} — {error}")
        return None


def from_trackers() -> list[tuple[str, str]]:
    """Board slugs read straight out of the links the trackers are publishing.

    Free, exact, and self-renewing: a tracker that adds a company today hands over
    that company's board today. No archive is involved, so it also reaches boards
    Common Crawl has never fetched — which is most of the ones that matter, because
    a board is only in an archive if something once linked to it."""
    pairs: list[tuple[str, str]] = []
    for source in load_sources(SOURCES):
        try:
            jobs = parse_jobs(fetch_source(source), datetime.now(tz=UTC).date())
        except Exception as error:  # noqa: BLE001 - one tracker must not end the run
            print(f"  WARNING: {source.name} — {error}")
            continue
        for job in jobs:
            parts = urlsplit(job.apply_link)
            host = parts.netloc.casefold().removeprefix("www.")
            segments = [segment for segment in parts.path.split("/") if segment]
            if not segments:
                continue
            for domain, ats in (
                ("greenhouse.io", "greenhouse"),
                ("lever.co", "lever"),
                ("ashbyhq.com", "ashby"),
            ):
                if host.endswith(domain):
                    # Greenhouse serves the same board under /embed/job_board and
                    # under /<slug>, so the slug is not always the first segment.
                    slug = (
                        segments[1] if segments[0] == "embed" and len(segments) > 1 else segments[0]
                    )
                    pairs.append((ats, slug))
    return pairs


def candidates() -> list[tuple[str, str]]:
    """Every (ats, slug) worth one probe, deduplicated, in a stable order."""
    seen: set[tuple[str, str]] = set()
    pairs: list[tuple[str, str]] = []

    def take(found: list[tuple[str, str]], label: str) -> None:
        kept = 0
        for pair in found:
            if pair[0] in BOARDS and pair[1] and pair not in seen:
                seen.add(pair)
                pairs.append(pair)
                kept += 1
        print(f"  {label:<11} {kept:>6} slugs")

    # Hand-written first, so they are never crowded out of the probe list.
    take(extra_boards(), "by hand")
    take(from_trackers(), "trackers")
    for ats in BOARDS:
        take([(ats, str(slug).strip()) for slug in (_json(CRAWL.format(ats)) or [])], ats)

    companies = _json(YC) or []
    take(
        [(ats, str(company.get("slug") or "").strip()) for company in companies for ats in BOARDS],
        "yc",
    )
    return pairs


def inspect(pair: tuple[str, str]) -> tuple[tuple[str, str], bool, bool, int]:
    """Does this board answer, does it advertise any internship, and how many of
    those are the software roles this tracker actually wants."""
    ats, slug = pair
    payload = read_board(ats, slug)
    if payload is None:
        return pair, False, False, 0
    rows = payload.get("jobs", []) if isinstance(payload, dict) else payload
    if not isinstance(rows, list) or not rows:
        return pair, True, False, 0
    titles = [row.get("title") or row.get("text") or "" for row in rows if isinstance(row, dict)]
    interning = any(INTERNSHIP_RE.search(title) for title in titles)
    return pair, True, interning, len(parse_board(ats, slug, payload))


def main() -> None:
    print("Collecting board slugs")
    pairs = candidates()
    print(f"\nProbing {len(pairs)} boards with {WORKERS} workers. This takes a while.")

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        answers = list(pool.map(inspect, pairs))

    answered = [row for row in answers if row[1]]
    interning = [row for row in answers if row[2]]
    matching = [row for row in answers if row[3]]
    daily = [list(row[0]) for row in interning]

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(
        json.dumps(
            {
                "generated": datetime.now(tz=UTC).date().isoformat(),
                "attribution": ATTRIBUTION,
                "probed": len(pairs),
                "answered": len(answered),
                "interning": len(interning),
                "with_target_roles": len(matching),
                "target_roles": sum(row[3] for row in matching),
                "daily": sorted(daily),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    print(f"\n  probed                      {len(pairs):>6}")
    print(f"  answered with a job          {len(answered):>6}")
    print(f"  advertising any internship   {len(interning):>6}  <- written to daily")
    print(f"  with a matching SWE intern   {len(matching):>6}")
    print(f"  matching roles right now     {sum(row[3] for row in matching):>6}")
    print(f"\nWrote {TARGET}")


if __name__ == "__main__":
    main()
