# job_sync — optional career and job feeds

`feeds.py`, `data/public_feeds.toml`

This layer supplements the Markdown trackers and the Greenhouse/Lever/Ashby board
shortlist. It never replaces them: an unavailable credential or a broken optional
feed is logged and the rest of the sync continues.

## Sources

- Startup Jobs is configured as an RSS source in `sources.toml`; it needs no key and
  is filtered to the engineering feed.
- SmartRecruiters, Personio, and Recruitee are company-scoped feeds. Their verified
  identifiers belong in `data/public_feeds.toml`.
- Adzuna is enabled by `ADZUNA_APP_ID` and `ADZUNA_APP_KEY`.
- USAJOBS is enabled by `USAJOBS_API_KEY`, with `USAJOBS_USER_AGENT` optional.

The company registry is empty by design. An identifier is added only after its career
page has been verified; these ATSes do not expose a reliable global directory.

## Functions

| Function | Does |
|---|---|
| `_fetch`, `_json`, `_date` | Bounded HTTP reads and safe date conversion. |
| `_smartrecruiters` | Reads active company postings from the public Posting API. |
| `_personio` | Reads open positions from the company XML feed. |
| `_recruitee` | Reads the company JSON offers feed. |
| `_adzuna` | Searches the US API with several SWE-intern queries. |
| `_usajobs` | Searches current federal announcements with software-intern queries. |
| `harvest_feeds` | Runs the optional adapters, isolates failures, counts skipped adapters, and URL-dedupes their output. |

All adapters apply the existing target-role and US-location filters before returning
`Job` objects. Aggregator links remain useful when no employer URL is available, but
`is_aggregator_link` makes a direct employer board win when the same role arrives from
two sources.
