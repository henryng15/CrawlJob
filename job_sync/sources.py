from __future__ import annotations

import re
import tomllib
from dataclasses import dataclass
from datetime import date, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from time import strptime
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen
from xml.etree import ElementTree

from job_sync.roles import is_target_role

# Only params that identify who sent the click, never the posting. Anything that
# names the job itself (gh_jid, lever's posting id) has to survive normalization.
TRACKING_PARAMS = frozenset(
    {"utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ref", "gh_src", "src"}
)
# Params that change how the page draws itself rather than which posting it is.
DISPLAY_PARAMS = frozenset({"embed", "mobile", "needsredirect"})
# Last path segment of an apply form rather than of a posting.
APPLY_SEGMENTS = frozenset({"application", "apply"})
# Word endings two trackers disagree on while describing one posting.
ROLE_SYNONYMS = {
    "engineering": "engineer",
    "engineers": "engineer",
    "internship": "intern",
    "internships": "intern",
    "interns": "intern",
    "development": "developer",
    "developers": "developer",
}
ROLE_ACRONYMS = {
    "swe": ("software", "engineer"),
    "sde": ("software", "engineer"),
}
# Legal-form words that are part of a registered name but not of a company's
# identity. "Chicago Trading Company (CTC)" and "Chicago Trading Company" are one
# employer, and so are "Altamira Technologies" and "Altamira".
COMPANY_NOISE = frozenset(
    {
        "inc",
        "llc",
        "ltd",
        "limited",
        "corp",
        "corporation",
        "co",
        "company",
        "companies",
        "group",
        "holdings",
        "plc",
        "gmbh",
        "ag",
        "nv",
        "bv",
        "sa",
        "technologies",
        "technology",
        "the",
        "an",
        "and",
    }
)
# Which intake a posting is for. Part of the role in the Jobs sheet, but not part
# of how an application already sent gets recognised.
ROLE_NOISE = frozenset({"summer", "fall", "winter", "spring", "program", "programs"})
YEAR = re.compile(r"20\d\d")
# Trackers decorate the company cell: 🔥 for hot, ✅/🛂 for sponsorship, and ↳ for
# "same company as the row above". None of them are part of a company's name.
MARKERS = re.compile(
    "["
    "\U0001f000-\U0001faff"  # emoji: 🔥 🆕 🛂
    "←-⇿"  # arrows: ↳ ⤷
    "⌀-➿"  # symbols and dingbats: ✅ ✓ ⏳
    "⬀-⯿"  # more arrows and stars
    "️‍"  # variation selector and zero-width joiner
    "*_`"  # markdown emphasis
    "]"
)


# Employers this tracker deliberately does not follow. Kept visible and editable
# next to the role patterns. Their boards also answer 200 for a requisition that
# never existed, so a row from either could never be retired automatically.
BLOCKED_COMPANIES = ("tiktok", "bytedance")
# Hosts that republish someone else's posting under an id of their own.
AGGREGATOR_HOSTS = frozenset({"jobright.ai", "startup.jobs", "adzuna.com"})


@dataclass(frozen=True)
class Source:
    name: str
    url: str
    format: str = "markdown"

    @property
    def label(self) -> str:
        """The short name for the Source column, cut out of the long one.

        "Simplify / Pitt CSC — Summer 2027" is the right thing to print in a log
        and far too much for a cell you glance at. The season and the co-curator
        are what change between a tracker's editions; the first word is what stays
        the same and is what anyone would say out loud."""
        head = self.name.split("—")[0].split("/")[0]
        return head.strip() or self.name.strip()


def normalize_link(value: str) -> str:
    """The one definition of "the same posting". A row already in the sheet and a
    row just parsed must normalize identically or the duplicate slips through.

    Two trackers list the same job under the same URL but tag it differently:
    Simplify appends ?utm_source=Simplify&ref=Simplify, speedyapply appends
    nothing. Dropping the tags is what makes those two rows one row."""
    parts = urlsplit(value.strip())
    host = parts.netloc.casefold().removeprefix("www.")
    path = parts.path.rstrip("/").casefold()
    # Some trackers link the apply form, others the posting it belongs to. Ashby
    # hangs the form off /application and Lever off /apply, one segment under the
    # same id, so the two are one posting written two ways.
    head, _, tail = path.rpartition("/")
    if head and tail in APPLY_SEGMENTS:
        path = head
    identifier = path.rsplit("/", 1)[-1]
    query = [
        (key, val)
        for key, val in parse_qsl(parts.query, keep_blank_values=True)
        if key.casefold() not in TRACKING_PARAMS
        and key.casefold() not in DISPLAY_PARAMS
        # gh_jid names the posting only where the path does not. Greenhouse writes
        # it both places, and the copy in the query is what makes one URL two.
        and not (key.casefold() == "gh_jid" and val.casefold() == identifier)
    ]
    return urlunsplit((parts.scheme.casefold(), host, path, urlencode(query), ""))


def role_key(role: str) -> str:
    """A role with its word endings settled, in the order it was written.

    "Software Engineer Intern" and "Software Engineering Intern" are one posting
    that two trackers typed differently, and name_key alone keeps them apart.

    The order and the intake are deliberately kept: Notion's Summer 2027 and
    Winter 2027 postings share every other word, and a rule loose enough to merge
    them would delete an opening that is genuinely still to be applied to."""
    return " ".join(ROLE_SYNONYMS.get(word, word) for word in name_key(role).split())


def role_tokens(role: str) -> frozenset[str]:
    """A role as an unordered bag of words, without the intake it belongs to.

    Only for asking whether an application has already been sent, never for
    deciding what leaves the sheet. The two tabs describe one job from opposite
    ends — "2027 Internship - Software Engineer" against "Software Engineer
    Intern" — and word order is the last thing they agree on."""
    return frozenset(
        word
        for word in role_key(role).split()
        if word not in ROLE_NOISE and not YEAR.fullmatch(word)
    )


def is_aggregator_link(url: str) -> bool:
    """A link that only redirects to the posting, rather than being it.

    Jobright publishes its own /jobs/info/ id instead of the employer's board,
    so the same job reaches this sheet as a jobright.ai link and, from Simplify
    or speedyapply, as the greenhouse or workday URL the employer actually
    reads. Between those two the employer's own board is the one worth keeping:
    it outlives the aggregator's interest in the posting, and the liveness check
    can read a 404 from it directly."""
    return urlsplit(url.strip()).netloc.casefold().removeprefix("www.") in AGGREGATOR_HOSTS


def name_key(value: str) -> str:
    """A company or role with case and punctuation set aside. Two trackers write
    one posting as "Intern - Summer 2027" and "Intern (Summer 2027)", Medtronic
    uses an en dash for the same job, and Amazon a comma. All are one row."""
    return re.sub(r"[^a-z0-9]+", " ", value.casefold()).strip()


def is_blocked_company(company: str) -> bool:
    """Matched on a substring of the condensed name so that "ByteDance",
    "Bytedance Inc" and "TikTok / ByteDance" are all the same refusal."""
    condensed = re.sub(r"[^a-z0-9]+", "", company.casefold())
    return any(blocked in condensed for blocked in BLOCKED_COMPANIES)


@dataclass(frozen=True)
class Job:
    company: str
    role: str
    apply_link: str
    date_posted: str
    # Which tracker or job board this row came from. Carried on the job rather than
    # decided at the sheet, because by the time two rows for one posting have been
    # deduped, only the surviving one knows where it was read.
    source: str = ""

    @property
    def dedupe_key(self) -> str:
        return normalize_link(self.apply_link)

    @property
    def identity_key(self) -> tuple[str, tuple[tuple[str, ...], tuple[str, ...]]]:
        """One row per company and role, whatever URL each tracker gave it. The
        same posting reaches this sheet under two links often enough — Lever's
        /apply suffix, a Jobright mirror of an employer's own board — that the
        link alone is not what makes two rows the same job."""
        return (company_identity(self.company), role_identity(self.role))


def load_sources(path: Path) -> list[Source]:
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    return [
        Source(name=row["name"], url=row["url"], format=row.get("format", "markdown"))
        for row in data.get("sources", [])
    ]


def fetch_source(source: Source) -> str:
    request = Request(source.url, headers={"User-Agent": "internship-sheet-sync/0.1"})
    with urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8")


def clean_text(value: str) -> str:
    value = re.sub(
        r"!?(?:\[[^]]*\])\([^)]*\)", lambda m: re.sub(r".*\[([^]]*)\].*", r"\1", m.group(0)), value
    )
    value = re.sub(r"<[^>]+>", "", value)
    return re.sub(r"\s+", " ", MARKERS.sub("", value)).strip()


def resolve_company(cell: str, previous: str) -> str:
    """A cell holding only ↳ means "the company above". Left alone it files a
    TikTok posting under the name "↳", and every such row from every company
    collapses into one bogus employer."""
    return clean_text(cell) or previous


def extract_url(value: str) -> str | None:
    links = re.findall(r"\[[^]]*\]\((https?://[^)\s]+)\)", value)
    if links:
        return links[-1]
    html_links = re.findall(r"href=[\"'](https?://[^\"']+)", value, re.IGNORECASE)
    if html_links:
        return html_links[0]
    raw_urls = re.findall(r"(https?://[^\s|]+)", value)
    return raw_urls[-1] if raw_urls else None


def posted_date(value: str, today: date) -> str:
    value = clean_text(value).strip()
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        pass
    try:
        return _parse_month_date(value, today).isoformat()
    except ValueError:
        pass
    age = re.search(r"\b(\d+)\s*(d|day|days|w|week|weeks|mo|month|months)\b", value, re.IGNORECASE)
    if age:
        amount, unit = int(age.group(1)), age.group(2).casefold()
        multiplier = 30 if unit.startswith("m") else 7 if unit.startswith("w") else 1
        return (today - timedelta(days=amount * multiplier)).isoformat()
    # This is the first observed date, not an invented employer posting date.
    return today.isoformat()


def _parse_month_date(value: str, today: date) -> date:
    for date_format in ("%b %d, %Y", "%B %d, %Y"):
        try:
            parsed = strptime(value, date_format)
            return date(parsed.tm_year, parsed.tm_mon, parsed.tm_mday)
        except ValueError:
            pass
    # Jobright writes "Aug 06" with no year. A tracker lists postings that already
    # exist, so a month still ahead of today has to belong to last year.
    for date_format in ("%b %d", "%B %d"):
        for year in (today.year, today.year - 1):
            # The year is supplied rather than defaulted: strptime without one
            # falls back to 1900, which cannot represent Feb 29.
            try:
                parsed = strptime(f"{value} {year}", f"{date_format} %Y")
            except ValueError:
                continue
            candidate = date(parsed.tm_year, parsed.tm_mon, parsed.tm_mday)
            if candidate <= today:
                return candidate
    raise ValueError(f"Not a month-name date: {value}")


def _header_index(headers: list[str], *names: str) -> int | None:
    for index, header in enumerate(headers):
        if any(name in header for name in names):
            return index
    return None


def parse_jobs(markdown: str, today: date) -> list[Job]:
    lines = markdown.splitlines()
    parsed: list[Job] = []
    seen: set[str] = set()
    for index, line in enumerate(lines[:-2]):
        header_text = line.casefold()
        if (
            "|" not in line
            or "company" not in header_text
            or not any(label in header_text for label in ("role", "position", "title"))
        ):
            continue
        separator = lines[index + 1]
        if "|" not in separator or "---" not in separator:
            continue
        headers = [clean_text(cell).casefold() for cell in line.strip().strip("|").split("|")]
        company_i = _header_index(headers, "company")
        role_i = _header_index(headers, "role", "position", "title")
        link_i = _header_index(headers, "apply", "application", "link", "posting")
        date_i = _header_index(headers, "added", "posted", "date", "age")
        if None in (company_i, role_i):
            continue
        # Jobright has no Apply column; the link lives inside the job title.
        link_i = role_i if link_i is None else link_i
        last_company = ""
        for row in lines[index + 2 :]:
            if "|" not in row or row.lstrip().startswith("#"):
                break
            cells = [cell.strip() for cell in row.strip().strip("|").split("|")]
            if max(company_i, role_i, link_i) >= len(cells):
                continue
            company = resolve_company(cells[company_i], last_company)
            # Carried forward before the role filter: a ↳ row often follows a row
            # this pipeline drops, and it still means that dropped row's company.
            last_company = company or last_company
            role = clean_text(cells[role_i])
            link = extract_url(cells[link_i])
            if not company or not link or not is_target_role(role):
                continue
            if is_blocked_company(company):
                continue
            date_value = cells[date_i] if date_i is not None and date_i < len(cells) else ""
            job = Job(
                company=company,
                role=role,
                apply_link=link,
                date_posted=posted_date(date_value, today),
            )
            if job.dedupe_key not in seen:
                seen.add(job.dedupe_key)
                parsed.append(job)
    # Simplify/Pitt CSC publishes the same logical table as HTML rather than
    # Markdown. Keep this deliberately small instead of adding an HTML package.
    for table in re.findall(
        r"<table[^>]*>(.*?)</table>", markdown, flags=re.IGNORECASE | re.DOTALL
    ):
        rows = re.findall(r"<tr[^>]*>(.*?)</tr>", table, flags=re.IGNORECASE | re.DOTALL)
        if not rows:
            continue
        cell_rows = [
            re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", row, flags=re.IGNORECASE | re.DOTALL)
            for row in rows
        ]
        headers = [clean_text(cell).casefold() for cell in cell_rows[0]]
        company_i = _header_index(headers, "company")
        role_i = _header_index(headers, "role", "position", "title")
        link_i = _header_index(headers, "apply", "application", "link", "posting")
        date_i = _header_index(headers, "added", "posted", "date", "age")
        if None in (company_i, role_i):
            continue
        # Jobright has no Apply column; the link lives inside the job title.
        link_i = role_i if link_i is None else link_i
        last_company = ""
        for cells in cell_rows[1:]:
            if max(company_i, role_i, link_i) >= len(cells):
                continue
            company = resolve_company(cells[company_i], last_company)
            last_company = company or last_company
            role = clean_text(cells[role_i])
            link = extract_url(cells[link_i])
            if not company or not link or not is_target_role(role):
                continue
            if is_blocked_company(company):
                continue
            date_value = cells[date_i] if date_i is not None and date_i < len(cells) else ""
            job = Job(
                company=company,
                role=role,
                apply_link=link,
                date_posted=posted_date(date_value, today),
            )
            if job.dedupe_key not in seen:
                seen.add(job.dedupe_key)
                parsed.append(job)
    return parsed


def _rss_date(value: str, today: date) -> str:
    """Return the publication date from an RSS item without guessing a timezone."""
    try:
        return parsedate_to_datetime(value).date().isoformat()
    except (TypeError, ValueError, OverflowError):
        return today.isoformat()


def parse_rss_jobs(xml: str, today: date) -> list[Job]:
    """Read a job RSS feed and keep only target roles.

    Startup Jobs puts the employer in the title as ``<role> at <company>`` and
    includes a canonical ``guid`` alongside a tracked link. The guid is preferred
    so the feed's own tracking parameters cannot create a second row. Items whose
    title has no employer delimiter are skipped: inventing a company would make
    company/role deduplication less safe than losing one ambiguous item.
    """
    try:
        root = ElementTree.fromstring(xml)
    except ElementTree.ParseError:
        return []
    parsed: list[Job] = []
    seen: set[str] = set()
    for item in root.findall(".//item"):
        title = (item.findtext("title") or "").strip()
        role, separator, company = title.rpartition(" at ")
        link = (item.findtext("guid") or item.findtext("link") or "").strip()
        if not separator or not role.strip() or not company.strip() or not link:
            continue
        if not is_target_role(role):
            continue
        job = Job(
            company=company.strip(),
            role=role.strip(),
            apply_link=link,
            source="Startup Jobs",
            date_posted=_rss_date(item.findtext("pubDate") or "", today),
        )
        if job.dedupe_key not in seen:
            seen.add(job.dedupe_key)
            parsed.append(job)
    return parsed


def parse_source(text: str, source: Source, today: date) -> list[Job]:
    """Dispatch one configured source while keeping the Markdown API stable."""
    if source.format.casefold() == "rss":
        return parse_rss_jobs(text, today)
    return parse_jobs(text, today)


def dedupe_jobs(jobs: list[Job]) -> list[Job]:
    """Keep the first occurrence of an application URL across all sources."""
    seen: set[str] = set()
    unique: list[Job] = []
    for job in jobs:
        if job.dedupe_key not in seen:
            seen.add(job.dedupe_key)
            unique.append(job)
    return unique


def company_tokens(company: str) -> frozenset[str]:
    """An employer as the words that actually name it, legal form dropped.

    Used only to ask whether two lists are talking about the same employer, never
    to delete anything, so it leans towards finding a match."""
    return frozenset(word for word in name_key(company).split() if word not in COMPANY_NOISE)


def company_identity(company: str) -> str:
    """A conservative company key for deduplication.

    Legal-form words are ignored, but token containment is not: ``Acme`` and
    ``Acme Robotics`` may be different employers, so only the same complete token
    set is merged. This is intentionally stricter than ``same_employer``, which is
    designed for contact matching rather than deleting rows.
    """
    return " ".join(sorted(company_tokens(company)))


def role_identity(role: str) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """A cautious posting identity that tolerates title reordering and acronyms.

    The intake remains part of the identity. Thus ``Summer 2027`` and ``Winter
    2027`` stay separate, while ``Summer 2027 Internship - Software Engineer``
    and ``Software Engineer Intern — Summer 2027`` converge. Extra descriptive
    words remain in the core tuple, so ``Backend`` or ``Platform`` does not get
    merged into a generic SWE role by accident.
    """
    words = name_key(role).split()
    intake = tuple(sorted(word for word in words if word in ROLE_NOISE or YEAR.fullmatch(word)))
    core: list[str] = []
    for word in words:
        if word in ROLE_NOISE or YEAR.fullmatch(word):
            continue
        expanded = ROLE_ACRONYMS.get(word, (word,))
        core.extend(ROLE_SYNONYMS.get(part, part) for part in expanded)
    return intake, tuple(sorted(core))


def same_employer(left: frozenset[str], right: frozenset[str]) -> bool:
    """Either name being contained in the other is enough: an alumni directory
    writes "Google Cloud" and "Hakkoda, an IBM Company" where the application says
    "Google" and "IBM".

    Containment is over whole words, not substrings, so "Dice" does not match
    "Dicerna" and "HP" does not match "Champion". Two companies that genuinely
    share a word still get flagged — that is the cost of the looser reading, and
    the log names every pair for review."""
    if not left or not right:
        return False
    return left <= right or right <= left
