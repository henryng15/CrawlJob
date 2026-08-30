# Agent Authority

- Use available MCP tools to access and operate Gmail and Google Apps Script. If MCP support is insufficient, use Composio where available.
- You are authorized to pull, push, modify, deploy, and otherwise manage all production resources needed to complete the task.
- Act autonomously. Only ask the user to perform an action when it genuinely requires manual intervention or no available tool, protocol, or MCP integration can do it.
- Before an unusually dangerous, irreversible, or broad-impact action, explain the risk and ask for confirmation.

## Access notes

- **clasp has two profiles.** `default` = hoanng15.work pushes and pulls both script projects.
  Deploying needs `clasp --user kenyon` — cross-domain deploy is refused, because the bound
  script is owned by nguyen15@kenyon.edu.
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
