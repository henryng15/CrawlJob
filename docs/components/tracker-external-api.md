# apps_script/external_application_api.gs + setup_process_dropdown.gs

## external_application_api.gs — applications recorded from outside the sheet

A Web App endpoint so a browser extension can record an application made on the employer's own
site, without anybody opening the spreadsheet.

### Connections

- **In:** `POST` from the extension, authenticated by a shared secret.
- **Writes:** appends to `App`, and ticks the matching `Jobs` row so the visible queue stays in step.
- Deployed as a **pinned** Web App (`@2`). `clasp push` alone does not update it.

| Function | Does |
|---|---|
| `configureExternalApplicationApi()` | Run once from the editor while bound to the target spreadsheet: stores the secret and the ids. |
| `rotateExternalApplicationApiSecret()` | Issue a new secret and invalidate the old one. |
| `doPost(e)` | The endpoint. Verifies the secret, then records the application. |
| `externalApplicationPayload_(e)` | Parse and validate the request body. |
| `externalApplicationText_(payload)` | The row's text fields, cleaned. |
| `addExternalApplication_(payload)` | Append the `App` row. |
| `markExternalApplicationJobsApplied_(payload)` | Tick the `Jobs` row, so the visible queue matches. |
| `externalApplicationJson_(obj)` | The JSON response. |

### Gotcha

Two writes, two tabs, one request. If `markExternalApplicationJobsApplied_` fails, the
application exists in `App` and the `Jobs` row still reads as untouched — the hourly
housekeeping is what reconciles that, not the endpoint.

## setup_process_dropdown.gs

| Function | Does |
|---|---|
| `setupProcessDropdown()` | Run once by hand: build the `Process` dropdown on `App` with the pipeline's stage names. |

The stage names here and `stageLabel` in [tracker-sync.md](tracker-sync.md) are the same list.
Changing one without the other lets a person pick a stage that `onAppEdit` refuses to stamp.
