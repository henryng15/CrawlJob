# 7.4 Deduplication

> Part of **7. Functional Requirements**

Deduplication must happen before:

- LLM scoring;
- resume generation;
- browser preparation;
- outreach.

Priority of identifiers:

1. ATS provider + employer board + external requisition/job ID.
2. Canonical application URL with tracking parameters removed.
3. Company domain + requisition ID extracted from URL or page.
4. Normalized company + normalized title + normalized location + season.
5. Fuzzy duplicate score.

Statuses:

```text
NEW
DUPLICATE_EXACT
DUPLICATE_PROBABLE
ALREADY_APPLIED
SAME_COMPANY_DIFFERENT_ROLE
CLOSED
```

`DUPLICATE_PROBABLE` must require manual review rather than silent deletion.
