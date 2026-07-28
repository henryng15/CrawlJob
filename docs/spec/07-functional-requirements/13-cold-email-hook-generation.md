# 7.13 Cold-email hook generation

> Part of **7. Functional Requirements**

Phase 1 hooks should be company/job specific rather than recruiter-personal.

Preferred evidence:

1. job description;
2. company engineering blog;
3. company careers page;
4. official product announcement;
5. official company website.

Do not scrape private or login-gated social profiles.

Output:

```json
{
  "hook_type": "JOB_SPECIFIC",
  "hook": "I was particularly interested in ...",
  "source_url": "https://...",
  "source_excerpt": "Exact source excerpt",
  "confidence": 0.88,
  "unsupported_claims": []
}
```

When no reliable hook exists:

- generate a short, direct email without a fabricated hook.
