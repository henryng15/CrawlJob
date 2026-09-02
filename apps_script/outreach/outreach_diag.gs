/**
 * TEMPORARY diagnostic — read-only, remove once the answer is in hand.
 *
 * Answers three questions the tab cannot: which spreadsheet ids this script is
 * pointed at, whether the account it runs as can actually open them, and what
 * triggers are installed. Nothing here writes.
 */
/** Touches nothing at all: if this fails, the failure is not in the code. */
function pingOutreach() {
  return 'pong';
}

function diagnoseOutreachAccess() {
  var props = PropertiesService.getScriptProperties();
  var out = { runningAs: '', ids: {}, open: {}, triggers: [], modes: {} };

  // These are operational switches, not credentials. A queue can be perfectly
  // healthy yet intentionally held in Draft mode, so diagnosing delivery without
  // reporting them leaves the decisive distinction invisible.
  out.modes = {
    outreach: props.getProperty(PROP_MODE) || MODE_SEND,
    referral: props.getProperty(PROP_REFERRAL_MODE) || MODE_SEND,
    followUp: props.getProperty(PROP_FOLLOWUP_MODE) || MODE_SEND
  };

  try { out.runningAs = Session.getEffectiveUser().getEmail(); }
  catch (error) { out.runningAs = 'unknown: ' + String(error.message || error); }

  ['TRACKER_SHEET_ID', 'CONTACTS_SHEET_ID'].forEach(function (key) {
    var id = props.getProperty(key);
    out.ids[key] = id || '(not set)';
    if (!id) { out.open[key] = 'no id set'; return; }
    try {
      out.open[key] = 'OK — ' + SpreadsheetApp.openById(id).getName();
    } catch (error) {
      out.open[key] = 'FAIL — ' + String(error.message || error).slice(0, 160);
    }
  });

  try {
    out.triggers = ScriptApp.getProjectTriggers().map(function (trigger) {
      return trigger.getHandlerFunction() + ' / ' + trigger.getEventType();
    });
  } catch (error) {
    out.triggers = ['unreadable: ' + String(error.message || error)];
  }

  return out;
}

/** Refresh the hidden tracker snapshot used by Company for remaining seed counts. */
function refreshReferralSeedCounts() {
  var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
  var seed = contactsBook.getSheetByName(TAB_EMPLOYEES_SEED);
  if (!seed || seed.getLastRow() < 2) throw new Error('missing or empty ' + TAB_EMPLOYEES_SEED);

  var values = seed.getRange(2, 1, seed.getLastRow() - 1, E_WIDTH).getValues();
  var addresses = {};
  values.forEach(function (row) {
    var verify = String(row[E_VERIFY - 1] || '').trim().toLowerCase();
    if (verify.indexOf('debounce:') !== 0 || verify === 'debounce:invalid') return;
    var company = String(row[E_COMPANY - 1] || '').trim();
    var email = String(row[E_EMAIL - 1] || '').trim().toLowerCase();
    if (!company || !email || email.indexOf('@') < 1) return;
    var key = outreachCompanyTokens_(company).join(' ');
    if (!addresses[key]) addresses[key] = {name: company, emails: {}};
    addresses[key].emails[email] = true;
  });

  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var deducted = 0;
  var referral = tracker.getSheetByName(TAB_REFERRAL);
  if (referral && referral.getLastRow() > 1) {
    // A contact is no longer available once Referral has reserved or used it.
    // Cancelled and Failed rows are intentionally not deducted: no message
    // reached that person and the address may be used by a later plan.
    outreachReadReferralRows_(referral).forEach(function (row) {
      if (STATUS_SPENDS_CONTACT.indexOf(row.status) === -1) return;
      var key = outreachCompanyTokens_(row.company).join(' ');
      if (!addresses[key] || !addresses[key].emails[row.email]) return;
      delete addresses[key].emails[row.email];
      deducted++;
    });
  }
  var sheet = tracker.getSheetByName(TAB_REFERRAL_SEED_COUNTS)
    || tracker.insertSheet(TAB_REFERRAL_SEED_COUNTS);
  var rows = [["Company", "Sendable referral emails"]];
  Object.keys(addresses).sort().forEach(function (key) {
    rows.push([addresses[key].name, Object.keys(addresses[key].emails).length]);
  });
  sheet.clearContents();
  sheet.getRange(1, 1, rows.length, 2).setValues(rows);
  sheet.hideSheet();
  return {tab: TAB_REFERRAL_SEED_COUNTS, companies: rows.length - 1,
          deducted: deducted,
          emails: rows.slice(1).reduce(function (sum, row) { return sum + row[1]; }, 0),
          spreadsheet: tracker.getName()};
}

/** Read-only proof that every active Referral row is in the non-invalid seed. */
function auditReferralSeedGate() {
  var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var employees = outreachReadEmployees_(contactsBook);
  var allowed = {};
  employees.forEach(function (person) { allowed[person.email] = true; });
  var referral = tracker.getSheetByName(TAB_REFERRAL);
  var active = referral ? outreachReadReferralRows_(referral).filter(function (row) {
    return (row.status === STATUS_QUEUED || row.status === STATUS_DRAFTED) && !row.cancel;
  }) : [];
  var ineligible = active.filter(function (row) { return !allowed[row.email]; });
  return {strictSeedRows: employees.length, activeReferralRows: active.length,
          activeIneligibleRows: ineligible.length,
          sample: ineligible.slice(0, 10).map(function (row) {
            return {row: row.index, company: row.company, email: row.email};
          })};
}

/** Reopen rows cancelled by the former risky-address gate, then replan them. */
function restoreReferralPolicyCancelledRows() {
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
  var referral = tracker.getSheetByName(TAB_REFERRAL);
  if (!referral) return {restored: 0, replan: outreachReferralIdle_()};

  var allowed = {};
  outreachReadEmployees_(contactsBook).forEach(function (person) { allowed[person.email] = true; });
  var restored = 0;
  outreachReadReferralRows_(referral).forEach(function (row) {
    if (row.status !== STATUS_CANCELLED
        || row.lastError !== REFERRAL_LEGACY_INELIGIBLE_ERROR
        || !allowed[row.email]) return;
    var updates = {};
    updates[R_STATUS] = STATUS_QUEUED;
    updates[R_CANCEL] = false;
    updates[R_SCHEDULED] = '';
    updates[R_DRAFTED_AT] = '';
    updates[R_DRAFT_ID] = '';
    updates[R_ERROR] = '';
    outreachWriteRow_(referral, row.index, updates);
    restored++;
  });
  var replan = replanReferralAsks();
  return {restored: restored, replan: replan};
}

/** Replace the generated Employees (seed) tab from ColdEmail's export.
 *
 * The seed tab is owned by the sending account and is intentionally separate
 * from Contacts (manual). This helper clears only generated cell contents,
 * preserves the tab's formatting, and does not touch the Referral tab.
 */
function replaceEmployeeSeed(rows) {
  return replaceEmployeeSeedChunk(rows, 2, true);
}

/** Chunked form for large generated exports that exceed clasp's argument limit. */
function replaceEmployeeSeedChunk(rows, startRow, clearExisting) {
  if (!Array.isArray(rows)) throw new Error('rows must be an array');
  startRow = Number(startRow);
  if (!isFinite(startRow) || startRow < 2 || Math.floor(startRow) !== startRow) {
    throw new Error('startRow must be an integer >= 2');
  }
  var contactsBook = SpreadsheetApp.openById(
    outreachProperty_(PROP_CONTACTS_ID, true));
  var sheet = contactsBook.getSheetByName(TAB_EMPLOYEES_SEED);
  if (!sheet) throw new Error('missing tab: ' + TAB_EMPLOYEES_SEED);

  if (clearExisting !== false) {
    var last = sheet.getLastRow();
    if (last > 1) sheet.getRange(2, 1, last - 1, E_WIDTH).clearContent();
  }
  if (rows.length) {
    var values = rows.map(function (row) {
      return [row.Company, row['Person Name'], row.Email, row.Title,
        row.Domain, row.Seniority, row.LinkedIn, row.Angle, row.Bucket,
        row.Verify];
    });
    sheet.getRange(startRow, 1, values.length, E_WIDTH).setValues(values);
  }
  return {tab: TAB_EMPLOYEES_SEED, rows: rows.length,
          startRow: startRow, spreadsheet: contactsBook.getName()};
}

/**
 * What replanReferralAsks WOULD do, computed without writing a single cell.
 *
 * outreachReferralReplan_ is pure — it returns the moves it would make — so this
 * asks it the question the hourly cycle asks and reports the answer instead of
 * applying it.
 */
function diagnoseReferralReplan() {
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var referral = tracker.getSheetByName(TAB_REFERRAL);
  var rows = outreachReadReferralRows_(referral);

  var queue = tracker.getSheetByName(TAB_QUEUE);
  var queueRows = [];
  if (queue && queue.getLastRow() > 1) {
    queueRows = queue.getRange(2, 1, queue.getLastRow() - 1, Q_WIDTH).getValues()
      .map(function (row, index) { return outreachParseQueue_(row, index + 2); });
  }

  var now = new Date();
  var roomOn = outreachReferralRoomOn_(queueRows, rows);
  var room = [];
  for (var i = 0; i < 7; i++) {
    var day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    room.push(Utilities.formatDate(day, Session.getScriptTimeZone(), 'MM-dd')
              + ' = ' + roomOn(day));
  }

  var movable = rows.filter(function (row) {
    return row.status === STATUS_QUEUED && !row.cancel;
  }).length;

  // Counts only live work, by the date the tab says it will send. This makes the
  // distinction between a capacity spill and a scheduler defect visible without
  // returning any recipient or message data.
  var openByScheduledDay = {};
  rows.forEach(function (row) {
    if ((row.status !== STATUS_QUEUED && row.status !== STATUS_DRAFTED)
        || row.cancel || !row.scheduled) return;
    var key = Utilities.formatDate(row.scheduled, Session.getScriptTimeZone(),
                                   'yyyy-MM-dd');
    if (!openByScheduledDay[key]) openByScheduledDay[key] = { queued: 0, drafted: 0 };
    if (row.status === STATUS_QUEUED) openByScheduledDay[key].queued++;
    else openByScheduledDay[key].drafted++;
  });

  var moved = outreachReferralReplan_(rows, now, roomOn);

  return {
    referralRows: rows.length,
    queueRows: queueRows.length,
    movable: movable,
    wouldMove: moved.length,
    openByScheduledDay: openByScheduledDay,
    roomOnNext7Days: room,
    firstMoves: moved.slice(0, 6).map(function (move) {
      return move.index + ' -> '
        + Utilities.formatDate(move.scheduled, Session.getScriptTimeZone(), 'MM-dd HH:mm');
    })
  };
}

/** Where the Referral tab's phantom rows come from, and what each stage costs. */
function diagnoseReferralTab() {
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var referral = tracker.getSheetByName(TAB_REFERRAL);
  var out = {
    maxRows: referral.getMaxRows(),
    lastRow: referral.getLastRow(),
    lastColumn: referral.getLastColumn()
  };

  var t0 = new Date().getTime();
  var values = referral.getRange(2, 1, referral.getLastRow() - 1, R_WIDTH).getValues();
  out.readMs = new Date().getTime() - t0;

  // Which columns keep a row alive as far as getLastRow is concerned.
  var withCompany = 0, blankButNotEmpty = 0, lastRealRow = 1;
  var culprits = {};
  values.forEach(function (row, i) {
    var company = String(row[R_COMPANY - 1] || '').trim();
    if (company) { withCompany++; lastRealRow = i + 2; return; }
    var any = false;
    row.forEach(function (cell, c) {
      if (cell !== '' && cell !== null && cell !== undefined) {
        any = true;
        culprits[(c + 1) + ''] = (culprits[(c + 1) + ''] || 0) + 1;
      }
    });
    if (any) blankButNotEmpty++;
  });
  out.rowsWithCompany = withCompany;
  out.lastRowWithCompany = lastRealRow;
  out.blankRowsStillHoldingSomething = blankButNotEmpty;
  out.columnsKeepingBlankRowsAlive = culprits;

  var t1 = new Date().getTime();
  var rows = outreachReadReferralRows_(referral);
  out.parseMs = new Date().getTime() - t1;
  out.parsedRows = rows.length;

  return out;
}

/** A look at the rows that have no company but are keeping the tab alive. */
function diagnosePhantomRows() {
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var referral = tracker.getSheetByName(TAB_REFERRAL);
  var values = referral.getRange(2, 1, referral.getLastRow() - 1, R_WIDTH).getValues();
  var samples = [], statuses = {}, errors = {};
  values.forEach(function (row, i) {
    if (String(row[R_COMPANY - 1] || '').trim()) return;
    var status = String(row[R_STATUS - 1] || '');
    var error = String(row[R_ERROR - 1] || '');
    if (!status && !error) return;
    statuses[status] = (statuses[status] || 0) + 1;
    errors[error.slice(0, 90)] = (errors[error.slice(0, 90)] || 0) + 1;
    if (samples.length < 3) {
      samples.push({ row: i + 2, status: status, error: error.slice(0, 140),
                     priority: row[R_PRIORITY - 1], cancel: row[R_CANCEL - 1] });
    }
  });
  return { statuses: statuses, errors: errors, samples: samples };
}
