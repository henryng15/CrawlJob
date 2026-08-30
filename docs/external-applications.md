# Add applications from any job site

The `Jobs` tab only contains jobs found by the sync. For a job from anywhere else, the
personal Chrome extension in
[`chrome_extension/quick_add_application`](../chrome_extension/quick_add_application)
adds a row to `App` without opening the spreadsheet.

It asks for **Company** and **Role**, fills the application link from the current browser
tab, and writes `Property`, today's `Date Applied`, `Process = Applied`, and the first
`Update` line itself. The extension does not read page contents and does not send data to
any server other than your Google Apps Script project.

## Install once

1. Push [`apps_script/`](../apps_script/) with `clasp` — the whole folder, so
   `external_application_api.gs` lands in the **same Apps Script project** as
   `sync_applied_to_app.gs`, which it needs because it reuses the tab layout and the
   duplicate-link check. Do not paste it in by hand.
2. Save, choose `configureExternalApplicationApi` in the function dropdown, and click
   **Run**. Approve Google's permission prompt. In **Execution log**, copy the extension
   key printed after `Chrome extension key (keep private):`; store it somewhere private for
   the next step. This also permanently records the current
   spreadsheet ID in Script Properties, so the web endpoint writes to the right sheet.
3. Click **Deploy → New deployment**. Choose **Web app**, set **Execute as: Me**, and set
   **Who has access** to **Anyone** (or the broadest no-sign-in option Google offers).
   Click **Deploy**, approve access if prompted, then copy the **Web app URL** ending in
   `/exec`. Do not use the `/dev` URL: it only works for the script editor.
4. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and
   choose the folder `Update_Job/chrome_extension/quick_add_application` from this repo.
5. Pin **Quick Add Application** in Chrome. Click its icon to open the side panel →
   **Settings**, paste the Web
   App URL and extension key, then click **Save settings**.

The deployment is reachable on the internet so Chrome can call it without a Google login
flow. It remains private in practice because every request needs the 64-character secret;
never share that key or commit it to the repository. The key is stored only in Chrome's
local extension storage on this computer.

## Use it

After submitting an application on an external site:

1. Leave that job page open and click the extension icon. The form opens as a side panel on
   the right, so it stays open while you click or copy from the job page.
2. Enter Company and Role. The current page URL is already in Application link; replace it
   if the page is not the actual application/job URL.
3. Click **Add to App**.

The popup reports either the assigned Property number, or that the same application is already
in `App`. It blocks duplicates by normalized link **or by the same Company + Role**, then
immediately ticks any matching `Jobs` row as `Applied`. Links differing only by a trailing
slash or known tracking parameters are also treated as duplicates.

The side panel automatically saves an unfinished Company, Role and Link locally in Chrome as
you type. Its draft also survives closing the panel or changing tabs, and is cleared only after
a successful add.

## If a key is exposed

In Apps Script, run `rotateExternalApplicationApiSecret`. Paste the new key into the
extension's Settings immediately. The old key stops working at once; the Web App URL does
not change.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `API is not configured` | Run `configureExternalApplicationApi` once in the spreadsheet-bound script. |
| `Invalid extension key` | Re-copy the key, or use the new one after rotating it. |
| `No tab named "App"` | Rename the application tab to `App`, matching the existing workflow. |
| Popup says it could not add the row | Check that Settings contains the deployed `/exec` URL, not `/dev`; then open the Apps Script deployment and confirm it is still active. |
| `already in App` | This is intentional duplicate protection. It checks the application link and Company + Role. Use a more specific role name if two genuinely distinct applications would otherwise have the same names. |

## Updating the extension

After changing any extension file in this repository, visit `chrome://extensions` and
press the extension's reload button. Your saved Web App URL and key remain in Chrome.
