/**
 * Personal Chrome extension → App tab.
 *
 * This file belongs in the same spreadsheet-bound Apps Script project as
 * sync_applied_to_app.gs.  It exposes a small Web App endpoint which accepts
 * Company, Role and Application Link, and writes the other App fields itself.
 *
 * First run configureExternalApplicationApi() by hand. It records this sheet's
 * ID and writes a generated secret to the Execution log. Deploy the project as
 * a Web App afterwards.
 * Full installation steps: ../docs/external-applications.md
 */

var EXTERNAL_APP_SHEET_ID = 'external_application_sheet_id';
var EXTERNAL_APP_SECRET = 'external_application_secret';


/**
 * Run once from the Apps Script editor while this script is bound to the target
 * spreadsheet. The returned secret is for the Chrome extension only; do not
 * put it in a GitHub issue, commit, or screenshot.
 */
function configureExternalApplicationApi() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('Open this function from the Apps Script project bound to your spreadsheet.');

  var properties = PropertiesService.getScriptProperties();
  properties.setProperty(EXTERNAL_APP_SHEET_ID, spreadsheet.getId());

  var secret = properties.getProperty(EXTERNAL_APP_SECRET);
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    properties.setProperty(EXTERNAL_APP_SECRET, secret);
  }

  // Do not use SpreadsheetApp.getUi().alert here. When run from the Apps
  // Script editor it can wait forever for a dialog that the editor never shows.
  // The execution log is available from both the editor and the Executions view.
  console.log('Chrome extension key (keep private): ' + secret);
  return secret;
}


/** Generate a replacement extension key, invalidating the old one immediately. */
function rotateExternalApplicationApiSecret() {
  var properties = PropertiesService.getScriptProperties();
  if (!properties.getProperty(EXTERNAL_APP_SHEET_ID)) {
    throw new Error('Run configureExternalApplicationApi first.');
  }
  var secret = Utilities.getUuid() + Utilities.getUuid();
  properties.setProperty(EXTERNAL_APP_SECRET, secret);
  console.log('New Chrome extension key (keep private): ' + secret);
  return secret;
}


/** Web App entry point. Always return JSON so the extension can show a useful result. */
function doPost(e) {
  try {
    var payload = externalApplicationPayload_(e);
    var result = addExternalApplication_(payload);
    return externalApplicationJson_({ ok: true, result: result });
  } catch (error) {
    console.log('External application API: ' + error.message);
    return externalApplicationJson_({ ok: false, error: String(error.message || error) });
  }
}


function externalApplicationPayload_(e) {
  if (!e || !e.postData || !e.postData.contents) throw new Error('Missing request body.');
  var payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (error) {
    throw new Error('Request body must be JSON.');
  }
  if (!payload || typeof payload !== 'object') throw new Error('Request body must be an object.');

  var configured = PropertiesService.getScriptProperties().getProperty(EXTERNAL_APP_SECRET);
  if (!configured) throw new Error('API is not configured. Run configureExternalApplicationApi first.');
  if (String(payload.secret || '') !== configured) throw new Error('Invalid extension key.');

  var company = externalApplicationText_(payload.company, 'Company', 200);
  var role = externalApplicationText_(payload.role, 'Role', 300);
  var link = String(payload.link == null ? '' : payload.link).trim();
  if (!/^https?:\/\//i.test(link)) throw new Error('Application link must start with http:// or https://.');
  if (link.length > 2000) throw new Error('Application link is too long.');

  return { company: company, role: role, link: link };
}


function externalApplicationText_(value, label, maximum) {
  var text = String(value == null ? '' : value).trim();
  if (!text) throw new Error(label + ' is required.');
  if (text.length > maximum) throw new Error(label + ' is too long.');
  // setValues interprets a leading '=' as a formula. These fields are notes from
  // the user, never formulas, so make every possible spreadsheet formula literal.
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}


function addExternalApplication_(payload) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('Another application is being added. Please submit again.');

  try {
    var properties = PropertiesService.getScriptProperties();
    var spreadsheetId = properties.getProperty(EXTERNAL_APP_SHEET_ID);
    if (!spreadsheetId) throw new Error('API is not configured. Run configureExternalApplicationApi first.');

    var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    var app = spreadsheet.getSheetByName(APP_TAB);
    if (!app) throw new Error('No tab named "' + APP_TAB + '".');

    var normalized = normalizeLink(payload.link);
    if (!normalized) throw new Error('Application link is invalid.');
    var sameLink = existingLinks(app)[normalized];
    var sameName = existingNames(app)[identity(payload.company, payload.role)];
    if (sameLink || sameName) {
      // An external application may use the employer's link while Jobs carries
      // an aggregator link.  Treat the same Company + Role as the same record
      // here, then immediately mark its Jobs counterpart Applied as well.
      var duplicateTicks = markExternalApplicationJobsApplied_(spreadsheet, payload);
      return {
        added: false,
        jobsTicked: duplicateTicks,
        message: sameLink
            ? 'This application link is already in ' + APP_TAB + '.'
            : 'This company and role are already in ' + APP_TAB + '.'
      };
    }

    var last = lastEntry(app);
    var row = Math.max(app.getLastRow() + 1, FIRST_ROW);
    var property = last.property + 1;
    var today = new Date();
    app.getRange(row, 1, 1, APP_WIDTH).setValues([[
      property, payload.company, payload.link, today, '', STAGES[0], payload.role, ''
    ]]);
    app.getRange(row, APP_DATE, 1, 1).setNumberFormat(DATE_FORMAT);
    app.getRange(row, UPDATE_COL, 1, 1)
       .setValue(STAGES[0] + ': ' + stamp(today))
       .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);

    // Carry over the Process dropdown and the Alumni/Recruiter checkbox rules.
    // An empty App tab has no template yet; setupAppColumns and
    // setupProcessDropdown create those rules once a first row exists.
    if (last.row) {
      app.getRange(last.row, 1, 1, RECRUITER_COL)
         .copyTo(app.getRange(row, 1, 1, RECRUITER_COL),
                 SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
    }
    var jobsTicked = markExternalApplicationJobsApplied_(spreadsheet, payload);
    SpreadsheetApp.flush();
    return {
      added: true,
      property: property,
      row: row,
      jobsTicked: jobsTicked,
      message: 'Added to ' + APP_TAB + '.'
    };
  } finally {
    lock.releaseLock();
  }
}


/**
 * Keep the visible Jobs queue in step with an application that came in through
 * the extension. Programmatic setValues does not invoke onEdit, so this cannot
 * create another App row. The normal scheduled sync does the same backfill;
 * doing it here means it is immediate.
 */
function markExternalApplicationJobsApplied_(spreadsheet, payload) {
  var jobs = spreadsheet.getSheetByName(JOBS_TAB);
  if (!jobs || jobs.getLastRow() < FIRST_ROW) return 0;

  var target = identity(payload.company, payload.role);
  if (!target) return 0;
  var count = jobs.getLastRow() - FIRST_ROW + 1;
  var rows = jobs.getRange(FIRST_ROW, 1, count, 2).getValues();
  var ticks = jobs.getRange(FIRST_ROW, APPLIED_COL, count, 1).getValues();
  var changed = 0;
  for (var i = 0; i < count; i++) {
    if (ticks[i][0] === true) continue;
    if (identity(rows[i][JOB_COMPANY], rows[i][JOB_ROLE]) !== target) continue;
    ticks[i][0] = true;
    changed++;
  }
  if (changed) jobs.getRange(FIRST_ROW, APPLIED_COL, count, 1).setValues(ticks);
  return changed;
}


function externalApplicationJson_(body) {
  return ContentService.createTextOutput(JSON.stringify(body))
      .setMimeType(ContentService.MimeType.JSON);
}
