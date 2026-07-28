# 5. Source Projects and Official References

This section defines what may be reused, what should only inspire design, and what should not be used in the default architecture.

## 5.1 ApplyPilot

Repository:

```text
https://github.com/Pickle-Pixel/ApplyPilot
```

License:

```text
AGPL-3.0-only
```

Useful concepts:

- staged pipeline:
  - discover;
  - enrich;
  - score;
  - tailor;
  - cover letter;
  - browser application;
- structured candidate profile;
- immutable resume facts;
- per-job resume tailoring;
- Workday employer registry;
- dry-run application mode;
- source URL deduplication;
- multiple LLM providers.

Recommended use:

- use it as an architectural reference;
- optionally import or adapt stages 1–5 in a clearly isolated AGPL-compatible module;
- do not use its default autonomous-submit behavior;
- pin a reviewed commit rather than tracking `main`;
- record the exact upstream commit in `THIRD_PARTY.md`.

Do not assume ApplyPilot is production-ready. Its repository describes itself as beta and its current browser-application design depends on Claude Code and Playwright MCP. InternshipOps should instead implement a deterministic browser service with explicit human review.

Licensing rule:

- private personal use is compatible with the project goal;
- if InternshipOps is later offered over a network to other users or distributed, perform a fresh AGPL compliance review and provide corresponding source as required;
- keep third-party code provenance clear.

## 5.2 Work, Pls.

Repository:

```text
https://github.com/jeffistyping/workpls
```

License:

```text
Apache-2.0
```

Useful concepts:

- common field taxonomy;
- Greenhouse and Lever field recognition;
- local candidate-profile autofill;
- activity tracking.

Recommended use:

- use provider patterns and field-name heuristics as reference;
- do not depend on the browser extension in the cloud architecture;
- port useful mappings into tested server-side adapter fixtures with attribution.

## 5.3 AIHawk Community Fork

Repository:

```text
https://github.com/Intusar/Auto_Jobs_Applier_AI_Agent
```

Useful concepts:

- job filtering configuration;
- blacklist handling;
- YAML-based candidate configuration;
- local-model provider abstraction.

Recommended use:

- reference only;
- do not include LinkedIn Easy Apply automation in MVP;
- do not adopt bot-detection evasion logic.

## 5.4 Plunk

Repository:

```text
https://github.com/useplunk/plunk
```

License:

```text
AGPL-3.0
```

Useful concepts:

- contact history;
- workflows;
- suppression;
- inbound email processing;
- campaign analytics.

Decision:

- do not deploy Plunk for MVP;
- Gmail drafts plus the InternshipOps database are simpler and safer for low-volume personal outreach;
- reconsider Plunk only if outreach volume and workflow complexity grow substantially.

## 5.5 Public internship repositories

Initial curated discovery sources:

```text
https://github.com/speedyapply/2027-SWE-College-Jobs
https://github.com/sndsh404/summer-2027-internships
```

Use these as discovery feeds, not as authoritative truth.

For each role:

1. preserve the source repository and source row;
2. follow the application link;
3. resolve the canonical employer/ATS URL;
4. confirm the role is still open;
5. fetch the employer job description;
6. deduplicate before scoring.

Do not copy repository content into a redistributed database without reviewing its license and terms. For private personal ingestion, store only the normalized role records needed for the user's workflow.

## 5.6 Public ATS APIs

### Greenhouse Job Board API

Documentation:

```text
https://developer.greenhouse.io/job-board.html
```

Public GET endpoints do not require authentication and may return:

- job IDs;
- descriptions;
- offices;
- departments;
- application questions.

Important constraint:

- application submission endpoints require employer-side API credentials and are not intended for an applicant automation tool;
- InternshipOps must use the employer-hosted application form and stop before manual Submit.

### Lever Postings API

Documentation:

```text
https://github.com/lever/postings-api
```

Use public published-posting endpoints for discovery and metadata.

Do not use programmatic application submission because it requires an employer API key and does not expose every custom question.

### Ashby Public Job Posting API

Documentation:

```text
https://developers.ashbyhq.com/docs/public-job-posting-api
```

Use the public API for current published roles and metadata.

For application preparation, use the hosted form in Chromium. Do not rely on employer-authenticated application submission APIs.

## 5.7 Playwright

Documentation:

```text
https://playwright.dev/docs/
https://playwright.dev/docs/api/class-browsercontext
https://playwright.dev/docs/docker
```

Use:

- BrowserContext isolation;
- persistent profiles;
- storage-state snapshots;
- role/label-based locators;
- network event monitoring;
- screenshots and traces;
- deterministic field filling.

Important:

- storage state preserves cookies, local storage, and IndexedDB;
- it does not preserve arbitrary unsaved text typed into ordinary input fields;
- therefore InternshipOps requires replay packages in addition to browser storage state.

## 5.8 noVNC and websockify

Repositories:

```text
https://github.com/novnc/noVNC
https://github.com/novnc/websockify
```

Use for private browser review inside Tailscale.

Do not expose noVNC ports to the public Internet.

## 5.9 Tailscale

Documentation:

```text
https://tailscale.com/docs/install/linux
https://tailscale.com/docs/features/tailscale-serve
https://tailscale.com/docs/features/access-control/auth-keys
```

Use:

- private tailnet connectivity;
- MagicDNS;
- HTTPS through Tailscale Serve;
- optional Tailscale SSH.

Do not enable Tailscale Funnel.

## 5.10 Gmail API

Documentation:

```text
https://developers.google.com/workspace/gmail/api/guides/drafts
https://developers.google.com/workspace/gmail/api/guides/sending
https://developers.google.com/workspace/gmail/api/guides/push
```

Use:

- draft creation;
- draft updates;
- mailbox history reconciliation;
- optional push notifications in a later phase.

Default behavior:

- create draft;
- never call `drafts.send`;
- user sends from Gmail manually.

## 5.11 Terraform and OCI

Documentation:

```text
https://registry.terraform.io/providers/oracle/oci/latest/docs
https://docs.oracle.com/en-us/iaas/Content/dev/terraform/configuring.htm
https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
```

Use the official OCI provider and pin a reviewed provider version.

As of the research date, the official registry listed OCI provider `8.23.0`. Claude must verify the current stable version before implementation and update the lock file intentionally.

---
