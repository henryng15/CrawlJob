# Docs

| | |
|---|---|
| [workflow.md](workflow.md) | **Start here.** The whole system on one page: the three identities, the four moving parts, the hourly cycle, and the invariants |
| [setup.md](setup.md) | Google Cloud, the service account, sharing access, `.env`, GitHub Actions secrets, installing the Apps Script |
| [spreadsheet.md](spreadsheet.md) | Every tab and every column: who may write where, `Applied`, `Expired`, where a note goes, why a row must not be deleted, and the one formula behind `Alphabet_Order` |
| [matching.md](matching.md) | When two rows are one job. The three layers of matching, and why the loosest of them may never delete a row |
| [crawling.md](crawling.md) | The sources, the role filter, `Date Posted`, and the only three reasons a row disappears |
| [alumni.md](alumni.md) | The `Alumni` and `Recruiter` checkbox columns on the App tab: which application still has a way to push it further |
| [external-applications.md](external-applications.md) | Install the personal Chrome extension that adds an external application straight to `App` |
| [outreach.md](outreach.md) | Emailing a recruiter after you have applied: the queue, the order, the daily caps, and why the sender is a separate Apps Script |
| [email-templates.md](email-templates.md) | Every subject line and every body that can go out, all three paths: the ten cold variations, the twenty follow-up nudges, the forty referral bodies and their thirty six subjects, the resume bullets, the per-person hook and the per-company angle |
| [operations.md](operations.md) | Reading the log, `--audit-app`, `--rebuild`, the error table |
| [components/](components/README.md) | **One document per source file:** what it owns, what it connects to, what every function does. Read the relevant one before changing a file; update it in the same change. |

These docs explain *why* the system is shaped this way. `components/` explains *what is where*.

Start with [../README.md](../README.md) if you do not know what this tool does yet.
