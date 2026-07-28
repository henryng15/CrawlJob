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
