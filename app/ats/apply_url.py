"""Where an employer actually keeps the application form.

A job feed gives the URL of a *posting*. On some boards that page is the form;
on others it is a description with an Apply button, and the form lives at a URL
of its own. The browser worker was opening the posting either way, finding no
fields, and handing every one of those applications back to the user.

Measured on real postings, with a headless browser counting inputs:

===========  ===================================  ============================
Board        Posting page                         Form page
===========  ===================================  ============================
Ashby        0 inputs                             ``/application`` — 35 inputs
Lever        0 inputs                             ``/apply`` — 31 inputs
Greenhouse   26 inputs                            same page
Workday      0 inputs                             behind an Apply button
===========  ===================================  ============================

So this module is a lookup, not a heuristic: each entry was checked against a
live page rather than inferred from the shape of the URL.
"""

from __future__ import annotations

import re
from urllib.parse import urlsplit, urlunsplit

__all__ = ["NEEDS_A_CLICK", "apply_url", "needs_a_click"]

#: Boards whose form is reached by pressing a button rather than by a URL. The
#: browser worker has to drive them; there is no address to jump to.
NEEDS_A_CLICK: frozenset[str] = frozenset({"workday"})

#: ``(host marker, suffix to append)``. The suffix is added only when the path
#: does not already end in it, so a URL that already points at the form — which
#: is what a re-queued task carries — is left alone.
_SUFFIX_BY_HOST: tuple[tuple[str, str], ...] = (
    ("jobs.ashbyhq.com", "/application"),
    ("jobs.lever.co", "/apply"),
)

#: Ashby and Lever both put the posting at ``/{org}/{id}``. Appending to
#: anything deeper — a board index, an already-suffixed URL, a referral link —
#: would produce an address that does not exist, and a 404 is indistinguishable
#: from an empty form to the code that reads the page.
_TWO_SEGMENT_PATH = re.compile(r"^/[^/]+/[^/]+/?$")


def needs_a_click(url: str) -> bool:
    """Whether the form on ``url`` is behind a button rather than a link."""
    host = urlsplit(url).netloc.lower()
    return any(marker in host for marker in ("myworkdayjobs.com", "wd1.", "wd3.", "wd5."))


def apply_url(url: str) -> str:
    """The URL that holds the form, or ``url`` unchanged when it already does.

    Never raises and never guesses: a board this does not know about is returned
    untouched, which is the behaviour the system had before and is correct for
    Greenhouse and for every employer hosting their own form.
    """
    parts = urlsplit(url)
    host = parts.netloc.lower()

    for marker, suffix in _SUFFIX_BY_HOST:
        if marker not in host:
            continue
        path = parts.path.rstrip("/")
        if path.endswith(suffix):
            return url
        if not _TWO_SEGMENT_PATH.match(parts.path):
            return url
        return urlunsplit((parts.scheme, parts.netloc, path + suffix, parts.query, ""))

    return url
