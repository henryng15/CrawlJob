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
//
// APP_WIDTH is eight and stays eight however many columns the tab grows, because
// it is not the width of the tab: it is the width of the block this script writes
// when a ticked row crosses from Jobs, and reads back when it needs the last
// Property number. That block is A..Note and nothing past it — every later column
// is either filled in by hand or written by the Python half. Widening it to match
// the tab would hand setValues a nine-wide range and eight-wide rows, which throws
// on the real service and would strand every new application half-written.
var APP_WIDTH = 8, APP_PROPERTY = 1, APP_COMPANY = 2, APP_LINK = 3, APP_DATE = 4, APP_ROLE = 7;
var PROCESS_COL = 6;   // App column F — the Process dropdown

// App column I, and the only column on this tab a person fills in by hand. It
// holds the employer's own posting for an application whose Application Link is
// an aggregator's — the link you send somebody when you ask them to refer you,
// and the one thing a referral request cannot be written without.
//
// It sits between Note and Alumni rather than at the end because it is read with
// the application, not with the answer to it: Note and Official are what you look
// at while deciding whether this row is worth chasing, and Alumni, Recruiter and
// Update are what happens afterwards.
var APP_OFFICIAL = 9;

// The last three columns of the App tab. J and K are checkboxes written by the
// Python half (highlight.py): does this company have an alumnus, does it have a
// recruiter. Both used to be background colours — yellow across the row, red in
// column I — but a checkbox can be filtered and sorted, and a colour cannot.
var ALUMNI_COL = 10, RECRUITER_COL = 11, UPDATE_COL = 12;

// Wide enough to see which company's board a link points at without opening it —
// the same reason Application Link is wide.
var OFFICIAL_WIDTH_PX = 230;
// The two checkbox columns only need room for the tick and the header word —
// nothing else ever goes in them. Update is the opposite: it has to hold several
// stacked lines like "Interview: Aug 12, 2026" without being dragged wider.
var ALUMNI_WIDTH_PX = 70, RECRUITER_WIDTH_PX = 90, UPDATE_WIDTH_PX = 300;

// The same yellow the Email tab uses for "a person is involved", because it means
// the same thing here: this row is an application waiting on you to go and find
// the employer's own posting before anybody can be asked to refer you.
var APP_OFFICIAL_YELLOW = '#FFF2CC';

// The pipeline setup_process_dropdown.gs builds, and the same list as
// PROCESS_STAGES in job_sync/sheet.py. The first entry is where every row starts.
var STAGES = ['Applied', 'OA', 'Completed OA', 'Interview', 'Offer', 'Rejected'];

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
//
// The three follow-up columns sit immediately after Mode, because they answer the
// same question one message later: this row was sent, nobody replied, so a nudge
// is booked for that day, using that sentence, and here is whether it has gone.
// Read next to Status they are one story; read from past the audit references
// they would be three columns nobody scrolls to.
var OUTREACH_HEADERS = [
  'Company', 'Role', 'Date Applied', 'Property', 'Recruiters', 'Attempt',
  'Template', 'Drafted At', 'Scheduled At', 'Priority', 'Status', 'Mode',
  'Follow Up', 'Follow Up Template', 'Follow Up Status',
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

// Six, and the same list as QUEUE_FOLLOWUP_STATUSES in the sender's
// outreach_config.gs — two Apps Script projects cannot share a file, so these
// have to agree by hand, the same arrangement OUTREACH_STATUS already has.
//
// Skipped and Stopped are the two worth telling apart. Skipped is a row this was
// never going to chase; Stopped is a row that had a day booked and lost it,
// because somebody at that company answered in between. One is a decision made
// once, the other a decision reversed, and the reversed one is what you go
// looking for.
var OUTREACH_FOLLOWUP_STATUS = [
  'Queued', 'Drafted', 'Sent', 'Skipped', 'Stopped', 'Failed'
];

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
// The same palette as Status, so the two columns can be read together without
// learning a second colour language. Green is on Stopped here rather than on a
// reply, and it is the same news wearing a different word: somebody answered, so
// this nudge is not needed.
var OUTREACH_FOLLOWUP_COLOURS = [
  { name: 'Drafted', bg: '#FFF2CC', fg: '#BF9000' },
  { name: 'Sent',    bg: '#CFE2F3', fg: '#1155CC' },
  { name: 'Stopped', bg: '#D9EAD3', fg: '#38761D' },
  { name: 'Failed',  bg: '#FCE5CD', fg: '#B45F06' },
  { name: 'Skipped', bg: '#EFEFEF', fg: '#999999' }
];
var OUTREACH_TIMESTAMP_FORMAT = 'mmm d, yyyy h:mm AM/PM';

// The Referral tab DOES hold the person's name and address, in Person and Email.
// That is a deliberate decision by the sheet's owner and the plain opposite of the
// rule the Email tab keeps a few lines above: a referral is asked for once, by
// hand, from somebody you already have a reason to write to, so the tab has to be
// readable end to end without opening the contacts spreadsheet to find out who
// row 14 even is. The Email tab sends in bulk and unattended, which is why its
// recipients stay out of a spreadsheet a screen-share can expose.
//
// Person, Email and Title lead because they are the row: which human this is.
// Tier is how senior they are, and it changes what Template is worth using, so
// the two sit together. Everything from Status rightwards is the same machinery
// the Email tab carries, in the same order, so the two tabs read alike where they
// do the same job.
var REFERRAL_QUEUE_TAB = 'Referral';
// Eighteen, and Gmail Draft ID is the one worth explaining. It sits between Mode
// and Sent At because that is where it happens: the row is written, the draft
// exists for an hour under this id, and deleting that draft in Gmail is what
// calls the message off. An earlier layout had no column for it and let the id
// ride in Result until the send replaced it with the sent message's id, which
// meant Result held two different kinds of Gmail id and you had to read Status
// to know which. The same arrangement the Email tab already uses, for the same
// reason it uses it.
var REFERRAL_HEADERS = [
  'Company', 'Role', 'Job Link', 'Person', 'Email', 'Title', 'Tier', 'Template',
  'Drafted At', 'Scheduled At', 'Status', 'Mode', 'Gmail Draft ID', 'Sent At',
  'Result', 'Last Error', 'Queue ID', 'Version'
];
// Four rungs, and the reason they are a dropdown rather than free text is that a
// tier typed by hand drifts — "Senior", "sr", "Sr." — and then no filter finds
// the seniors. peer is somebody who interned there last summer; staff is somebody
// whose referral carries weight but who owes you nothing.
var REFERRAL_TIER = ['peer', 'mid', 'senior', 'staff'];

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

  // Date Applied is the one bare date on the tab.
  queue.getRange(FIRST_ROW, 3, LAST_ROW - FIRST_ROW + 1, 1).setNumberFormat(DATE_FORMAT);
  // The other four record an exact sending slot, Follow Up included. The hour
  // matters as much as the day there: six rows reading "August 29" are six replies
  // at nine in the morning as far as anybody scanning the column can tell, which
  // is the one thing this is built not to do.
  [8, 9, 13, 19].forEach(function (column) {
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
  queue.getRange(FIRST_ROW, 15, LAST_ROW - FIRST_ROW + 1, 1)
       .setDataValidation(SpreadsheetApp.newDataValidation()
         .requireValueInList(OUTREACH_FOLLOWUP_STATUS, true)
         .setAllowInvalid(false)
         .build());

  [170, 240, 115, 85, 85, 70, 100, 145, 145, 75, 105, 80, 130, 95, 120, 180, 160,
   180, 145, 280, 200, 120, 70]
    .forEach(function (width, index) { queue.setColumnWidth(index + 1, width); });

  colourQueueColumn_(queue, 11, OUTREACH_STATUS_COLOURS);
  colourQueueColumn_(queue, 12, OUTREACH_MODE_COLOURS);
  colourQueueColumn_(queue, 15, OUTREACH_FOLLOWUP_COLOURS);

  ss.toast(
    created
      ? 'Created an empty Email tab. No application was queued and no email was sent.'
      : 'Email tab headers and formatting are already set. No queue items changed.',
    'Email',
    8
  );
}


/**
 * Walk the Email tab forward to the current layout, one added column at a time.
 *
 * setupOutreachQueue cannot do this itself. Its whole safety property is that it
 * refuses to write a header over a different one, and on a tab a migration behind
 * there is a real name sitting where the new layout wants a different one — so it
 * throws, correctly, and the columns have to be opened first. insertColumnBefore
 * is what moves everything to the right of the gap along with its values,
 * validation and colour rules; rewriting headers over live data would have left
 * every row shifted under the wrong name.
 *
 * Two steps now, run in order, because the second is written against the layout
 * the first produces. A tab two migrations behind is walked forward twice in one
 * call rather than being refused for not being either shape.
 *
 * **Stop the sender before running this.** Run removeOutreachTriggers in the
 * standalone sender project, run this, deploy the sender, then run
 * installOutreachTriggers. Between the insert and the deploy the two disagree
 * about which column is which, and the disagreement is not harmless: the sender
 * would read Status from the new blank column, find no row that has spent a
 * contact, and queue a second cold email to people already written to. An hour of
 * no sending is the cheap half of that trade.
 *
 * Since the sender learned to run both migrations itself — outreachEnsure-
 * PriorityColumn_ and outreachEnsureFollowUpColumns_, ahead of everything that
 * reads the queue — this is the manual path rather than the only one. It stays
 * because a tab can be repaired from the spreadsheet with the sender switched off,
 * which is the order you want when something has already gone wrong.
 *
 * Safe to run twice: a tab already on the current layout is left alone.
 */
function migrateOutreachColumns() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var queue = ss.getSheetByName(OUTREACH_QUEUE_TAB);
  if (!queue) {
    setupOutreachQueue();
    return;
  }

  // Never wider than the sheet is. getRange past the last column throws, and the
  // whole point of this function is to be pointed at a tab narrower than the
  // layout it is migrating towards.
  var header = function (index) {
    var width = Math.min(OUTREACH_HEADERS.length, queue.getMaxColumns());
    var value = queue.getRange(1, 1, 1, width).getValues()[0][index];
    return String(value == null ? '' : value).trim();
  };

  var opened = [];

  // Step one: Priority, which used to be this function's whole job.
  var at10 = header(9);
  if (at10 === 'Status') {
    queue.insertColumnBefore(10);
    opened.push('Priority at column 10');
  } else if (at10 !== 'Priority') {
    throw new Error(
      'Email column 10 is ' + JSON.stringify(at10) + ', expected "Status" or '
      + '"Priority". This tab is not the layout this migration moves; fix it by '
      + 'hand or say what it should be.'
    );
  }

  // Step two, and only reachable once step one has run, because it is written
  // against the layout step one produces: Contact Fingerprint sits at 13 on a
  // tab that has Priority and does not yet have these three.
  //
  // A blank there is the state a run that died between the insert and
  // setupOutreachQueue leaves behind. It is not an error and it is not a second
  // insert: the columns are already open and unnamed, so falling through to
  // setupOutreachQueue below is exactly the repair.
  var at13 = header(12);
  if (at13 === 'Contact Fingerprint') {
    for (var i = 0; i < 3; i++) queue.insertColumnBefore(13);
    opened.push('the three follow-up columns at 13');
  } else if (at13 !== 'Follow Up' && at13 !== '') {
    throw new Error(
      'Email column 13 is ' + JSON.stringify(at13) + ', expected "Contact '
      + 'Fingerprint" or "Follow Up". This tab is not the layout this migration '
      + 'moves; fix it by hand or say what it should be.'
    );
  }

  // Each insert leaves its columns blank, headers included, so setupOutreachQueue
  // no longer has a conflicting name to refuse — it fills in the headers, the
  // checkbox, the widths and the three dropdown colourings at their new positions.
  setupOutreachQueue();
  ss.toast(
    opened.length
      ? 'Inserted ' + opened.join(' and ') + '. Deploy the sender now, before the '
        + 'hourly trigger goes back on.'
      : 'The Email tab is already on the current layout. Nothing moved.',
    'Email',
    opened.length ? 12 : 8
  );
}

/**
 * The name this used to have, kept because docs/spreadsheet.md and a year of
 * notes point at it. It has never done anything the general one does not.
 */
function migrateOutreachPriorityColumn() {
  migrateOutreachColumns();
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
 * Run once by hand: create the empty Referral tab.
 *
 * Like setupOutreachQueue this only builds the table. Nothing here reads Jobs or
 * App, picks who to ask, or writes a message — a row arrives on this tab because
 * somebody put it there.
 *
 * Safe to run again: it restores the known headers and formatting, but refuses to
 * overwrite a non-empty header that means this is a different table.
 */
function setupReferralQueue() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var queue = ss.getSheetByName(REFERRAL_QUEUE_TAB);
  var created = !queue;
  if (!queue) queue = ss.insertSheet(REFERRAL_QUEUE_TAB);

  var existing = queue.getRange(1, 1, 1, REFERRAL_HEADERS.length).getValues()[0];
  for (var i = 0; i < REFERRAL_HEADERS.length; i++) {
    var found = String(existing[i] == null ? '' : existing[i]).trim();
    if (found && found !== REFERRAL_HEADERS[i]) {
      throw new Error(
        'Referral column ' + (i + 1) + ' is ' + JSON.stringify(found)
        + ', expected ' + JSON.stringify(REFERRAL_HEADERS[i]) + '. Refusing to overwrite it.'
      );
    }
  }

  var header = queue.getRange(1, 1, 1, REFERRAL_HEADERS.length);
  header.setValues([REFERRAL_HEADERS])
      .setFontWeight('bold')
      .setBackground('#D9EAD3')
      .setHorizontalAlignment('center');
  queue.setFrozenRows(1);

  // Drafted At, Scheduled At and Sent At, with the hour on them for the same
  // reason the Email tab keeps it: a column of bare days cannot tell you whether
  // four messages went out one at a time or all together at nine in the morning.
  [9, 10, 14].forEach(function (column) {
    queue.getRange(FIRST_ROW, column, LAST_ROW - FIRST_ROW + 1, 1)
         .setNumberFormat(OUTREACH_TIMESTAMP_FORMAT);
  });
  queue.getRange(FIRST_ROW, 7, LAST_ROW - FIRST_ROW + 1, 1)
       .setDataValidation(SpreadsheetApp.newDataValidation()
         .requireValueInList(REFERRAL_TIER, true)
         .setAllowInvalid(false)
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

  // Person, Email, Title and Result are the four that get read rather than
  // glanced at, so they get the room; Tier and Version hold one short word each
  // and would only push the readable columns off the screen if they were wider.
  // Gmail Draft ID is narrow on purpose: it is an audit reference nobody reads
  // until something has gone wrong, and it earns its column by existing, not by
  // being legible at a glance.
  [170, 240, 230, 150, 220, 180, 70, 100, 145, 145, 105, 80, 110, 145, 280, 200,
   120, 70].forEach(function (width, index) { queue.setColumnWidth(index + 1, width); });

  // The same palette as the Email tab, because it is the same seven words meaning
  // the same seven things — a second colour language for one more tab would only
  // have to be learned twice.
  colourQueueColumn_(queue, 11, OUTREACH_STATUS_COLOURS);

  ss.toast(
    created
      ? 'Created an empty Referral tab. Nobody was contacted and no email was sent.'
      : 'Referral tab headers and formatting are already set. No rows changed.',
    'Referral',
    8
  );
}


/**
 * Walk the App tab forward to the current layout by opening a gap for Official at
 * column I.
 *
 * setupAppColumns cannot do this itself. It writes its four headers at fixed
 * columns, and on a tab a migration behind there is a real name sitting where the
 * new layout wants a different one — I reads "Alumni" where "Official" belongs. It
 * refuses, correctly, and the column has to be opened first. insertColumnBefore is
 * what moves everything to the right of the gap along with its values, its
 * checkbox validation and its colour rules; rewriting headers over live data would
 * have left every row's ticks and history sitting one column to the left of the
 * name that describes them, which reads as an alumnus at every company that has a
 * recruiter.
 *
 * **The Python half has to be redeployed after this.** highlight.py addresses the
 * two checkboxes as App columns I and J by number, and this moves them to J and K.
 * It fails safe rather than silently: it reads I1:J1 first and refuses to write
 * unless the pair reads "Alumni" and "Recruiter", so between this migration and
 * that deploy the sync prints its complaint and leaves both columns exactly as
 * they stand. No tick is lost — but none is written either, so the deploy is the
 * thing that turns the sync back on.
 *
 * Safe to run twice: a tab already carrying Official at I is left alone.
 */
function migrateAppOfficialColumn() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var app = ss.getSheetByName(APP_TAB);
  if (!app) throw new Error('No tab named "' + APP_TAB + '".');

  // Never wider than the sheet is. getRange past the last column throws, and the
  // whole point of this function is to be pointed at a tab narrower than the
  // layout it is migrating towards.
  var header = function (column) {
    var width = Math.min(UPDATE_COL, app.getMaxColumns());
    if (width < column) return '';
    var value = app.getRange(1, 1, 1, width).getValues()[0][column - 1];
    return String(value == null ? '' : value).trim();
  };
  var refuse = function (column, found, expected) {
    throw new Error(
      'App column ' + column + ' is ' + JSON.stringify(found) + ', expected '
      + expected + '. This tab is not the layout this migration moves; fix it by '
      + 'hand or say what it should be.'
    );
  };

  var at9 = header(APP_OFFICIAL);
  var opened = false;
  var healed = 0;

  if (at9 === 'Alumni') {
    // The layout Official is being inserted into. The two columns behind it are
    // checked as well, and not out of tidiness: insertColumnBefore is happy to
    // shift anything, so the only thing standing between a half-built tab and a
    // blind insert is reading the names first.
    if (header(APP_OFFICIAL + 1) !== 'Recruiter') {
      refuse(APP_OFFICIAL + 1, header(APP_OFFICIAL + 1), '"Recruiter"');
    }
    if (header(APP_OFFICIAL + 2) !== 'Update') {
      refuse(APP_OFFICIAL + 2, header(APP_OFFICIAL + 2), '"Update"');
    }
    app.insertColumnBefore(APP_OFFICIAL);
    // And then strip what the insert brought with it. A column inserted next to a
    // checkbox column inherits that column's data validation, so every row of the
    // new Official column comes up holding an unticked checkbox: three hundred
    // cells reading FALSE in the column whose entire purpose is to hold a URL a
    // person pastes. It looks like data, it is not, and the sender reads it as a
    // link that fails every rule — a whole tab of rows that can never go yellow
    // and never qualify, for a reason nothing on the sheet explains.
    //
    // Cleared to the sheet's full height rather than to the last data row: the
    // validation is applied to the whole column, and rows added later would
    // otherwise arrive with the checkbox already on them.
    var inserted = app.getRange(1, APP_OFFICIAL, app.getMaxRows(), 1);
    inserted.clearDataValidations();
    inserted.clearContent();
    inserted.setBackground(null);
    opened = true;
  } else if (at9 === 'Official') {
    // Already migrated, so nothing is inserted. The three behind it are still
    // read, because "Official is at I" is not on its own proof the rest landed:
    // a run that died mid-insert would leave exactly that, and a second run that
    // trusted column I alone would call it finished.
    if (header(ALUMNI_COL) !== 'Alumni') refuse(ALUMNI_COL, header(ALUMNI_COL), '"Alumni"');
    if (header(RECRUITER_COL) !== 'Recruiter') {
      refuse(RECRUITER_COL, header(RECRUITER_COL), '"Recruiter"');
    }
    if (header(UPDATE_COL) !== 'Update') refuse(UPDATE_COL, header(UPDATE_COL), '"Update"');

    // Repair, not tidying, and the reason it lives on the already-migrated branch
    // is that the first version of this migration did not strip what the insert
    // inherited. A tab it ran on carries a checkbox on every row of Official and
    // cannot be fixed by running the migration again unless this branch does it:
    // the insert has already happened, so the branch that strips is never reached.
    //
    // Only ever clears cells that hold a checkbox's FALSE. A pasted link is left
    // exactly where it is, because the whole point of the column is that what a
    // person typed there survives everything this file does.
    var below = app.getMaxRows() - 1;
    if (below > 0) {
      var column = app.getRange(2, APP_OFFICIAL, below, 1);
      var junk = column.getValues();
      var repaired = 0;
      for (var row = 0; row < junk.length; row++) {
        if (junk[row][0] === false || junk[row][0] === true) {
          junk[row][0] = '';
          repaired++;
        }
      }
      if (repaired) {
        column.clearDataValidations();
        column.setValues(junk);
        healed = repaired;
      }
    }
  } else if (at9 !== '') {
    refuse(APP_OFFICIAL, at9, '"Alumni" or "Official"');
  }
  // A blank at I is the third recognised shape and it is not an error: it is a tab
  // setupAppColumns has never run on, or one still on the layout that predates
  // Alumni entirely. There is nothing to shift rightward, because there is nothing
  // to the right, so falling through to setupAppColumns below is exactly the
  // repair — and it is the one that knows how to fetch the old Update column.

  // The insert leaves its column blank, header included, so setupAppColumns no
  // longer has a conflicting name to refuse — it fills in the header and the width
  // at the new position and rebuilds the checkbox validation where the ticks now
  // are.
  setupAppColumns();
  ss.toast(
    opened
      ? 'Opened Official at column I. Alumni, Recruiter and Update moved to J, K '
        + 'and L — deploy the Python half before the next sync.'
      : (healed
          ? 'The App tab was already on the current layout. Cleared ' + healed
            + ' inherited checkbox cell(s) out of Official; pasted links were left alone.'
          : 'The App tab is already on the current layout. Nothing moved.'),
    'App',
    opened ? 12 : 8
  );
}


/** A link you can actually click: present, and going somewhere over http. */
function appOfficialUsableLink_(value) {
  return String(value == null ? '' : value).trim().toLowerCase().indexOf('http') === 0;
}


/**
 * Which App rows are worth painting: an application nobody can be asked to refer
 * you for, because there is no employer link to send them.
 *
 * Company is the test for "this line is an application" rather than a stray. App
 * really does carry rows holding nothing but a link, and a row with no company is
 * a row there is nobody to ask about — painting it yellow would put work at the
 * top of the tab that cannot be done.
 *
 * "Usable" here means only non-empty and starting with http, and that is the whole
 * rule on purpose. Telling an employer's own board from an aggregator is a
 * judgement the sender project already makes, and duplicating it here would mean
 * two copies drifting apart with nothing to catch it. This function stays crude so
 * the two stay separable.
 */
function appOfficialNeedsLink_(company, applicationLink, official) {
  if (!String(company == null ? '' : company).trim()) return false;
  return !appOfficialUsableLink_(applicationLink) && !appOfficialUsableLink_(official);
}


/**
 * Paint A..L yellow on every App row still needing an official link, and clear the
 * colour from every row that does not.
 *
 * Clearing is half the job, not a tidy-up: paste a link into column I and the row
 * has to stop shouting, or the colour turns into decoration nobody trusts.
 *
 * One read and one write for the whole block. Row by row this would be one call to
 * setBackground per application, each one a round trip to the spreadsheet service,
 * and Apps Script stops a trigger at thirty seconds — the paint would die
 * somewhere in the middle of the tab, leaving half of it coloured by the old rule.
 *
 * The rows are then brought into order, painted first and sorted second. That way
 * round because the paint is what settles which rows are yellow and the sort needs
 * that settled before it can act on it. The sort writes nothing at all when the
 * rows are already where they belong, so the ordinary case is still one read and
 * one write.
 */
function paintAppOfficialRows() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var app = ss.getSheetByName(APP_TAB);
  if (!app) throw new Error('No tab named "' + APP_TAB + '".');
  var bottom = app.getLastRow();
  if (bottom < FIRST_ROW) {
    ss.toast('Tab ' + APP_TAB + ' has no rows yet.', 'App', 5);
    return;
  }
  paintAppOfficialBlock_(app, FIRST_ROW, bottom);
  sortAppOfficialBlock_(app);
}


/**
 * The paint itself, over one block of rows, so the full sweep and the single row
 * onEdit repaints cannot disagree about what yellow means.
 *
 * Out to UPDATE_COL, which is where this tool stops owning the row. Not out to
 * getLastColumn: a colour laid over somebody's own column past Update would be
 * this script painting a cell it has no opinion about.
 */
function paintAppOfficialBlock_(app, firstRow, lastRow) {
  if (lastRow < firstRow) return;
  var count = lastRow - firstRow + 1;
  var rows = app.getRange(firstRow, 1, count, UPDATE_COL).getValues();
  var colours = [];
  for (var i = 0; i < count; i++) {
    var needed = appOfficialNeedsLink_(
      rows[i][APP_COMPANY - 1], rows[i][APP_LINK - 1], rows[i][APP_OFFICIAL - 1]);
    var line = [];
    // null rather than white: white is a colour, and it would paint over whatever
    // banding or manual highlight the row already had.
    for (var c = 0; c < UPDATE_COL; c++) line.push(needed ? APP_OFFICIAL_YELLOW : null);
    colours.push(line);
  }
  app.getRange(firstRow, 1, count, UPDATE_COL).setBackgrounds(colours);
}


/**
 * Reorder the App data rows so every application still needing an official link
 * sits at the top of the tab, then repaint.
 *
 * The colour on its own is not enough. App only ever grows, so an application sent
 * in July with no employer link on it is a hundred rows down by September, and the
 * whole point of painting it was to be told about it without going hunting; a
 * yellow row you have to scroll to find is a yellow row you find next term. The
 * sort is what turns the colour into a worklist.
 *
 * Run by hand, and run again at the end of paintAppOfficialRows. Deliberately NOT
 * run from onEdit — see the comment in onAppEdit for why.
 */
function sortAppOfficialRowsToTop() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var app = ss.getSheetByName(APP_TAB);
  if (!app) throw new Error('No tab named "' + APP_TAB + '".');
  sortAppOfficialBlock_(app);
}


/**
 * The sort itself, over one sheet, so paintAppOfficialRows can call it without
 * going back through SpreadsheetApp for a sheet it is already holding.
 *
 * One read and one write of the whole block, for the same reason
 * paintAppOfficialBlock_ paints in one write: moving rows one at a time would be
 * hundreds of round trips to the spreadsheet service, and Apps Script stops a
 * script at thirty seconds. A sort that dies halfway is far worse than a paint
 * that dies halfway — a half-written block is a tab with applications duplicated
 * above and missing below, and App is the source of truth for what has been
 * applied to, so that is lost work rather than a cosmetic problem.
 *
 * sheet.sort() is not used, and not because of the round trips. It orders by a key
 * it reads out of a column, and "needs an official link" is in no column: it is a
 * function of Company, Application Link and Official together. Writing that key
 * into a helper column would put a value past Update on a tab whose columns past
 * Update belong to whoever added them. sheet.sort() is also not documented as
 * stable, and stability is a requirement here rather than a nicety.
 */
function sortAppOfficialBlock_(app) {
  // To the real last row and no further, NOT out to LAST_ROW the way the Jobs
  // sweep used to. Jobs is a fixed five-hundred-row tab; App is appended to, and
  // onEdit puts each new application at getLastRow() + 1. Writing a block that
  // reached row 500 would leave five hundred rows of written-and-emptied cells
  // behind it, and the next row across from Jobs would land at 501 with a
  // hundred blank lines above it. The same trap setupAppColumns keeps its
  // checkbox validation clear of.
  var bottom = app.getLastRow();
  if (bottom < FIRST_ROW) return false;
  var count = bottom - FIRST_ROW + 1;

  // Not UPDATE_COL: the App tab really can hold data past column L. Update is
  // where this tool stops having an opinion, not where the row stops — an
  // operator's own column sits past it, and a row moved here with only A..L in
  // hand would leave that cell sitting on whatever row lands in its place,
  // quietly reattaching one application's notes to a different application.
  // getLastColumn is the real extent of the data, so the block widens by itself
  // the day somebody adds a column and there is nothing here to remember to
  // update. The floor is UPDATE_COL rather than 1, so that a tab whose Update
  // column happens to be empty still moves the whole layout this tool owns.
  var width = Math.max(app.getLastColumn(), UPDATE_COL);
  var rows = app.getRange(FIRST_ROW, 1, count, width).getValues();
  var ordered = orderAppOfficialRows_(rows);

  // Nothing moved, so nothing is written and nothing is repainted. This is what
  // makes a second run a genuine no-op rather than a run that happens to write
  // back the same bytes: if no row moved then no row's colour moved either, and
  // the repaint below would have nothing to correct.
  var moved = false;
  for (var i = 0; i < count; i++) {
    if (ordered[i] !== rows[i]) { moved = true; break; }
  }
  if (!moved) return false;

  app.getRange(FIRST_ROW, 1, count, width).setValues(ordered);

  // The colours are recomputed from the moved values rather than being permuted
  // alongside them. Carrying them would work, but it means holding two grids in
  // step through one permutation, and the moment they drift the tab paints the
  // wrong rows yellow — worse than not sorting at all, because a colour that lies
  // stops being read, and then the applications that really do need a link stop
  // being read with it. Recomputing cannot drift: yellow is a pure function of the
  // row's own Company, Application Link and Official, so whichever row now sits on
  // a line gets exactly the colour that row earns.
  paintAppOfficialBlock_(app, FIRST_ROW, bottom);
  return true;
}


/**
 * The ordering decision on its own — rows in, reordered rows out, no sheet — so
 * that what the sort does can be checked without a spreadsheet to check it on.
 *
 * Three groups, in this order: rows needing a link, everything else, then the
 * empty tail. Each group keeps the order it arrived in.
 *
 * Stable because the tab is something a person works down. Rebuilding the yellow
 * group in some other order would mean the application you were half way through
 * chasing has jumped three rows up, and the next link you paste lands on a
 * different job from the one you were reading. The order the rows are already in
 * is information somebody put there — on App it is the order things were applied
 * to in, which is the one thing Property numbers them by — and a sort asked only
 * to bring yellow to the top has no business spending it.
 *
 * The empty tail is held back rather than left to fall into the second group. An
 * empty row is not yellow, so a plain two-way split would leave the blanks
 * wherever they were — which is fine while they are all at the bottom, and wrong
 * the moment they are not. Pinning the tail makes "the blank rows are at the
 * bottom" true for any input, instead of true by luck of this one.
 *
 * Only the genuinely trailing blanks are pinned. A blank row with real rows still
 * below it is a gap somebody left on purpose, and moving that one would be the
 * reshuffle the stability rule exists to prevent.
 */
function orderAppOfficialRows_(rows) {
  var end = rows.length;
  while (end > 0 && appRowIsEmpty_(rows[end - 1])) end--;

  var needing = [];
  var rest = [];
  for (var i = 0; i < end; i++) {
    if (appOfficialNeedsLink_(
          rows[i][APP_COMPANY - 1], rows[i][APP_LINK - 1], rows[i][APP_OFFICIAL - 1])) {
      needing.push(rows[i]);
    } else {
      rest.push(rows[i]);
    }
  }
  return needing.concat(rest, rows.slice(end));
}


/**
 * A row with nothing on it. The two checkbox columns are why this cannot just ask
 * whether every cell is blank: an unticked checkbox reads back as false rather
 * than as an empty cell, and the Python half writes FALSE down both columns across
 * every row it covers. Counting false as content would make a row that is nothing
 * but two unticked boxes look occupied, so it would never be pinned to the bottom
 * and would sort in among the applications as though it were one.
 */
function appRowIsEmpty_(row) {
  for (var c = 0; c < row.length; c++) {
    var cell = row[c];
    if (cell === false || cell === null || cell === undefined) continue;
    if (String(cell).trim() === '') continue;
    return false;
  }
  return true;
}



/**
 * Run once by hand: build the four columns of the App tab past Note — Official
 * (I), Alumni (J), Recruiter (K), Update (L) — and fill in the history for the
 * rows already there.
 *
 * Safe to run as many times as you like: an Update cell that already has text is
 * left alone, and the column-move step runs only when there is really a move left
 * to make.
 *
 * It refuses rather than writing "Official" over a name that is already there, and
 * that refusal is what makes migrateAppOfficialColumn necessary — the same
 * arrangement setupOutreachQueue and migrateOutreachColumns already have. On a tab
 * from before Official existed, column I is Alumni, and writing the four headers
 * blind would leave every row's ticks and history one column left of the name
 * describing them: an alumnus recorded at every company that has a recruiter.
 */
function setupAppColumns() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var app = ss.getSheetByName(APP_TAB);
  if (!app) throw new Error('No tab named "' + APP_TAB + '".');

  // Only column I is guarded, because it is the only one an insert has to happen
  // before. A blank there is a tab this has never been run on — including the one
  // still carrying Update at J, which migrateUpdateColumn below is what fetches.
  var atOfficial = String(app.getRange(1, APP_OFFICIAL).getValue()).trim();
  if (atOfficial && atOfficial !== 'Official') {
    throw new Error(
      'App column ' + APP_OFFICIAL + ' is ' + JSON.stringify(atOfficial)
      + ', expected "Official". Run migrateAppOfficialColumn first — it opens the '
      + 'gap and carries this column\'s values, ticks and colours rightward.'
    );
  }

  var moved = migrateUpdateColumn(app);
  app.getRange(1, APP_OFFICIAL).setValue('Official');
  app.getRange(1, ALUMNI_COL).setValue('Alumni');
  app.getRange(1, RECRUITER_COL).setValue('Recruiter');
  app.getRange(1, UPDATE_COL).setValue('Update');
  app.setColumnWidth(APP_OFFICIAL, OFFICIAL_WIDTH_PX);
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


// Column J, written as a number rather than as a constant. It was RECRUITER_COL
// on the day this was written and it is ALUMNI_COL now, because Official opened a
// gap at I and pushed both a column right. What moved is the layout, not the
// history: the sheets this reaches are older than every column past Note, and
// their Update really is sitting in J. Following the constant would have this
// looking for it in K, finding a Recruiter header or nothing at all, and leaving a
// year of stage history stranded in a column that is about to be relabelled.
var LEGACY_UPDATE_COL = 10;

/**
 * Update used to live at J, up until the day Alumni and Recruiter took I and J.
 * This moves it to wherever Update lives now, exactly once.
 *
 * The destination follows UPDATE_COL rather than being pinned the way the source
 * is, and the asymmetry is the point: the source is a fact about sheets that
 * already exist and cannot change, while the destination has to be whichever
 * column setupAppColumns is about to write the "Update" header over. Pinning it to
 * K, where it landed the first time, would now drop the history one column short
 * of its own header and under Recruiter's.
 *
 * Two conditions stand guard and both are needed: J1 must actually read 'Update' (if
 * not, this is a sheet that never built the column and there is nothing to move),
 * and the Update column must be empty (if not, the move already happened, and
 * moving again would overwrite the very history it moved across).
 */
function migrateUpdateColumn(app) {
  if (String(app.getRange(1, LEGACY_UPDATE_COL).getValue()).trim() !== 'Update') return 0;
  if (String(app.getRange(1, UPDATE_COL).getValue()).trim()) return 0;

  var moved = 0;
  var bottom = app.getLastRow();
  if (bottom >= FIRST_ROW) {
    var count = bottom - FIRST_ROW + 1;
    var from = app.getRange(FIRST_ROW, LEGACY_UPDATE_COL, count, 1);
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
  if (moved) parts.push('Moved ' + rowCount(moved) + ' of history from column J to L');
  if (filled) {
    var text = 'Filled in ' + rowCount(filled) + ' in the Update column';
    if (unknown) {
      text += ' (' + unknown + ' at a stage past Applied, so the date reads "'
           + UNKNOWN_DATE + '" — search for that mark and fill it in by hand)';
    }
    parts.push(text);
  }
  if (!parts.length) return 'All four columns are already right; nothing to fix.';
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
 * creates a row in App; on App, changing Process appends a dated line to Update
 * and pasting into Official repaints the row.
 */
function onEdit(e) {
  var name = e.range.getSheet().getName();
  if (name === JOBS_TAB) return onJobsEdit(e);
  if (name === APP_TAB) return onAppEdit(e);
}


function onJobsEdit(e) {
  var range = e.range;
  var jobs = range.getSheet();

  if (range.getColumn() > APPLIED_COL || range.getLastColumn() < APPLIED_COL) return;

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
    // Out to the end of Recruiter, not stopping at APP_WIDTH: the two checkboxes are
    // validation too, and a new row without them turns the next sync's TRUE/FALSE into
    // bare words sitting on top of the cell. Official is inside that span and wants
    // no validation of its own, which costs nothing — copying a cell that carries
    // none is what leaves it free text.
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
  var app = range.getSheet();

  // Column I is its own question and it is answered here rather than on the next
  // full sweep: paste the employer's own posting and the row has to stop being
  // yellow while you are still looking at it. Waiting for paintAppOfficialRows to
  // be run by hand would leave the tab telling you to go and find a link you have
  // already found. Only the rows the edit touched are repainted — a fill-down over
  // twenty rows is still one write.
  if (range.getColumn() <= APP_OFFICIAL && range.getLastColumn() >= APP_OFFICIAL) {
    var top = Math.max(range.getRow(), FIRST_ROW);
    var bottom = Math.min(range.getLastRow(), app.getLastRow());
    paintAppOfficialBlock_(app, top, bottom);
    // The rows are NOT sorted here, and that is a decision rather than an
    // oversight. This runs while you are typing. Paste a link into I40 and
    // sorting on the spot would pull row 40 out from under the cursor between
    // keystrokes, and the row that slid into its place is a different
    // application from the one you were reading — so the next paste goes on the
    // wrong row. A fill-down over twenty rows would rearrange the tab halfway
    // through the drag. Reordering a sheet somebody is working in is hostile even
    // when the new order is the better one. There is a budget argument too:
    // onEdit is a simple trigger with thirty seconds, and sorting reads and
    // rewrites every application on the tab, which is not what a single keystroke
    // should cost. So the colour updates instantly, which is the half that has to
    // be immediate, and the position waits for paintAppOfficialRows — run when
    // you are ready for the tab to move under you.
  }

  if (range.getColumn() > PROCESS_COL || range.getLastColumn() < PROCESS_COL) return;
  var firstRow = Math.max(range.getRow(), FIRST_ROW);
  var lastRow = range.getLastRow();
  if (lastRow < firstRow) return;  // only the header was edited

  // Fill-down and paste edit many rows at once, so read the whole block rather than
  // just the first cell.
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


/**
 * Put the repaint and the sort on the clock.
 *
 * They cannot be left to run by hand, and the reason is that App only ever grows.
 * Every ticked box on Jobs appends a row to the bottom of this tab, and onEdit
 * deliberately does not move it — so the yellow block at the top is accurate only
 * until the next application goes out, and by the end of a week the rows with no
 * employer link on them are scattered down the tab again. A worklist that is only
 * right just after you remember to rebuild it is one nobody reads.
 *
 * Hourly, which is the same cadence the outreach machinery runs at, so the top of
 * the tab is never wrong for longer than it takes the next firing to notice.
 *
 * It is not free of races and it is worth naming the one it has. highlight.py
 * reads App A:H, works out which row numbers earn a tick, and writes the two
 * checkbox columns back by position — so a sort landing between that read and that
 * write puts an alumnus against the wrong application. The window is the seconds
 * between two calls in one sync, and the sort writes nothing at all in the
 * ordinary case where no row moved, which is what keeps it narrow rather than what
 * closes it. Run removeAppOfficialTrigger while the Python half is being worked
 * on, the same way the sender is stopped before a migration.
 *
 * Safe to run again. The old trigger is removed before the new one is made, so
 * running this three times leaves one trigger rather than three tabs' worth of
 * repaints an hour.
 */
function installAppOfficialTrigger() {
  removeAppOfficialTrigger();
  ScriptApp.newTrigger('paintAppOfficialRows').timeBased().everyHours(1).create();
  SpreadsheetApp.getActiveSpreadsheet().toast(
    'App rows needing an official link will be repainted and moved to the top every hour.',
    'Installed', 5);
}

/** The kill switch for the above, and the only one. */
function removeAppOfficialTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'paintAppOfficialRows') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}
