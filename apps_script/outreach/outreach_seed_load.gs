/**
 * Loading the two contact tabs from ColdEmail's exports.
 *
 * The tabs are replaced wholesale rather than merged, because the export is the
 * source of truth for who exists: a row that has left the CSV has left the list,
 * and reconciling row by row would keep people the export deliberately dropped.
 *
 * Chunked, because a full load is several thousand rows and `clasp run` has to
 * carry them as one JSON argument. The caller sends them in batches and only the
 * first batch clears; a chunk is idempotent for its own range, so a batch that
 * fails can be sent again without disturbing the ones around it.
 *
 * **The Sent column is preserved across a load, not overwritten.** That is the
 * whole reason this is not a plain overwrite: the tick is the durable record of
 * who has been written to, and re-exporting the contacts must not lose it. Each
 * loader reads the existing ticks by address first and re-applies them to
 * whatever rows come back carrying the same address. A person dropped from the
 * export and later re-added therefore returns already ticked.
 *
 * A `Sent` value on the incoming row is honoured too, and the two are OR-ed: the
 * export seeds the column from what the queue tabs recorded before this column
 * existed, and the tab keeps whatever the sender has written since. Neither can
 * clear the other -- there is no path here that unticks anybody, because nothing
 * that has been sent can be unsent.
 *
 * `replaceEmployeeSeedChunk` used to live in outreach_diag.gs, whose header
 * calls itself a temporary diagnostic to be removed once its answer is in hand.
 * A permanent loader had no business there.
 */

/** Existing Sent ticks on a tab, by lower-cased address. */
function outreachExistingSentTicks_(sheet, emailCol, sentCol) {
  var ticks = {};
  var last = sheet.getLastRow();
  if (last < 2) return ticks;
  var emails = sheet.getRange(2, emailCol, last - 1, 1).getValues();
  var flags = sheet.getRange(2, sentCol, last - 1, 1).getValues();
  for (var i = 0; i < emails.length; i++) {
    var email = String(emails[i][0] || '').trim().toLowerCase();
    if (email && outreachSentTicked_(flags[i][0])) ticks[email] = true;
  }
  return ticks;
}

function outreachSeedBook_() {
  return SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
}

/**
 * Replace the `Contacts (seed)` tab, one chunk at a time.
 *
 * `rows` are objects keyed by the CSV's own headers, so the caller ships the
 * export unchanged and the column order is decided here, in one place, beside
 * the constants that define it.
 */
function replaceContactSeedChunk(rows, startRow, clearExisting) {
  if (!Array.isArray(rows)) throw new Error('rows must be an array');
  startRow = Number(startRow);
  if (!isFinite(startRow) || startRow < 2 || Math.floor(startRow) !== startRow) {
    throw new Error('startRow must be an integer >= 2');
  }
  var book = outreachSeedBook_();
  var sheet = book.getSheetByName(TAB_CONTACTS_SEED);
  if (!sheet) throw new Error('missing tab: ' + TAB_CONTACTS_SEED);

  var ticks = outreachExistingSentTicks_(sheet, C_EMAIL, C_SENT);
  if (clearExisting !== false) {
    sheet.getRange(1, 1, 1, C_WIDTH).setValues([[
      'Company', 'Recruiter Name', 'Email', 'Role', 'Focus', 'Hook', 'Angle',
      'Verify', 'Bucket', 'Sent', 'From'
    ]]);
    var last = sheet.getLastRow();
    if (last > 1) sheet.getRange(2, 1, last - 1, C_WIDTH).clearContent();
  }
  if (rows.length) {
    var values = rows.map(function (row) {
      var email = String(row.Email || '').trim().toLowerCase();
      return [row.Company, row['Recruiter Name'], email, row.Role, row.Focus,
        row.Hook, row.Angle, row.Verify, row.Bucket,
        (ticks[email] || outreachSentTicked_(row.Sent)) ? SENT_TICK : '',
        Number(row.From) || FROM_SEED];
    });
    sheet.getRange(startRow, 1, values.length, C_WIDTH).setValues(values);
  }
  return { tab: TAB_CONTACTS_SEED, rows: rows.length, startRow: startRow,
           ticksCarried: Object.keys(ticks).length, spreadsheet: book.getName() };
}

/** Replace the `Employees (seed)` tab, one chunk at a time. */
function replaceEmployeeSeedChunk(rows, startRow, clearExisting) {
  if (!Array.isArray(rows)) throw new Error('rows must be an array');
  startRow = Number(startRow);
  if (!isFinite(startRow) || startRow < 2 || Math.floor(startRow) !== startRow) {
    throw new Error('startRow must be an integer >= 2');
  }
  var book = outreachSeedBook_();
  var sheet = book.getSheetByName(TAB_EMPLOYEES_SEED);
  if (!sheet) throw new Error('missing tab: ' + TAB_EMPLOYEES_SEED);

  var ticks = outreachExistingSentTicks_(sheet, E_EMAIL, E_SENT);
  if (clearExisting !== false) {
    sheet.getRange(1, 1, 1, E_WIDTH).setValues([[
      'Company', 'Person Name', 'Email', 'Title', 'Domain', 'Seniority',
      'LinkedIn', 'Angle', 'Bucket', 'Verify', 'Sent', 'From'
    ]]);
    var last = sheet.getLastRow();
    if (last > 1) sheet.getRange(2, 1, last - 1, E_WIDTH).clearContent();
  }
  if (rows.length) {
    var values = rows.map(function (row) {
      var email = String(row.Email || '').trim().toLowerCase();
      return [row.Company, row['Person Name'], email, row.Title, row.Domain,
        row.Seniority, row.LinkedIn, row.Angle, row.Bucket, row.Verify,
        (ticks[email] || outreachSentTicked_(row.Sent)) ? SENT_TICK : '',
        Number(row.From) || FROM_SEED];
    });
    sheet.getRange(startRow, 1, values.length, E_WIDTH).setValues(values);
  }
  return { tab: TAB_EMPLOYEES_SEED, rows: rows.length, startRow: startRow,
           ticksCarried: Object.keys(ticks).length, spreadsheet: book.getName() };
}

/**
 * Tick Sent for people already written to before this column existed.
 *
 * A one-off, and it has to run before the Email and Referral tabs are cleared:
 * those tabs are the only record of who has been written to, and clearing them
 * without doing this would re-open every one of them.
 *
 * Cold rows are matched by fingerprint and referral rows by address, which is
 * the same asymmetry the two tabs have everywhere else. Only statuses that mean
 * a message actually left are counted: Queued and Drafted rows were planned and
 * never sent, and the rebuild is entitled to plan them again.
 */
function markAlreadySentContacts() {
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var out = { coldRows: 0, referralRows: 0, contactsTicked: 0, employeesTicked: 0 };
  var landed = { Sent: true, Replied: true, Bounced: true };

  var queue = tracker.getSheetByName(TAB_QUEUE);
  if (queue && queue.getLastRow() > 1) {
    var fingerprints = [];
    queue.getRange(2, 1, queue.getLastRow() - 1, Q_WIDTH).getValues()
      .forEach(function (row) {
        if (!landed[String(row[Q_STATUS - 1] || '').trim()]) return;
        var fingerprint = String(row[Q_FINGERPRINT - 1] || '').trim();
        if (fingerprint) fingerprints.push(fingerprint);
      });
    out.coldRows = fingerprints.length;
    out.contactsTicked = outreachMarkColdContactsSent_(fingerprints);
  }

  var referral = tracker.getSheetByName(TAB_REFERRAL);
  if (referral && referral.getLastRow() > 1) {
    var emails = [];
    referral.getRange(2, 1, referral.getLastRow() - 1, R_WIDTH).getValues()
      .forEach(function (row) {
        if (!landed[String(row[R_STATUS - 1] || '').trim()]) return;
        var email = String(row[R_EMAIL - 1] || '').trim();
        if (email) emails.push(email);
      });
    out.referralRows = emails.length;
    out.employeesTicked = outreachMarkEmployeesSent_(emails);
  }
  return out;
}

/**
 * Archive the Email and Referral tabs, then empty them.
 *
 * The rebuild starts both queues from nothing. Clearing them is what the user
 * asked for and is safe only because markAlreadySentContacts has already moved
 * the one thing they knew that nothing else did -- who has been written to --
 * onto the contacts tabs. Run that first. This refuses to run if it looks like
 * nobody has.
 *
 * The copy is made inside the same spreadsheet rather than exported, because a
 * copy that lives somewhere else is a copy nobody finds. It is dated, so running
 * this twice does not overwrite the first archive.
 *
 * Headers are kept. Both tabs carry a layout the rest of the project reads by
 * position, and rebuilding one from scratch is a separate job with its own
 * setup function.
 */
function archiveAndClearQueues() {
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var out = { archived: [], cleared: [] };

  [TAB_QUEUE, TAB_REFERRAL].forEach(function (name) {
    var sheet = tracker.getSheetByName(name);
    if (!sheet) return;
    var last = sheet.getLastRow();
    if (last < 2) { out.cleared.push(name + ' (already empty)'); return; }

    var archiveName = name + ' archive ' + stamp;
    if (!tracker.getSheetByName(archiveName)) {
      var copy = sheet.copyTo(tracker);
      copy.setName(archiveName);
      copy.hideSheet();
      out.archived.push(archiveName + ': ' + (last - 1) + ' rows');
    } else {
      out.archived.push(archiveName + ': already existed, left alone');
    }

    sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).clear();
    out.cleared.push(name + ': ' + (last - 1) + ' rows');
  });
  return out;
}
