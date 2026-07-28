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
