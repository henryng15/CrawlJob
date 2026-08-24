/**
 * Jobs → App: tick the "Applied" box on the Jobs tab and that row moves to App.
 *
 * How to run it:
 *   1. Open the Google Sheet, Extensions → Apps Script
 *   2. Add a new file and paste this whole file in
 *   3. Pick setupJobsCheckboxes from the toolbar and press Run
 *   4. The first time, Google asks for permission → Review permissions → pick the account
 *      → Advanced → Go to (project name) → Allow
 *
 * No trigger to install: onEdit is a simple trigger, and Google calls it itself.
 *
 * The sync runs one way, Jobs → App. App is the source of truth — this script never
 * edits or deletes a row that has reached App, not when you untick it back on Jobs
 * and not when you tick Expired afterwards. Expired only stops a row going across;
 * it never calls one back.
 */

var JOBS_TAB    = 'Jobs';
var APP_TAB     = 'App';
var OUTREACH_QUEUE_TAB = 'Email';
// Column E is Source — where the row came from (Simplify, Jobright, Greenhouse…),
// written by the Python half. It sits BEFORE the two checkboxes rather than after,
// and that is not optional: every column past Expired is read as a note of yours,
// and a note is the only thing that stops the auto-tick. A Source column placed
// after F would look like a note on every row.
var SOURCE_COL  = 5;    // Jobs column E
var APPLIED_COL = 6;    // Jobs column F
var EXPIRED_COL = 7;    // Jobs column G — tick this and the row does not go to App
var FIRST_ROW   = 2;    // row 1 is the header
var LAST_ROW    = 500;  // room to grow, matching setup_process_dropdown.gs

// Jobs: Company | Role | Link Apply | Date Posted
var JOB_COMPANY = 0, JOB_ROLE = 1, JOB_LINK = 2;

// App: Property | Company | Application Link | Date Applied | Location | Process | Role | Note
// 1-based column numbers for getRange; subtract 1 to index a getValues array.
var APP_WIDTH = 8, APP_PROPERTY = 1, APP_COMPANY = 2, APP_LINK = 3, APP_DATE = 4, APP_ROLE = 7;
var PROCESS_COL = 6;   // App column F — the Process dropdown

// The last three columns of the App tab. I and J are checkboxes written by the
// Python half (highlight.py): does this company have an alumnus, does it have a
// recruiter. Both used to be background colours — yellow across the row, red in
// column I — but a checkbox can be filtered and sorted, and a colour cannot.
var ALUMNI_COL = 9, RECRUITER_COL = 10, UPDATE_COL = 11;

// The two checkbox columns only need room for the tick and the header word —
// nothing else ever goes in them. Update is the opposite: it has to hold several
// stacked lines like "Interview: Aug 12, 2026" without being dragged wider.
var ALUMNI_WIDTH_PX = 70, RECRUITER_WIDTH_PX = 90, UPDATE_WIDTH_PX = 300;

// The pipeline setup_process_dropdown.gs builds, and the same list as
// PROCESS_STAGES in job_sync/sheet.py. The first entry is where every row starts.
var STAGES = ['Applied', 'OA', 'Interview', 'Offer', 'Rejected'];

// Shorter than DATE_FORMAT because these lines stack inside one cell, but still
// read the same way as the rest of the sheet.
var UPDATE_DATE_FORMAT = 'MMM d, yyyy';

// The Email tab never holds a recruiter's name, address, or message body: those
// stay in the contacts spreadsheet the sending account owns. setupOutreachQueue()
// only creates the empty table — the sender is a separate project and fills it.
//
// The three columns copied straight from App lead, because they are the only ones
// a human reads to know which application a row is about. Everything after Attempt
// is the sending machinery, and everything past Sent At is an audit reference
// nobody looks at until something has gone wrong.
//
// Drafted At and Scheduled At are a pair, read left to right: the minute the
// message appears in Drafts, and the hour it leaves them. Every email waits an
// hour between the two, and deleting the draft inside that hour calls it off, so
// the pair is the column you check when you want to intervene.
//
// Priority leads Status because the two read as one answer: whether this row was
// asked for, and where it has got to. Ticking one lifts every row for the same
// company and role, so it is ticked once per job rather than once per attempt.
var OUTREACH_HEADERS = [
  'Company', 'Role', 'Date Applied', 'Property', 'Recruiters', 'Attempt',
  'Template', 'Drafted At', 'Scheduled At', 'Priority', 'Status', 'Mode',
  'Contact Fingerprint', 'Gmail Draft ID', 'Gmail Message ID', 'Sent At',
  'Result', 'Last Error', 'Queue ID', 'Version'
];
// Seven, and every one is a state the worker itself sets. An earlier list also
// carried Approved, Scheduled and Sending from a design with a separate approval
// step and a separate scheduler — Mode and Scheduled At do both of those jobs
// now — and an Opted out that a human had to remember to set by hand, for an
// outcome Replied already produces on its own.
var OUTREACH_STATUS = [
  'Queued', 'Drafted', 'Sent', 'Replied', 'Bounced', 'Cancelled', 'Failed'
];
var OUTREACH_MODE = ['Draft', 'Send'];

// Colour by value, the same way the Process dropdown does it. Queued is
// deliberately left plain: it is what most rows read most of the time, and a
// colour on the ordinary case is a colour that stops meaning anything. The eye
// should be pulled to the four that want something from you.
//
// Yellow means a person is involved, blue means the machine has it, green is good
// news, red and orange are the two ways a message does not arrive.
var OUTREACH_STATUS_COLOURS = [
  { name: 'Drafted',   bg: '#FFF2CC', fg: '#BF9000' },  // waiting for you to read it
  { name: 'Sent',      bg: '#CFE2F3', fg: '#1155CC' },  // gone, waiting on them
  { name: 'Replied',   bg: '#D9EAD3', fg: '#38761D' },  // somebody answered
  { name: 'Bounced',   bg: '#F4CCCC', fg: '#CC0000' },  // the address is bad
  { name: 'Failed',    bg: '#FCE5CD', fg: '#B45F06' },  // our end; it retries
  { name: 'Cancelled', bg: '#EFEFEF', fg: '#999999' }   // stopped, nothing to do
];
// Draft is yellow because it ends with you; Send is blue because it does not.
var OUTREACH_MODE_COLOURS = [
  { name: 'Draft', bg: '#FFF2CC', fg: '#BF9000' },
  { name: 'Send',  bg: '#CFE2F3', fg: '#1155CC' }
];
var OUTREACH_TIMESTAMP_FORMAT = 'mmm d, yyyy h:mm AM/PM';

// A stage that really happened on a date nothing ever recorded. Mark it so it can
// be found and filled in by hand, rather than inventing a date that looks real.
var UNKNOWN_DATE = '?';

// backfillTicksFromApp's second pass. The same job can carry different links on the
// two tabs — Python swaps an aggregator link for the employer's own when it finds
// one — so matching on links alone misses some. Set it to false if it ticks too
// many rows wrongly.
var MATCH_BY_NAME = true;

// Match how the existing rows show a date, rather than letting new rows fall back
// to the default format.
var DATE_FORMAT = 'mmmm d, yyyy';

// The same list as TRACKING_PARAMS in job_sync/sources.py: only the parameters that
// say who sent the click, never one that identifies the posting itself.
var TRACKING_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content',
                       'utm_term', 'ref', 'gh_src', 'src'];


/**
 * "The same posting" as this tool means it: Simplify hangs ?utm_source=Simplify&ref=Simplify
 * on the link speedyapply leaves bare, and those two links are one link.
 *
 * It does not have to agree byte for byte with normalize_link() on the Python side.
 * This only compares a link on Jobs against a link already in App, and both sides go
 * through this very function.
 */
function normalizeLink(value) {
  var url = String(value == null ? '' : value).trim();
  var parts = url.match(/^([A-Za-z][A-Za-z0-9+.\-]*):\/\/([^\/?#]*)([^?#]*)(?:\?([^#]*))?/);
  if (!parts) return url.toLowerCase();
  var host = parts[2].toLowerCase().replace(/^www\./, '');
  var path = parts[3].replace(/\/+$/, '').toLowerCase();
  var query = (parts[4] || '').split('&').filter(function (pair) {
    return pair && TRACKING_PARAMS.indexOf(pair.split('=')[0].toLowerCase()) === -1;
  }).join('&');
  return parts[1].toLowerCase() + '://' + host + path + (query ? '?' + query : '');
}


/**
 * A job the way Python identifies one: the (company, role) pair with case and
 * punctuation stripped. See name_key() and _identity() in job_sync/. Two trackers
 * write the same posting as "Intern - Summer 2027" and "Intern (Summer 2027)", and
 * both still have to produce one key.
 */
function nameKey(value) {
  return String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function identity(company, role) {
  var left = nameKey(company), right = nameKey(role);
  // Separated by NUL rather than a space: nameKey returns strings containing
  // spaces, so ("ibm a", "b") and ("ibm", "a b") would collide on one key.
  return left && right ? left + '\u0000' + right : '';
}


/**
 * Run once by hand: build the headers and checkboxes for the Jobs tab.
 *
 * Free-text notes start at column H, not G. A checkbox column reads as FALSE on
 * every row it covers, so if G counted as note space the Python half would see a
 * note on every row in the sheet and stop ticking anything automatically.
 */
function setupJobsCheckboxes() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var jobs = ss.getSheetByName(JOBS_TAB);
  if (!jobs) throw new Error('No tab named "' + JOBS_TAB + '".');
  if (!ss.getSheetByName(APP_TAB)) throw new Error('No tab named "' + APP_TAB + '".');

  jobs.getRange(1, APPLIED_COL).setValue('Applied');
  jobs.getRange(1, EXPIRED_COL).setValue('Expired');
  jobs.getRange(FIRST_ROW, APPLIED_COL, LAST_ROW - FIRST_ROW + 1, 2)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());

  ss.toast('Columns F and G (rows 2–' + LAST_ROW + ') are now checkboxes.', 'Done', 5);
}


/**
 * Run once by hand: create the empty Email tab.
 *
 * The queue is intentionally empty after this function finishes. A later,
 * separate worker will decide which App rows qualify and will append items; this
 * setup never reads App, sends mail, or creates a Gmail credential.
 *
 * Safe to run again: it restores the known headers and formatting, but refuses
 * to overwrite a non-empty header that means this is a different table.
 */
function setupOutreachQueue() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var queue = ss.getSheetByName(OUTREACH_QUEUE_TAB);
  var created = !queue;
  if (!queue) queue = ss.insertSheet(OUTREACH_QUEUE_TAB);

  var existing = queue.getRange(1, 1, 1, OUTREACH_HEADERS.length).getValues()[0];
  for (var i = 0; i < OUTREACH_HEADERS.length; i++) {
    var found = String(existing[i] == null ? '' : existing[i]).trim();
    if (found && found !== OUTREACH_HEADERS[i]) {
      throw new Error(
        'Email column ' + (i + 1) + ' is ' + JSON.stringify(found)
        + ', expected ' + JSON.stringify(OUTREACH_HEADERS[i]) + '. Refusing to overwrite it.'
      );
    }
  }

  var header = queue.getRange(1, 1, 1, OUTREACH_HEADERS.length);
  header.setValues([OUTREACH_HEADERS])
      .setFontWeight('bold')
      .setBackground('#D9EAD3')
      .setHorizontalAlignment('center');
  queue.setFrozenRows(1);

  // Date Applied is a date; the other three fields record an exact sending slot.
  queue.getRange(FIRST_ROW, 3, LAST_ROW - FIRST_ROW + 1, 1).setNumberFormat(DATE_FORMAT);
  [8, 9, 16].forEach(function (column) {
    queue.getRange(FIRST_ROW, column, LAST_ROW - FIRST_ROW + 1, 1)
         .setNumberFormat(OUTREACH_TIMESTAMP_FORMAT);
  });
  // A real checkbox rather than a free-text column: the worker obeys this cell, and
  // the difference between a box and a cell you type TRUE into is how often it is
  // ticked wrong. allowInvalid stays on so a row typed by hand before this ran is
  // not rejected — outreachTicked_ reads those spellings too.
  queue.getRange(FIRST_ROW, 10, LAST_ROW - FIRST_ROW + 1, 1)
       .setDataValidation(SpreadsheetApp.newDataValidation()
         .requireCheckbox()
         .setAllowInvalid(true)
         .build());
  queue.getRange(FIRST_ROW, 11, LAST_ROW - FIRST_ROW + 1, 1)
       .setDataValidation(SpreadsheetApp.newDataValidation()
         .requireValueInList(OUTREACH_STATUS, true)
         .setAllowInvalid(false)
         .build());
  queue.getRange(FIRST_ROW, 12, LAST_ROW - FIRST_ROW + 1, 1)
       .setDataValidation(SpreadsheetApp.newDataValidation()
         .requireValueInList(OUTREACH_MODE, true)
         .setAllowInvalid(false)
         .build());

  [170, 240, 115, 85, 85, 70, 100, 145, 145, 75, 105, 80, 180, 160, 180, 145,
   280, 200, 120, 70]
    .forEach(function (width, index) { queue.setColumnWidth(index + 1, width); });

  colourQueueColumn_(queue, 11, OUTREACH_STATUS_COLOURS);
  colourQueueColumn_(queue, 12, OUTREACH_MODE_COLOURS);

  ss.toast(
    created
      ? 'Created an empty Email tab. No application was queued and no email was sent.'
      : 'Email tab headers and formatting are already set. No queue items changed.',
    'Email',
    8
  );
}


/**
 * Make room for Priority on a tab that was built before it existed.
 *
 * setupOutreachQueue cannot do this itself. Its whole safety property is that it
 * refuses to write a header over a different one, and on an existing tab column 10
 * says Status where the new layout wants Priority — so it throws, correctly, and
 * the column has to be opened first. insertColumnBefore is what moves the ten
 * columns to its right along with their values, validation and colour rules;
 * rewriting headers over live data would have left every row shifted under the
 * wrong name.
 *
 * **Stop the sender before running this.** Run removeOutreachTriggers in the
 * standalone sender project, run this, deploy the sender, then run
 * installOutreachTriggers. Between the insert and the deploy the two disagree
 * about which column is which, and the disagreement is not harmless: the sender
 * would read Status from the new blank column, find no row that has spent a
 * contact, and queue a second cold email to people already written to. An hour of
 * no sending is the cheap half of that trade.
 *
 * Safe to run twice: a tab that already has Priority in column 10 is left alone.
 */
function migrateOutreachPriorityColumn() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var queue = ss.getSheetByName(OUTREACH_QUEUE_TAB);
  if (!queue) {
    setupOutreachQueue();
    return;
  }

  var header = queue.getRange(1, 1, 1, OUTREACH_HEADERS.length).getValues()[0];
  var at10 = String(header[9] == null ? '' : header[9]).trim();

  if (at10 === 'Priority') {
    setupOutreachQueue();
    ss.toast('Priority is already column 10. Nothing moved.', 'Email', 8);
    return;
  }
  // Anything other than the layout this migration was written against is a tab
  // somebody has already rearranged, and shifting it blind would put every row
  // under the wrong header. Say what was found instead.
  if (at10 !== 'Status') {
    throw new Error(
      'Email column 10 is ' + JSON.stringify(at10) + ', expected "Status" or '
      + '"Priority". This tab is not the layout this migration moves; fix it by '
      + 'hand or say what it should be.'
    );
  }

  queue.insertColumnBefore(10);
  // The insert leaves column 10 blank, including its header, so setupOutreachQueue
  // no longer has a conflicting name to refuse — it fills in the header, the
  // checkbox, the widths and the two dropdown colourings at their new positions.
  setupOutreachQueue();
  ss.toast(
    'Inserted Priority as column 10. Deploy the sender now, before the hourly '
    + 'trigger goes back on.',
    'Email',
    12
  );
}


/**
 * Paint one dropdown column by value.
 *
 * Rules belonging to other columns are kept and only this column's are replaced,
 * so running setupOutreachQueue again does not stack a second identical set on
 * top of the first — the same care setup_process_dropdown.gs takes.
 */
function colourQueueColumn_(queue, column, palette) {
  var range = queue.getRange(FIRST_ROW, column, LAST_ROW - FIRST_ROW + 1, 1);
  var kept = queue.getConditionalFormatRules().filter(function (rule) {
    return rule.getRanges().every(function (r) { return r.getColumn() !== column; });
  });
  var added = palette.map(function (entry) {
    return SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(entry.name)
      .setBackground(entry.bg)
      .setFontColor(entry.fg)
      .setRanges([range])
      .build();
  });
  queue.setConditionalFormatRules(kept.concat(added));
}


/**
 * Run once by hand: build the last three columns of the App tab — Alumni (I),
 * Recruiter (J), Update (K) — and fill in the history for the rows already there.
 *
 * Safe to run as many times as you like: an Update cell that already has text is
 * left alone, and the column-move step runs only when there is really a move left
 * to make.
 */
function setupAppColumns() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var app = ss.getSheetByName(APP_TAB);
  if (!app) throw new Error('No tab named "' + APP_TAB + '".');

  var moved = migrateUpdateColumn(app);
  app.getRange(1, ALUMNI_COL).setValue('Alumni');
  app.getRange(1, RECRUITER_COL).setValue('Recruiter');
  app.getRange(1, UPDATE_COL).setValue('Update');
  app.setColumnWidth(ALUMNI_COL, ALUMNI_WIDTH_PX);
  app.setColumnWidth(RECRUITER_COL, RECRUITER_WIDTH_PX);
  app.setColumnWidth(UPDATE_COL, UPDATE_WIDTH_PX);

  var bottom = app.getLastRow();
  if (bottom < FIRST_ROW) {
    ss.toast('Tab ' + APP_TAB + ' has no rows yet.', 'App', 5);
    return;
  }
  var count = bottom - FIRST_ROW + 1;

  // Cover only as far as the real last row, NOT out to LAST_ROW the way Jobs does.
  // A checkbox validation physically writes FALSE into every cell it covers, so
  // covering to row 500 would make app.getLastRow() return 500 and onEdit would
  // append each new row at row 501.
  //
  // The cost is that this range stands still while the tab grows with every
  // application — so a new row picks up its validation two other ways: onEdit copies
  // it from the last entry row, and every Python sync resets the rule across exactly
  // the range it writes. With neither, the cell holds a boolean that no checkbox is
  // drawing, and Sheets prints the bare word FALSE.
  app.getRange(FIRST_ROW, ALUMNI_COL, count, 2)
     .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());

  var dates = app.getRange(FIRST_ROW, APP_DATE, count, 1).getValues();
  var stages = app.getRange(FIRST_ROW, PROCESS_COL, count, 1).getValues();
  var column = app.getRange(FIRST_ROW, UPDATE_COL, count, 1);
  var notes = column.getValues();
  var filled = 0;
  var unknown = 0;

  for (var i = 0; i < count; i++) {
    if (String(notes[i][0] == null ? '' : notes[i][0]).trim()) continue;
    // No Process means it is not an entry — App has a few rows carrying only a link.
    var stage = stageLabel(stages[i][0]);
    if (!stage) continue;
    var text = STAGES[0] + ': ' + stamp(dates[i][0]);
    if (stage !== STAGES[0]) {
      text += '\n' + stage + ': ' + UNKNOWN_DATE;
      unknown++;
    }
    notes[i][0] = text;
    filled++;
  }

  column.setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  if (filled) column.setValues(notes);
  ss.toast(updateReport(filled, unknown, moved), 'App', 10);
}


/**
 * Update used to live at J, up until the day Alumni and Recruiter took I and J.
 * This moves it to K, exactly once.
 *
 * Two conditions stand guard and both are needed: J1 must actually read 'Update' (if
 * not, this is a sheet that never built the column and there is nothing to move),
 * and K1 must be empty (if not, the move already happened, and moving again would
 * overwrite the very history it moved across).
 */
function migrateUpdateColumn(app) {
  if (String(app.getRange(1, RECRUITER_COL).getValue()).trim() !== 'Update') return 0;
  if (String(app.getRange(1, UPDATE_COL).getValue()).trim()) return 0;

  var moved = 0;
  var bottom = app.getLastRow();
  if (bottom >= FIRST_ROW) {
    var count = bottom - FIRST_ROW + 1;
    var from = app.getRange(FIRST_ROW, RECRUITER_COL, count, 1);
    var values = from.getValues();
    for (var i = 0; i < count; i++) if (String(values[i][0]).trim()) moved++;
    app.getRange(FIRST_ROW, UPDATE_COL, count, 1)
       .setValues(values)
       .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
    from.clearContent();
  }
  return moved;
}


function updateReport(filled, unknown, moved) {
  var parts = [];
  if (moved) parts.push('Moved ' + rowCount(moved) + ' of history from column J to K');
  if (filled) {
    var text = 'Filled in ' + rowCount(filled) + ' in the Update column';
    if (unknown) {
      text += ' (' + unknown + ' at a stage past Applied, so the date reads "'
           + UNKNOWN_DATE + '" — search for that mark and fill it in by hand)';
    }
    parts.push(text);
  }
  if (!parts.length) return 'All three columns are already right; nothing to fix.';
  return parts.join('. ') + '.';
}


/**
 * Run by hand: tick the jobs on Jobs that are already sitting in App, so that the
 * unticked list is exactly the list still to apply to.
 *
 * It writes only to the Applied column on Jobs. No row is added to App: Apps Script
 * does not fire onEdit for a change the script itself made, and these jobs are in
 * App already.
 *
 * It only ticks, never unticks — a box you ticked for a reason of your own survives.
 */
function backfillTicksFromApp() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var jobs = ss.getSheetByName(JOBS_TAB);
  var app = ss.getSheetByName(APP_TAB);
  if (!jobs) throw new Error('No tab named "' + JOBS_TAB + '".');
  if (!app) throw new Error('No tab named "' + APP_TAB + '".');

  var bottom = jobs.getLastRow();
  if (bottom < FIRST_ROW) {
    ss.toast('Tab ' + JOBS_TAB + ' has no rows yet.', 'App → Jobs', 5);
    return;
  }

  var links = existingLinks(app);
  var names = MATCH_BY_NAME ? existingNames(app) : Object.create(null);
  var count = bottom - FIRST_ROW + 1;
  var rows = jobs.getRange(FIRST_ROW, 1, count, 4).getValues();
  var ticks = jobs.getRange(FIRST_ROW, APPLIED_COL, count, 1).getValues();
  var byLink = 0;
  var byName = [];

  for (var i = 0; i < count; i++) {
    if (ticks[i][0] === true) continue;
    var key = normalizeLink(rows[i][JOB_LINK]);
    if (key && links[key]) {
      ticks[i][0] = true;
      byLink++;
      continue;
    }
    var name = identity(rows[i][JOB_COMPANY], rows[i][JOB_ROLE]);
    if (name && names[name]) {
      ticks[i][0] = true;
      // Matching by name is the more error-prone pass, so log it to be checked.
      byName.push('Jobs!' + (FIRST_ROW + i) + ': ' + rows[i][JOB_COMPANY] + ' — ' + rows[i][JOB_ROLE]);
    }
  }

  if (byLink + byName.length) {
    jobs.getRange(FIRST_ROW, APPLIED_COL, count, 1).setValues(ticks);
    if (byName.length) console.log('Tick theo company + role:\n' + byName.join('\n'));
  }
  ss.toast(backfillReport(byLink, byName.length), 'App → Jobs', 10);
}


function backfillReport(byLink, byName) {
  if (!byLink && !byName) return 'No further rows to tick.';
  var text = 'Ticked ' + rowCount(byLink + byName) + ': ' + byLink + ' matched by link';
  if (MATCH_BY_NAME) text += ', ' + byName + ' by company + role (see the Execution log)';
  return text + '.';
}


/**
 * This trigger runs every time any cell in the file is edited, so the first thing it
 * does is ask which tab the cell is on and hand it to the right half. The two tabs
 * listen to different columns and do different things: ticking Applied on Jobs
 * creates a row in App; changing Process on App appends a dated line to Update.
 */
function onEdit(e) {
  var name = e.range.getSheet().getName();
  if (name === JOBS_TAB) return onJobsEdit(e);
  if (name === APP_TAB) return onAppEdit(e);
}


function onJobsEdit(e) {
  var range = e.range;
  if (range.getColumn() > APPLIED_COL || range.getLastColumn() < APPLIED_COL) return;
  var jobs = range.getSheet();

  var firstRow = Math.max(range.getRow(), FIRST_ROW);
  var lastRow = range.getLastRow();
  if (lastRow < firstRow) return;  // only the header was edited

  // Fill-down and paste edit many rows at once, so read the whole block rather than
  // just the first cell.
  var count = lastRow - firstRow + 1;
  var flags = jobs.getRange(firstRow, APPLIED_COL, count, 2).getValues();
  var picked = [];
  var expired = 0;
  for (var i = 0; i < count; i++) {
    if (flags[i][0] !== true) continue;  // unticking does nothing
    // Expired beats Applied: you have said this posting is no longer there to apply
    // to, so a ticked Applied box has nothing worth carrying across to App.
    if (flags[i][1] === true) { expired++; continue; }
    picked.push(i);
  }
  if (!picked.length) {
    if (expired) {
      var ss0 = e.source;
      ss0.toast('Skipped ' + rowCount(expired) + ' ticked Expired.', 'Jobs → App', 6);
    }
    return;
  }

  var ss = e.source;
  var app = ss.getSheetByName(APP_TAB);
  if (!app) {
    ss.toast('No tab named "' + APP_TAB + '".', 'Jobs → App', 8);
    return;
  }

  var jobRows = jobs.getRange(firstRow, 1, count, 4).getValues();
  var seen = existingLinks(app);
  var last = lastEntry(app);
  var property = last.property + 1;
  var fresh = [];
  var skipped = 0;

  for (var j = 0; j < picked.length; j++) {
    var row = jobRows[picked[j]];
    var link = String(row[JOB_LINK] || '').trim();
    var key = link && normalizeLink(link);
    // A row with no link has nothing to dedupe on, so leave it for you to fill in
    // rather than guessing.
    if (!key || seen[key]) { skipped++; continue; }
    seen[key] = true;
    // Location is left empty: Jobs does not carry it.
    fresh.push([property++, row[JOB_COMPANY], link, new Date(), '', 'Applied', row[JOB_ROLE], '']);
  }

  if (fresh.length) {
    var start = app.getLastRow() + 1;
    var written = app.getRange(start, 1, fresh.length, APP_WIDTH);
    written.setValues(fresh);
    app.getRange(start, APP_DATE, fresh.length, 1).setNumberFormat(DATE_FORMAT);
    // The first line of the history, seeded right here. The script writes 'Applied'
    // into the Process column itself, and Apps Script does not call onEdit back for a
    // change the script made — without seeding it, the opening stage of every new row
    // would vanish without trace.
    var today = stamp(new Date());
    var seeded = [];
    for (var k = 0; k < fresh.length; k++) seeded.push([STAGES[0] + ': ' + today]);
    app.getRange(start, UPDATE_COL, fresh.length, 1)
       .setValues(seeded)
       .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
    // The validation is copied rather than rebuilt: the Process dropdown on the rows
    // above is a set of coloured chips made through the UI, and Apps Script has no API
    // for setting a chip colour. Copying makes the new row identical to the old one
    // however that dropdown was originally created.
    // Out to the end of column J, not stopping at APP_WIDTH: the two checkboxes are
    // validation too, and a new row without them turns the next sync's TRUE/FALSE into
    // bare words sitting on top of the cell.
    if (last.row) {
      app.getRange(last.row, 1, 1, RECRUITER_COL)
         .copyTo(app.getRange(start, 1, fresh.length, RECRUITER_COL),
                 SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
    }
  }
  ss.toast(report(fresh.length, skipped, expired), 'Jobs → App', 6);
}


/**
 * App: changing Process in column F appends one "<Stage>: <date>" line to the Update
 * column.
 *
 * That cell is a history, not a log. Each stage is written exactly once: going back to
 * a stage already passed, or pasting the value that is already there, adds no line.
 * Got one wrong? Edit the cell directly — it is free text, and the script only ever
 * appends, never rewrites what is already there.
 *
 * A value outside the pipeline is ignored: the dropdown already lists every real
 * stage, so anything that does not match is a typo, and a typo does not deserve a
 * date.
 */
function onAppEdit(e) {
  var range = e.range;
  if (range.getColumn() > PROCESS_COL || range.getLastColumn() < PROCESS_COL) return;
  var firstRow = Math.max(range.getRow(), FIRST_ROW);
  var lastRow = range.getLastRow();
  if (lastRow < firstRow) return;  // only the header was edited

  // Fill-down and paste edit many rows at once, so read the whole block rather than
  // just the first cell.
  var app = range.getSheet();
  var count = lastRow - firstRow + 1;
  var stages = app.getRange(firstRow, PROCESS_COL, count, 1).getValues();
  var notes = app.getRange(firstRow, UPDATE_COL, count, 1).getValues();
  var today = stamp(new Date());
  var written = 0;

  for (var i = 0; i < count; i++) {
    var stage = stageLabel(stages[i][0]);
    if (!stage) continue;
    var cell = String(notes[i][0] == null ? '' : notes[i][0]).replace(/\s+$/, '');
    if (hasStage(cell, stage)) continue;
    notes[i][0] = (cell ? cell + '\n' : '') + stage + ': ' + today;
    written++;
  }
  if (!written) return;

  // Without WRAP the cell shows only its first line, and the whole history looks
  // like it was lost.
  app.getRange(firstRow, UPDATE_COL, count, 1)
     .setValues(notes)
     .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  e.source.toast(stageReport(written, today), 'App', 5);
}


function stageReport(written, today) {
  return 'Wrote ' + today + ' to the Update column of ' + rowCount(written) + '.';
}


/**
 * The canonical name of a stage, or '' if the value is not in the pipeline. Typing
 * "oa" by hand and picking "OA" from the dropdown have to produce the same line, or
 * hasStage() reads two spellings as two different stages and writes a duplicate.
 */
function stageLabel(value) {
  var text = String(value == null ? '' : value).trim().toLowerCase();
  for (var i = 0; i < STAGES.length; i++) {
    if (STAGES[i].toLowerCase() === text) return STAGES[i];
  }
  return '';
}


/** Whether this stage already has its line in the cell. Compares what precedes ':'. */
function hasStage(cell, stage) {
  var lines = String(cell == null ? '' : cell).split('\n');
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].split(':')[0].trim().toLowerCase() === stage.toLowerCase()) return true;
  }
  return false;
}


/**
 * The date to write into the cell. Date Applied returns a Date, but a few older rows
 * hold text — keep whatever can be read, and write '?' for whatever cannot, so it can
 * be found and filled in by hand.
 *
 * Object.prototype.toString rather than instanceof: a Date handed back by Apps Script
 * and a Date made by the script are not always from the same realm.
 */
function stamp(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), UPDATE_DATE_FORMAT);
  }
  var text = String(value == null ? '' : value).trim();
  return text || UNKNOWN_DATE;
}


/**
 * The links already in App, normalized. Re-ticking a row that has synced — or
 * ticking a job you once applied to through a different link — must not produce a
 * second row.
 *
 * Object.create(null) rather than {}: a key that collides with an inherited property
 * name ("constructor") reads as truthy on an ordinary object and reports a false
 * duplicate.
 */
function existingLinks(app) {
  var seen = Object.create(null);
  var last = app.getLastRow();
  if (last < FIRST_ROW) return seen;
  var links = app.getRange(FIRST_ROW, APP_LINK, last - FIRST_ROW + 1, 1).getValues();
  for (var i = 0; i < links.length; i++) {
    var key = normalizeLink(links[i][0]);
    if (key) seen[key] = true;
  }
  return seen;
}


/**
 * The (company, role) pairs already in App. Used by the backfill, not by onEdit: the
 * moment you tick a box you have genuinely just applied, so a row skipped there for a
 * "name collision" is a lost record — much worse than one row too many.
 */
function existingNames(app) {
  var seen = Object.create(null);
  var bottom = app.getLastRow();
  if (bottom < FIRST_ROW) return seen;
  var rows = app.getRange(FIRST_ROW, 1, bottom - FIRST_ROW + 1, APP_WIDTH).getValues();
  for (var i = 0; i < rows.length; i++) {
    var key = identity(rows[i][APP_COMPANY - 1], rows[i][APP_ROLE - 1]);
    if (key) seen[key] = true;
  }
  return seen;
}


/**
 * Two things read in the same pass over the Property column.
 *
 * `property` is the largest number in use, not the row count: App may have had a row
 * deleted from the middle, and two rows carrying the same number is worse than a gap.
 *
 * `row` is the last row that is genuinely an entry, used as the template the dropdown
 * is copied from. App has a few rows carrying only a link in column C — one of those
 * can sit at the bottom while holding no validation worth copying.
 */
function lastEntry(app) {
  var bottom = app.getLastRow();
  if (bottom < FIRST_ROW) return { property: 0, row: 0 };
  var values = app.getRange(FIRST_ROW, APP_PROPERTY, bottom - FIRST_ROW + 1, 1).getValues();
  var found = { property: 0, row: 0 };
  for (var i = 0; i < values.length; i++) {
    var n = Number(values[i][0]);
    if (values[i][0] === '' || !isFinite(n)) continue;
    if (n > found.property) found.property = n;
    found.row = FIRST_ROW + i;
  }
  return found;
}


/** "1 row" / "2 rows". The reports read as sentences, so the noun has to agree. */
function rowCount(n) {
  return n + (n === 1 ? ' row' : ' rows');
}


function report(added, skipped, expired) {
  var tail = '';
  if (skipped) tail += ' Skipped ' + rowCount(skipped) + ' already in App or missing a link.';
  if (expired) tail += ' Skipped ' + rowCount(expired) + ' ticked Expired.';
  if (!added) return 'Added no rows to ' + APP_TAB + '.' + tail;
  return 'Added ' + rowCount(added) + ' to ' + APP_TAB + '.' + tail;
}
