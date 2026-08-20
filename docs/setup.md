# Rebuilding from scratch

Three parts, in this order: access to the Google Sheet, running it locally, then handing the
run over to GitHub Actions.

## 1. Google Cloud and the service account

The tool does not sign in as your Gmail account. It uses a **service account** — a machine
account with an email address of its own, and you have to **share the spreadsheet with that
email** exactly as you would with a real person. This is the step most often missed, and its
symptom is a `403`.

### 1.1 Create a project

1. Go to [console.cloud.google.com](https://console.cloud.google.com).
2. The project menu in the top bar → **New Project**. Any name will do, for example
   `internship-sheet-sync`. **Create**.
3. Wait for it to be created, then **select that project** in the top bar. Every step below
   happens inside the project currently selected.

Billing does not need to be enabled. The Google Sheets API sits inside the free quota.

### 1.2 Enable the Google Sheets API

1. **APIs & Services → Library**.
2. Search for `Google Sheets API` → open it → **Enable**.

Skip this step and the tool reports something like *"Google Sheets API has not been used in
project … before or it is disabled"*.

### 1.3 Create the service account

1. **APIs & Services → Credentials → Create credentials → Service account**.
2. Give it a name, for example `sheet-sync`. **Create and continue**.
3. The "Grant this service account access to project" part — **leave it empty, press
   Continue**. That is permission on the Google Cloud project, which has nothing to do with
   permission on the spreadsheet.
4. **Done**.

### 1.4 Download the JSON key

1. Click the service account you just created → the **Keys** tab.
2. **Add key → Create new key → JSON → Create**.
3. The browser downloads a `.json` file. **It can only be downloaded once** — lose it and
   you have to create a new key.

Inside, it looks like this:

```json
{
  "type": "service_account",
  "project_id": "internship-sheet-sync",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...",
  "client_email": "sheet-sync@internship-sheet-sync.iam.gserviceaccount.com",
  ...
}
```

`client_email` is what the next step needs. **Do not commit this file.**

### 1.5 Share the spreadsheet with the service account

This is the step that makes the tool able to write.

1. Open your Google Sheet.
2. Press **Share**, top right.
3. Paste the `client_email` from above verbatim — of the form
   `name@project-id.iam.gserviceaccount.com`.
4. Change the permission to **Editor**, not Viewer. The tool needs to write to the `Jobs`
   tab.
5. **Turn "Notify people" off** — this is not a person, and the mail would bounce.
6. **Share**.

If your organisation blocks sharing outside the domain, this step will fail. Use a
spreadsheet on a personal account instead, or ask an admin to allow it.

### 1.6 Check it

Take `GOOGLE_SHEET_ID` from the URL — the part between `/d/` and `/edit`:

```
https://docs.google.com/spreadsheets/d/1AbC...XyZ/edit#gid=0
                                       └──────────┘
```

Once the environment variables from step 2 are set, run `internship-sync --audit-app`. It
only reads, which makes it the safest way to test the permission.

| Error | What it means |
|---|---|
| `403 … caller does not have permission` | step 1.5 was never done, or the wrong email was shared with |
| `403 … Google Sheets API has not been used` | step 1.2 was never done |
| `404 … Requested entity was not found` | `GOOGLE_SHEET_ID` is wrong |
| `No tab named 'Jobs'` | the permission is fine, the tab is simply named something else |
| `invalid_grant` / `Invalid JWT` | the JSON is mangled, usually a broken line break inside `private_key` |

## 2. Environment variables

Copy `.env.example` to `.env`:

| Variable | Required | Default | |
|---|---|---|---|
| `GOOGLE_SHEET_ID` | yes | | the part between `/d/` and `/edit` in the URL |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | yes | | the **whole** contents of the JSON file from step 1.4 |
| `GOOGLE_SHEET_TAB` | no | `Jobs` | the tab the tool writes to |
| `GOOGLE_SHEET_APP_TAB` | no | `App` | the tab the tool reads to know what has been applied to |

The two tab variables use `os.getenv(...) or "..."` rather than `getenv`'s own default
value. The reason: a GitHub Actions secret that was never created arrives as an **empty
string** rather than as "not there" — and with an ordinary default the tool would go looking
for a tab named `""`.

To set `GOOGLE_SERVICE_ACCOUNT_JSON` in `.env`, paste the JSON verbatim inside single
quotes, keeping the `\n` sequences inside `private_key` as they are:

```
GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...","client_email":"..."}'
```

On GitHub, paste the file contents straight into the secret box; no quotes needed.

`.env` and `.env.*` are both already in `.gitignore`. Do not commit JSON credentials.

## 3. Running locally

```bash
uv venv && uv pip install -e .
set -a; source .env; set +a
internship-sync
```

Running it again and again produces no duplicates: the sheet is always read before each
write.

Check before trusting it:

```bash
uv run pytest -q                  # 194 tests
uv run ruff check .
node apps_script/harness.js       # 56 assertions for the Apps Script half
```

## 4. GitHub Actions

Add the secrets at **Settings → Secrets and variables → Actions**:

- `GOOGLE_SHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `GOOGLE_SHEET_TAB` — only if the tab is not named `Jobs`
- `GOOGLE_SHEET_APP_TAB` — only if the tab is not named `App`

The workflow at [`.github/workflows/sync.yml`](../.github/workflows/sync.yml) runs every 90
minutes from 09:00 to 18:00 `America/New_York`: 9:00, 10:30, 12:00, 13:30, 15:00, 16:30 and
18:00 — seven runs a day, and every one of them asks the ATS boards.

GitHub cron only accepts UTC, and New York moves between EST and EDT twice a year. So the
schedule is written as two crons, `0 13,16,19,22` and `30 14,17,20`, which are those seven
ET times while EDT is in force, and `--scheduled` refuses only a run arriving outside the
08:00–18:59 ET working window. The window is an hour wider than the schedule at each end,
which is what carries it through the November change: the same crons land an hour early once
EST starts, and all seven runs still pass. A run takes about four minutes.

To run it by hand use **Run workflow**; there is no `--scheduled` then, so it ignores the
time window and crawls straight away.

## 5. Apps Script

The two files in [`apps_script/`](../apps_script/) run on Google's side, not on Python's.
Open the spreadsheet → **Extensions → Apps Script**, paste each file in, Save.

| File | Function to run | What it does |
|---|---|---|
| `sync_applied_to_app.gs` | `setupJobsCheckboxes` | builds the `Applied` (F) and `Expired` (G) checkboxes on the Jobs tab |
| | `setupAppColumns` | builds `Alumni` (I), `Recruiter` (J) and `Update` (K) on the App tab |
| `setup_process_dropdown.gs` | `setupProcessDropdown` | builds the coloured `Process` dropdown on the App tab |

Running each setup function once is enough; `onEdit` is a simple trigger, so Google calls it
itself and no trigger has to be installed by hand. The first time, Google asks for
permission: Review permissions → pick the account → Advanced → Go to (project) → Allow.

> **Careful with `setupProcessDropdown`.** It overwrites the data validation of the whole of
> `F2:F500` on the App tab. If your current dropdown was made through the Sheets UI (the
> rounded-chip kind), running this function again changes how **every** existing row is
> displayed.

## Cost

Free, all of it.

- **GitHub Actions** — a public repo has no minute limit. A private repo has the free tier's
  2000 minutes a month, and the current schedule uses roughly 1,050. See the budget table
  in [operations.md](operations.md) for where that goes.
- **Apps Script** — a 90-minute-a-day runtime quota on an ordinary account; each tick costs
  about a second.
- **Google Sheets API** — a limit of 60 requests a minute a user, and each sync uses about a
  dozen.
