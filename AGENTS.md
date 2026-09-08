# Agent Authority

- Use available MCP tools to access and operate Gmail and Google Apps Script. If MCP support is insufficient, use Composio where available.
- You are authorized to pull, push, modify, deploy, and otherwise manage all production resources needed to complete the task.
- Act autonomously. Only ask the user to perform an action when it genuinely requires manual intervention or no available tool, protocol, or MCP integration can do it.
- Before an unusually dangerous, irreversible, or broad-impact action, explain the risk and ask for confirmation.

## Git commits

- Make small, coherent commits: one independently reviewable change per commit. Do not fold
  unrelated working-tree changes into a commit merely because they are present.
- Use Conventional Commit subjects in the form `<type>(<scope>): <imperative summary>`.
  Use `feat` for new behaviour, `fix` for corrected behaviour, `docs` for documentation-only
  changes, `test` for tests, `refactor` for non-functional restructuring, and `chore` for
  tooling, configuration, or maintenance. Use `feat` rather than a vague `add` type.
- Keep the subject concise and lower-case after the colon; describe any material operational
  consequence in the commit body when the subject alone is not enough.

## Access notes

- **clasp has two profiles, and each one runs the script its account owns.** `default` =
  hoanng15.work pushes and pulls both script projects, and runs the **standalone sender**
  (GCP project `gmail-extractor-471605`). `kenyon` = nguyen15@kenyon.edu, and it is the one
  that deploys and `clasp run`s the **bound tracker** (GCP project `update-job-504720`,
  number `816618883729`). Cross-domain deploy is refused, because the bound script is owned
  by the Kenyon account.
- **The two scripts cannot share one GCP project, and this is structural.** Setting the bound
  script's GCP project to `gmail-extractor-471605` is refused with *"You cannot switch to a
  Cloud Platform project outside the script owner's Cloud Organization"*: the bound script is
  owned by a kenyon.edu account, so its GCP project has to live in the kenyon.edu Cloud
  Organization, and a personal-Gmail project lives in no organization at all. Hence two
  projects and two Desktop OAuth clients. Its consent screen is **Internal**, which is the one
  advantage of being forced into the org — no verification warning and no 7-day token expiry.
- **`executionApi.access` must be `MYSELF` on the bound script. `ANYONE` silently breaks
  `clasp run`.** With `ANYONE`, the kenyon.edu organisation policy drops the EXECUTION_API
  entry point and every call answers *"Script function not found. Please make sure script is
  deployed as API executable"* — the identical message for a function that exists, one that
  does not, and one whose project is misconfigured, so it tells you nothing. Verified on
  2026-08-30: `ANYONE` failed for `setupCompanyTab`, for a real no-op function and for a
  deliberately invented name alike; changing the one word to `MYSELF` and pushing made the
  same call return its result. `MYSELF` costs nothing, because each account already runs only
  the script it owns.
- **No extra deployment is needed for `clasp run`.** The auto `@HEAD` deployment is enough, and
  `clasp run` is in devMode unless you pass `--nondev`. Creating an API-executable deployment
  was tried while chasing the error above and then deleted after `MYSELF` proved to be the
  whole fix — on a manifest carrying a `webapp` entry, `clasp deploy` would also mint a second
  ANYONE_ANONYMOUS web app URL nobody asked for.
- **`clasp run` needs the script's own OAuth client.** A plain `clasp login` falls back to
  Google's built-in client, and then every `scripts.run` call answers *"Unable to run script
  function"* or *"Authorization is required to perform that action"* — the same message for a
  function that exists and one that does not, so it tells you nothing about your code.
  Re-authorise with
  `clasp login --creds <Desktop client JSON from the script's GCP project> --use-project-scopes --include-clasp-scopes`,
  then confirm `clasp show-authorized-user` reports the client as **user-provided**.
  `appsscript.json` must also carry `"executionApi": { "access": "MYSELF" }`.
- **`clasp tail-logs` is the fastest ground truth there is.** Every `Logger.log` line with a
  timestamp, so you can see which run did what and when. Reach for it before reasoning.
- **`clasp push` does not update a pinned deployment.** The extension's Web App is pinned to a
  version and keeps serving that frozen snapshot. Redeploy it after any `App` column change.
- **The bound script is invisible to the Drive MCP** (404 on its script id). clasp is the way in,
  and the only way to read what is actually deployed.
- **Composio has no Apps Script toolkit.** Sheets/Drive/Gmail each carry both accounts; the
  tracker spreadsheet is owned by the Kenyon one.
- **Verify a deploy by pulling that version back and grepping it** — never by trusting the
  command's output.
- **Composio's Sheets reads reshape arrays** and can drop or pad empty cells. For anything about
  column alignment, use single-cell reads or a formula inside the sheet.

## One owner per column

**The sender project (`apps_script/outreach/`) owns the Referral tab's row order and both its
hour columns.** The bound tracker script may sink called-off rows and nothing else.

Until 2026-08-30 both projects timed that tab: the sender interleaved employers and capped a
non-priority company at one ask per day, while the tracker's `reflowReferralTimes_` dealt the
tab's hours back out in row order after regrouping the rows by employer. Each hourly job undid
the other, so a fix could pass every test, run correctly against the live sheet, and be gone
before anybody looked. See `docs/components/outreach-referral-queue.md`.

**Before adding a write to any tab, check the tab-ownership table in
[`docs/components/README.md`](docs/components/README.md) and name the project that owns the
column.** Two things writing one column is the failure mode this codebase is most prone to,
because the two projects cannot see each other and neither one looks wrong on its own.

## Read the last day's note, and leave one

`update/` holds one short Markdown file per day of work, named `YYYY-MM-DD.md`.

**Before starting, read the most recent one.** It is the only place that records what was
changed today-ish and what was deliberately left undone — the things a diff shows but does not
explain, and that `docs/components/` does not carry because they are about the work rather than
about the system.

**Before finishing, write or extend the file for today's date.** A new file each day; append to
it if the day is already open. Keep it short — what changed, why, what is still open, and
anything the next person would otherwise have to rediscover. It is a log, not a second set of
component docs: if a fact belongs to the system rather than to the day, it belongs in
`docs/components/` and the note should link to it instead of repeating it.

This exists because a working tree with a month of half-finished changes in it, and no note
saying which are half-finished, costs more to read than the code does.

## Read the component docs first

`docs/components/` holds one document per source file: what it owns, what it connects to, and
what every function does. Start at
[`docs/components/README.md`](docs/components/README.md) — it carries the system map, the data
flow between the three subsystems, and which script writes which tab.

**Read the relevant component doc before changing a file.** This codebase's rules are load-bearing
and mostly invisible from the code alone: caps that spread a queue across employers, an order of
steps that exists so a message is never written and sent in the same hour, two company-name keys
that disagree on purpose. The docs record why. Guessing has cost real sends.

`docs/*.md` one level up explain *why* the system is shaped this way and stay useful;
`docs/components/` explains *what is where*.

## Keep the docs in step with the code

**Any change to a component, an element, a rule or a constant must update its component document
in the same change.** Specifically:

- Adding a function → add its row to that file's table.
- Changing what a function decides → change that row.
- Adding or changing a rule, cap or constant → say what it is now and why it changed.
- Adding a source file → add its document and link it from `docs/components/README.md`.
- Deleting code → delete its rows, and the document if the file is gone.

A document describing code that no longer exists is worse than no document, because it still
reads as current. The same applies to this file: an access note that has stopped being true is a
trap, not a note.

**Verify before you document.** State what you ran and what came back. Do not describe behaviour
you have not observed — the tests passing is not evidence that the code ran against the sheet.
