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

/**
 * One-off Adobe referral send, deliberately outside both outreach queues.
 * Reads the current employee seed, skips any Adobe address already in Sent,
 * and sends the remaining contacts one minute apart with the approved short
 * two-bullet template. This function does not write Referral or Email rows.
 */
function sendRemainingAdobeReferralBatch() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
    var seed = contactsBook.getSheetByName(TAB_EMPLOYEES_SEED);
    if (!seed || seed.getLastRow() < 2) throw new Error('missing or empty ' + TAB_EMPLOYEES_SEED);

    var people = seed.getRange(2, 1, seed.getLastRow() - 1, E_WIDTH).getValues()
      .map(function (row) {
        return {
          company: outreachCell_(row, E_COMPANY),
          name: outreachCell_(row, E_NAME),
          email: outreachCell_(row, E_EMAIL).toLowerCase(),
          verify: outreachCell_(row, E_VERIFY).toLowerCase()
        };
      })
      .filter(function (person) {
        return outreachSameEmployer_(outreachCompanyTokens_('Adobe'),
                                     outreachCompanyTokens_(person.company))
          && person.email.indexOf('@') > 0
          && person.verify !== REFERRAL_REJECTED_VERIFY;
      });

    var seen = {}, recipients = [];
    people.forEach(function (person) {
      if (seen[person.email]) return;
      seen[person.email] = true;
      if (!GmailApp.search('from:me to:' + person.email, 0, 1).length) {
        recipients.push(person);
      }
    });

    var subjects = [
      'Referral request for the Software Engineer Intern role',
      'A quick question about Adobe',
      'Referral request for Adobe',
      'Could I ask about a referral?',
      'Software Engineer Intern referral'
    ];
    var asks = [
      'Would you be open to <b>referring me</b> if you think my background could be a fit?',
      'If you think my background could be a fit, would you be comfortable <b>referring me</b>?',
      'Would you consider <b>referring me</b> if you feel the role is a good match?',
      'If the role seems aligned, would you be willing to <b>refer me</b>?',
      'Would you feel comfortable <b>referring me</b> if you see a fit?'
    ];
    var closes = [
      'Thanks for your time,', 'Thank you for considering it,',
      'I appreciate your time,', 'Thanks for taking a look,',
      'Thank you for your consideration,'
    ];
    var posting = 'https://careers.adobe.com/us/en/job/R171666/2027-Intern-Software-Engineer';
    var resume = DriveApp.getFileById(OFFICIAL_RESUME_FILE_ID).getBlob()
      .setName('Henry_Nguyen_Resume.pdf');
    var sent = [];

    recipients.forEach(function (person, index) {
      var first = String(person.name || '').trim().split(/\s+/).pop();
      var salutation = person.name.toLowerCase().indexOf('nguyen') !== -1
        && /^jessica$/i.test(first) ? 'Chị ' + first + ',' : 'Hi ' + first + ',';
      var why = [
        'I’m <b>Henry Nguyen</b>, a Math and Computer Science student at <b>Kenyon College</b>.',
        'Since you work at <b>Adobe</b>, I wanted to reach out because I saw that Adobe just opened this role today. I realize this message is a little out of the blue, but your profile seemed like a good fit, so I wanted to ask.'
      ];
      var html = '<p>' + outreachEscape_(salutation) + '</p>'
        + '<p><b>Why I’m reaching out:</b></p>'
        + '<ul><li>' + why[0] + '</li><li>' + why[1] + '</li></ul>'
        + '<p>' + asks[index % asks.length] + ' I’ve attached my resume and included the posting below.</p>'
        + '<p>' + closes[index % closes.length] + '<br><b>Henry Nguyen</b><br>'
        + '<span style="color:#666">' + outreachEscape_(SENDER_LINKS) + '</span></p>'
        + '<p style="color:#666">The posting: ' + outreachEscape_(posting) + '</p>';
      var plain = html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
        .replace(/\n\s*\n/g, '\n\n').trim();
      GmailApp.sendEmail(person.email, subjects[index % subjects.length], plain, {
        htmlBody: html,
        attachments: [resume]
      });
      sent.push({name: person.name, email: person.email, subject: subjects[index % subjects.length]});
      if (index < recipients.length - 1) Utilities.sleep(60000);
    });
    Logger.log('Manual Adobe referral batch sent ' + sent.length + ' message(s); no queue rows written.');
    return {sent: sent, skippedAlreadySent: people.length - recipients.length};
  } finally {
    lock.releaseLock();
  }
}

/**
 * One-off Microsoft referral send, deliberately outside both outreach queues.
 * Sends four Boston and four Mountain View requests. The first message is sent
 * immediately; the remaining seven are separate one-shot clock triggers two
 * minutes apart so the run stays below Apps Script's execution limit.
 * Truc Nguyen is intentionally excluded. No Referral or Email rows are written.
 */
function sendMicrosoftReferralBatch() {
  var created = [];
  try {
    var props = PropertiesService.getScriptProperties();
    var existing = props.getProperty('MICROSOFT_DIRECT_BATCH_STATE');
    if (existing) {
      var existingState = JSON.parse(existing);
      if (existingState.status !== 'cancelled') {
        return {alreadyStarted: true, state: existingState};
      }
      // A cancelled one-off batch may be restarted after its links/template
      // are corrected; Gmail search below still skips addresses already sent.
      props.deleteProperty('MICROSOFT_DIRECT_BATCH_STATE');
    }

    var people = microsoftReferralBatchPeople_();
    var recipients = people.filter(function (person) {
      return !GmailApp.search('from:me to:' + person.email, 0, 1).length;
    });
    if (!recipients.length) {
      props.setProperty('MICROSOFT_DIRECT_BATCH_STATE', JSON.stringify({
        status: 'complete', sent: 0, skippedAlreadySent: people.length
      }));
      return {sent: [], skippedAlreadySent: people.length};
    }

    props.setProperty('MICROSOFT_DIRECT_BATCH_STATE', JSON.stringify({
      status: 'scheduled', startedAt: new Date().toISOString(),
      indexes: recipients.map(function (person) { return people.indexOf(person); })
    }));

    var sent = [sendMicrosoftReferralPerson_(recipients[0])];
    var wrappers = [
      'sendMicrosoftReferralSlot1_', 'sendMicrosoftReferralSlot2_',
      'sendMicrosoftReferralSlot3_', 'sendMicrosoftReferralSlot4_',
      'sendMicrosoftReferralSlot5_', 'sendMicrosoftReferralSlot6_',
      'sendMicrosoftReferralSlot7_'
    ];
    var now = new Date().getTime();
    recipients.slice(1).forEach(function (person, i) {
      created.push(ScriptApp.newTrigger(wrappers[i])
        .timeBased().at(new Date(now + (i + 1) * 120000)).create());
    });
    Logger.log('Microsoft referral batch sent first message and scheduled ' +
               created.length + ' more message(s), no queue rows written.');
    return {sent: sent, scheduled: created.length,
            skippedAlreadySent: people.length - recipients.length};
  } catch (error) {
    created.forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
    PropertiesService.getScriptProperties().deleteProperty('MICROSOFT_DIRECT_BATCH_STATE');
    throw error;
  }
}

/** Cancel the pending Microsoft direct-send triggers without touching sent mail. */
function stopMicrosoftReferralBatch() {
  // This is intentionally lock-free: the normal hourly sender may hold the
  // shared lock while this cancellation needs to prevent future sends.
  var props = PropertiesService.getScriptProperties();
  var stateText = props.getProperty('MICROSOFT_DIRECT_BATCH_STATE');
  var state = stateText ? JSON.parse(stateText) : {status: 'not_started'};
  state.status = 'cancelled';
  state.cancelledAt = new Date().toISOString();
  props.setProperty('MICROSOFT_DIRECT_BATCH_STATE', JSON.stringify(state));
  var handlers = {
    sendMicrosoftReferralSlot1_: true, sendMicrosoftReferralSlot2_: true,
    sendMicrosoftReferralSlot3_: true, sendMicrosoftReferralSlot4_: true,
    sendMicrosoftReferralSlot5_: true, sendMicrosoftReferralSlot6_: true,
    sendMicrosoftReferralSlot7_: true
  };
  var deleted = 0;
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (!handlers[trigger.getHandlerFunction()]) return;
    ScriptApp.deleteTrigger(trigger);
    deleted++;
  });
  Logger.log('Microsoft referral batch cancelled; deleted ' + deleted + ' pending trigger(s).');
  return {status: 'cancelled', deletedTriggers: deleted, state: state};
}

/** Remove completed Microsoft one-shot triggers while preserving the batch state. */
function cleanupMicrosoftReferralBatchTriggers() {
  var handlers = {
    sendMicrosoftReferralSlot1_: true, sendMicrosoftReferralSlot2_: true,
    sendMicrosoftReferralSlot3_: true, sendMicrosoftReferralSlot4_: true,
    sendMicrosoftReferralSlot5_: true, sendMicrosoftReferralSlot6_: true,
    sendMicrosoftReferralSlot7_: true
  };
  var deleted = 0;
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (!handlers[trigger.getHandlerFunction()]) return;
    ScriptApp.deleteTrigger(trigger);
    deleted++;
  });
  Logger.log('Cleaned up ' + deleted + ' completed Microsoft referral trigger(s).');
  return {deletedTriggers: deleted};
}

function sendMicrosoftReferralSlot1_() { return sendMicrosoftReferralSlot_(0); }
function sendMicrosoftReferralSlot2_() { return sendMicrosoftReferralSlot_(1); }
function sendMicrosoftReferralSlot3_() { return sendMicrosoftReferralSlot_(2); }
function sendMicrosoftReferralSlot4_() { return sendMicrosoftReferralSlot_(3); }
function sendMicrosoftReferralSlot5_() { return sendMicrosoftReferralSlot_(4); }
function sendMicrosoftReferralSlot6_() { return sendMicrosoftReferralSlot_(5); }
function sendMicrosoftReferralSlot7_() { return sendMicrosoftReferralSlot_(6); }

function sendMicrosoftReferralSlot_(index) {
  var state = PropertiesService.getScriptProperties().getProperty('MICROSOFT_DIRECT_BATCH_STATE');
  if (!state || JSON.parse(state).status !== 'scheduled') return {skipped: true};
  var batch = JSON.parse(state);
  var people = microsoftReferralBatchPeople_();
  var personIndex = batch.indexes[index + 1];
  var person = people[personIndex];
  if (!person) return {skipped: true};
  var result = sendMicrosoftReferralPerson_(person);
  if (index + 1 === batch.indexes.length - 1) {
    PropertiesService.getScriptProperties().setProperty(
      'MICROSOFT_DIRECT_BATCH_STATE', JSON.stringify({status: 'complete'}));
  }
  return result;
}

/** Send the corrected Boston posting link to Trung without touching any queue. */
function sendMicrosoftBostonLinkCorrection() {
  var recipient = 'trungnguyen@microsoft.com';
  var subject = 'Sorry — corrected Microsoft CoreAI link';
  if (GmailApp.search('from:me to:' + recipient + ' subject:"' + subject + '"', 0, 1).length) {
    return {alreadySent: true, email: recipient, subject: subject};
  }
  var link = 'https://apply.careers.microsoft.com/careers/job/1970393556972698/?jr_id=6a9688d1e4e60e4b8da59437';
  var html = '<p>Hi anh Trung,</p>'
    + '<p>Sorry, I sent you the wrong link just now. I’m sending the correct link again below:</p>'
    + '<p><b>Boston CoreAI role:</b> ' + outreachEscape_(link) + '</p>'
    + '<p>Thanks,<br><b>Henry Nguyen</b></p>';
  var plain = html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
  GmailApp.sendEmail(recipient, subject, plain, {htmlBody: html});
  Logger.log('Microsoft Boston link correction sent to ' + recipient + '.');
  return {sent: true, email: recipient, subject: subject, link: link};
}

function microsoftReferralBatchPeople_() {
  return [
    {name: 'Trung Nguyen', email: 'trungnguyen@microsoft.com', city: 'Boston',
      salutation: 'Hi anh Trung,', role: 'Software Engineer Intern – CoreAI',
      link: 'https://apply.careers.microsoft.com/careers/job/1970393556972698/?jr_id=6a9688d1e4e60e4b8da59437',
      wording: 'I recently applied to the Software Engineer Intern role on Microsoft’s CoreAI team in Boston. I realize this message is a little out of the blue, but since you work at Microsoft, I wanted to reach out and ask.'},
    {name: 'Minh Nguyen', email: 'minhnguyen@microsoft.com', city: 'Boston',
      salutation: 'Hi anh Minh,', role: 'Software Engineer Intern – CoreAI',
      link: 'https://apply.careers.microsoft.com/careers/job/1970393556972698/?jr_id=6a9688d1e4e60e4b8da59437',
      wording: 'I’ve just submitted my application for Microsoft’s CoreAI Software Engineer Intern opening in Boston. This is a bit of an unexpected message, but I saw that you work at Microsoft and thought I would reach out.'},
    {name: 'Tuan Nguyen', email: 'tuannguyen@microsoft.com', city: 'Boston',
      salutation: 'Hi anh Tuan,', role: 'Software Engineer Intern – CoreAI',
      link: 'https://apply.careers.microsoft.com/careers/job/1970393556972698/?jr_id=6a9688d1e4e60e4b8da59437',
      wording: 'I recently applied for the CoreAI Software Engineer Intern role in Boston. I know reaching out cold can feel a little sudden, but because you’re at Microsoft, I wanted to ask about a possible referral.'},
    {name: 'Joshua Venable', email: 'jos@microsoft.com', city: 'Boston',
      salutation: 'Hi Joshua,', role: 'Software Engineer Intern – CoreAI',
      link: 'https://apply.careers.microsoft.com/careers/job/1970393556972698/?jr_id=6a9688d1e4e60e4b8da59437',
      wording: 'I recently applied to Microsoft’s CoreAI Software Engineer Intern role in Boston. I realize this note is a little out of the blue, but I noticed you work at Microsoft and wanted to reach out.'},
    {name: 'John Nguyen', email: 'johnnguyen@microsoft.com', city: 'Mountain View',
      salutation: 'Hi John,', role: 'Software Engineer Intern – CoreAI',
      link: 'https://apply.careers.microsoft.com/careers/job/1970393556972687?domain=microsoft.com&hl=en',
      wording: 'I recently applied for Microsoft’s CoreAI Software Engineer Intern opening in Mountain View. This message may be a little unexpected, but since you work at Microsoft, I wanted to ask about a possible referral.'},
    {name: 'Hung Nguyen', email: 'hungnguyen@microsoft.com', city: 'Mountain View',
      salutation: 'Hi anh Hung,', role: 'Software Engineer Intern – CoreAI',
      link: 'https://apply.careers.microsoft.com/careers/job/1970393556972687?domain=microsoft.com&hl=en',
      wording: 'I’ve applied to the Software Engineer Intern role on Microsoft’s CoreAI team in Mountain View. I realize reaching out this way is a little out of the blue, but I saw that you’re at Microsoft and wanted to get in touch.'},
    {name: 'Ming Zou', email: 'mingz@microsoft.com', city: 'Mountain View',
      salutation: 'Hi Ming,', role: 'Software Engineer Intern – CoreAI',
      link: 'https://apply.careers.microsoft.com/careers/job/1970393556972687?domain=microsoft.com&hl=en',
      wording: 'I recently submitted an application for Microsoft’s CoreAI Software Engineer Intern role in Mountain View. I know this is a somewhat unexpected reach-out, but I noticed you work at Microsoft and wanted to ask.'},
    {name: 'Hou Chi Chan', email: 'hchan@microsoft.com', city: 'Mountain View',
      salutation: 'Hi Hou,', role: 'Software Engineer Intern – CoreAI',
      link: 'https://apply.careers.microsoft.com/careers/job/1970393556972687?domain=microsoft.com&hl=en',
      wording: 'I recently applied to the CoreAI Software Engineer Intern opening in Mountain View. I realize this note is a little out of the blue, but because you work at Microsoft, I wanted to reach out and ask.'}
  ];
}

function sendMicrosoftReferralPerson_(person) {
  if (GmailApp.search('from:me to:' + person.email, 0, 1).length) {
    return {skippedAlreadySent: true, name: person.name, email: person.email};
  }
  var why = [
    'I’m <b>Henry Nguyen</b>, a Math and Computer Science student at <b>Kenyon College</b>.',
    person.wording
  ];
  var secondBullet = outreachEscape_(why[1])
    .replace(/Microsoft/g, '<b>Microsoft</b>')
    .replace(/CoreAI/g, '<b>CoreAI</b>')
    .replace(/Software Engineer Intern/g, '<b>Software Engineer Intern</b>')
    .replace(/Boston|Mountain View/g, '<b>$&</b>');
  var html = '<p>' + outreachEscape_(person.salutation) + '</p>'
    + '<p><b>Why I’m reaching out:</b></p>'
    + '<ul><li>' + why[0] + '</li><li>' + secondBullet
    + '</li></ul>'
    + '<p>Would you be open to <b>referring me</b> if you think my background could be a fit? I’ve attached my resume and included the posting below.</p>'
    + '<p>Thanks for your time,<br><b>Henry Nguyen</b><br>'
    + '<span style="color:#666">' + outreachEscape_(SENDER_LINKS) + '</span></p>'
    + '<p style="color:#666">The posting: ' + outreachEscape_(person.link) + '</p>';
  var plain = html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/\n\s*\n/g, '\n\n').trim();
  var subject = 'Referral request — Microsoft CoreAI (' + person.city + ')';
  var resume = DriveApp.getFileById(OFFICIAL_RESUME_FILE_ID).getBlob()
    .setName('Henry_Nguyen_Resume.pdf');
  GmailApp.sendEmail(person.email, subject, plain, {htmlBody: html, attachments: [resume]});
  Logger.log('Microsoft referral sent to ' + person.email + ' for ' + person.city + '.');
  return {sent: true, name: person.name, email: person.email, city: person.city};
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
    if (verify === 'debounce:invalid') return;
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

/** Read-only view of the currently active Referral rows and their exact hours. */
function diagnoseReferralActiveRows() {
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var referral = tracker.getSheetByName(TAB_REFERRAL);
  if (!referral || referral.getLastRow() < 2) return [];
  return outreachReadReferralRows_(referral).filter(function (row) {
    return row.status === STATUS_QUEUED || row.status === STATUS_DRAFTED;
  }).map(function (row) {
    return {
      row: row.index,
      company: row.company,
      status: row.status,
      scheduled: row.scheduled
        ? Utilities.formatDate(row.scheduled, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm')
        : '',
      priority: row.priority,
      cancelled: row.cancel,
      lastError: row.lastError
    };
  });
}

/** Read-only recent Referral rows, including cancellation reasons but no emails. */
function diagnoseReferralRecentRows() {
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var referral = tracker.getSheetByName(TAB_REFERRAL);
  if (!referral || referral.getLastRow() < 2) return [];
  var rows = outreachReadReferralRows_(referral);
  return rows.slice(Math.max(0, rows.length - 12)).map(function (row) {
    return {
      row: row.index,
      company: row.company,
      role: row.role,
      status: row.status,
      scheduled: row.scheduled
        ? Utilities.formatDate(row.scheduled, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm')
        : '',
      lastError: row.lastError
    };
  });
}

/** Read-only Referral rows for one company, including the selected role. */
function diagnoseReferralCompanyRows(company) {
  var wanted = outreachNameKey_(company);
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var referral = tracker.getSheetByName(TAB_REFERRAL);
  if (!referral || referral.getLastRow() < 2) return [];
  return outreachReadReferralRows_(referral).filter(function (row) {
    return outreachNameKey_(row.company) === wanted;
  }).map(function (row) {
    return {
      row: row.index,
      company: row.company,
      role: row.role,
      status: row.status,
      scheduled: row.scheduled
        ? Utilities.formatDate(row.scheduled, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm')
        : '',
      lastError: row.lastError
    };
  });
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

/**
 * Read-only: which cold-path addresses the Email tab has already spent.
 *
 * The Email tab deliberately holds a salted fingerprint and never an address, so
 * "who has already been written to" is a question no reader of that tab can
 * answer. This resolves the spent fingerprints back to addresses the same way
 * sendPreparedDrafts does — by hashing the contact list, not by unhashing
 * anything — and hands back the addresses alone. The salt never leaves the
 * script.
 *
 * "Spent" is STATUS_SPENDS_CONTACT and nothing looser: Queued, Drafted, Sent,
 * Replied and Bounced hold a contact; Cancelled hands it back to the pool. That
 * is the same rule outreachPlanEnqueue_ enqueues by, so a list built from this
 * is a list the planner would agree with.
 *
 * Both intakes are hashed per contact for the reason outreachContactByFinger-
 * print_ tries both: the bucket a row was spent in is a fact about the row, not
 * about the Role somebody may have corrected since.
 *
 * Writes nothing.
 */
function diagnoseSpentColdContacts(offset, limit) {
  var salt = outreachProperty_(PROP_SALT, true);
  var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));

  var byPrint = {};
  outreachReadContacts_(contactsBook).forEach(function (contact) {
    byPrint[outreachFingerprint_(contact.email, salt, SEASON_SUMMER)] = contact;
    byPrint[outreachFingerprint_(contact.email, salt, SEASON_OFFCYCLE)] = contact;
  });

  var queue = tracker.getSheetByName(TAB_QUEUE);
  var last = queue ? queue.getLastRow() : 0;
  var rows = last > 1
    ? queue.getRange(2, 1, last - 1, Q_WIDTH).getValues().map(outreachParseQueue_)
    : [];

  var spent = {}, unresolved = [];
  rows.forEach(function (row) {
    if (!row.fingerprint || STATUS_SPENDS_CONTACT.indexOf(row.status) === -1) return;
    var contact = byPrint[row.fingerprint];
    if (!contact) {
      unresolved.push({row: row.rowNumber, company: row.company, status: row.status});
      return;
    }
    var known = spent[contact.email];
    if (!known) {
      spent[contact.email] = {company: row.company, name: contact.name,
                              statuses: [row.status]};
    } else if (known.statuses.indexOf(row.status) === -1) {
      known.statuses.push(row.status);
    }
  });

  // One tab-separated block rather than an array of objects. clasp run prints a
  // returned array through util.inspect, which stops at a hundred items and says
  // so — a caller reading the tail would have been handed a silently short list.
  var addresses = Object.keys(spent).sort().map(function (email) {
    return [email, spent[email].company, spent[email].name,
            spent[email].statuses.join('/')].join('\t');
  });

  // Paged, and not for the sheet's sake. clasp run prints the return through
  // util.inspect, which stops an array at a hundred entries and a string at ten
  // thousand characters and says so only in the tail — a caller reading the head
  // is handed a short list that looks complete. A page small enough to clear both
  // limits is the only shape that cannot lie about its own length.
  var from = Number(offset) || 0;
  var size = Number(limit) || 150;
  var page = addresses.slice(from, from + size);

  return {
    contacts: Object.keys(byPrint).length / 2,
    queueRows: rows.length,
    spentCount: addresses.length,
    offset: from,
    returned: page.length,
    more: from + page.length < addresses.length,
    spentAddresses: page.join('\n'),
    unresolved: unresolved
  };
}
