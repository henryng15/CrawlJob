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
