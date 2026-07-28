# 26. Cost Plan

## 26.1 Infrastructure

Expected:

| Component | Expected cost |
|---|---:|
| OCI A1 2 OCPU / 12 GB | $0 if Always Free eligible and available |
| 50 GB boot + 100 GB data volume | $0 within documented Always Free allocation |
| OCI Object Storage up to documented free allocation | $0 |
| Tailscale Personal | $0 |
| Gmail API at personal volume | $0 |
| Domain | $0; not required |

Risks:

- Always Free capacity may be unavailable in the selected region;
- idle instances may be reclaimed;
- accidental resources above free limits can incur charges on a paid tenancy;
- configure OCI budgets and quotas.

## 26.2 LLM cost estimate

Use a strict monthly budget.

Illustrative monthly workload:

- 300 jobs classified/scored;
- 100–150 resumes tailored;
- 60–100 outreach drafts;
- 10 applications/day maximum.

Use lower-cost models for extraction/classification and a stronger model only for selected resume work.

Suggested default cap:

```text
$15/month
```

Behavior at budget thresholds:

- 70%: dashboard warning;
- 90%: disable nonessential regeneration;
- 100%: stop LLM tasks and require user approval.

Prices change. The implementation must not hard-code dollar assumptions; model prices should be configurable and reviewed against the official provider pricing page.

## 26.3 Development cost

Claude Code usage for building the repository is separate from production API usage and depends on the user's current Anthropic plan and usage policy.

---
