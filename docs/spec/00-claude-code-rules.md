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
