# 16. Orchestration

## 16.1 Time zone

Business logic uses:

```text
America/New_York
```

Database timestamps use UTC.

## 16.2 Daily schedule

Recommended default:

```yaml
schedule:
  discovery: "07:00 America/New_York"
  enrichment: "07:10 America/New_York"
  scoring: "07:20 America/New_York"
  resume_tailoring: "07:35 America/New_York"
  browser_preparation: "08:00 America/New_York"
  submission_reconciliation: "every 15 minutes"
  outreach_due_scan: "every 30 minutes"
  gmail_reconciliation: "every 30 minutes"
  backup: "02:30 America/New_York"
  cleanup: "03:15 America/New_York"
```

## 16.3 Daily selection policy

Default selection:

1. only open, nonduplicate jobs;
2. hard eligibility passed;
3. sponsorship not clearly incompatible, unless manual review enabled;
4. fit score above threshold;
5. role age below configured maximum;
6. not too many applications at same company;
7. cap at 10.

Suggested:

```yaml
selection:
  max_prepare_per_day: 10
  minimum_fit_score: 72
  max_role_age_days: 21
  max_active_applications_per_company: 2
  max_same_company_prepared_per_day: 1
```

## 16.4 Task types

```text
DISCOVER_SOURCE
ENRICH_JOB
DEDUPE_JOB
ANALYZE_SPONSORSHIP
SCORE_JOB
TAILOR_RESUME
PREPARE_APPLICATION
REPLAY_APPLICATION
RECONCILE_SUBMISSION
SCHEDULE_OUTREACH
MATCH_RECRUITER
GENERATE_HOOK
CREATE_GMAIL_DRAFT
RECONCILE_GMAIL
BACKUP_DATABASE
BACKUP_ARTIFACTS
CLEANUP_EXPIRED_SESSION
```

## 16.5 Idempotency keys

Examples:

```text
discover:{source}:{date}
enrich:{job_id}:{description_hash}
sponsorship:{job_id}:{description_hash}:{prompt_version}
score:{job_id}:{profile_version}:{prompt_version}
resume:{job_id}:{base_resume_hash}:{prompt_version}
prepare:{application_id}:{resume_sha256}
outreach:{application_id}
gmail-draft:{outreach_task_id}:{content_hash}
```

## 16.6 Retry policy

- HTTP 429/5xx: exponential backoff with jitter;
- login required: no automated retry until user action;
- CAPTCHA: mark manual;
- selector mismatch: one semantic replay retry, then manual;
- LLM schema failure: retry once with correction prompt;
- Gmail auth failure: stop email tasks and notify;
- disk full: stop browser and resume tasks immediately.

---
