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
