# InternshipOps — Specification Index

**Cloud-Hosted, Human-in-the-Loop SWE Internship Application and Recruiter Outreach System**

| | |
|---|---|
| Codename | `internship-ops` |
| Target user | One private user applying to U.S. SWE internships |
| Deployment | Oracle Cloud Infrastructure Always Free, Ampere A1 (ARM64) |
| Access | Private Tailscale network, no custom domain |
| Repo visibility | Private |
| Research date | July 28, 2026 |

This folder is the master spec split into one file per section. The original
single-file version is kept at
[`../internship_ops_master_build_spec.md`](../internship_ops_master_build_spec.md).

---

## Pipeline at a glance

```
Discover → Normalize → Dedupe → Hard filter → Sponsorship + Fit
   → Select ≤10/day → Tailor resume → Browser prefill
   → ⛔ STOP before Submit → Human review (noVNC) → Human submits
   → Detect submission → wait 2 business days
   → Match recruiter → Generate hook → Gmail DRAFT
   → ⛔ NO auto-send → Human sends → Reconcile reply
```

Two mandatory human gates: **Submit** and **Send**. Everything else is automated.

---

## Start here

| File | Why |
|---|---|
| [00 — Rules for Claude Code](00-claude-code-rules.md) | Locked safety rules. Read before touching code. |
| [29 — Hard Safety Guards in Code](29-hard-safety-guards-in-code.md) | The guards that enforce those rules at runtime. |
| [30 — Implementation Milestones](30-implementation-milestones.md) | The build order. |
| [36 — Master Prompt for Claude Code](36-master-prompt-for-claude-code.md) | Kickoff prompt. |

---

## Product

- [01 — Executive Summary](01-executive-summary.md)
- [02 — Product Principles](02-product-principles.md)
- [03 — Goals and Non-Goals](03-goals-and-non-goals.md)
- [04 — Key Product Decisions](04-key-product-decisions.md)
- [05 — Source Projects and Official References](05-source-projects-and-official-references.md)
- [06 — User Journeys](06-user-journeys.md)
- [38 — Final Product Boundary](38-final-product-boundary.md)

## Functional requirements — [overview](07-functional-requirements.md)

One file per sub-task:

| # | Sub-task | Milestone |
|---|---|---|
| 7.1 | [Candidate profile](07-functional-requirements/01-candidate-profile.md) | M3 |
| 7.2 | [Discovery](07-functional-requirements/02-discovery.md) | M4 |
| 7.3 | [Eligibility filter](07-functional-requirements/03-eligibility-filter.md) | M4 |
| 7.4 | [Deduplication](07-functional-requirements/04-deduplication.md) | M4 |
| 7.5 | [Sponsorship analysis](07-functional-requirements/05-sponsorship-analysis.md) | M5 |
| 7.6 | [Job scoring](07-functional-requirements/06-job-scoring.md) | M5 |
| 7.7 | [Resume tailoring](07-functional-requirements/07-resume-tailoring.md) | M6 |
| 7.8 | [Browser preparation](07-functional-requirements/08-browser-preparation.md) | M7 |
| 7.9 | [Review queue](07-functional-requirements/09-review-queue.md) | M7 |
| 7.10 | [Submission detection](07-functional-requirements/10-submission-detection.md) | M7 |
| 7.11 | [Replay package](07-functional-requirements/11-replay-package.md) | M7 |
| 7.12 | [Recruiter import and matching](07-functional-requirements/12-recruiter-import-and-matching.md) | M3, M9 |
| 7.13 | [Cold-email hook generation](07-functional-requirements/13-cold-email-hook-generation.md) | M9 |
| 7.14 | [Gmail drafts](07-functional-requirements/14-gmail-drafts.md) | M9 |

- [08 — Email Safety and Anti-Spam Policy](08-email-safety-and-anti-spam-policy.md)
- [09 — Non-Functional Requirements](09-non-functional-requirements.md)

## Architecture

- [10 — System Architecture](10-system-architecture.md)
- [11 — Recommended Technology Stack](11-recommended-technology-stack.md)
- [12 — Data Model](12-data-model.md)
- [13 — State Machines](13-state-machines.md)
- [14 — Application Adapters](14-application-adapters.md)
- [15 — Browser Slot Design](15-browser-slot-design.md)
- [16 — Orchestration](16-orchestration.md)
- [20 — Repository Layout](20-repository-layout.md)
- [22 — Web Application Screens](22-web-application-screens.md)

## Infrastructure and operations

- [17 — OCI Infrastructure](17-oci-infrastructure.md)
- [18 — Post-Provision Setup](18-post-provision-setup.md)
- [19 — Docker Compose](19-docker-compose.md)
- [21 — Configuration](21-configuration.md)
- [23 — Security Design](23-security-design.md)
- [24 — Backup and Disaster Recovery](24-backup-and-disaster-recovery.md)
- [25 — Monitoring and Operations](25-monitoring-and-operations.md)
- [26 — Cost Plan](26-cost-plan.md)
- [33 — Initial Production Settings](33-initial-production-settings.md)

## Build process

### Milestones — [overview](30-implementation-milestones.md)

| # | Milestone | Priority |
|---|---|---|
| 0 | [Architecture and ARM64 Spike](30-milestones/00-architecture-and-arm64-spike.md) | **Blocking** |
| 1 | [Infrastructure as Code](30-milestones/01-infrastructure-as-code.md) | Deferrable |
| 2 | [Core Application and Database](30-milestones/02-core-application-and-database.md) | Core |
| 3 | [Candidate Profile and Recruiter Import](30-milestones/03-candidate-profile-and-recruiter-import.md) | Core |
| 4 | [Discovery and Deduplication](30-milestones/04-discovery-and-deduplication.md) | Core |
| 5 | [Sponsorship and Fit Analysis](30-milestones/05-sponsorship-and-fit-analysis.md) | Core |
| 6 | [Resume Tailoring](30-milestones/06-resume-tailoring.md) | Deferrable |
| 7 | [Greenhouse Browser Adapter](30-milestones/07-greenhouse-browser-adapter.md) | Core |
| 8 | [Lever and Ashby Adapters](30-milestones/08-lever-and-ashby-adapters.md) | Deferrable |
| 9 | [Outreach Pipeline](30-milestones/09-outreach-pipeline.md) | Core |
| 10 | [Backup, Monitoring, and Hardening](30-milestones/10-backup-monitoring-and-hardening.md) | Deferrable |
| 11 | [Workday Research Spike](30-milestones/11-workday-research-spike.md) | Deferrable |

- [27 — Legal, Ethical, and Platform Constraints](27-legal-ethical-and-platform-constraints.md)
- [28 — Testing Strategy](28-testing-strategy.md)
- [29 — Hard Safety Guards in Code](29-hard-safety-guards-in-code.md)
- [31 — Claude Code Working Method](31-claude-code-working-method.md)
- [32 — Definition of Done](32-definition-of-done.md)
- [34 — Risks and Mitigations](34-risks-and-mitigations.md)
- [35 — Future Enhancements](35-future-enhancements.md)
- [36 — Master Prompt for Claude Code](36-master-prompt-for-claude-code.md)
- [37 — Source Reference Index](37-source-reference-index.md)

---

## Known defects in this spec

Fix these before implementing the affected section.

| Where | Problem |
|---|---|
| [18 — Post-Provision Setup](18-post-provision-setup.md) §18.6 | Gmail OAuth section omits that a project left in **"Testing"** publishing status expires refresh tokens after 7 days. The outreach pipeline will break weekly. Publish the OAuth app to "In production" (the unverified-app warning screen is acceptable for personal use). |
| [15 — Browser Slot Design](15-browser-slot-design.md) §15.1 vs §15.2 | Port table says noVNC is `6081`/`6082`; the Caddyfile proxies to `6080`. Pick one. |
| [19 — Docker Compose](19-docker-compose.md) | The `worker` service mounts `/var/run/docker.sock`, which the security note directly below tells you not to do. Remove the mount. |
| [21 — Configuration](21-configuration.md) | `LLM_WRITING_MODEL=claude-sonnet-4-6` is not a real model ID. Current IDs: `claude-sonnet-5`, `claude-opus-5`, `claude-haiku-4-5-20251001`. |
| [12 — Data Model](12-data-model.md) | `applications.job_id` is `NOT NULL UNIQUE`, which permanently blocks re-applying to the same job in a later season. |
| [12 — Data Model](12-data-model.md) | `uq_job_fingerprint` as a partial unique index raises on INSERT instead of deduplicating. Needs explicit upsert handling. |
| [17 — OCI Infrastructure](17-oci-infrastructure.md) | Does not mention that upgrading the tenancy to Pay-As-You-Go (free-tier resources still cost $0) substantially improves the odds of getting A1 capacity. |

### How each was resolved

| Where | Resolution |
|---|---|
| §18.6 Gmail "Testing" | [scripts/gmail_authorize.py](../../scripts/gmail_authorize.py) states it in its docstring and again in its output. |
| §15.1 vs §15.2 ports | 6080 in every slot. Each container has its own network namespace, so per-slot numbers buy nothing. |
| §19 docker.sock | Not mounted. Browser slots are fixed services on the internal network. |
| §21 model ID | `claude-sonnet-5`, and model IDs are configuration rather than constants. |
| §12 `applications.job_id UNIQUE` | Replaced by a partial unique index excluding SKIPPED, WITHDRAWN and FAILED, so re-applying after an abandoned attempt works and G5 still holds. |
| §12 `uq_job_fingerprint` | Non-unique index. A fingerprint collision is only *probable* duplication and must reach a human, so the row is inserted and linked via `duplicate_of_id`. |
| §17 A1 capacity | Noted in the deployment section of the root README. |
