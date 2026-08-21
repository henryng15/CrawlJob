# Who can put in a word for you

The school's alumni directory is pasted into a tab of its own. Every sync marks **both
sides** of the overlap:

- Tab **`Alumni`** — the row of someone working at a company you have applied to is
  **painted yellow**. That is the person worth asking for a referral.
- Tab **`App`** — column **I `Alumni`** is ticked on an application where you *know
  someone on the inside*.

And a second mark in the `App` tab: column **J `Recruiter`** is ticked when that company
already has a recruiter in the contact list. The two columns are independent, and one
application can carry both ticks.

Both `App` marks used to be background colours — yellow across the row and red in column
I. A checkbox says exactly the same thing but can be **filtered and sorted on**, which a
background colour cannot: asking for "every application with an alumnus" is one filter
with a checkbox, and an eye running down every row with a colour. The first sync after the
change lifts the old paint by itself.

The `Alumni` tab is still colour, because there is no application there to hang a tick off
— each row is a person, not an application sent.

## Why it has to live in the spreadsheet

GitHub Actions runs on GitHub's runner and Apps Script runs on Google's server. Neither
can see the `.xlsx` in the Downloads folder on your machine. Automating it means the data
has to sit where they can read it — and the spreadsheet is the place that is already
there.

## Set up once

1. Open the spreadsheet → **File → Import → Upload**, and pick the alumni `.xlsx` you just
   downloaded.
2. Choose **Insert new sheet(s)** and press Import.
3. Rename the new tab to **`Alumni`**. For another name, set the
   `GOOGLE_SHEET_ALUMNI_TAB` variable.

Column A has to be the company name. The current export is exactly that:

```
Job Organization | Job Title | Industry | State | Degrees Aggregated | LinkedIn
```

Row 1 is the header and is never painted.

Next time there is a fresh export, import it over that tab. Nothing else to do — the next
sync repaints from scratch.

## How company names are matched

The directory records the registered name, an application records the name on the careers
page, and the two are rarely identical. `company_tokens` drops case, punctuation, and the
words that only name a legal form (`Inc`, `LLC`, `Ltd`, `Corp`, `Company`, `Group`,
`Technologies`…). It then matches where **one side's token set sits inside the other's**:

| Alumni directory | Application sent | |
|---|---|---|
| `Chicago Trading Company (CTC)` | `Chicago Trading Company` | ✅ |
| `Hakkōda, an IBM Company` | `IBM` | ✅ |
| `Google Cloud` | `Google` | ✅ |
| `Altamira Technologies` | `Altamira` | ✅ |
| `Dicerna Pharmaceuticals` | `Dice` | ❌ |
| `Champion Sports` | `HP` | ❌ |

Containment counts **whole tokens**, not substrings. On substrings `Dice` would match
`Dicerna` and `HP` would match `Champion`, and the whole directory would go yellow.

The rule is loose by design: miss an alumnus and you never find out, while one row painted
yellow by mistake is obvious at a glance. Every matched pair is printed to the Actions log
so it can be checked:

```
Alumni row 41: Google Cloud — applied to Google
```

A name that reduces to no tokens at all (`The Company Ltd`) matches **nothing** — the
empty set sits inside every set, and left unguarded it would paint the entire directory
yellow. A test pins that down.

## Those two columns belong to the tool, not to you

Every sync writes **both answers** into columns I and J — TRUE on a matching row, FALSE on
one that does not match. Tick a box by hand and the next run clears it.

It has to work that way for the mark to stay true: an alumnus changing employer, or an
application deleted from `App`, both have to turn a tick off. Ticking and never clearing
only accumulates marks until they are wrong without saying when. The place for something
you want kept is column **H `Note`**.

These two columns are the **only** cells outside the Jobs tab that the tool writes.
Columns A–H and column K of `App` are never touched.

One exception stands guard: where the source is **missing**, that column is left as it
stands rather than written. No `Alumni` tab does not mean "nobody works anywhere" —
reading 0 matches out of a tab that is not there and writing that down clears the whole
column. Same for the recruiter list: empty means the file did not travel with the build,
not that no company has a recruiter.

A run that finds both columns already correct **sends no request**, nine times a day
included.

### When a cell shows the word `FALSE`

A checkbox cell is really two things: the boolean **value**, and the **rule** that draws
it as a box. Write a value where the rule does not reach and Sheets has nothing to draw
with, so it prints the value straight out — the `FALSE` you are looking at.

That happens because two ranges drift apart. `setupAppColumns` lays the rule down to the
last row that **exists when you press Run**, and the App tab grows with every application
sent; Python writes down to the last row **when it runs**. Run setup once, send ten more
applications, and ten rows sit outside the rule.

Now every sync checks for itself: it reads the rule over the exact range it is about to
write, and where a cell is missing one it lays the rule over the whole range before
writing. The two ranges have no way left to drift, because one number produces both. A run
that has to repair says so:

```
Repairing the checkbox rule over App!I2:J83.
```

This is the second line; the first is `onEdit` copying the validation from the last entry
row to the row it has just added. Both are needed: the first covers rows the script
creates, the second covers every other row — typed by hand, pasted in, or imported from
somewhere else.

### Nothing is written before the columns are built

And one more latch in front of all of it: **I1 and J1 have to read exactly `Alumni` and
`Recruiter`** before the tool writes. The sync runs on cron nine times a day while you
run `setupAppColumns` by hand — if a sync arrives before you have, column J is still where
the `Update` history used to live, and writing FALSE over it wipes the lot. On a wrong
header the tool prints a line of warning and leaves both columns alone.

## The tool clears only its own yellow

In the `Alumni` tab, before painting, the tool reads the backgrounds already there and
compares them with its own colour — the `#FFE599` yellow in column A. Only a cell carrying
that exact colour is cleared.

- A cell you painted yourself is **left as it is**.
- Remove a company from `App` and the matching alumni row loses its yellow by itself.
- A row already the right colour is not written again.

The same mechanism handles the old paint in the `App` tab: the row-wide yellow and the
column-I red now match the empty set, so all they can still do is lift the colour they
once laid down. The clean-up has to happen: column I today is the `Alumni` checkbox, and a
checkbox on a red background reads as a warning nobody wrote.

One exception worth knowing: a row once painted yellow had all of A–H turned yellow, so a
cell you had painted by hand on that row was covered over long before. The clean-up
returns it to white, not to the colour it used to be.

## Recruiter (column J)

The source is the `ColdEmail` project, file `web/db/seed_recruiters.csv` — 2269 verified
contacts. But this repo **carries nobody's name or email**: only the company list is
copied across, into `job_sync/data/recruiter_companies.txt` (720 lines). What matters is
"there is a contact", not "who the contact is".

Refresh it when ColdEmail has new data:

```bash
python scripts/recruiter_companies.py ../ColdEmail/web/db/seed_recruiters.csv
```

The file lives **inside the package**, `job_sync/data/`, not at the repo root: `pip
install .` copies only `job_sync/`, so a file at the root would be there on a local run
and gone on the runner — a silent failure that lights 0 rows while the workflow stays
green. `pyproject.toml` declares `[tool.setuptools.package-data]` so the wheel carries it.

Being in the repo, the file costs no API call, and a missing file is only a feature
switched off.

Matched by the same loose rule as above. Tried against the companies read out of the App
tab it hits **32/54**, far more than alumni — the recruiter list covers much more ground
than the school directory.

## Cost

Nine more API calls per sync: read `Alumni`, read `App`, read backgrounds in three places
(column A of `Alumni`, columns A and I of `App`), read the two checkbox columns, read the
rule over those two columns, then one `batchUpdate` and one `update` — the last two dropped
entirely when nothing has changed. The recruiter list is read from disk and costs no call. Consecutive rows are folded
into one request, so 100 matches scattered about still cost a handful of requests rather
than 100.

With no `Alumni` tab yet, the tool prints a line and moves on; the sync runs as usual.
