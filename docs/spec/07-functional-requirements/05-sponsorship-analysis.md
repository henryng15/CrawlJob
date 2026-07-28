# 7.5 Sponsorship analysis

> Part of **7. Functional Requirements**

Output schema:

```json
{
  "classification": "SPONSORSHIP_NOT_MENTIONED",
  "work_authorization_restriction": "UNKNOWN",
  "evidence": [
    {
      "quote": "Exact excerpt from the job description",
      "source_url": "https://...",
      "start_offset": 100,
      "end_offset": 180
    }
  ],
  "confidence": 0.93,
  "recommended_action": "MANUAL_REVIEW",
  "reasoning_summary": "Concise explanation without legal advice."
}
```

Allowed classifications:

```text
SPONSORSHIP_AVAILABLE
SPONSORSHIP_CASE_BY_CASE
SPONSORSHIP_NOT_AVAILABLE
SPONSORSHIP_NOT_MENTIONED
SPONSORSHIP_AMBIGUOUS
```

Work-authorization restriction:

```text
NO_EXPLICIT_RESTRICTION
US_WORK_AUTHORIZATION_REQUIRED
US_CITIZENSHIP_REQUIRED
PERMANENT_RESIDENCY_OR_CITIZENSHIP_REQUIRED
EXPORT_CONTROL_REVIEW
UNKNOWN
```

Rules:

- require a JD quote for any restrictive classification;
- if there is no quote, use `NOT_MENTIONED` or `AMBIGUOUS`;
- never use employer policy to alter the user's truthful answer;
- jobs with `SPONSORSHIP_NOT_AVAILABLE` default to manual review or skip;
- citizenship-restricted jobs default to skip unless the user's locked profile clearly satisfies the restriction;
- show sponsorship evidence prominently before review.
