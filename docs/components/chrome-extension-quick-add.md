# chrome_extension/quick_add_application/popup.js

The extension's side panel for recording applications from sites outside the synced `Jobs`
list. It stores an unfinished form locally in Chrome and posts completed applications to the
spreadsheet-bound Apps Script Web App. The endpoint defaults to the verified deployment and is
saved in Chrome Settings with the extension key.

| Function or handler | Does |
|---|---|
| `copyText(value)` | Copies a value through the Clipboard API, with a textarea fallback. |
| `setStatus(message, kind)` | Shows success or error feedback in the side panel. |
| `validEndpoint(value)` | Accepts an HTTPS Apps Script Web App URL ending in `/exec`. |
| `parseApiResponse(response)` | Parses the Apps Script JSON response and marks Google HTML errors with their HTTP status for recovery. |
| `sendApplication(target, requestBody)` | Posts the application; if a saved deployment returns HTML 404, retries the verified default deployment and repairs the saved URL. |
| `saveDraft()` | Stores the current Company, Role and Link in local extension storage. |
| `fillLoginBoxes(login)` | Runs in the active tab's frames, finds visible sign-in inputs (including open shadow roots), and fills email/password fields. |
| Copy-link, sign-in, settings and form event handlers | Copy profile links, invoke sign-in filling, save endpoint/key settings, and submit the application to Apps Script. A missing URL defaults to the verified Web App; a non-JSON HTML response is surfaced as a deployment URL or access problem instead of a JSON parser exception. |
