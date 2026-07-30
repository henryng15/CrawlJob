# InternshipOps
## Cloud-Hosted, Human-in-the-Loop SWE Internship Application and Recruiter Outreach System

**Document type:** Product Requirements Document, System Design, Infrastructure Plan, Implementation Runbook, and Claude Code Build Specification  
**Target user:** One private user applying to U.S. software engineering internships  
**Primary deployment target:** Oracle Cloud Infrastructure (OCI) Always Free, Ampere A1  
**Primary access model:** Private Tailscale network; no custom domain required  
**Research date:** July 28, 2026  
**Project codename:** `internship-ops`  
**Recommended repository visibility:** Private  

---

# 0. Instructions to Claude Code

This document is the source of truth for building the project.

Claude Code must:

1. Read this entire document before modifying code.
2. Create and maintain a root-level `CLAUDE.md` that summarizes:
   - architecture;
   - commands;
   - repository conventions;
   - locked safety rules;
   - current milestone;
   - known limitations.
3. Implement the system milestone by milestone.
4. Stop and report clearly when a task requires:
   - the user's OCI credentials;
   - a Tailscale login;
   - Gmail OAuth authorization;
   - an API key;
   - a manual ATS login;
   - a legal or work-authorization answer from the user.
5. Never implement automatic application submission in the default product.
6. Never implement automatic cold-email sending in the default product.
7. Never bypass, outsource, or defeat CAPTCHA, bot detection, rate limits, account security checks, or platform access controls.
8. Never change, soften, reinterpret, or fabricate:
   - work authorization;
   - sponsorship requirements;
   - immigration status;
   - citizenship;
   - graduation date;
   - GPA;
   - employment history;
   - demographic answers;
   - disability or veteran answers;
   - export-control eligibility.
9. Treat AI-generated text as untrusted until it passes deterministic validation.
10. Preserve every tailored resume version and the exact version uploaded to each application.
11. Make every background task idempotent.
12. Add tests before adding a new ATS adapter.
13. Prefer official public ATS job-posting APIs over scraping.
14. Keep all app and browser-review ports private. The application must not be publicly reachable.
15. Do not place secrets in:
   - Git;
   - Docker images;
   - Terraform variables committed to Git;
   - Terraform outputs;
   - Terraform state;
   - logs;
   - screenshots;
   - error-reporting payloads.
16. When uncertain, fail closed and put the item into a manual-review queue.

The system should optimize for **time saved without sacrificing truthfulness, control, security, or application quality**.

---

# 1. Executive Summary

InternshipOps is a private web application that prepares U.S. software engineering internship applications and recruiter outreach while keeping the user in control of the final actions.

The system should:

1. Discover U.S. SWE internship openings from curated internship repositories and public ATS job feeds.
2. Normalize and deduplicate roles before doing expensive work.
3. Analyze each job description for:
   - SWE-intern relevance;
   - graduation-year fit;
   - location;
   - employment term;
   - sponsorship language;
   - work-authorization restrictions;
   - role requirements;
   - application deadline when present.
4. Score jobs against the user's profile.
5. Generate and preserve a tailored resume for eligible jobs.
6. Open the application in a cloud-hosted Chromium browser.
7. Fill all fields that can be answered safely.
8. Stop before the final Submit action.
9. Place the application into a private review queue.
10. Allow the user to open a link to:
    - a still-live browser session when available; or
    - a rapidly reconstructed session using saved answers and login state.
11. Detect a successful manual submission.
12. Wait two business days.
13. Match an appropriate recruiter from the user's recruiter database.
14. Generate a source-grounded company/job hook.
15. Create a Gmail draft.
16. Let the user review and manually send the email.
17. Track replies and prevent duplicate or excessive outreach.

The expected operating volume is:

- up to **10 prepared applications per day**;
- up to **2 concurrent browser workers**;
- up to **2 live review sessions** on the free 12 GB RAM VM;
- the remaining applications stored as replayable review packages;
- initially **2–3 recruiter drafts per day**, later capped at **5 per day**.

---

# 2. Product Principles

## 2.1 Human-in-the-loop at irreversible actions

The system may prepare, prefill, and draft, but the user performs:

- final application submission;
- final cold-email sending;
- answers requiring personal judgment;
- CAPTCHA and account-security checks;
- ambiguous work-authorization decisions;
- any application that conflicts with the user's stored facts.

## 2.2 Candidate truth overrides job-description preferences

The job description may indicate that sponsorship is unavailable. That is a reason to:

- skip;
- deprioritize;
- or manually review the job.

It is **never** a reason to answer a sponsorship question untruthfully.

The system must separately store:

1. **Candidate facts** — immutable truth supplied by the user.
2. **Employer policy evidence** — extracted from the job description.
3. **Application recommendation** — continue, skip, or manual review.

## 2.3 Prepare asynchronously; review in batches

The user should not have to watch a browser fill a form from the beginning.

The normal experience is:

1. cloud workers prepare applications;
2. the user returns later;
3. the dashboard shows what is ready;
4. the user opens each item;
5. the user reviews unresolved fields and submits.

## 2.4 Evidence over invention

Every material AI conclusion should have evidence:

- sponsorship classification → quoted JD excerpt;
- job-fit score → explicit reasons;
- company hook → source URL and source excerpt;
- tailored resume statement → linked candidate fact IDs;
- form answer → source classification and confidence.

## 2.5 Private by default

The system contains highly sensitive information:

- legal name;
- address;
- phone;
- resume;
- employment history;
- work authorization;
- recruiter emails;
- application answers.

Therefore:

- no public dashboard;
- no public VNC;
- no public database;
- no public API;
- no tracking pixels in recruiter email;
- no third-party analytics in the web app.

---

# 3. Goals and Non-Goals

## 3.1 Goals

### G1. Reduce repetitive application work

The user should spend time reviewing rather than repeatedly typing:

- contact details;
- education;
- work history;
- portfolio links;
- common eligibility answers;
- common voluntary EEO answers;
- resume uploads.

### G2. Prepare up to 10 applications daily

The system should prepare a daily queue of up to 10 high-fit, nonduplicate U.S. SWE internship applications.

### G3. Preserve review control

The system must stop before Submit and present:

- all answers;
- unresolved fields;
- sponsorship evidence;
- tailored resume;
- resume change summary;
- application URL;
- screenshots;
- confidence flags.

### G4. Connect applications to outreach

After confirmed submission, the system should schedule a recruiter email draft for two business days later.

### G5. Prevent duplicates

The system must prevent:

- applying twice to the same requisition;
- creating multiple drafts for the same recruiter and role;
- contacting several recruiters at one company in a short period;
- follow-ups after a reply;
- reprocessing the same source listing.

### G6. Run when the laptop is off

Discovery, scoring, tailoring, prefilling, scheduling, reconciliation, and draft creation must run on OCI.

### G7. Keep operating cost low

Target recurring infrastructure cost:

- **$0** when OCI Always Free capacity remains available;
- **$0** for Tailscale Personal;
- **$0** for Gmail API at this personal volume;
- variable LLM cost with a configurable monthly cap.

## 3.2 Non-Goals for MVP

The MVP will not:

- auto-click final application Submit;
- auto-send cold emails;
- bypass CAPTCHA;
- automate LinkedIn account activity;
- scrape private LinkedIn profile data;
- impersonate the user in recruiter conversations;
- guarantee support for every Workday tenant;
- maintain ten live browser sessions simultaneously;
- support multiple users;
- become a commercial SaaS;
- infer immigration advice;
- fabricate personalized recruiter facts;
- submit applications through employer-only ATS APIs requiring employer credentials.

---

# 4. Key Product Decisions

| Area | Decision |
|---|---|
| Deployment | One OCI Ampere A1 VM in the tenancy home region |
| Compute target | 2 OCPU, 12 GB RAM |
| Storage | 50 GB boot volume + 100 GB data block volume |
| Private access | Tailscale + Tailscale Serve |
| Domain | Not required |
| Web stack | FastAPI + Jinja2 + HTMX + Alpine.js |
| Database | PostgreSQL 16 |
| Queue | PostgreSQL-backed durable task queue |
| Browser automation | Playwright |
| Remote review | Chromium + Xvfb + x11vnc + noVNC/websockify |
| Live browser capacity | 2 fixed browser slots |
| Daily application capacity | 10 prepared applications |
| Session fallback | Semantic replay package |
| Initial ATS adapters | Greenhouse, Lever, Ashby |
| Workday | Phase 2 after core system is stable |
| LinkedIn Easy Apply | Excluded from MVP |
| Discovery | Curated 2027 repos + public ATS feeds |
| AI runtime | Provider abstraction; Anthropic API default |
| Email | Gmail API drafts only |
| Cold-email delay | Two business days after confirmed application |
| Public analytics | None |
| IaC | Terraform with the official OCI provider |
| Runtime deployment | Docker Compose |
| Backups | Nightly encrypted backup to OCI Object Storage |

---

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

# 6. User Journeys

## 6.1 Daily application preparation

```mermaid
sequenceDiagram
    participant S as Scheduler
    participant D as Discovery
    participant DB as PostgreSQL
    participant AI as LLM
    participant R as Resume Service
    participant B as Browser Manager
    participant U as User

    S->>D: Start daily discovery
    D->>DB: Insert normalized source records
    DB->>DB: Exact and probable dedupe
    DB->>AI: Analyze sponsorship and fit
    AI->>DB: Evidence-grounded structured result
    DB->>R: Tailor top eligible jobs
    R->>DB: Store immutable resume artifacts
    DB->>B: Queue up to 10 application preparations
    B->>DB: Store field answers and screenshots
    B->>DB: Mark READY_FOR_REVIEW or READY_FOR_REPLAY
    U->>DB: Open dashboard later
```

## 6.2 Review and submit

```mermaid
sequenceDiagram
    participant U as User
    participant W as Web App
    participant B as Browser Slot
    participant ATS as Employer ATS
    participant DB as PostgreSQL

    U->>W: Click Open Filled Application
    W->>DB: Request review session
    alt live session exists
        W->>B: Return existing noVNC route
    else replay required
        W->>B: Allocate free slot
        B->>ATS: Restore login state and open form
        B->>ATS: Replay stored answers
        B->>DB: Mark LIVE_REVIEW_READY
        W-->>U: Show ready link
    end
    U->>B: Review and edit
    U->>ATS: Click Submit
    B->>ATS: Observe URL, DOM, and network
    B->>DB: Save confirmation and applied_at
```

## 6.3 Recruiter outreach

```mermaid
sequenceDiagram
    participant S as Scheduler
    participant DB as PostgreSQL
    participant AI as LLM
    participant G as Gmail API
    participant U as User

    S->>DB: Find submissions older than 2 business days
    DB->>DB: Match eligible recruiter
    DB->>AI: Generate evidence-grounded hook and email
    AI->>DB: Return structured draft and citations
    DB->>G: Create Gmail draft
    G->>DB: Return stable draft ID
    DB-->>U: Show Email Ready for Review
    U->>G: Review and manually send
    S->>G: Reconcile sent message or reply
    G->>DB: Update SENT or REPLIED
```

---

# 7. Functional Requirements

## 7.1 Candidate profile

The profile must store:

- legal name;
- preferred name;
- email;
- phone;
- address;
- LinkedIn;
- GitHub;
- portfolio;
- school;
- degree;
- major;
- graduation month/year;
- GPA and display policy;
- employment history;
- projects;
- skills;
- work authorization;
- sponsorship requirements;
- location preferences;
- internship terms;
- EEO defaults;
- compensation preference;
- source-of-truth resume facts.

Every field must have:

- a stable fact ID;
- value;
- sensitivity class;
- locked/unlocked status;
- verification timestamp;
- optional evidence;
- allowed transformation policy.

Example:

```yaml
candidate:
  legal_name:
    value: "Viet Hoan Nguyen"
    locked: true
    sensitivity: restricted
  preferred_name:
    value: "Henry"
    locked: true
    sensitivity: personal
  graduation_date:
    value: "2028-05"
    locked: true
    sensitivity: personal

work_authorization:
  currently_authorized_in_us:
    value: true
    locked: true
  requires_future_sponsorship:
    value: true
    locked: true
  explanation:
    value: "User-supplied statement goes here."
    locked: true
```

The real values must be confirmed by the user. Example values in this document are not legal advice.

## 7.2 Discovery

The system must support pluggable source adapters:

- `GithubMarkdownFeedAdapter`;
- `GreenhouseBoardAdapter`;
- `LeverBoardAdapter`;
- `AshbyBoardAdapter`;
- optional `JobSpyAdapter`, disabled by default;
- manual URL import.

Every source result must record:

- source type;
- source URL;
- source external ID;
- fetched timestamp;
- raw title;
- raw company;
- raw location;
- raw application URL;
- normalized result;
- content hash.

## 7.3 Eligibility filter

Default hard filters:

- country: United States;
- employment type: internship;
- target function:
  - software engineering;
  - backend;
  - full stack;
  - platform;
  - infrastructure;
  - developer tools;
  - data engineering when sufficiently software-focused;
- exclude:
  - senior;
  - staff;
  - principal;
  - manager;
  - director;
  - mandatory graduate-degree roles when user is ineligible;
  - roles closed or unavailable;
  - duplicate requisitions.

Configurable soft filters:

- remote/hybrid/onsite;
- location;
- technology;
- company type;
- role age;
- sponsorship preference;
- application effort;
- fit score.

## 7.4 Deduplication

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

## 7.5 Sponsorship analysis

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

## 7.6 Job scoring

Score components:

| Component | Weight |
|---|---:|
| Internship/level fit | 20 |
| Core SWE relevance | 20 |
| Skills overlap | 15 |
| Project/experience relevance | 15 |
| Graduation eligibility | 10 |
| Location fit | 5 |
| Sponsorship compatibility | 10 |
| Application freshness | 5 |

The deterministic filter runs before the AI score.

The LLM must return structured output and cite profile fact IDs.

Do not allow a high AI score to override a hard ineligibility rule.

## 7.7 Resume tailoring

The resume system must consist of:

1. **Facts registry**
2. **Resume template**
3. **Tailoring plan**
4. **Validation**
5. **Rendering**
6. **Immutable artifact storage**

Allowed changes:

- reorder existing bullets;
- select relevant experiences/projects;
- shorten wording;
- emphasize relevant technologies;
- use JD keywords when factually supported;
- adjust summary only when all claims map to candidate facts.

Disallowed changes:

- new employers;
- new projects;
- new metrics;
- inflated ownership;
- fabricated users or scale;
- fabricated technologies;
- fabricated dates;
- altered title;
- altered GPA;
- altered graduation date.

Every generated bullet must include provenance:

```json
{
  "text": "Implemented ...",
  "fact_ids": ["experience.todd.3", "skill.fastapi"],
  "transformation": "rewrite",
  "validation": "passed"
}
```

Artifacts per job:

```text
/data/artifacts/applications/{application_id}/
├── job-description.html
├── job-description.txt
├── sponsorship-analysis.json
├── fit-score.json
├── resume-plan.json
├── resume-source.html
├── resume-tailored.pdf
├── resume-diff.json
├── resume-validation.json
└── sha256sums.txt
```

The application record must point to the exact `resume_version_id` uploaded.

## 7.8 Browser preparation

The system must:

1. allocate a browser slot;
2. launch or restore the correct browser profile;
3. navigate to the canonical application URL;
4. detect ATS type;
5. map form fields;
6. fill deterministic fields;
7. draft safe free-text fields;
8. upload the tailored resume;
9. identify unresolved/manual fields;
10. take a screenshot;
11. save a replay package;
12. stop before Submit.

Field source types:

```text
LOCKED_FACT
PROFILE_FACT
DERIVED_DETERMINISTIC
AI_DRAFT
USER_OVERRIDE
MANUAL_REQUIRED
UNRESOLVED
```

Fields that must default to manual or locked answers:

- sponsorship;
- work authorization;
- citizenship;
- export control;
- criminal-history questions;
- disability;
- veteran status;
- race/ethnicity;
- gender;
- salary;
- relocation commitment;
- noncompete/conflict questions;
- attestation;
- electronic signature;
- “I certify” checkboxes.

The system may prefill a user-configured locked EEO preference, but it must never infer one.

## 7.9 Review queue

Each card must show:

- company;
- role;
- location;
- source;
- fit score;
- sponsorship classification;
- sponsorship evidence;
- resume version;
- completed field count;
- manual field count;
- session state;
- session expiration;
- application age;
- actions.

Actions:

```text
Open Filled Application
Prepare Replay Now
View All Answers
View Tailored Resume
Compare Resume
Mark Submitted
Skip
Discard
Report Incorrect Field
```

## 7.10 Submission detection

The browser worker must monitor:

1. URL changes;
2. success-text patterns;
3. DOM replacement;
4. form disappearance;
5. network responses associated with submission;
6. known ATS confirmation patterns.

A positive automatic confirmation should require at least:

- one strong signal; or
- two medium signals.

Strong signals:

- known confirmation URL;
- explicit “application submitted” confirmation element;
- successful known application-submit network request plus confirmation DOM.

Medium signals:

- submit button disappears;
- application form is replaced;
- “thank you” text appears;
- page title changes.

Fallbacks:

- manual `Mark Submitted`;
- Gmail confirmation reconciliation.

Store:

- `submitted_at`;
- detection method;
- confirmation URL;
- confirmation text;
- screenshot;
- relevant response metadata;
- confidence.

Never store sensitive request bodies in logs.

## 7.11 Replay package

A replay package must contain:

```json
{
  "application_id": "uuid",
  "application_url": "https://...",
  "ats_type": "GREENHOUSE",
  "storage_state_path": "...",
  "resume_artifact_path": "...",
  "fields": [
    {
      "semantic_key": "candidate.first_name",
      "label": "First name",
      "field_type": "text",
      "value_ref": "candidate.legal_first_name",
      "source_type": "LOCKED_FACT",
      "required": true,
      "last_locator_strategy": {
        "role": "textbox",
        "label": "First name"
      }
    }
  ],
  "manual_fields": [],
  "page_fingerprint": "...",
  "created_at": "..."
}
```

Replay must prioritize semantic matching:

1. accessible label;
2. ARIA role/name;
3. HTML `name`;
4. associated label;
5. nearby question text;
6. stable ATS-specific attributes;
7. CSS selector only as last fallback.

If the page fingerprint changed materially, stop and request manual review.

## 7.12 Recruiter import and matching

Input columns currently available:

```text
name
company
email
```

Optional future columns:

```text
title
linkedin_url
location
team
source
verified_at
notes
```

Importer requirements:

- CSV and XLSX support;
- email syntax validation;
- lowercase email;
- company normalization;
- duplicate merge;
- preview before commit;
- import report;
- no emails sent during import.

Recruiter match order:

1. exact normalized company;
2. email domain equals company domain;
3. approved company alias;
4. fuzzy company match requiring confidence threshold;
5. manual selection.

When multiple recruiters match:

1. prefer titles containing:
   - university;
   - campus;
   - early career;
   - technical recruiter;
   - software;
2. prefer recruiter not contacted recently;
3. select only one recruiter by default;
4. require manual selection when confidence is low.

## 7.13 Cold-email hook generation

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

## 7.14 Gmail drafts

The system must use Gmail OAuth and `drafts.create`.

It must not call:

```text
drafts.send
messages.send
```

Email-draft record:

- application ID;
- recruiter ID;
- Gmail draft ID;
- subject;
- body;
- source links;
- created timestamp;
- scheduled timestamp;
- sent timestamp;
- reply timestamp;
- status.

After the user sends manually, reconciliation may detect:

- draft deleted;
- SENT message with matching headers/thread;
- reply in the thread.

Manual confirmation must remain available.

---

# 8. Email Safety and Anti-Spam Policy

The system is a personalized outreach assistant, not a bulk sender.

## 8.1 Default limits

```yaml
outreach:
  enabled: true
  initial_daily_draft_limit: 3
  maximum_daily_draft_limit: 5
  minimum_days_after_application: 2
  use_business_days: true
  allowed_weekdays: [MON, TUE, WED, THU, FRI]
  allowed_time_window_et:
    start: "09:30"
    end: "15:30"
  maximum_recruiters_per_application: 1
  maximum_recruiters_per_company_30d: 2
  recruiter_cooldown_days: 30
  maximum_followups: 1
  followup_business_days: 6
```

## 8.2 Suppression rules

Do not create another draft when:

- recruiter replied;
- recruiter bounced;
- recruiter asked not to be contacted;
- same recruiter and same role already contacted;
- same email appears on suppression list;
- same company hit its 30-day cap;
- application was withdrawn;
- application is not confirmed submitted;
- the user marked outreach as inappropriate;
- the recruiter email is unverified or malformed.

## 8.3 Content rules

- plain text or simple HTML;
- no tracking pixel;
- no hidden links;
- no misleading subject;
- no fake referral;
- no fake mutual connection;
- no unsupported personal fact;
- one clear ask;
- short body;
- include the role and company;
- do not claim an application was submitted unless confirmed.

## 8.4 Follow-up rules

- at most one follow-up;
- only after 5–7 business days;
- cancel immediately if a reply is detected;
- never follow up after bounce or opt-out;
- follow-up must remain a Gmail draft requiring manual send.

---

# 9. Non-Functional Requirements

## 9.1 Reliability

- all tasks idempotent;
- durable state in PostgreSQL;
- restart-safe workers;
- no duplicate task execution after crash;
- browser slot heartbeat;
- stale-lock recovery;
- daily reconciliation;
- retry with exponential backoff for transient errors;
- no unbounded retry loops.

## 9.2 Performance

Target on OCI A1:

- dashboard response: under 500 ms for normal pages;
- daily discovery: under 30 minutes;
- resume generation: under 90 seconds per selected job, excluding API delays;
- browser form preparation: under 5 minutes per supported ATS;
- replay: target under 60 seconds;
- maximum two browser preparations concurrently.

## 9.3 Capacity

- 10 prepared applications/day;
- 2 live sessions;
- 100 recruiters initially;
- 10,000 stored job records;
- 2 years of application history;
- 20 GB maximum backup footprint in OCI Object Storage.

## 9.4 Security

- no public application ports;
- Tailscale-only access;
- app-level authorization;
- secrets encrypted or permission-restricted;
- PII removed from logs;
- database backups encrypted;
- signed session links;
- browser sessions scoped to one application;
- CSRF protection;
- secure cookies;
- content security policy;
- no remote code execution from job-page content.

## 9.5 Maintainability

- typed Python;
- migrations;
- adapter interface;
- fixture-driven ATS tests;
- structured logging;
- documented commands;
- lint and test in CI;
- architecture decision records.

---

# 10. System Architecture

## 10.1 Logical architecture

```mermaid
flowchart TB
    User[User Laptop or Phone]
    Tail[Tailscale Tailnet]
    Serve[Tailscale Serve HTTPS]
    Proxy[Caddy Internal Reverse Proxy]
    Web[FastAPI Web App]
    Worker[Durable Worker]
    DB[(PostgreSQL)]
    Slot1[Browser Slot 1]
    Slot2[Browser Slot 2]
    Files[(Data Volume)]
    Gmail[Gmail API]
    LLM[LLM Provider]
    Sources[Job Sources]
    Backup[OCI Object Storage]

    User --> Tail --> Serve --> Proxy
    Proxy --> Web
    Proxy --> Slot1
    Proxy --> Slot2
    Web --> DB
    Worker --> DB
    Worker --> Slot1
    Worker --> Slot2
    Worker --> Files
    Worker --> Gmail
    Worker --> LLM
    Worker --> Sources
    Worker --> Backup
```

## 10.2 Deployment architecture

One OCI VM runs:

```text
Host OS
├── tailscaled
├── Docker Engine
├── Docker Compose
└── /data mounted block volume
    ├── postgres/
    ├── artifacts/
    ├── browser-profiles/
    ├── browser-sessions/
    ├── backups/
    └── logs/
```

Docker services:

```text
caddy
web
worker
postgres
browser-slot-1
browser-slot-2
```

Optional development-only services:

```text
mailpit
fake-ats
```

## 10.3 Why fixed browser slots

A dynamic container-per-application architecture is flexible but unnecessarily complex for one user.

Two fixed slots provide:

- predictable RAM use;
- fixed internal ports;
- simple noVNC routing;
- easier health checks;
- fewer orphan containers;
- persistent browser profiles;
- straightforward replay.

The queue may hold 10 applications, but only two occupy live browser slots.

---

# 11. Recommended Technology Stack

## 11.1 Backend and UI

```text
Python 3.12
FastAPI
Pydantic v2
SQLAlchemy 2
Alembic
Jinja2
HTMX
Alpine.js
Tailwind CSS
```

Rationale:

- one-language backend;
- low RAM;
- fast development;
- server-rendered pages are sufficient for a private dashboard;
- HTMX supports live status without a separate SPA;
- easier for Claude Code to maintain than a split Next.js/FastAPI architecture.

## 11.2 Database

```text
PostgreSQL 16
```

Use PostgreSQL instead of SQLite because:

- multiple workers;
- durable task locking;
- JSONB;
- partial unique indexes;
- `FOR UPDATE SKIP LOCKED`;
- better recovery and backup tooling.

## 11.3 Durable task queue

Do not add Redis or Celery in MVP.

Use PostgreSQL tables:

- `scheduled_tasks`;
- `task_runs`;
- `task_locks`.

Worker pattern:

```sql
SELECT id
FROM scheduled_tasks
WHERE status = 'PENDING'
  AND run_at <= NOW()
ORDER BY priority DESC, run_at ASC
FOR UPDATE SKIP LOCKED
LIMIT 1;
```

Then atomically mark the task `RUNNING`.

This is sufficient for:

- one VM;
- two workers;
- low volume;
- delayed outreach;
- retry;
- auditability.

## 11.4 Browser

```text
Playwright
Chromium
Xvfb
Openbox or Fluxbox
x11vnc
noVNC
websockify
```

### ARM64 compatibility requirement

OCI Ampere A1 is ARM-based.

Before building the full system, Claude must complete an architecture spike that proves:

1. Chromium launches on the selected Ubuntu ARM64 image.
2. Playwright connects and fills a local fixture form.
3. Xvfb renders Chromium.
4. x11vnc exposes the display.
5. noVNC is reachable through Caddy and Tailscale.
6. file upload works.
7. PDF download works.
8. two slots can run without memory failure.

Do not assume an upstream Docker image is multi-architecture. Prefer a custom Docker image based on a Debian/Ubuntu ARM64 base and install browser dependencies explicitly. If Playwright-managed Chromium is unavailable for the selected combination, use the distribution Chromium binary through Playwright's `executable_path`, after validating compatibility.

## 11.5 PDF resume rendering

> **Superseded by [ADR 0001](adr/0001-latex-resume-rendering.md).** The
> production path is the user's own LaTeX source compiled with `pdflatex`, not an
> HTML template. WeasyPrint was implemented, then removed: rendering extracted
> facts through a generic template produces a correct document that is not the
> user's resume, which contradicts §7.7's requirement to preserve their template,
> layout, fonts, section order and spacing. Every requirement listed below is
> still met — see the ADR for the point-by-point mapping. Do not reintroduce an
> HTML renderer for application tailoring.

Originally recommended:

```text
Structured YAML/JSON facts
Jinja2 HTML template
WeasyPrint PDF rendering
```

Requirements:

- selectable text;
- embedded standard fonts;
- ATS-readable single-column layout;
- no image-only PDF;
- stable page count;
- deterministic rendering.

Keep the user’s original PDF as the base artifact even if the structured template is reconstructed.

## 11.6 AI provider

Create a provider interface:

```python
class LLMProvider(Protocol):
    async def structured_generate(
        self,
        task: str,
        schema: type[BaseModel],
        messages: list[Message],
        *,
        model: str,
        max_tokens: int,
    ) -> BaseModel: ...
```

Default task routing:

| Task | Default model class |
|---|---|
| JD extraction | deterministic parser first; Haiku fallback |
| Sponsorship classification | Haiku |
| Job scoring | Haiku |
| Resume tailoring plan | Sonnet |
| Form free-text draft | Haiku or Sonnet depending complexity |
| Email hook | Haiku |
| Email body | Haiku |
| Validation | deterministic + separate Haiku check |

Do not run Claude Code as the production automation engine. Claude Code is used to build the software; the runtime uses APIs and deterministic code.

---

# 12. Data Model

Use UUID primary keys and UTC timestamps.

## 12.1 Core tables

### `candidate_facts`

```sql
CREATE TABLE candidate_facts (
    id UUID PRIMARY KEY,
    fact_key TEXT NOT NULL UNIQUE,
    value_json JSONB NOT NULL,
    data_type TEXT NOT NULL,
    sensitivity TEXT NOT NULL,
    is_locked BOOLEAN NOT NULL DEFAULT TRUE,
    source TEXT NOT NULL,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `companies`

```sql
CREATE TABLE companies (
    id UUID PRIMARY KEY,
    canonical_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE,
    domain TEXT,
    aliases JSONB NOT NULL DEFAULT '[]',
    ats_types JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `job_source_records`

```sql
CREATE TABLE job_source_records (
    id UUID PRIMARY KEY,
    source_type TEXT NOT NULL,
    source_name TEXT NOT NULL,
    external_id TEXT,
    source_url TEXT NOT NULL,
    raw_payload JSONB NOT NULL,
    content_hash TEXT NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL,
    UNIQUE(source_type, source_name, external_id, content_hash)
);
```

### `jobs`

```sql
CREATE TABLE jobs (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id),
    canonical_url TEXT NOT NULL,
    canonical_url_hash TEXT NOT NULL,
    ats_type TEXT,
    ats_board_id TEXT,
    requisition_id TEXT,
    title TEXT NOT NULL,
    normalized_title TEXT NOT NULL,
    location_text TEXT,
    normalized_location TEXT,
    country_code TEXT,
    employment_type TEXT,
    season TEXT,
    description_html TEXT,
    description_text TEXT,
    description_hash TEXT,
    posted_at TIMESTAMPTZ,
    discovered_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ,
    dedupe_fingerprint TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Recommended unique indexes:

```sql
CREATE UNIQUE INDEX uq_job_ats_requisition
ON jobs (ats_type, ats_board_id, requisition_id)
WHERE requisition_id IS NOT NULL;

CREATE UNIQUE INDEX uq_job_url
ON jobs (canonical_url_hash);

CREATE UNIQUE INDEX uq_job_fingerprint
ON jobs (dedupe_fingerprint)
WHERE status <> 'DUPLICATE_PROBABLE';
```

### `job_source_links`

```sql
CREATE TABLE job_source_links (
    job_id UUID NOT NULL REFERENCES jobs(id),
    source_record_id UUID NOT NULL REFERENCES job_source_records(id),
    PRIMARY KEY (job_id, source_record_id)
);
```

### `sponsorship_assessments`

```sql
CREATE TABLE sponsorship_assessments (
    id UUID PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES jobs(id),
    classification TEXT NOT NULL,
    work_authorization_restriction TEXT NOT NULL,
    evidence JSONB NOT NULL,
    confidence NUMERIC(4,3) NOT NULL,
    recommended_action TEXT NOT NULL,
    model_name TEXT,
    prompt_version TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(job_id)
);
```

### `job_scores`

```sql
CREATE TABLE job_scores (
    id UUID PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES jobs(id),
    total_score NUMERIC(5,2) NOT NULL,
    components JSONB NOT NULL,
    hard_filter_result TEXT NOT NULL,
    fact_references JSONB NOT NULL,
    model_name TEXT,
    prompt_version TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(job_id)
);
```

### `resume_versions`

```sql
CREATE TABLE resume_versions (
    id UUID PRIMARY KEY,
    job_id UUID REFERENCES jobs(id),
    parent_resume_id UUID REFERENCES resume_versions(id),
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    source_path TEXT NOT NULL,
    pdf_path TEXT NOT NULL,
    diff_path TEXT,
    validation_path TEXT,
    sha256 TEXT NOT NULL,
    prompt_version TEXT,
    model_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `applications`

```sql
CREATE TABLE applications (
    id UUID PRIMARY KEY,
    job_id UUID NOT NULL UNIQUE REFERENCES jobs(id),
    resume_version_id UUID REFERENCES resume_versions(id),
    status TEXT NOT NULL,
    application_url TEXT NOT NULL,
    ats_type TEXT,
    browser_slot_id TEXT,
    ready_for_review_at TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ,
    submission_detection_method TEXT,
    submission_confidence NUMERIC(4,3),
    confirmation_data JSONB,
    outreach_due_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `application_fields`

```sql
CREATE TABLE application_fields (
    id UUID PRIMARY KEY,
    application_id UUID NOT NULL REFERENCES applications(id),
    semantic_key TEXT,
    page_index INTEGER NOT NULL DEFAULT 0,
    question_text TEXT NOT NULL,
    field_type TEXT NOT NULL,
    answer_json JSONB,
    source_type TEXT NOT NULL,
    source_fact_ids JSONB NOT NULL DEFAULT '[]',
    confidence NUMERIC(4,3),
    required BOOLEAN NOT NULL DEFAULT FALSE,
    manual_required BOOLEAN NOT NULL DEFAULT FALSE,
    user_overridden BOOLEAN NOT NULL DEFAULT FALSE,
    locator_strategy JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `browser_sessions`

```sql
CREATE TABLE browser_sessions (
    id UUID PRIMARY KEY,
    slot_name TEXT NOT NULL,
    application_id UUID REFERENCES applications(id),
    status TEXT NOT NULL,
    review_token_hash TEXT,
    profile_path TEXT,
    storage_state_path TEXT,
    replay_package_path TEXT,
    heartbeat_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    error_summary TEXT
);
```

### `recruiters`

```sql
CREATE TABLE recruiters (
    id UUID PRIMARY KEY,
    full_name TEXT NOT NULL,
    company_id UUID REFERENCES companies(id),
    raw_company TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    email_domain TEXT,
    title TEXT,
    linkedin_url TEXT,
    location TEXT,
    source TEXT,
    verified_at TIMESTAMPTZ,
    last_contacted_at TIMESTAMPTZ,
    replied_at TIMESTAMPTZ,
    do_not_contact BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `outreach_tasks`

```sql
CREATE TABLE outreach_tasks (
    id UUID PRIMARY KEY,
    application_id UUID NOT NULL REFERENCES applications(id),
    recruiter_id UUID REFERENCES recruiters(id),
    status TEXT NOT NULL,
    due_at TIMESTAMPTZ NOT NULL,
    hook_json JSONB,
    subject TEXT,
    body TEXT,
    gmail_draft_id TEXT,
    gmail_message_id TEXT,
    gmail_thread_id TEXT,
    sent_at TIMESTAMPTZ,
    replied_at TIMESTAMPTZ,
    followup_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(application_id)
);
```

### `suppression_entries`

```sql
CREATE TABLE suppression_entries (
    id UUID PRIMARY KEY,
    email TEXT,
    company_id UUID REFERENCES companies(id),
    reason TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `scheduled_tasks`

```sql
CREATE TABLE scheduled_tasks (
    id UUID PRIMARY KEY,
    task_type TEXT NOT NULL,
    dedupe_key TEXT NOT NULL UNIQUE,
    payload JSONB NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    run_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    locked_by TEXT,
    locked_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `audit_events`

```sql
CREATE TABLE audit_events (
    id UUID PRIMARY KEY,
    event_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    actor_type TEXT NOT NULL,
    actor_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Audit metadata must not contain raw secrets or unnecessary PII.

---

# 13. State Machines

## 13.1 Job state

```text
DISCOVERED
ENRICHED
DUPLICATE_EXACT
DUPLICATE_PROBABLE
ELIGIBILITY_REJECTED
SPONSORSHIP_REVIEW
SCORED
SELECTED
CLOSED
ARCHIVED
```

## 13.2 Application state

```text
CREATED
MATERIALS_PREPARING
MATERIALS_READY
BROWSER_QUEUED
BROWSER_FILLING
MANUAL_LOGIN_REQUIRED
MANUAL_FIELD_REQUIRED
READY_FOR_REVIEW
READY_FOR_REPLAY
REPLAYING
LIVE_REVIEW_READY
SUBMISSION_PENDING_CONFIRMATION
SUBMITTED
SUBMISSION_UNCERTAIN
FAILED
SKIPPED
WITHDRAWN
```

## 13.3 Outreach state

```text
NOT_ELIGIBLE
SCHEDULED
RECRUITER_MATCH_REQUIRED
HOOK_GENERATING
DRAFT_CREATING
READY_FOR_REVIEW
SENT
REPLIED
FOLLOWUP_DUE
CLOSED
SUPPRESSED
FAILED
```

## 13.4 Browser slot state

```text
IDLE
ALLOCATING
FILLING
LIVE_REVIEW
REPLAYING
MANUAL_LOGIN
CLEANING
UNHEALTHY
```

All transitions must be validated in a central state-transition module.

---

# 14. Application Adapters

## 14.1 Adapter interface

```python
class ATSAdapter(Protocol):
    ats_type: str

    async def detect(self, page: Page) -> bool: ...
    async def extract_form_schema(self, page: Page) -> FormSchema: ...
    async def fill(self, page: Page, answers: AnswerSet) -> FillResult: ...
    async def upload_resume(self, page: Page, path: Path) -> UploadResult: ...
    async def validate_before_review(self, page: Page) -> ValidationResult: ...
    async def observe_submission(self, page: Page) -> SubmissionObservation: ...
    async def create_replay_package(self, page: Page) -> ReplayPackage: ...
```

## 14.2 Greenhouse MVP adapter

Must support:

- embedded and hosted Greenhouse forms;
- personal info;
- links;
- resume upload;
- education;
- common custom questions;
- EEO section;
- multi-select questions;
- location/autocomplete;
- review stop before Submit.

Use public Job Board API when possible to obtain question labels before browser navigation.

## 14.3 Lever MVP adapter

Must support:

- hosted Lever form;
- name/contact;
- resume;
- links;
- free-text questions;
- checkbox and dropdown questions;
- multiple pages if present;
- stop before Submit.

## 14.4 Ashby MVP adapter

Must support:

- hosted Ashby form;
- structured job metadata;
- form sections;
- file upload;
- work authorization;
- custom questions;
- stop before Submit.

## 14.5 Workday Phase 2

Workday must not be added until:

- core state machine is stable;
- replay packages work;
- browser slot recovery is tested;
- Greenhouse/Lever/Ashby have fixture coverage.

Workday-specific requirements:

- tenant-specific account/profile handling;
- multi-page wizard;
- dynamic fields;
- repeated education/work-history sections;
- save-and-continue behavior;
- session expiration;
- possible email verification;
- application profile reuse;
- tenant adapter registry;
- manual-login queue.

## 14.6 Unsupported application behavior

For unsupported ATS or heavily customized form:

- collect page schema;
- fill only deterministic common fields;
- save screenshot;
- mark `MANUAL_FIELD_REQUIRED`;
- never guess or submit.

---

# 15. Browser Slot Design

## 15.1 Slot services

Each browser slot container contains:

```text
Xvfb display
Window manager
Chromium
Playwright control service
x11vnc
websockify
noVNC static client
health endpoint
```

Internal ports per slot:

| Purpose | Slot 1 | Slot 2 |
|---|---:|---:|
| Playwright control | 9221 | 9222 |
| noVNC | 6081 | 6082 |
| Health | 7081 | 7082 |

These ports must only exist on the Docker network.

## 15.2 Caddy routes

Example:

```caddyfile
:8080 {
    encode zstd gzip

    handle_path /review/slot-1/* {
        reverse_proxy browser-slot-1:6080
    }

    handle_path /review/slot-2/* {
        reverse_proxy browser-slot-2:6080
    }

    handle {
        reverse_proxy web:8000
    }
}
```

Caddy binds to host loopback only:

```yaml
ports:
  - "127.0.0.1:8080:8080"
```

Tailscale Serve exposes the loopback service privately:

```bash
tailscale serve --bg 8080
```

Do not use Tailscale Funnel.

## 15.3 Review authorization

A noVNC path must require:

- authenticated InternshipOps session;
- application-specific signed token;
- token expiry;
- application-to-slot match;
- CSRF-safe link generation.

Caddy alone is not enough. The web app should generate a short-lived review token and the browser-control service should validate it before proxying the noVNC page.

## 15.4 Session retention policy

```yaml
browser:
  worker_count: 2
  live_review_slots: 2
  maximum_review_queue: 10
  live_session_ttl_hours: 8
  maximum_session_ttl_hours: 24
  idle_live_session_minutes: 90
  replay_enabled: true
```

Retention order:

1. user-pinned session;
2. session currently open;
3. application with near-term deadline;
4. newest ready application;
5. oldest non-pinned session moves to replay.

## 15.5 Memory policy

The system should not promise all 10 applications are instantly live on OCI Free.

Default:

- 2 live sessions;
- 8 replay packages.

Add a memory watchdog:

- warn at 75% RAM;
- stop new browser allocation at 82%;
- move an idle session to replay at 85%;
- restart an unhealthy slot at 90%;
- never let the host enter swap thrashing.

Configure a small swap file for emergency recovery, not normal browser capacity.

---

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

# 17. OCI Infrastructure

## 17.1 Expected Always Free allocation

Use one Ampere A1 Flex instance in the OCI tenancy home region:

```text
2 OCPU
12 GB RAM
Ubuntu Always Free eligible image
50 GB boot volume
100 GB attached data volume
```

This leaves approximately 50 GB of the documented 200 GB combined Always Free block-volume allocation unused as safety headroom.

OCI documentation also describes:

- 20 GB Always Free Object Storage;
- five Always Free volume backups;
- potential reclamation of idle Always Free compute instances.

The system must therefore:

- keep off-instance backups;
- assume the VM can be replaced;
- never store the only copy of application history on the VM;
- monitor OCI notices;
- document a paid-VM migration path.

Do not artificially generate useless load to defeat idle-resource policies.

## 17.2 Network design

```text
VCN: 10.20.0.0/16
Public subnet: 10.20.10.0/24
Internet Gateway
Route 0.0.0.0/0 → Internet Gateway
Instance public IP for outbound/bootstrap
```

Ingress:

- TCP 22 only from `admin_cidr` during bootstrap;
- no public ingress to 8000, 8080, 6081, 6082, 5432, or browser ports.

After Tailscale SSH is verified, optionally set public SSH ingress to disabled.

Egress:

- HTTPS/HTTP;
- DNS;
- NTP;
- required package repositories and APIs.

## 17.3 Infrastructure repository layout

```text
infra/
└── terraform/
    ├── versions.tf
    ├── providers.tf
    ├── variables.tf
    ├── data.tf
    ├── network.tf
    ├── compute.tf
    ├── storage.tf
    ├── outputs.tf
    ├── cloud-init.yaml.tftpl
    ├── terraform.tfvars.example
    └── README.md
```

## 17.4 Terraform versions

Example:

```hcl
terraform {
  required_version = ">= 1.8.0"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "8.23.0"
    }
  }
}
```

Before implementation, verify the current stable provider and pin it intentionally.

Commit:

```text
.terraform.lock.hcl
```

Do not commit:

```text
terraform.tfstate
terraform.tfstate.backup
terraform.tfvars
.terraform/
OCI private keys
```

## 17.5 Provider configuration

Use OCI API key authentication from the developer machine.

Example:

```hcl
provider "oci" {
  tenancy_ocid     = var.tenancy_ocid
  user_ocid        = var.user_ocid
  fingerprint      = var.api_key_fingerprint
  private_key_path = var.api_private_key_path
  region           = var.region
}
```

Prefer environment variables or an uncommitted local `terraform.tfvars`.

## 17.6 Representative network resources

Claude should generate complete validated Terraform for:

```hcl
resource "oci_core_vcn" "main" { ... }
resource "oci_core_internet_gateway" "main" { ... }
resource "oci_core_route_table" "public" { ... }
resource "oci_core_security_list" "app" { ... }
resource "oci_core_subnet" "public" { ... }
```

Security-list requirements:

```hcl
ingress_security_rules {
  protocol = "6"
  source   = var.admin_cidr

  tcp_options {
    min = 22
    max = 22
  }
}
```

No application-port ingress rule is allowed.

## 17.7 Compute instance

Representative:

```hcl
resource "oci_core_instance" "app" {
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  compartment_id      = var.compartment_ocid
  display_name        = "internship-ops"
  shape               = "VM.Standard.A1.Flex"

  shape_config {
    ocpus         = 2
    memory_in_gbs = 12
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.public.id
    assign_public_ip = true
    hostname_label   = "internshipops"
  }

  source_details {
    source_type             = "image"
    source_id               = data.oci_core_images.ubuntu.images[0].id
    boot_volume_size_in_gbs = 50
  }

  metadata = {
    ssh_authorized_keys = trimspace(file(var.ssh_public_key_path))
    user_data = base64encode(
      templatefile("${path.module}/cloud-init.yaml.tftpl", {
        app_user = "internshipops"
      })
    )
  }

  freeform_tags = {
    Project = "internship-ops"
    Tier    = "personal"
  }
}
```

Image lookup must filter for:

- Ubuntu;
- an Always Free eligible release;
- AArch64/ARM;
- a supported OS version.

Do not hard-code a stale image OCID.

## 17.8 Data block volume

Create a 100 GB volume and attach it paravirtualized.

```hcl
resource "oci_core_volume" "data" {
  availability_domain = oci_core_instance.app.availability_domain
  compartment_id      = var.compartment_ocid
  display_name        = "internship-ops-data"
  size_in_gbs         = 100
}

resource "oci_core_volume_attachment" "data" {
  attachment_type = "paravirtualized"
  instance_id     = oci_core_instance.app.id
  volume_id       = oci_core_volume.data.id
}
```

The bootstrap script must:

1. identify the attached unformatted disk safely;
2. refuse to format if a filesystem exists;
3. format as ext4 only on first boot;
4. mount by filesystem UUID at `/data`;
5. write an `/etc/fstab` entry;
6. create app directories;
7. set ownership and permissions.

Never identify a disk solely by a guessed device name.

## 17.9 Terraform outputs

Allowed outputs:

- instance public IP;
- instance OCID;
- data volume OCID;
- SSH command template.

Sensitive outputs are prohibited.

## 17.10 Cloud-init responsibilities

Cloud-init should only:

- create application user;
- update packages;
- install baseline packages;
- install Docker;
- enable Docker;
- install Tailscale package;
- create directories;
- install fail2ban if public SSH remains enabled;
- configure host firewall;
- install a bootstrap placeholder.

Cloud-init must not contain:

- Tailscale auth key;
- Gmail token;
- Anthropic key;
- database password;
- app master key.

---

# 18. Post-Provision Setup

## 18.1 Local prerequisites

On the user's Windows machine with WSL:

```text
Git
Terraform
OCI CLI optional
OpenSSH
Tailscale client
Claude Code
```

## 18.2 OCI setup

1. Create OCI account.
2. Confirm the home region.
3. Create a compartment such as `internship-ops`.
4. Generate an OCI API signing key.
5. Upload the public key to OCI.
6. Record:
   - tenancy OCID;
   - user OCID;
   - compartment OCID;
   - region;
   - key fingerprint.
7. Generate an SSH key for the VM.

## 18.3 Apply infrastructure

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
# Fill only the local uncommitted file.

terraform init
terraform fmt -check
terraform validate
terraform plan -out=tfplan
terraform apply tfplan
```

## 18.4 Connect Tailscale

SSH to the VM using the restricted public-IP rule.

Install/connect:

```bash
sudo tailscale up --hostname=internship-ops --ssh
```

Use interactive login for the first deployment.

After Tailscale works:

1. verify Tailscale SSH;
2. verify MagicDNS;
3. optionally remove public SSH ingress via Terraform;
4. configure Tailscale Serve:

```bash
sudo tailscale serve --bg 8080
```

The private URL will use the tailnet DNS name, for example:

```text
https://internship-ops.<tailnet>.ts.net
```

No purchased domain is required.

## 18.5 Deploy application

Recommended repository path:

```text
/opt/internship-ops
```

Persistent data:

```text
/data/internship-ops
```

Steps:

```bash
sudo mkdir -p /opt/internship-ops
sudo chown internshipops:internshipops /opt/internship-ops

git clone <PRIVATE_REPOSITORY_URL> /opt/internship-ops
cd /opt/internship-ops

cp .env.example .env
chmod 600 .env
```

Then:

```bash
docker compose build
docker compose run --rm web alembic upgrade head
docker compose up -d
docker compose ps
```

## 18.6 Gmail OAuth

Recommended flow:

1. Create a Google Cloud project.
2. Enable Gmail API.
3. Configure OAuth consent for personal use.
4. Create a Desktop OAuth client.
5. Run a local authorization helper on the user's laptop.
6. Grant the minimum scope needed:
   - `gmail.compose` for draft creation;
   - add `gmail.modify` only if reconciliation requires it.
7. Encrypt the refresh token using the app master key.
8. Transfer the encrypted token to the server.
9. Delete plaintext temporary token files.

Do not put OAuth client secret or refresh token into Git.

## 18.7 Candidate profile and resume

The initial setup wizard must:

1. import the base resume;
2. require user verification of structured facts;
3. mark legal/work-authorization fields locked;
4. generate a base resume from the structured template;
5. compare it visually to the user's original;
6. require user approval before tailoring is enabled.

## 18.8 Recruiter database

```bash
internship-ops import-recruiters recruiters.csv --preview
internship-ops import-recruiters recruiters.csv --commit
```

The preview must show:

- valid rows;
- invalid emails;
- duplicate emails;
- company normalization;
- fuzzy company matches;
- unresolved companies.

---

# 19. Docker Compose

Recommended structure:

```yaml
services:
  postgres:
    image: postgres:16-bookworm
    restart: unless-stopped
    environment:
      POSTGRES_DB: internship_ops
      POSTGRES_USER: internship_ops
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password
    volumes:
      - /data/internship-ops/postgres:/var/lib/postgresql/data
    networks: [internal]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U internship_ops"]
      interval: 10s
      timeout: 5s
      retries: 10
    secrets:
      - postgres_password

  web:
    build:
      context: .
      dockerfile: docker/web.Dockerfile
    restart: unless-stopped
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - /data/internship-ops/artifacts:/app/artifacts
      - /data/internship-ops/secrets:/app/secrets:ro
    networks: [internal]

  worker:
    build:
      context: .
      dockerfile: docker/worker.Dockerfile
    restart: unless-stopped
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /data/internship-ops:/data/internship-ops
    networks: [internal]

  browser-slot-1:
    build:
      context: .
      dockerfile: docker/browser-arm64.Dockerfile
    restart: unless-stopped
    shm_size: "1gb"
    environment:
      SLOT_NAME: slot-1
      DISPLAY: ":99"
    volumes:
      - /data/internship-ops/browser-profiles/slot-1:/home/pwuser/profile
      - /data/internship-ops/browser-sessions/slot-1:/session
      - /data/internship-ops/artifacts:/artifacts
    networks: [internal]

  browser-slot-2:
    build:
      context: .
      dockerfile: docker/browser-arm64.Dockerfile
    restart: unless-stopped
    shm_size: "1gb"
    environment:
      SLOT_NAME: slot-2
      DISPLAY: ":99"
    volumes:
      - /data/internship-ops/browser-profiles/slot-2:/home/pwuser/profile
      - /data/internship-ops/browser-sessions/slot-2:/session
      - /data/internship-ops/artifacts:/artifacts
    networks: [internal]

  caddy:
    image: caddy:2
    restart: unless-stopped
    depends_on: [web, browser-slot-1, browser-slot-2]
    ports:
      - "127.0.0.1:8080:8080"
    volumes:
      - ./deploy/Caddyfile:/etc/caddy/Caddyfile:ro
    networks: [internal]

networks:
  internal:
    driver: bridge

secrets:
  postgres_password:
    file: /data/internship-ops/secrets/postgres_password
```

Security note:

Mounting the Docker socket gives the worker significant host control. Prefer one of these:

1. fixed browser slots controlled over internal APIs, with no Docker socket; or
2. a restricted Docker socket proxy.

For MVP with fixed slots, **do not mount the Docker socket** unless necessary.

---

# 20. Repository Layout

```text
internship-ops/
├── CLAUDE.md
├── README.md
├── THIRD_PARTY.md
├── SECURITY.md
├── pyproject.toml
├── docker-compose.yml
├── .env.example
├── alembic.ini
├── app/
│   ├── main.py
│   ├── config.py
│   ├── api/
│   ├── auth/
│   ├── db/
│   │   ├── models/
│   │   ├── repositories/
│   │   └── migrations/
│   ├── domain/
│   │   ├── jobs/
│   │   ├── applications/
│   │   ├── resumes/
│   │   ├── sponsorship/
│   │   ├── recruiters/
│   │   ├── outreach/
│   │   └── tasks/
│   ├── services/
│   │   ├── discovery/
│   │   ├── dedupe/
│   │   ├── scoring/
│   │   ├── resume/
│   │   ├── browser/
│   │   ├── gmail/
│   │   ├── llm/
│   │   └── backup/
│   ├── ats/
│   │   ├── base.py
│   │   ├── greenhouse.py
│   │   ├── lever.py
│   │   ├── ashby.py
│   │   └── workday/
│   ├── templates/
│   ├── static/
│   └── cli/
├── browser/
│   ├── control_service/
│   ├── scripts/
│   └── fixtures/
├── resume_templates/
├── prompts/
│   ├── sponsorship/
│   ├── scoring/
│   ├── resume/
│   ├── form_answers/
│   └── outreach/
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── ats_fixtures/
│   └── e2e/
├── docker/
│   ├── web.Dockerfile
│   ├── worker.Dockerfile
│   └── browser-arm64.Dockerfile
├── deploy/
│   ├── Caddyfile
│   ├── systemd/
│   └── scripts/
└── infra/
    └── terraform/
```

---

# 21. Configuration

Example `.env.example`:

```dotenv
APP_ENV=production
APP_TIMEZONE=America/New_York
APP_BASE_URL=https://internship-ops.example-tailnet.ts.net
APP_SECRET_KEY=
APP_ENCRYPTION_KEY=

DATABASE_URL=postgresql+psycopg://internship_ops:password@postgres:5432/internship_ops

LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=
LLM_CLASSIFICATION_MODEL=claude-haiku-4-5
LLM_WRITING_MODEL=claude-sonnet-4-6
LLM_MONTHLY_BUDGET_USD=15

GMAIL_CREDENTIALS_PATH=/app/secrets/gmail_client.json
GMAIL_TOKEN_PATH=/app/secrets/gmail_token.enc
GMAIL_DRAFT_ONLY=true

MAX_PREPARED_APPLICATIONS_PER_DAY=10
MAX_BROWSER_WORKERS=2
MAX_LIVE_SESSIONS=2
LIVE_SESSION_TTL_HOURS=8

OUTREACH_INITIAL_DAILY_LIMIT=3
OUTREACH_MAX_DAILY_LIMIT=5
OUTREACH_DELAY_BUSINESS_DAYS=2
OUTREACH_MAX_PER_COMPANY_30D=2
OUTREACH_MAX_FOLLOWUPS=1

PUBLIC_JOB_SCRAPING_ENABLED=false
LINKEDIN_AUTOMATION_ENABLED=false
AUTO_SUBMIT_ENABLED=false
AUTO_SEND_EMAIL_ENABLED=false
CAPTCHA_BYPASS_ENABLED=false
```

The final four flags must be hard-failed if set to true in production.

---

# 22. Web Application Screens

## 22.1 Dashboard

Sections:

- jobs discovered today;
- selected applications;
- live sessions;
- replay queue;
- submissions awaiting confirmation;
- outreach due;
- email drafts ready;
- system health;
- daily limits.

## 22.2 Job review

Show:

- complete JD;
- source;
- role age;
- fit breakdown;
- sponsorship classification and quote;
- eligibility flags;
- duplicate analysis;
- select/skip decision.

## 22.3 Resume review

Show:

- base resume;
- tailored resume;
- side-by-side diff;
- provenance for every changed bullet;
- validation warnings;
- download link;
- approve/regenerate.

## 22.4 Application review

Show:

- current browser status;
- field completion;
- manual fields;
- all stored answers;
- source type per answer;
- sponsorship warning;
- tailored resume;
- open noVNC link;
- mark submitted fallback.

## 22.5 Outreach review

Show:

- application date;
- recruiter;
- recruiter match reason;
- hook;
- hook source;
- subject;
- body;
- open Gmail draft;
- change recruiter;
- regenerate;
- suppress;
- skip outreach.

## 22.6 Settings

- candidate profile;
- locked facts;
- resume;
- search rules;
- company aliases;
- sponsorship policy;
- daily limits;
- email policy;
- source registry;
- API usage budget;
- data retention.

---

# 23. Security Design

## 23.1 Network

- OCI security list exposes only restricted SSH during bootstrap.
- App binds to loopback through Caddy.
- Tailscale Serve provides private HTTPS.
- no Docker service publishes a public port.
- PostgreSQL is internal only.
- Browser debugging ports are internal only.
- Tailscale Funnel is disabled.

## 23.2 Authentication

Recommended:

- require a local admin login even inside Tailscale;
- secure cookie;
- `HttpOnly`;
- `SameSite=Strict`;
- short idle timeout;
- optional TOTP.

Optionally use verified Tailscale identity headers, but only when:

- traffic can reach the app only through Tailscale Serve;
- proxy headers are stripped from untrusted sources;
- the backend trusts only the local proxy.

## 23.3 Secrets

Secret storage hierarchy:

1. OCI Vault optional;
2. encrypted files on `/data`;
3. Docker secrets;
4. permission-restricted `.env` only for non-rotating low-risk config.

At minimum:

```bash
chmod 700 /data/internship-ops/secrets
chmod 600 /data/internship-ops/secrets/*
```

## 23.4 Browser security

- run Chromium as non-root;
- enable Chromium sandbox where compatible;
- use a seccomp profile;
- do not evaluate page-supplied code outside browser isolation;
- restrict file mounts;
- only mount the current application's artifact directory when practical;
- clear clipboard after session;
- do not retain passwords in screenshots;
- mask sensitive inputs in logs.

## 23.5 Logging

Never log:

- full resume text at info level;
- passwords;
- cookies;
- OAuth refresh tokens;
- API keys;
- full street address;
- SSN;
- demographic answers;
- raw application POST bodies.

Use structured event IDs and redaction.

## 23.6 Data retention

Suggested:

| Data | Retention |
|---|---|
| Job source records | 12 months |
| Applications | Indefinite until user deletes |
| Tailored resumes | Indefinite until user deletes |
| Pre-submit screenshots | 30 days |
| Confirmation screenshots | 12 months |
| Browser storage state | Delete 7 days after submission |
| Live profiles | Rotate after session |
| Logs | 30 days |
| Backup snapshots | 14 daily + 8 weekly |
| Suppression list | Indefinite |

---

# 24. Backup and Disaster Recovery

## 24.1 Nightly backup

Create:

```text
postgres-YYYY-MM-DD.dump.zst.age
artifacts-manifest-YYYY-MM-DD.json.zst.age
config-YYYY-MM-DD.tar.zst.age
```

Upload to OCI Object Storage.

Do not upload active browser cookies unless explicitly encrypted and necessary.

## 24.2 Backup encryption

Use `age` with a user-controlled public key.

The private decryption key should not live on the server.

## 24.3 Restore test

Once per month:

1. create a temporary local PostgreSQL instance;
2. restore the latest dump;
3. verify row counts;
4. verify resume checksums;
5. verify recruiter data;
6. record restore test in `backup_audit`.

## 24.4 VM replacement

The system must be recoverable from:

- Terraform;
- private Git repository;
- encrypted Object Storage backups;
- local secret backup held by the user.

---

# 25. Monitoring and Operations

## 25.1 Health endpoints

```text
/health/live
/health/ready
/health/database
/health/browser-slots
/health/gmail
/health/llm
/health/storage
```

## 25.2 Metrics

Track:

- jobs discovered;
- jobs deduplicated;
- jobs selected;
- resumes generated;
- resume validation failures;
- application fill success by ATS;
- replay success;
- manual fields per application;
- submission detection success;
- Gmail draft success;
- replies;
- bounce/suppression;
- LLM tokens and cost;
- RAM;
- disk;
- task latency;
- task retries.

Do not use a public telemetry vendor in MVP.

A lightweight internal metrics page is sufficient.

## 25.3 Alerts

Notify the user in the dashboard and optionally by email for:

- disk over 80%;
- database unavailable;
- backup failed;
- browser slot unhealthy;
- Gmail token revoked;
- LLM budget exceeded;
- Oracle instance reboot;
- Tailscale disconnected;
- repeated ATS adapter failure;
- possible duplicate submission.

---

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

# 27. Legal, Ethical, and Platform Constraints

This project is for the user's own legitimate applications.

Rules:

1. Respect site terms and access controls.
2. Prefer official public job feeds.
3. Use browser automation only on forms the user is authorized to complete.
4. Do not bypass CAPTCHA.
5. Do not evade rate limits or bot detection.
6. Do not create fake accounts.
7. Do not misrepresent qualifications.
8. Do not submit duplicate applications intentionally.
9. Do not scrape private recruiter data.
10. Do not send bulk unsolicited email.
11. Do not infer legal immigration advice.
12. Keep the user responsible for final attestations.

For sites that prohibit automation, switch to a manual-assist mode:

- prepare answers;
- generate resume;
- open the application;
- user fills/submits manually.

---

# 28. Testing Strategy

## 28.1 Unit tests

Required:

- company normalization;
- URL canonicalization;
- requisition extraction;
- duplicate fingerprints;
- sponsorship classification parsing;
- candidate locked-field enforcement;
- resume fact provenance;
- outreach cooldown;
- business-day calculations;
- task idempotency;
- state transitions;
- secret redaction.

## 28.2 ATS fixture tests

Store sanitized local HTML fixtures for:

- Greenhouse;
- Lever;
- Ashby;
- multi-page form;
- file upload;
- dropdown;
- radio group;
- checkbox;
- autocomplete;
- sponsorship question;
- EEO section;
- custom question.

Never include real candidate PII in fixtures.

## 28.3 Fake ATS app

Build a local fake ATS service with:

- configurable forms;
- fake submission endpoint;
- fake success page;
- deliberate selector changes;
- session expiration;
- validation errors;
- CAPTCHA placeholder that forces manual handling.

Use it for end-to-end tests without submitting real applications.

## 28.4 Browser tests

Test:

- field mapping;
- file upload;
- screenshot;
- storage-state restore;
- replay;
- manual edit persistence;
- submit observation;
- slot crash recovery;
- noVNC access token;
- two concurrent slots.

## 28.5 Integration tests

- Gmail draft creation against a test mailbox;
- recruiter import;
- Postgres task locking;
- encrypted backup and restore;
- Tailscale route verified manually in deployment checklist.

## 28.6 Production smoke tests

Before enabling a real ATS adapter:

1. run dry mode;
2. block submit button through injected guard;
3. use one real application URL;
4. verify every field;
5. compare screenshot;
6. close without submitting;
7. document tenant-specific differences.

---

# 29. Hard Safety Guards in Code

Implement an immutable production safety module:

```python
class SafetySettings(BaseModel):
    auto_submit_enabled: Literal[False] = False
    auto_send_email_enabled: Literal[False] = False
    captcha_bypass_enabled: Literal[False] = False
    linkedin_automation_enabled: Literal[False] = False
```

Application startup must fail if environment variables attempt to enable these options.

Before browser review:

```python
assert not adapter.has_clicked_submit
assert application.status in ALLOWED_PRE_SUBMIT_STATES
```

Before Gmail draft:

```python
assert application.status == ApplicationStatus.SUBMITTED
assert application.submitted_at is not None
assert outreach.due_at <= now
assert not suppression_service.is_suppressed(recruiter)
assert limiter.can_create_draft(...)
```

The Gmail service interface in MVP should not expose a `send` method.

---

# 30. Implementation Milestones

## Milestone 0 — Architecture and ARM64 Spike

Deliverables:

- repository skeleton;
- ADRs;
- Docker Compose skeleton;
- custom ARM64 browser image;
- local fake ATS;
- one noVNC browser slot;
- Playwright fill demo;
- memory measurements;
- Tailscale Serve deployment proof.

Acceptance criteria:

- Chromium launches on OCI A1;
- noVNC opens privately;
- a fixture form is filled;
- no public browser port;
- resource usage documented.

Do not continue until this passes.

## Milestone 1 — Infrastructure as Code

Deliverables:

- complete Terraform;
- VCN;
- subnet;
- IGW;
- restricted SSH;
- A1 instance;
- data volume;
- cloud-init;
- outputs;
- bootstrap guide;
- OCI budget/quota guide.

Acceptance criteria:

- `terraform validate` passes;
- fresh deployment succeeds;
- data volume persists;
- no app ports exposed;
- destroy plan is reviewed;
- secrets absent from state.

## Milestone 2 — Core Application and Database

Deliverables:

- FastAPI app;
- HTMX dashboard;
- PostgreSQL;
- Alembic;
- auth;
- state machine;
- task queue;
- audit events;
- health page.

Acceptance criteria:

- worker survives restart;
- duplicate task cannot execute twice;
- state transitions validated;
- dashboard available through Tailscale only.

## Milestone 3 — Candidate Profile and Recruiter Import

Deliverables:

- candidate setup wizard;
- locked fields;
- structured resume facts;
- CSV/XLSX recruiter importer;
- company normalization;
- import preview.

Acceptance criteria:

- invalid emails rejected;
- duplicates merged;
- locked facts cannot be AI-edited;
- profile export/import works.

## Milestone 4 — Discovery and Deduplication

Deliverables:

- 2027 GitHub-feed adapters;
- Greenhouse feed adapter;
- Lever feed adapter;
- Ashby feed adapter;
- manual URL import;
- canonical URL service;
- dedupe engine;
- job review page.

Acceptance criteria:

- same requisition from multiple sources becomes one job;
- probable duplicates require review;
- closed jobs stop downstream work;
- source provenance retained.

## Milestone 5 — Sponsorship and Fit Analysis

Deliverables:

- deterministic keyword pass;
- structured LLM classifier;
- evidence extraction;
- fit score;
- eligibility rules;
- budget tracking.

Acceptance criteria:

- restrictive classification requires a quote;
- candidate sponsorship truth is never changed;
- hard ineligible job cannot be selected automatically;
- all model output passes schema validation.

## Milestone 6 — Resume Tailoring

Deliverables:

- base resume template;
- facts registry;
- tailoring plan;
- provenance validation;
- PDF rendering;
- diff view;
- immutable storage.

Acceptance criteria:

- every changed bullet maps to fact IDs;
- unsupported claim blocks resume;
- exact uploaded version is tracked;
- PDF text extraction succeeds.

## Milestone 7 — Greenhouse Browser Adapter

Deliverables:

- field schema;
- fill engine;
- manual-field detection;
- resume upload;
- replay package;
- noVNC review;
- submission observer;
- fake and live dry tests.

Acceptance criteria:

- no submit click;
- review link works;
- replay works after slot restart;
- sponsorship answers come only from locked profile;
- success detection works in fake ATS.

## Milestone 8 — Lever and Ashby Adapters

Use the same acceptance criteria as Greenhouse.

## Milestone 9 — Outreach Pipeline

Deliverables:

- two-business-day scheduler;
- recruiter matcher;
- hook generator;
- Gmail draft creation;
- suppression;
- cooldown;
- sent/reply reconciliation;
- outreach dashboard.

Acceptance criteria:

- no draft before confirmed submission;
- no more than configured daily limit;
- no duplicate recruiter-role draft;
- no email-send API method;
- reply cancels follow-up.

## Milestone 10 — Backup, Monitoring, and Hardening

Deliverables:

- encrypted backup;
- Object Storage upload;
- restore test;
- metrics;
- alerting;
- retention cleanup;
- security review;
- runbook.

Acceptance criteria:

- restore succeeds;
- PII redaction tests pass;
- failure scenarios documented;
- restart recovery tested;
- no public services found by port scan.

## Milestone 11 — Workday Research Spike

Do not promise full Workday support.

Deliverables:

- three representative tenant dry runs;
- account/login flow documentation;
- field taxonomy;
- replay feasibility;
- RAM/time measurement;
- go/no-go decision.

---

# 31. Claude Code Working Method

Claude should use the following cycle for each milestone:

1. Restate milestone scope.
2. Inspect existing code.
3. Write or update an implementation plan.
4. Create tests first where practical.
5. Implement the smallest working slice.
6. Run:
   - formatter;
   - linter;
   - type checker;
   - unit tests;
   - integration tests.
7. Update:
   - `CLAUDE.md`;
   - `README.md`;
   - ADRs;
   - migration notes;
   - threat model when relevant.
8. Report:
   - files changed;
   - commands run;
   - test results;
   - security implications;
   - remaining limitations.
9. Do not proceed to the next milestone until acceptance criteria pass.

Suggested commands:

```bash
uv sync
uv run ruff format .
uv run ruff check .
uv run mypy app
uv run pytest -q
docker compose config
docker compose build
```

For infrastructure:

```bash
terraform fmt -check -recursive
terraform validate
tflint
checkov -d infra/terraform
```

---

# 32. Definition of Done

The first production release is done when:

1. OCI infrastructure can be recreated with Terraform.
2. App is private through Tailscale.
3. Up to 10 applications can be queued daily.
4. Two browser slots operate on OCI A1.
5. Greenhouse, Lever, and Ashby dry-mode adapters work.
6. Applications stop before Submit.
7. User can open a review link.
8. Dead sessions can be replayed.
9. Submission can be detected or manually confirmed.
10. Sponsorship evidence is visible and truthful answers are locked.
11. Tailored resumes are preserved and validated.
12. Recruiter CSV/XLSX import works.
13. Cold-email drafts are created two business days later.
14. Email limits and suppression work.
15. No auto-send method exists.
16. Backups restore successfully.
17. No app/browser/database port is public.
18. Tests and runbook pass.
19. Monthly AI budget cap works.
20. User can operate the system without editing the database manually.

---

# 33. Initial Production Settings

```yaml
project:
  name: internship-ops
  mode: single-user-private

jobs:
  target_country: US
  target_terms:
    - Summer 2027
  target_roles:
    - Software Engineer Intern
    - Software Engineering Intern
    - Backend Engineer Intern
    - Full Stack Engineer Intern
    - Platform Engineer Intern
    - Infrastructure Engineer Intern
  max_prepare_per_day: 10
  minimum_fit_score: 72
  max_role_age_days: 21

browser:
  workers: 2
  live_slots: 2
  queue_capacity: 10
  live_ttl_hours: 8
  replay: true

sponsorship:
  no_sponsorship_action: MANUAL_REVIEW
  citizenship_required_action: SKIP
  not_mentioned_action: CONTINUE
  ambiguous_action: MANUAL_REVIEW
  candidate_answers_locked: true

outreach:
  delay_business_days: 2
  initial_daily_limit: 3
  maximum_daily_limit: 5
  max_recruiters_per_application: 1
  max_recruiters_per_company_30d: 2
  recruiter_cooldown_days: 30
  max_followups: 1
  auto_send: false
  tracking_pixels: false

safety:
  auto_submit: false
  auto_send_email: false
  captcha_bypass: false
  linkedin_automation: false
```

---

# 34. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Oracle Always Free capacity unavailable | Try another availability domain; keep paid VPS fallback documented |
| OCI idle reclaim | Off-instance backups; infrastructure reproducible; monitor notices |
| ARM64 browser incompatibility | Milestone 0 spike; custom image; system Chromium fallback |
| Browser RAM exhaustion | Two fixed slots; replay queue; watchdog; session TTL |
| ATS layout changes | Semantic locators; fixture tests; fail closed |
| Session expires | Storage state + replay package |
| CAPTCHA | Manual review only |
| Incorrect sponsorship answer | Locked candidate facts; JD policy separated from answer |
| Resume hallucination | Fact provenance; deterministic validator |
| Duplicate application | DB unique indexes; requisition and canonical URL checks |
| Recruiter spam | low limits; cooldown; suppression; manual send |
| Fake personal hook | source-required hook; fallback to no hook |
| Gmail token revoked | health alert; stop outreach tasks |
| LLM cost spike | task routing; monthly cap; cache; stop at limit |
| Public data exposure | Tailscale-only; app auth; encrypted backups |
| AGPL obligations | isolate third-party code; record provenance; legal review before sharing |
| Platform terms conflict | manual-assist mode; disable adapter |

---

# 35. Future Enhancements

Only after MVP stability:

- Workday adapter;
- Handshake manual-assist adapter;
- browser extension for local handoff;
- mobile review notifications;
- Gmail push notifications with Pub/Sub;
- recruiter title enrichment from permitted public sources;
- company engineering-blog feed;
- cover letter support when required;
- interview-stage tracking;
- calendar integration;
- application analytics;
- multiple base resumes;
- local model option;
- paid x86 cloud migration;
- passkey authentication.

Do not add multi-user SaaS behavior without a new privacy, security, licensing, and cost review.

---

# 36. Master Prompt for Claude Code

Copy the following into Claude Code after placing this document in the repository:

```text
You are the lead product engineer for InternshipOps, a private single-user
cloud application that prepares U.S. SWE internship applications and recruiter
outreach.

Read `internship_ops_master_build_spec.md` completely. Treat it as the source
of truth. Then read or create `CLAUDE.md`.

Start with Milestone 0 only: Architecture and ARM64 Browser Spike.

Requirements:
- Do not implement application auto-submit.
- Do not implement email auto-send.
- Do not bypass CAPTCHA or bot detection.
- Do not automate LinkedIn.
- Do not alter candidate legal/work-authorization facts.
- Do not place secrets in source control, Docker images, Terraform state, logs,
  screenshots, or test fixtures.
- Use a private Tailscale-only access design.
- Target Oracle A1 ARM64 with 2 OCPU and 12 GB RAM.
- Prove one browser slot first, then prove two browser slots.
- Build a local fake ATS form for testing.
- Add tests and document every command.
- Fail closed when a field or page is uncertain.
- Do not proceed to Milestone 1 until all Milestone 0 acceptance criteria pass.

Before coding:
1. Summarize the architecture you inferred.
2. List assumptions and risks.
3. Propose the exact files you will create.
4. Identify any requirement that cannot be validated in the current
   environment.
5. Write a short milestone plan.

During implementation:
- Make small, testable changes.
- Run formatting, linting, typing, tests, and Docker validation.
- Keep `CLAUDE.md`, ADRs, and README current.
- Report exact test results, not generic statements.

At completion:
- Provide the commands to reproduce the spike locally and on OCI A1.
- Provide measured CPU/RAM usage for one and two slots.
- Document the ARM64 browser strategy.
- Document failures and fallback options.
- Stop and wait for the next milestone.
```

---

# 37. Source Reference Index

Official and primary references used to design this specification:

```text
Oracle Always Free resources:
https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm

OCI Terraform provider:
https://registry.terraform.io/providers/oracle/oci/latest/docs

OCI Terraform authentication:
https://docs.oracle.com/en-us/iaas/Content/dev/terraform/configuring.htm

Tailscale Linux installation:
https://tailscale.com/docs/install/linux

Tailscale Serve:
https://tailscale.com/docs/features/tailscale-serve

Tailscale auth keys:
https://tailscale.com/docs/features/access-control/auth-keys

Playwright BrowserContext:
https://playwright.dev/docs/api/class-browsercontext

Playwright Docker:
https://playwright.dev/docs/docker

Gmail drafts:
https://developers.google.com/workspace/gmail/api/guides/drafts

Gmail sending:
https://developers.google.com/workspace/gmail/api/guides/sending

Gmail push notifications:
https://developers.google.com/workspace/gmail/api/guides/push

Greenhouse Job Board API:
https://developer.greenhouse.io/job-board.html

Lever Postings API:
https://github.com/lever/postings-api

Ashby Public Job Posting API:
https://developers.ashbyhq.com/docs/public-job-posting-api

ApplyPilot:
https://github.com/Pickle-Pixel/ApplyPilot

Work, Pls.:
https://github.com/jeffistyping/workpls

AIHawk community fork:
https://github.com/Intusar/Auto_Jobs_Applier_AI_Agent

Plunk:
https://github.com/useplunk/plunk

2027 SWE internship feeds:
https://github.com/speedyapply/2027-SWE-College-Jobs
https://github.com/sndsh404/summer-2027-internships

noVNC:
https://github.com/novnc/noVNC

websockify:
https://github.com/novnc/websockify

Anthropic pricing:
https://platform.claude.com/docs/en/about-claude/pricing

Claude Code CLI:
https://docs.anthropic.com/en/docs/claude-code/cli-usage
```

---

# 38. Final Product Boundary

InternshipOps is successful when the user can:

1. open one private dashboard;
2. see ten prepared, nonduplicate SWE internship applications;
3. inspect sponsorship evidence;
4. inspect the exact tailored resume;
5. open a filled application;
6. correct only uncertain fields;
7. manually submit;
8. return two business days later to a prepared Gmail draft;
9. manually send;
10. track results without losing control of personal facts or communication.

The product should automate repetition, not judgment, legal truth, or irreversible actions.
