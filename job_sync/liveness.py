"""Is the posting behind a link still there?

Most job boards answer 200 whether or not the role is open, because the page is
an empty shell and the posting arrives later over JavaScript. So a status code
alone decides almost nothing, and three different questions have to be asked:

  * Workday (57 of the links here, Salesforce among them) hides a JSON endpoint
    behind the same path. It answers 404 once the requisition is gone.
  * Jobright renders its title server-side. A posting it no longer knows about
    falls back to the bare site name.
  * Everything else — Greenhouse, Lever, Ashby, workatastartup — 404s honestly.

TikTok and ByteDance answer 200 for an id that never existed, so nothing here
can judge them. They come back UNKNOWN and are kept: a link this module cannot
read is not a link it may delete.
"""

from __future__ import annotations

import re
import ssl
import time
import urllib.error
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlsplit

# A default urllib agent is refused by several boards; this is not evasion, only
# enough of a browser string to be served the same page a person would see.
BROWSER_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0 Safari/537.36"
)
# workatastartup answers 406 to Accept: */*, so the browser's own string is sent.
BROWSER_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
TIMEOUT_SECONDS = 20
# Distinct hosts probed at once. Links on one host are never probed in parallel.
WORKERS = 12
PER_HOST_DELAY_SECONDS = 0.4
DEAD_CODES = frozenset({404, 410})
# HEAD is cheap but not universally implemented; these mean "ask again with GET".
RETRY_WITH_GET = frozenset({403, 405, 501})

WORKDAY = re.compile(
    r"https://(?P<tenant>[^.]+)\.(?P<pod>wd\d+)\.myworkdayjobs\.com/"
    r"(?:[a-z]{2}-[A-Z]{2}/)?(?P<site>[^/]+)/job/(?P<path>[^?#]+)",
    re.IGNORECASE,
)
JOBRIGHT = re.compile(r"https://(?:www\.)?jobright\.ai/jobs/info/", re.IGNORECASE)
TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)
# What Jobright serves when it has no posting under that id.
JOBRIGHT_PLACEHOLDER_TITLES = frozenset({"jobright.ai", "jobright", ""})

_CONTEXT = ssl.create_default_context()


def workday_api(url: str) -> str | None:
    """The CXS endpoint backing a Workday posting page, which unlike the page
    itself distinguishes a live requisition from a withdrawn one."""
    match = WORKDAY.match(url)
    if match is None:
        return None
    tenant, pod, site, path = match.group("tenant", "pod", "site", "path")
    return f"https://{tenant}.{pod}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/job/{path}"


def _fetch(url: str, method: str, accept: str, read_bytes: int) -> tuple[int, str] | None:
    request = urllib.request.Request(
        url, method=method, headers={"User-Agent": BROWSER_UA, "Accept": accept}
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS, context=_CONTEXT) as response:
            body = response.read(read_bytes).decode("utf-8", "ignore") if read_bytes else ""
            return response.status, body
    except urllib.error.HTTPError as error:
        return error.code, ""
    except Exception:  # noqa: BLE001 - a flaky host is unknown, never dead.
        return None


def check(url: str) -> bool | None:
    """True if the posting is there, False if the host says it is gone, None if
    the host cannot be made to answer the question."""
    api = workday_api(url)
    if api is not None:
        result = _fetch(api, "GET", "application/json", 0)
        if result is None:
            return None
        if result[0] in DEAD_CODES:
            return False
        return True if result[0] == 200 else None

    if JOBRIGHT.match(url):
        result = _fetch(url, "GET", BROWSER_ACCEPT, 4000)
        if result is None:
            return None
        if result[0] in DEAD_CODES:
            return False
        if result[0] != 200:
            return None
        found = TITLE.search(result[1])
        if found is None:
            return None
        return found.group(1).strip().casefold() not in JOBRIGHT_PLACEHOLDER_TITLES

    result = _fetch(url, "HEAD", BROWSER_ACCEPT, 0)
    if result is not None and result[0] in RETRY_WITH_GET:
        result = _fetch(url, "GET", BROWSER_ACCEPT, 0)
    if result is None:
        return None
    if result[0] in DEAD_CODES:
        return False
    return True if 200 <= result[0] < 400 else None


def _sweep(urls: list[str]) -> dict[str, bool | None]:
    verdicts: dict[str, bool | None] = {}
    for position, url in enumerate(urls):
        if position:
            time.sleep(PER_HOST_DELAY_SECONDS)
        verdicts[url] = check(url)
    return verdicts


def dead_links(urls: list[str]) -> set[str]:
    """Only links a host positively reported as gone, and only after saying so
    twice.

    Hammered with 16 parallel requests, Jobright served its generic shell for 41
    of 83 live postings — every one of which came back alive when asked again on
    its own. So hosts are swept in parallel with each other but one link at a
    time within a host, and anything that still looks dead is asked once more
    before a row is deleted over it.
    """
    unique = list(dict.fromkeys(urls))
    if not unique:
        return set()
    by_host: dict[str, list[str]] = defaultdict(list)
    for url in unique:
        by_host[urlsplit(url).netloc.casefold()].append(url)

    verdicts: dict[str, bool | None] = {}
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for part in pool.map(_sweep, by_host.values()):
            verdicts.update(part)

    confirmed = set()
    for url in (url for url, alive in verdicts.items() if alive is False):
        time.sleep(PER_HOST_DELAY_SECONDS)
        if check(url) is False:
            confirmed.add(url)
    return confirmed
