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
      syncTargetAfterSend_('Adobe', 'refer');
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
  syncTargetAfterSend_('Microsoft', 'recruiter');
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
  syncTargetAfterSend_('Microsoft', 'refer');
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
  var sentAddresses = {};
  values.forEach(function (row) {
    var email = String(row[E_EMAIL - 1] || '').trim().toLowerCase();
    if (email && outreachSentTicked_(row[E_SENT - 1])) sentAddresses[email] = true;
  });
  values.forEach(function (row) {
    var verify = String(row[E_VERIFY - 1] || '').trim().toLowerCase();
    if (verify === 'debounce:invalid') return;
    var company = String(row[E_COMPANY - 1] || '').trim();
    var email = String(row[E_EMAIL - 1] || '').trim().toLowerCase();
    if (!company || !email || email.indexOf('@') < 1 || sentAddresses[email]) return;
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
          sentTickDeducted: Object.keys(sentAddresses).length,
          emails: rows.slice(1).reduce(function (sum, row) { return sum + row[1]; }, 0),
          spreadsheet: tracker.getName()};
}

/** Refresh the hidden tracker snapshot used by Target for recruiter availability. */
function refreshRecruiterSeedCounts() {
  var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
  var contacts = outreachReadContacts_(contactsBook);
  var salt = outreachProperty_(PROP_SALT, true);
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var spent = {};
  var queue = tracker.getSheetByName(TAB_QUEUE);
  if (queue && queue.getLastRow() > 1) {
    queue.getRange(2, 1, queue.getLastRow() - 1, Q_WIDTH).getValues()
      .map(function (row, index) { return outreachParseQueue_(row, index + 2); })
      .forEach(function (row) {
        if (row.fingerprint && STATUS_SPENDS_CONTACT.indexOf(row.status) !== -1) {
          spent[row.fingerprint] = true;
        }
      });
  }

  var addresses = {};
  contacts.forEach(function (contact) {
    if (contact.sent) return;
    var summer = outreachFingerprint_(contact.email, salt, SEASON_SUMMER);
    var offcycle = outreachFingerprint_(contact.email, salt, SEASON_OFFCYCLE);
    if (spent[summer] || spent[offcycle]) return;
    var key = outreachCompanyTokens_(contact.company).join(' ');
    if (!key) return;
    if (!addresses[key]) addresses[key] = {name: contact.company, emails: {}};
    addresses[key].emails[contact.email] = true;
  });

  var sheet = tracker.getSheetByName('Recruiter Seed Counts')
    || tracker.insertSheet('Recruiter Seed Counts');
  var rows = [['Company', 'Sendable recruiter email']];
  Object.keys(addresses).sort().forEach(function (key) {
    rows.push([addresses[key].name, Object.keys(addresses[key].emails).length]);
  });
  sheet.clearContents();
  sheet.getRange(1, 1, rows.length, 2).setValues(rows);
  sheet.hideSheet();
  return {tab: 'Recruiter Seed Counts', companies: rows.length - 1,
          emails: rows.slice(1).reduce(function (sum, row) { return sum + row[1]; }, 0),
          spreadsheet: tracker.getName()};
}

/** Record a successful Target referral/recruiter send for the bound renderer. */
function markTargetOutreachStatus_(company, kind) {
  if (!company || (kind !== 'refer' && kind !== 'recruiter')) return false;
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var sheet = tracker.getSheetByName('Target Outreach Status')
    || tracker.insertSheet('Target Outreach Status');
  var rows = sheet.getLastRow() >= 2 && sheet.getLastColumn() >= 3
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues() : [];
  var target = outreachCompanyTokens_(company);
  var found = false;
  rows.forEach(function (row) {
    if (!outreachSameEmployer_(target, outreachCompanyTokens_(row[0]))) return;
    found = true;
    row[1] = row[1] === true || String(row[1]).toLowerCase() === 'true';
    row[2] = row[2] === true || String(row[2]).toLowerCase() === 'true';
    if (kind === 'refer') row[1] = true;
    if (kind === 'recruiter') row[2] = true;
  });
  if (!found) rows.push([company, kind === 'refer', kind === 'recruiter']);
  sheet.clearContents();
  sheet.getRange(1, 1, rows.length + 1, 3)
    .setValues([['Company', 'Refer', 'Recruiter?']].concat(rows));
  sheet.hideSheet();
  return true;
}

/** Refresh both Target count snapshots after a successful Target send. */
function refreshTargetSendableCounts_() {
  return {
    referral: refreshReferralSeedCounts(),
    recruiter: refreshRecruiterSeedCounts()
  };
}

/** Best-effort Target sync used by direct sends outside the normal queue. */
function syncTargetAfterSend_(company, kind) {
  try {
    markTargetOutreachStatus_(company, kind);
    return refreshTargetSendableCounts_();
  } catch (error) {
    Logger.log('Post-send Target sync failed: ' + String(error.message || error));
    return null;
  }
}

/** Every persisted direct recruiter/referral campaign participates in bounce reconciliation. */
function targetDeliveryFailureCampaigns_() {
  return Object.keys(PropertiesService.getScriptProperties().getProperties())
    .filter(function (key) {
      return key.indexOf('TARGET_REFERRAL_CAMPAIGN_') === 0
        || key.indexOf('TARGET_RECRUITER_CAMPAIGN_') === 0
        || key.indexOf('OFFTARGET_RECRUITER_CAMPAIGN_') === 0;
    })
    .sort()
    .map(function (key) {
      return {key: key, kind: key.indexOf('TARGET_REFERRAL_CAMPAIGN_') === 0
        ? 'referral' : 'recruiter'};
    })
    .concat([{key: 'MICROSOFT_COLD_DRAFT_SCHEDULE_20260909', kind: 'recruiter'}]);
}

/** Read recent delivery-failure notices into an address-to-received-time map. */
function targetDeliveryFailureAddresses_() {
  var bounced = {};
  GmailApp.search('{from:mailer-daemon from:postmaster} newer_than:30d', 0, 100)
    .forEach(function (thread) {
      thread.getMessages().forEach(function (message) {
        if (!OUTREACH_BOUNCE_SENDER.test(String(message.getFrom() || ''))) return;
        // Gmail providers disagree about where the rejected recipient lives.
        // Google commonly puts it in the body; Microsoft can place it only in
        // an X-Failed-Recipients header, exposed by the raw source.
        var text = (message.getPlainBody() || '') + '\n' + (message.getSubject() || '')
          + '\n' + (message.getRawContent() || '');
        (text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []).forEach(function (address) {
          bounced[String(address).trim().toLowerCase()] = message.getDate().toISOString();
        });
      });
    });
  return bounced;
}

/**
 * Reconcile delivery failures for every direct Target campaign.
 *
 * Gmail accepting a message only proves that it left this mailbox. A later
 * mailer-daemon or postmaster response is the final delivery result, so this
 * scanner updates the campaign state and its visible Target mirror without
 * making an invalid address sendable again.
 */
function scanTargetDeliveryFailures() {
  var bounced = targetDeliveryFailureAddresses_();
  var props = PropertiesService.getScriptProperties();
  var tally = {bounced: 0, referral: 0, recruiter: 0, notices: Object.keys(bounced).length};

  targetDeliveryFailureCampaigns_().forEach(function (campaign) {
    var text = props.getProperty(campaign.key);
    if (!text) return;
    var state = JSON.parse(text);
    var changed = targetApplyDeliveryFailures_(state.entries, bounced);
    if (!changed) return;
    props.setProperty(campaign.key, JSON.stringify(state));
    tally.bounced += changed;
    tally[campaign.kind] += changed;
  });

  if (tally.bounced) {
    refreshTargetSendableCounts_();
    refreshTargetQueueTabs_();
  }
  Logger.log('Target delivery failures: ' + tally.bounced
           + ' bounced across ' + tally.notices + ' notice address(es).');
  return tally;
}

/** Safely reconcile delayed delivery results, counts, and Target mirrors on demand. */
function reconcileTargetDeliveryState() {
  var delivery = scanTargetDeliveryFailures();
  var counts = refreshTargetSendableCounts_();
  var mirrors = refreshTargetQueueTabs_();
  return {delivery: delivery, counts: counts, mirrors: mirrors};
}

/** Install the safe 15-minute delivery-failure scanner without enabling sends. */
function installTargetDeliveryFailureScanner() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'scanTargetDeliveryFailures') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger('scanTargetDeliveryFailures').timeBased().everyMinutes(15).create();
  return {installed: true, handler: 'scanTargetDeliveryFailures', everyMinutes: 15};
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

/**
 * Read-only daily accounting for the normal automatic Email, Referral and
 * follow-up planners. It simulates newly planned work against the live rows but
 * never writes a queue row, draft, or message.
 */
function diagnoseAutomaticOutreachForDay(dayIso) {
  var requestedDay = String(dayIso || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDay)) {
    throw new Error('Use a local date in YYYY-MM-DD format.');
  }
  var noon = new Date(requestedDay + 'T12:00:00-04:00');
  if (Utilities.formatDate(noon, 'America/New_York', 'yyyy-MM-dd') !== requestedDay) {
    throw new Error('The requested date is invalid.');
  }
  var isRequestedDay = function (value) {
    return !!value && Utilities.formatDate(
      value, 'America/New_York', 'yyyy-MM-dd') === requestedDay;
  };
  var now = new Date();
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
  var appSheet = tracker.getSheetByName(TAB_APP);
  var emailSheet = tracker.getSheetByName(TAB_QUEUE);
  var referralSheet = tracker.getSheetByName(TAB_REFERRAL);
  if (!appSheet || !emailSheet || !referralSheet) {
    throw new Error('App, Email and Referral tabs are all required for this preview.');
  }

  var appRows = appSheet.getLastRow() < 2 ? []
    : appSheet.getRange(2, 1, appSheet.getLastRow() - 1, APP_RECRUITERS)
      .getValues().map(outreachParseApp_);
  var emailLast = emailSheet.getLastRow();
  var emailRows = emailLast < 2 ? []
    : emailSheet.getRange(2, 1, emailLast - 1, Q_WIDTH).getValues()
      .map(function (row, index) { return outreachParseQueue_(row, index + 2); });
  var referralRows = outreachReadReferralRows_(referralSheet);
  var contacts = outreachReadContacts_(contactsBook);
  var salt = outreachProperty_(PROP_SALT, true);

  var coldPlan = outreachPlanEnqueue_(appRows, emailRows, contacts, now, salt,
                                       outreachColdTargetCompanies_(tracker));
  var hypotheticalEmailRows = coldPlan.planned.map(function (item, index) {
    return outreachParseQueue_(outreachQueueRowValues_(item), emailLast + index + 1);
  });
  var allEmailRows = emailRows.concat(hypotheticalEmailRows);
  var emailProjection = outreachProjectSchedule_(allEmailRows, now);
  var coldSent = emailRows.filter(function (row) {
    return (row.status === STATUS_SENT || row.status === STATUS_REPLIED
      || row.status === STATUS_BOUNCED) && isRequestedDay(row.sentAt);
  }).length;
  var coldDrafted = emailRows.filter(function (row) {
    return row.status === STATUS_DRAFTED && isRequestedDay(row.scheduled);
  }).length;
  var coldQueued = emailProjection.filter(function (row) {
    return row.rowNumber <= emailLast && isRequestedDay(row.sendAt);
  }).length;
  emailRows.forEach(function (row) {
    if (row.status === STATUS_QUEUED && outreachOffTargetEmailQueueRow_(row)
        && isRequestedDay(row.scheduled)) coldQueued++;
  });
  var coldNew = emailProjection.filter(function (row) {
    return row.rowNumber > emailLast && isRequestedDay(row.sendAt);
  }).length;

  var employees = outreachReadEmployees_(contactsBook);
  var domainFor = outreachReferralDomainFor_(employees);
  var referralApps = appSheet.getLastRow() < 2 ? []
    : appSheet.getRange(2, 1, appSheet.getLastRow() - 1, APP_READ_WIDTH)
      .getValues().map(function (row, index) {
        return outreachParseApplication_(row, index + 2, domainFor);
      });
  var referralPlan = outreachReferralPlan_(
    referralApps, referralRows, employees, now,
    outreachReferralRoomOn_(emailRows, referralRows),
    outreachReferralTargetCompanies_(tracker));
  var referralSent = referralRows.filter(function (row) {
    return (row.status === STATUS_SENT || row.status === STATUS_REPLIED
      || row.status === STATUS_BOUNCED) && isRequestedDay(row.sentAt);
  }).length;
  var referralDrafted = referralRows.filter(function (row) {
    return row.status === STATUS_DRAFTED && isRequestedDay(row.scheduled);
  }).length;
  var referralQueued = referralRows.filter(function (row) {
    return row.status === STATUS_QUEUED && !row.cancel && isRequestedDay(row.scheduled);
  }).length;
  var referralNew = referralPlan.booked.filter(function (row) {
    return isRequestedDay(row.scheduled);
  }).length;

  var followUpPlan = outreachPlanFollowUps_(emailRows, now);
  var stopped = {};
  followUpPlan.stopped.forEach(function (row) { stopped[row.rowNumber] = true; });
  var followUpSent = emailRows.filter(function (row) {
    return row.followUpStatus === FOLLOWUP_SENT && isRequestedDay(row.followUpAt);
  }).length;
  var followUpDrafted = emailRows.filter(function (row) {
    return row.followUpStatus === FOLLOWUP_DRAFTED && isRequestedDay(row.followUpAt);
  }).length;
  var followUpQueued = emailRows.filter(function (row) {
    return row.followUpStatus === FOLLOWUP_QUEUED && !stopped[row.rowNumber]
      && isRequestedDay(row.followUpAt);
  }).length;
  var followUpNew = followUpPlan.booked.filter(function (row) {
    return isRequestedDay(row.day);
  }).length;

  var alreadySent = coldSent + referralSent + followUpSent;
  var stillQueuedDrafted = coldQueued + coldDrafted + referralQueued + referralDrafted
    + followUpQueued + followUpDrafted;
  var hypothetical = coldNew + referralNew + followUpNew;
  return {
    planDate: requestedDay,
    asOf: now.toISOString(),
    cold: {sent: coldSent, queued: coldQueued, drafted: coldDrafted, newlyPlanned: coldNew},
    referral: {sent: referralSent, queued: referralQueued, drafted: referralDrafted,
               newlyPlanned: referralNew},
    followUp: {sent: followUpSent, queued: followUpQueued, drafted: followUpDrafted,
               newlyPlanned: followUpNew},
    automaticTotal: alreadySent + stillQueuedDrafted + hypothetical,
    alreadySent: alreadySent,
    stillQueuedDrafted: stillQueuedDrafted,
    hypotheticalNewWork: hypothetical,
    assumption: 'Current App, contact and queue snapshot; future applications and replies are not forecast.'
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

/** One-off schedule for the seven existing Microsoft recruiter drafts on 2026-09-09. */
function scheduleMicrosoftColdDrafts0909() {
  var propertyKey = 'MICROSOFT_COLD_DRAFT_SCHEDULE_20260909';
  var handlers = [
    'sendMicrosoftColdDraftSlot1_', 'sendMicrosoftColdDraftSlot2_',
    'sendMicrosoftColdDraftSlot3_', 'sendMicrosoftColdDraftSlot4_',
    'sendMicrosoftColdDraftSlot5_', 'sendMicrosoftColdDraftSlot6_',
    'sendMicrosoftColdDraftSlot7_'
  ];
  var slots = [
    {email: 'recowheatley@microsoft.com', subject: 'Student SWE working across AI tooling, cloud, and backend infrastructure', at: '2026-09-09T07:00:00-04:00'},
    {email: 'sharif@microsoft.com', subject: 'Student SWE who turned a 30-minute analyst workflow into 1 minute', at: '2026-09-09T07:10:00-04:00'},
    {email: 'tpulliam@microsoft.com', subject: 'Student SWE with hands-on MCP, AWS, and Kubernetes experience', at: '2026-09-09T07:20:00-04:00'},
    {email: 'jessicaa@microsoft.com', subject: 'Student SWE who handled 500 concurrent requests with no overbooking', at: '2026-09-09T07:30:00-04:00'},
    {email: 'charlest@microsoft.com', subject: 'Kenyon SWE student building across MCP, AWS, and Kubernetes', at: '2026-09-09T07:40:00-04:00'},
    {email: 'djamison@microsoft.com', subject: 'Math & CS student building production systems across AWS and Kubernetes', at: '2026-09-09T07:50:00-04:00'},
    {email: 'evalarson@microsoft.com', subject: 'Student engineer focused on backend reliability at scale', at: '2026-09-09T08:00:00-04:00'}
  ];
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var props = PropertiesService.getScriptProperties();
    var existingText = props.getProperty(propertyKey);
    if (existingText) {
      var existing = JSON.parse(existingText);
      if (existing.status === 'scheduled' || existing.status === 'complete') {
        return {alreadyStarted: true, state: existing};
      }
    }
    handlers.forEach(function (handler) {
      ScriptApp.getProjectTriggers().forEach(function (trigger) {
        if (trigger.getHandlerFunction() === handler) ScriptApp.deleteTrigger(trigger);
      });
    });

    var drafts = {};
    GmailApp.getDrafts().forEach(function (draft) {
      var message = draft.getMessage();
      var to = String(message.getTo() || '').toLowerCase();
      slots.forEach(function (slot) {
        if (to.indexOf(slot.email) >= 0 && message.getSubject() === slot.subject) {
          if (drafts[slot.email]) throw new Error('Duplicate matching draft for ' + slot.email);
          drafts[slot.email] = draft;
        }
      });
    });
    var missing = slots.filter(function (slot) { return !drafts[slot.email]; })
      .map(function (slot) { return slot.email; });
    if (missing.length) throw new Error('Missing Microsoft draft(s): ' + missing.join(', '));
    var alreadySent = slots.filter(function (slot) {
      return GmailApp.search('in:sent to:' + slot.email + ' subject:"' + slot.subject + '"', 0, 1).length > 0;
    }).map(function (slot) { return slot.email; });
    if (alreadySent.length) throw new Error('Already sent; refusing to schedule duplicate(s): ' + alreadySent.join(', '));

    var state = {
      status: 'scheduled',
      timezone: 'America/New_York',
      createdAt: new Date().toISOString(),
      entries: slots.map(function (slot) {
        return {email: slot.email, subject: slot.subject, at: slot.at,
                atMs: new Date(slot.at).getTime(), status: 'pending'};
      })
    };
    props.setProperty(propertyKey, JSON.stringify(state));
    var created = [];
    try {
      handlers.forEach(function (handler, index) {
        created.push(ScriptApp.newTrigger(handler).timeBased()
          .at(new Date(state.entries[index].atMs)).create());
      });
    } catch (error) {
      created.forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
      props.deleteProperty(propertyKey);
      throw error;
    }
    return {scheduled: state.entries.map(function (entry) {
      return {email: entry.email, at: Utilities.formatDate(new Date(entry.atMs), 'America/New_York', 'yyyy-MM-dd HH:mm z')};
    }), triggerCount: created.length};
  } finally {
    lock.releaseLock();
  }
}

/** Read-only status for the seven scheduled Microsoft recruiter drafts. */
function diagnoseMicrosoftColdDrafts0909() {
  var text = PropertiesService.getScriptProperties()
    .getProperty('MICROSOFT_COLD_DRAFT_SCHEDULE_20260909');
  if (!text) return {status: 'not-scheduled', entries: []};
  var state = JSON.parse(text);
  var counts = {pending: 0, sent: 0, bounced: 0, failed: 0, skipped: 0};
  var entries = (state.entries || []).map(function (entry) {
    if (entry.status === 'pending') counts.pending++;
    else if (entry.status === 'sent') counts.sent++;
    else if (entry.status === 'bounced') counts.bounced++;
    else if (entry.status === 'failed') counts.failed++;
    else counts.skipped++;
    return {
      email: entry.email,
      subject: entry.subject,
      at: entry.at,
      status: entry.status,
      completedAt: entry.completedAt || '',
      messageId: entry.messageId || '',
      error: entry.error || ''
    };
  });
  return {status: state.status, timezone: state.timezone || 'America/New_York',
          createdAt: state.createdAt || '', counts: counts, entries: entries};
}

function sendMicrosoftColdDraftSlot1_() { return sendMicrosoftColdDraftSlot_(0); }
function sendMicrosoftColdDraftSlot2_() { return sendMicrosoftColdDraftSlot_(1); }
function sendMicrosoftColdDraftSlot3_() { return sendMicrosoftColdDraftSlot_(2); }
function sendMicrosoftColdDraftSlot4_() { return sendMicrosoftColdDraftSlot_(3); }
function sendMicrosoftColdDraftSlot5_() { return sendMicrosoftColdDraftSlot_(4); }
function sendMicrosoftColdDraftSlot6_() { return sendMicrosoftColdDraftSlot_(5); }
function sendMicrosoftColdDraftSlot7_() { return sendMicrosoftColdDraftSlot_(6); }

/** Send one scheduled Microsoft draft and retire all seven one-shot triggers when done. */
function sendMicrosoftColdDraftSlot_(index) {
  var propertyKey = 'MICROSOFT_COLD_DRAFT_SCHEDULE_20260909';
  var handlers = {
    sendMicrosoftColdDraftSlot1_: true, sendMicrosoftColdDraftSlot2_: true,
    sendMicrosoftColdDraftSlot3_: true, sendMicrosoftColdDraftSlot4_: true,
    sendMicrosoftColdDraftSlot5_: true, sendMicrosoftColdDraftSlot6_: true,
    sendMicrosoftColdDraftSlot7_: true
  };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var props = PropertiesService.getScriptProperties();
    var stateText = props.getProperty(propertyKey);
    if (!stateText) return {skipped: true, reason: 'schedule state is absent'};
    var state = JSON.parse(stateText);
    if (state.status !== 'scheduled') return {skipped: true, status: state.status};
    var entry = state.entries[index];
    if (!entry || entry.status !== 'pending') return {skipped: true, reason: 'slot is not pending'};
    if (new Date().getTime() + 60000 < entry.atMs) {
      return {skipped: true, reason: 'trigger fired early', email: entry.email};
    }
    if (GmailApp.search('in:sent to:' + entry.email + ' subject:"' + entry.subject + '"', 0, 1).length) {
      entry.status = 'already-sent';
      entry.completedAt = new Date().toISOString();
      state.status = state.entries.every(function (item) { return item.status !== 'pending'; }) ? 'complete' : 'scheduled';
      props.setProperty(propertyKey, JSON.stringify(state));
      try { refreshTargetQueueTabs_(); }
      catch (mirrorError) { Logger.log('Target mirror refresh failed: ' + mirrorError); }
      return {skippedAlreadySent: true, email: entry.email};
    }
    var matching = GmailApp.getDrafts().filter(function (draft) {
      var message = draft.getMessage();
      return String(message.getTo() || '').toLowerCase().indexOf(entry.email) >= 0
        && message.getSubject() === entry.subject;
    });
    if (matching.length !== 1) {
      entry.status = 'failed';
      entry.error = 'Expected one matching draft, found ' + matching.length;
      props.setProperty(propertyKey, JSON.stringify(state));
      throw new Error(entry.error + ' for ' + entry.email);
    }
    var sent = matching[0].send();
    entry.status = 'sent';
    entry.completedAt = new Date().toISOString();
    entry.messageId = sent.getId();
    syncTargetAfterSend_('Microsoft', 'recruiter');
    state.status = state.entries.every(function (item) { return item.status !== 'pending'; }) ? 'complete' : 'scheduled';
    props.setProperty(propertyKey, JSON.stringify(state));
    try { refreshTargetQueueTabs_(); }
    catch (mirrorError) { Logger.log('Target mirror refresh failed: ' + mirrorError); }
    if (state.status === 'complete') {
      ScriptApp.getProjectTriggers().forEach(function (trigger) {
        if (handlers[trigger.getHandlerFunction()]) ScriptApp.deleteTrigger(trigger);
      });
    }
    return {sent: true, email: entry.email, subject: entry.subject};
  } finally {
    lock.releaseLock();
  }
}

/**
 * One-off Target referral campaign for the three companies that were urgent on
 * 2026-09-09. This intentionally sits outside the normal Referral planner:
 * Target companies are a deliberate exclusion from that automatic path, while
 * this campaign was explicitly requested by the owner of the mailbox.
 *
 * It schedules at most ten unsent Employees (seed) contacts per company, one
 * every nine minutes from 09:00 through 13:21 America/New_York. A single
 * every-minute trigger sends only the next due entry, with an eight-minute
 * minimum gap so a late trigger cannot burst the whole campaign. Each successful
 * send is recorded as Sent on Referral and ticks Employees (seed), allowing the
 * final seed-count refresh to flow into Target.
 */
function scheduleTargetReferralCampaign0909() {
  return scheduleTargetReferralCampaign_({
    propertyKey: 'TARGET_REFERRAL_CAMPAIGN_20260909_SIERRA_WAYMO_MASTERCARD',
    handler: 'runTargetReferralCampaignTick_',
    startIso: '2026-09-09T09:00:00-04:00',
    companies: [
      {
        company: 'Sierra',
        role: 'Intern, Agent Development (Summer 2027)',
        jobLink: 'https://jobs.ashbyhq.com/Sierra/34b31b67-268c-4270-b48f-72e59064c96e?embed=true&utm_source=Simplify&ref=Simplify'
      },
      {
        company: 'Waymo',
        role: '2027 Summer Intern, BS, SysEng Software Engineer',
        jobLink: 'https://careers.withwaymo.com/jobs?gh_jid=8174099'
      },
      {
        company: 'Mastercard',
        role: 'Software Engineer Intern, Summer 2027 – United States',
        jobLink: 'https://mastercard.wd1.myworkdayjobs.com/campusapplyonly/job/OFallon-Missouri/Software-Engineer-Intern--Summer-2027---United-States_R-287618?jr_id=6a889bbdd34f700f87fc97ff'
      }
    ]
  });
}

/** One-off Target referral campaign for the next requested companies. */
function scheduleTargetReferralCampaign0910() {
  return scheduleTargetReferralCampaign_({
    propertyKey: 'TARGET_REFERRAL_CAMPAIGN_20260910_PAYPAL_DROPBOX_SCALE_AI',
    handler: 'runTargetReferralCampaignTick0910_',
    startIso: '2026-09-10T09:00:00-04:00',
    companies: [
      {
        company: 'PayPal',
        role: 'Software Engineer Intern',
        jobLink: 'https://paypal.wd1.myworkdayjobs.com/en-US/jobs/job/Software-Engineer-Intern_R0137285'
      },
      {
        company: 'Dropbox',
        role: 'Software Engineering Intern (Summer 2027)',
        jobLink: 'https://www.dropbox.jobs/en/jobs/apply/?id=8106224'
      },
      {
        company: 'Scale AI',
        role: 'Software Engineering Intern (Summer 2027)',
        jobLink: 'https://job-boards.greenhouse.io/scaleai/jobs/4730845005/'
      }
    ]
  });
}

/** Explicit Target referral campaign for five Datadog contacts on 2026-09-10. */
function scheduleTargetReferralCampaign0910Datadog() {
  return scheduleTargetReferralCampaign_({
    propertyKey: 'TARGET_REFERRAL_CAMPAIGN_20260910_DATADOG',
    handler: 'runTargetReferralCampaignTick0910Datadog_',
    startIso: '2026-09-10T15:15:00-04:00',
    spacingMinutes: 9,
    minGapMinutes: 8,
    excludeEmails: targetReferralCampaignEmails_(
      'TARGET_REFERRAL_CAMPAIGN_20260911_DATADOG_VERCEL_COINBASE_RED_HAT', 'Datadog'),
    companies: [
      {
        company: 'Datadog',
        maxContacts: 5,
        role: 'Software Engineering Intern',
        jobLink: 'https://careers.datadoghq.com/detail/8052118/?gh_jid=8052118'
      }
    ]
  });
}

/** One-off Target referral campaign for the next requested companies. */
function scheduleTargetReferralCampaign0911() {
  return scheduleTargetReferralCampaign_({
    propertyKey: 'TARGET_REFERRAL_CAMPAIGN_20260911_DATADOG_VERCEL_COINBASE_RED_HAT',
    handler: 'runTargetReferralCampaignTick0911_',
    startIso: '2026-09-11T09:00:00-04:00',
    spacingMinutes: 6,
    minGapMinutes: 5,
    companies: [
      {
        company: 'Datadog',
        role: 'Software Engineering Intern',
        jobLink: 'https://careers.datadoghq.com/detail/8052118/?gh_jid=8052118'
      },
      {
        company: 'Vercel',
        role: 'Software Engineering Intern - Summer 27',
        jobLink: 'https://job-boards.greenhouse.io/vercel/jobs/6181759004?gh_src=Simplify'
      },
      {
        company: 'Coinbase',
        role: 'Software Engineer Intern',
        jobLink: 'https://job-boards.greenhouse.io/embed/job_app?token=8168315&for=coinbase&utm_source=Simplify&gh_src=Simplify'
      },
      {
        company: 'Red Hat',
        role: 'Software Engineer Intern',
        jobLink: 'https://jobright.ai/jobs/info/6aa053623b5aa83237b08639?utm_campaign=1079&utm_source=git'
      }
    ]
  });
}

/** One-off manual referral campaign for five Whatnot engineers on 2026-09-11. */
function scheduleTargetReferralCampaign0911Whatnot() {
  return scheduleTargetReferralCampaign_({
    propertyKey: 'TARGET_REFERRAL_CAMPAIGN_20260911_WHATNOT',
    handler: 'runTargetReferralCampaignTick0911Whatnot_',
    startIso: '2026-09-11T14:00:00-04:00',
    spacingMinutes: 6,
    minGapMinutes: 5,
    companies: [{
      company: 'Whatnot',
      maxContacts: 5,
      role: 'Software Engineer Intern (Summer 2027)',
      jobLink: 'https://jobs.ashbyhq.com/whatnot/928ffdca-b316-40ce-b82b-94b570919bcd/application?utm_source=Simplify'
    }]
  });
}

/** One-off Vietnamese referral request for the owner-approved Dell contact Hai La. */
function scheduleTargetReferralCampaign0911DellHai() {
  return scheduleTargetReferralCampaign_({
    propertyKey: 'TARGET_REFERRAL_CAMPAIGN_20260911_DELL_HAI_LA',
    handler: 'runTargetReferralCampaignTick0911DellHai_',
    startIso: '2026-09-11T14:35:00-04:00',
    spacingMinutes: 6,
    minGapMinutes: 5,
    includeEmails: ['hai.la@dell.com'],
    vietnameseOverrides: {
      'hai.la@dell.com': {
        name: 'Hai', title: 'anh', variant: 2
      }
    },
    companies: [{
      company: 'Dell Technologies',
      maxContacts: 1,
      role: 'Software Engineer Intern - Client Solutions Group Engineering',
      jobLink: 'https://iawmqy.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/careers/job/298217?utm_source=Simplify&ref=Simplify'
    }]
  });
}

/** Manual Target referral campaign for eight Cisco engineers on Monday 2026-09-14. */
function scheduleTargetReferralCampaign0914Cisco() {
  return scheduleTargetReferralCampaign_({
    propertyKey: 'TARGET_REFERRAL_CAMPAIGN_20260914_CISCO',
    handler: 'runTargetReferralCampaignTick0914Cisco_',
    startIso: '2026-09-14T11:00:00-04:00',
    spacingMinutes: 6,
    minGapMinutes: 5,
    // "Anh" can be a given name of any gender. Do not put this person into a
    // Vietnamese-copy campaign until the owner supplies anh or chị.
    excludeNames: ['Anh Huynh'],
    vietnameseOverridesByName: {
      'Danh Nguyen': {name: 'Danh', title: 'anh', variant: 1},
      'Hai Nguyen': {name: 'Hai', title: 'anh', variant: 2}
    },
    companies: [{
      company: 'Cisco',
      maxContacts: 8,
      role: 'Software Consulting Engineer I (Intern) United States',
      jobLink: 'https://cisco.wd5.myworkdayjobs.com/cisco_careers/job/USA-RESEARCH-TRIANGLE-PARK/Software-Consulting-Engineer-I--Intern--United-States_2025180'
    }]
  });
}

/** Manual Target referral campaign for Dell's recent SWE Intern application. */
function scheduleTargetReferralCampaign0914Dell() {
  return scheduleTargetReferralCampaign_({
    propertyKey: 'TARGET_REFERRAL_CAMPAIGN_20260914_DELL',
    handler: 'runTargetReferralCampaignTick0914Dell_',
    startIso: '2026-09-14T12:00:00-04:00',
    spacingMinutes: 6,
    minGapMinutes: 5,
    vietnameseOverridesByName: {
      // The owner approved this exact greeting in the cancelled 09/11 Dell ask.
      'Hai La': {name: 'Hai', title: 'anh', variant: 2}
    },
    companies: [{
      company: 'Dell Technologies',
      maxContacts: 10,
      role: 'Software Engineer Intern - Client Solutions Group Engineering',
      jobLink: 'https://iawmqy.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/careers/job/298217?utm_source=Simplify&ref=Simplify'
    }]
  });
}

/** Manual Target referral campaign for Plaid's recent SWE Intern application. */
function scheduleTargetReferralCampaign0914Plaid() {
  return scheduleTargetReferralCampaign_({
    propertyKey: 'TARGET_REFERRAL_CAMPAIGN_20260914_PLAID',
    handler: 'runTargetReferralCampaignTick0914Plaid_',
    startIso: '2026-09-14T13:00:00-04:00',
    spacingMinutes: 6,
    minGapMinutes: 5,
    vietnameseOverridesByName: {
      'Andy Nguyen': {name: 'Andy', title: 'anh', variant: 4}
    },
    companies: [{
      company: 'Plaid', maxContacts: 10,
      role: 'Software Engineering Intern, Summer 2027',
      jobLink: 'https://app.ripplematch.com/v2/public/job/02cb6f70?from=AllJobsPage'
    }]
  });
}

/**
 * Owner-approved Lyft referrals for 2026-09-11: two selected seed contacts and
 * one supplied external contact. The schedule starts five minutes after setup
 * and keeps ten-minute gaps, so all three leave within one hour.
 */
function scheduleTargetReferralCampaign0911Lyft() {
  var propertyKey = 'TARGET_REFERRAL_CAMPAIGN_20260911_LYFT';
  var handler = 'runTargetReferralCampaignTick0911Lyft_';
  var roleBackend = 'Software Engineer Intern, Backend (Summer 2027)';
  var roleFullstack = 'Software Engineer Intern, Fullstack (Summer 2027)';
  var jobBackend = 'https://app.careerpuck.com/job-board/lyft/job/8767726002?gh_jid=8767726002';
  var jobFullstack = 'https://app.careerpuck.com/job-board/lyft/job/8797837002?gh_jid=8797837002';
  var specs = [
    {name: 'Abhinav Solan', role: roleBackend, jobLink: jobBackend, subjectRole: 'Backend',
     profile: 'My work has mainly focused on backend systems and data products, and this role feels closely aligned with the kind of engineering work I’m hoping to grow in.',
     resume: 'I’ve attached my resume in case it is helpful. I completely understand if it is not something you are able to support.',
     thanks: 'Thank you very much for taking the time to read this.'},
    {name: 'Degao Chen', role: roleFullstack, jobLink: jobFullstack, subjectRole: 'Fullstack',
     profile: 'My background is centered on building reliable backend systems and data products, and I was drawn to the opportunity to learn from the kind of product engineering Lyft does at scale.',
     resume: 'I’ve attached my resume for context. No pressure at all if you are not in a position to help.',
     thanks: 'Thank you very much for your time.'},
    {name: 'Tammy', email: 'tammylee@lyft.com', role: roleBackend, jobLink: jobBackend, subjectRole: 'Backend',
     profile: 'I’ve been focusing on backend systems and data products, and Lyft feels like a place where I could learn a great deal while contributing thoughtfully as an intern.',
     resume: 'I’ve attached my resume for your reference. I understand completely if you are unable to help, and I appreciate you taking a moment to consider it.',
     thanks: 'Thank you very much.'}
  ];
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var props = PropertiesService.getScriptProperties();
    var existingText = props.getProperty(propertyKey);
    if (existingText) {
      var existing = JSON.parse(existingText);
      if (existing.status === 'scheduled' || existing.status === 'complete') {
        return {alreadyStarted: true, state: existing};
      }
    }
    var rejections = {};
    specs.forEach(function (spec) {
      var key = outreachNameKey_(spec.role);
      if (rejections[key]) return;
      var result = outreachGmailApiRejectedTarget_({company: 'Lyft', role: spec.role, jobLink: spec.jobLink});
      if (result.rejected) throw new Error('Lyft ' + spec.role + ' was rejected: ' + result.why);
      rejections[key] = true;
    });
    var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
    var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
    var referral = tracker.getSheetByName(TAB_REFERRAL);
    if (!referral) throw new Error('Referral tab is missing.');
    var used = {};
    outreachReadReferralRows_(referral).forEach(function (row) {
      if (row.email) used[String(row.email).toLowerCase()] = true;
    });
    var employees = outreachEmployeesFor_(outreachReadEmployees_(contactsBook), 'Lyft');
    var startMs = new Date().getTime() + 5 * 60000;
    var entries = specs.map(function (spec, index) {
      var source = null;
      var email = String(spec.email || '').trim().toLowerCase();
      if (!email) {
        var matches = employees.filter(function (person) {
          return outreachNameKey_(person.name) === outreachNameKey_(spec.name);
        });
        if (matches.length !== 1) throw new Error('Expected exactly one current Lyft seed contact for ' + spec.name + '.');
        source = matches[0];
        email = String(source.email || '').trim().toLowerCase();
      }
      if (!email) throw new Error('Lyft referral recipient is missing an email address.');
      if (used[email] || GmailApp.search('from:me to:' + email, 0, 1).length) {
        throw new Error('Lyft referral recipient was already contacted: ' + spec.name + '.');
      }
      used[email] = true;
      return {
        company: 'Lyft', role: spec.role, jobLink: spec.jobLink,
        name: spec.name, email: email,
        title: source ? source.title : '', seniority: source ? (source.seniority || '') : '',
        template: 'lyft-approved-' + String(index + 1),
        customCopy: 'lyft-referral-0911', subjectRole: spec.subjectRole,
        profile: spec.profile, resume: spec.resume, thanks: spec.thanks,
        atMs: startMs + index * 10 * 60000, status: 'pending'
      };
    });
    if (!config.reuseExistingTrigger) {
      ScriptApp.getProjectTriggers().forEach(function (trigger) {
        if (trigger.getHandlerFunction() === handler) ScriptApp.deleteTrigger(trigger);
      });
    } else if (!ScriptApp.getProjectTriggers().some(function (trigger) {
      return trigger.getHandlerFunction() === handler;
    })) {
      throw new Error('The shared Target recruiter trigger is not installed.');
    }
    var state = {
      status: 'scheduled', timezone: 'America/New_York', createdAt: new Date().toISOString(),
      lastSentAtMs: 0, spacingMinutes: 10, minGapMinutes: 9, entries: entries, skipped: []
    };
    props.setProperty(propertyKey, JSON.stringify(state));
    try { ScriptApp.newTrigger(handler).timeBased().everyMinutes(1).create(); }
    catch (error) { props.deleteProperty(propertyKey); throw error; }
    try { refreshTargetQueueTabs_(); }
    catch (mirrorError) { Logger.log('Target mirror refresh failed: ' + mirrorError); }
    return {
      scheduled: entries.map(function (entry) {
        return {name: entry.name, at: Utilities.formatDate(new Date(entry.atMs), 'America/New_York', 'yyyy-MM-dd HH:mm z')};
      }), trigger: handler
    };
  } finally {
    lock.releaseLock();
  }
}

/** Cancel the Dell Hai La referral before it can reach Gmail after a rejection block. */
function cancelTargetReferralCampaign0911DellHai() {
  var propertyKey = 'TARGET_REFERRAL_CAMPAIGN_20260911_DELL_HAI_LA';
  var handler = 'runTargetReferralCampaignTick0911DellHai_';
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var props = PropertiesService.getScriptProperties();
    var stateText = props.getProperty(propertyKey);
    if (!stateText) return {status: 'not-scheduled', cancelledPending: 0, deletedTriggers: 0};
    var state = JSON.parse(stateText);
    var cancelled = 0;
    (state.entries || []).forEach(function (entry) {
      if (entry.status !== 'pending') return;
      entry.status = 'cancelled';
      entry.cancelledAt = new Date().toISOString();
      entry.error = 'Cancelled before sending: Gmail API preflight found a matching rejection.';
      cancelled++;
    });
    if (cancelled) {
      state.status = 'cancelled';
      state.cancelledAt = new Date().toISOString();
      props.setProperty(propertyKey, JSON.stringify(state));
    }
    var deleted = 0;
    ScriptApp.getProjectTriggers().forEach(function (trigger) {
      if (trigger.getHandlerFunction() !== handler) return;
      ScriptApp.deleteTrigger(trigger);
      deleted++;
    });
    try { refreshTargetQueueTabs_(); }
    catch (mirrorError) { Logger.log('Target mirror refresh failed: ' + mirrorError); }
    return {status: state.status, cancelledPending: cancelled, deletedTriggers: deleted};
  } finally {
    lock.releaseLock();
  }
}

/** Schedule one Target campaign with ten templates and one-minute polling. */
function scheduleTargetReferralCampaign_(config) {
  var propertyKey = config.propertyKey;
  var handler = config.handler;
  var startMs = new Date(config.startIso).getTime();
  var spacingMinutes = Number(config.spacingMinutes || 9);
  var minGapMinutes = Number(config.minGapMinutes || Math.max(1, spacingMinutes - 1));
  var now = new Date().getTime();
  if (now >= startMs) throw new Error('The 09:00 campaign start time has passed.');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var props = PropertiesService.getScriptProperties();
    var existingText = props.getProperty(propertyKey);
    if (existingText) {
      var existing = JSON.parse(existingText);
      if (existing.status === 'scheduled' || existing.status === 'complete') {
        return {alreadyStarted: true, state: existing};
      }
    }
    ScriptApp.getProjectTriggers().forEach(function (trigger) {
      if (trigger.getHandlerFunction() === handler) ScriptApp.deleteTrigger(trigger);
    });

    var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
    var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
    var employees = outreachReadEmployees_(contactsBook);
    if (!employees.length) throw new Error('Employees (seed) is empty.');
    var referral = tracker.getSheetByName(TAB_REFERRAL);
    if (!referral) throw new Error('Referral tab is missing.');
    var existingRows = outreachReadReferralRows_(referral);
    var used = {};
    var excluded = {};
    var included = {};
    var excludedNames = {};
    var vietnameseOverrides = config.vietnameseOverrides || {};
    var vietnameseOverridesByName = {};
    existingRows.forEach(function (row) {
      if (row.email) used[row.email.toLowerCase()] = true;
    });
    (config.excludeEmails || []).forEach(function (email) {
      if (email) excluded[String(email).toLowerCase()] = true;
    });
    (config.includeEmails || []).forEach(function (email) {
      if (email) included[String(email).toLowerCase()] = true;
    });
    (config.excludeNames || []).forEach(function (name) {
      if (name) excludedNames[outreachNameKey_(name)] = true;
    });
    Object.keys(config.vietnameseOverridesByName || {}).forEach(function (name) {
      vietnameseOverridesByName[outreachNameKey_(name)] = config.vietnameseOverridesByName[name];
    });

    var entries = [], skipped = [];
    config.companies.forEach(function (spec) {
      var people = outreachEmployeesFor_(employees, spec.company)
        .filter(function (person) {
          var email = person.email.toLowerCase();
          if (used[email]) return false;
          if (Object.keys(included).length && !included[email]) return false;
          if (excluded[email]) {
            skipped.push({company: spec.company, email: email, reason: 'reserved-by-campaign'});
            return false;
          }
          if (excludedNames[outreachNameKey_(person.name)]) {
            skipped.push({company: spec.company, email: email, reason: 'requires-title-review'});
            return false;
          }
          // This is intentionally broad: a person written to by any earlier
          // campaign must not receive a second unsolicited message.
          if (GmailApp.search('from:me to:' + email, 0, 1).length) {
            skipped.push({company: spec.company, email: email, reason: 'already-sent'});
            return false;
          }
          used[email] = true;
          return true;
        })
        .sort(function (left, right) {
          return (left.name || left.email).localeCompare(right.name || right.email);
        })
        .slice(0, Number(spec.maxContacts || 10));

      people.forEach(function (person, index) {
        var entry = {
          company: spec.company,
          role: spec.role,
          jobLink: spec.jobLink,
          name: person.name,
          email: person.email,
          title: person.title,
          seniority: person.seniority || '',
          angle: person.angle || '',
          bucket: person.bucket || '',
          template: index + 1,
          atMs: startMs + entries.length * spacingMinutes * 60000,
          status: 'pending'
        };
        var vietnamese = vietnameseOverrides[person.email.toLowerCase()]
          || vietnameseOverridesByName[outreachNameKey_(person.name)];
        if (vietnamese) {
          if (!vietnamese.name || (vietnamese.title !== 'anh' && vietnamese.title !== 'chị')) {
            throw new Error('Vietnamese referral copy requires an approved given name and anh or chị title.');
          }
          entry.copy = 'henry_vietnamese';
          entry.vietnameseName = vietnamese.name;
          entry.vietnameseTitle = vietnamese.title;
          entry.vietnameseVariant = Number(vietnamese.variant || 1);
        }
        entries.push(entry);
      });
    });
    if (!entries.length) {
      var emptyState = {status: 'complete', timezone: 'America/New_York',
                        createdAt: new Date().toISOString(), entries: [], skipped: skipped};
      props.setProperty(propertyKey, JSON.stringify(emptyState));
      return {scheduled: [], skipped: skipped, state: emptyState};
    }

    var state = {
      status: 'scheduled', timezone: 'America/New_York',
      createdAt: new Date().toISOString(), lastSentAtMs: 0,
      spacingMinutes: spacingMinutes, minGapMinutes: minGapMinutes,
      entries: entries, skipped: skipped
    };
    props.setProperty(propertyKey, JSON.stringify(state));
    if (!config.reuseExistingTrigger) {
      try {
        ScriptApp.newTrigger(handler).timeBased().everyMinutes(1).create();
      } catch (error) {
        props.deleteProperty(propertyKey);
        throw error;
      }
    }
    try { refreshTargetQueueTabs_(); }
    catch (mirrorError) { Logger.log('Target mirror refresh failed: ' + mirrorError); }
    return {
      scheduled: entries.map(function (entry) {
        return {company: entry.company, name: entry.name, email: entry.email,
                template: entry.template,
                at: Utilities.formatDate(new Date(entry.atMs), 'America/New_York', 'yyyy-MM-dd HH:mm z')};
      }),
      skipped: skipped, trigger: handler
    };
  } finally {
    lock.releaseLock();
  }
}

/** Send one due 09/09 Target referral entry and finalize its seed snapshot. */
function runTargetReferralCampaignTick_() {
  return runTargetReferralCampaignTickFor_({
    propertyKey: 'TARGET_REFERRAL_CAMPAIGN_20260909_SIERRA_WAYMO_MASTERCARD',
    handler: 'runTargetReferralCampaignTick_'
  });
}

/** Send one due 09/10 Target referral entry and finalize its seed snapshot. */
function runTargetReferralCampaignTick0910_() {
  return runTargetReferralCampaignTickFor_({
    propertyKey: 'TARGET_REFERRAL_CAMPAIGN_20260910_PAYPAL_DROPBOX_SCALE_AI',
    handler: 'runTargetReferralCampaignTick0910_'
  });
}

/** Send one due 09/10 Datadog Target referral entry and finalize its seed snapshot. */
function runTargetReferralCampaignTick0910Datadog_() {
  return runTargetReferralCampaignTickFor_({
    propertyKey: 'TARGET_REFERRAL_CAMPAIGN_20260910_DATADOG',
    handler: 'runTargetReferralCampaignTick0910Datadog_'
  });
}

/** Send one due 09/11 Target referral entry and finalize its seed snapshot. */
function runTargetReferralCampaignTick0911_() {
  return runTargetReferralCampaignTickFor_({
    propertyKey: 'TARGET_REFERRAL_CAMPAIGN_20260911_DATADOG_VERCEL_COINBASE_RED_HAT',
    handler: 'runTargetReferralCampaignTick0911_'
  });
}

/** Send one due 09/11 Whatnot Target referral entry. */
function runTargetReferralCampaignTick0911Whatnot_() {
  return runTargetReferralCampaignTickFor_({
    propertyKey: 'TARGET_REFERRAL_CAMPAIGN_20260911_WHATNOT',
    handler: 'runTargetReferralCampaignTick0911Whatnot_'
  });
}

/** Send the owner-approved Vietnamese referral entry for Hai La at Dell. */
function runTargetReferralCampaignTick0911DellHai_() {
  return runTargetReferralCampaignTickFor_({
    propertyKey: 'TARGET_REFERRAL_CAMPAIGN_20260911_DELL_HAI_LA',
    handler: 'runTargetReferralCampaignTick0911DellHai_'
  });
}

/** Send one due Cisco Target referral entry on 2026-09-14. */
function runTargetReferralCampaignTick0914Cisco_() {
  return runTargetReferralCampaignTickFor_({
    propertyKey: 'TARGET_REFERRAL_CAMPAIGN_20260914_CISCO',
    handler: 'runTargetReferralCampaignTick0914Cisco_'
  });
}

/** Send one due Dell Target referral entry on 2026-09-14. */
function runTargetReferralCampaignTick0914Dell_() {
  return runTargetReferralCampaignTickFor_({
    propertyKey: 'TARGET_REFERRAL_CAMPAIGN_20260914_DELL',
    handler: 'runTargetReferralCampaignTick0914Dell_'
  });
}

/** Send one due Plaid Target referral entry on 2026-09-14. */
function runTargetReferralCampaignTick0914Plaid_() {
  return runTargetReferralCampaignTickFor_({
    propertyKey: 'TARGET_REFERRAL_CAMPAIGN_20260914_PLAID',
    handler: 'runTargetReferralCampaignTick0914Plaid_'
  });
}

/** Send one due owner-approved Lyft referral entry. */
function runTargetReferralCampaignTick0911Lyft_() {
  return runTargetReferralCampaignTickFor_({
    propertyKey: 'TARGET_REFERRAL_CAMPAIGN_20260911_LYFT',
    handler: 'runTargetReferralCampaignTick0911Lyft_'
  });
}

/** Manually run the due Lyft slot when an owner asks for immediate delivery. */
function sendDueTargetReferralCampaign0911Lyft() {
  return runTargetReferralCampaignTick0911Lyft_();
}

var TARGET_REFERRAL_0911_VIETNAMESE_OVERRIDES_ = {
  'anh pham': { name: 'Anh', title: 'anh' },
  'chau nguyen': { name: 'Chau', title: 'chị' },
  'dang nguyen': { name: 'Dang', title: 'anh' },
  'truc duong': { name: 'Truc', title: 'chị' }
};

/**
 * Apply the owner's four confirmed Vietnamese-title decisions to the pending
 * 09/11 Target referral entries. This changes only their copy metadata; it
 * neither drafts nor sends email. Re-running after a successful application is
 * idempotent, while a conflicting or already-sent entry stops the operation.
 */
function applyVietnameseReferralOverrides0911() {
  var propertyKey = 'TARGET_REFERRAL_CAMPAIGN_20260911_DATADOG_VERCEL_COINBASE_RED_HAT';
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var props = PropertiesService.getScriptProperties();
    var text = props.getProperty(propertyKey);
    if (!text) throw new Error('The 09/11 Target referral campaign is absent.');
    var state = JSON.parse(text);
    if (state.status !== 'scheduled') throw new Error('The 09/11 Target referral campaign is not scheduled.');
    var entriesByName = {};
    (state.entries || []).forEach(function (entry) {
      var key = outreachNameKey_(entry.name || '');
      if (!entriesByName[key]) entriesByName[key] = [];
      entriesByName[key].push(entry);
    });
    var changes = [];
    Object.keys(TARGET_REFERRAL_0911_VIETNAMESE_OVERRIDES_).forEach(function (key) {
      var matches = entriesByName[outreachNameKey_(key)] || [];
      if (matches.length !== 1) throw new Error('Expected exactly one 09/11 entry for ' + key + '.');
      var entry = matches[0];
      var override = TARGET_REFERRAL_0911_VIETNAMESE_OVERRIDES_[key];
      var variant = ((Number(entry.template) || 1) - 1) % HENRY_VIETNAMESE_REFERRAL_VARIANTS_.length + 1;
      var alreadyApplied = entry.copy === 'henry_vietnamese'
        && entry.vietnameseName === override.name
        && entry.vietnameseTitle === override.title
        && Number(entry.vietnameseVariant) === variant;
      if (entry.status !== 'pending' && !alreadyApplied) {
        throw new Error('The 09/11 entry for ' + entry.name + ' is no longer pending.');
      }
      if (!alreadyApplied) {
        entry.copy = 'henry_vietnamese';
        entry.vietnameseName = override.name;
        entry.vietnameseTitle = override.title;
        entry.vietnameseVariant = variant;
      }
      changes.push({company: entry.company, name: entry.name, title: override.title,
                    variant: variant, status: alreadyApplied ? 'already-applied' : 'applied'});
    });
    props.setProperty(propertyKey, JSON.stringify(state));
    try { refreshTargetQueueTabs_(); }
    catch (mirrorError) { Logger.log('Target mirror refresh failed: ' + mirrorError); }
    return changes;
  } finally {
    lock.releaseLock();
  }
}

/** Read-only confirmation of the approved Vietnamese-copy entries in the 09/11 campaign. */
function diagnoseVietnameseReferralOverrides0911() {
  var text = PropertiesService.getScriptProperties().getProperty(
    'TARGET_REFERRAL_CAMPAIGN_20260911_DATADOG_VERCEL_COINBASE_RED_HAT');
  if (!text) return [];
  return (JSON.parse(text).entries || []).filter(function (entry) {
    return entry.copy === 'henry_vietnamese';
  }).map(function (entry) {
    return {company: entry.company, name: entry.name, greeting: entry.vietnameseTitle + ' ' + entry.vietnameseName,
            variant: entry.vietnameseVariant, status: entry.status,
            at: Utilities.formatDate(new Date(entry.atMs), 'America/New_York', 'yyyy-MM-dd HH:mm')};
  });
}

/** Read every active Target employer once through Gmail API and report rejection blocks. */
function diagnoseTargetRejectionPreflight() {
  var propertyKeys = [
    'TARGET_REFERRAL_CAMPAIGN_20260911_DATADOG_VERCEL_COINBASE_RED_HAT',
    'TARGET_REFERRAL_CAMPAIGN_20260911_WHATNOT',
    'TARGET_REFERRAL_CAMPAIGN_20260911_DELL_HAI_LA',
    'TARGET_RECRUITER_CAMPAIGN_20260911_NETAPP',
    'TARGET_RECRUITER_CAMPAIGN_20260914_STRIPE',
    'TARGET_RECRUITER_CAMPAIGN_20260914_WHATNOT',
    'TARGET_RECRUITER_CAMPAIGN_20260914_MOTOROLA_SOLUTIONS',
    'TARGET_REFERRAL_CAMPAIGN_20260914_CISCO',
    'TARGET_REFERRAL_CAMPAIGN_20260915_LYFT',
    'TARGET_RECRUITER_CAMPAIGN_20260915_CISCO',
    'TARGET_RECRUITER_CAMPAIGN_20260915_HP_INTUIT_ORACLE',
    'TARGET_RECRUITER_CAMPAIGN_20260915_ANDURIL',
    'TARGET_REFERRAL_CAMPAIGN_20260914_DELL',
    'TARGET_REFERRAL_CAMPAIGN_20260914_PLAID',
    'TARGET_REFERRAL_CAMPAIGN_20260918_FIGMA',
    'TARGET_REFERRAL_CAMPAIGN_20260916_DOORDASH',
    'TARGET_RECRUITER_CAMPAIGN_20260916_INTEL_ATLASSIAN',
    'TARGET_RECRUITER_CAMPAIGN_20260916_ATLASSIAN_HUNTER4',
    'TARGET_RECRUITER_CAMPAIGN_20260916_NOTION',
    'TARGET_RECRUITER_CAMPAIGN_20260917_DELL',
    'TARGET_REFERRAL_CAMPAIGN_20260911_LYFT',
    'TARGET_RECRUITER_CAMPAIGN_20260917_PALANTIR',
    'TARGET_REFERRAL_CAMPAIGN_20260915_LOCKHEED_MARTIN',
    'TARGET_RECRUITER_CAMPAIGN_20260922_LOCKHEED_MARTIN',
    'TARGET_RECRUITER_CAMPAIGN_20260916_DATADOG',
    'TARGET_RECRUITER_CAMPAIGN_20260917_SCALE_AI',
    'TARGET_RECRUITER_CAMPAIGN_20260918_VERCEL',
    'TARGET_RECRUITER_CAMPAIGN_20260918_VERCEL_SUPPLEMENT',
    'TARGET_RECRUITER_CAMPAIGN_20260918_PAYPAL',
    'TARGET_RECRUITER_CAMPAIGN_20260918_PAYPAL_SUPPLEMENT',
    'TARGET_RECRUITER_CAMPAIGN_20260922_INTUIT',
    'TARGET_RECRUITER_CAMPAIGN_20260922_INTUIT_HUNTER_SUPPLEMENT',
    'TARGET_RECRUITER_CAMPAIGN_20260922_INTUIT_QUEUED_REMAINDER',
    'TARGET_RECRUITER_CAMPAIGN_20260924_ROBINHOOD',
    'TARGET_RECRUITER_CAMPAIGN_20260922_COINBASE',
    'TARGET_RECRUITER_CAMPAIGN_20260925_FIGMA',
    'TARGET_RECRUITER_CAMPAIGN_20260925_FIGMA_SUPPLEMENT',
    'TARGET_RECRUITER_CAMPAIGN_20260925_FIGMA_SUPPLEMENT2',
    'TARGET_RECRUITER_CAMPAIGN_20260921_DROPBOX',
    'TARGET_RECRUITER_CAMPAIGN_20260922_LYFT',
    'TARGET_RECRUITER_CAMPAIGN_20260923_MASTERCARD',
    'TARGET_REFERRAL_CAMPAIGN_20260915_WALMART',
    'TARGET_REFERRAL_CAMPAIGN_20260916_DOORDASH',
    'TARGET_RECRUITER_CAMPAIGN_20260922_WALMART',
    'TARGET_RECRUITER_CAMPAIGN_20260923_RED_HAT',
    'TARGET_RECRUITER_CAMPAIGN_20260923_DOORDASH',
    'TARGET_RECRUITER_CAMPAIGN_20260918_SHIELD_AI'
  ];
  var entries = targetMirrorCampaignEntries_(propertyKeys).filter(function (entry) {
    return entry.status === 'pending';
  });
  var candidates = outreachGmailApiRejectionCandidates_();
  var seen = {};
  return entries.filter(function (entry) {
    var key = outreachNameKey_(entry.company) + '|' + outreachNameKey_(entry.role);
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  }).map(function (entry) {
    var result = outreachGmailApiRejectedTarget_(entry, candidates);
    return {
      company: entry.company,
      role: entry.role,
      blocked: result.rejected,
      reason: result.rejected ? 'Gmail API found a matching rejection: ' + result.why : 'clear'
    };
  });
}

/** Read-only Gmail API rejection check for one proposed Target campaign. */
function diagnoseTargetCompanyRejectionPreflight(company, role, jobLink) {
  var entry = {
    company: String(company || '').trim(),
    role: String(role || '').trim(),
    jobLink: String(jobLink || '').trim()
  };
  if (!entry.company || !entry.role) {
    throw new Error('A company and role are required for Target rejection preflight.');
  }
  var result = outreachGmailApiRejectedTarget_(entry);
  return {
    company: entry.company,
    role: entry.role,
    blocked: result.rejected,
    reason: result.rejected
      ? 'Gmail API found a matching rejection: ' + result.why
      : 'clear'
  };
}

/** Read-only evidence for a single company/role Gmail rejection preflight decision. */
function diagnoseTargetCompanyRejectionEvidence(company, role, jobLink) {
  var entry = {
    company: String(company || '').trim(),
    role: String(role || '').trim(),
    jobLink: String(jobLink || '').trim()
  };
  if (!entry.company || !entry.role) {
    throw new Error('A company and role are required for rejection evidence.');
  }
  var app = {company: entry.company, role: entry.role, link: entry.jobLink,
             official: entry.jobLink, process: 'Applied'};
  return outreachGmailApiRejectionCandidates_().map(function (message) {
    return {message: message, target: outreachRejectionTarget_(message, [app])};
  }).filter(function (result) {
    return !!result.target.app && (result.message.decodeError
      || outreachIsRejection_(result.message.subject, result.message.body));
  }).map(function (result) {
    return {
      from: result.message.from,
      subject: result.message.subject,
      match: result.target.why,
      decodeError: result.message.decodeError || '',
      bodyPreview: String(result.message.body || '').replace(/\s+/g, ' ').slice(0, 600)
    };
  });
}

/**
 * Whether an App role belongs to the requested Summer 2027 review.
 *
 * A missing season/year is intentionally treated as Summer 2027: App records
 * an application, and the owner requested that unstated intake metadata not
 * hide an otherwise current application.  Explicitly named non-Summer intakes
 * and an explicit year other than 2027 remain out of scope.
 */
function outreachRecentSummer2027Role_(role) {
  var text = String(role || '').toLowerCase();
  if (!text.trim()) return true;
  if (/\b(?:winter|spring|fall)\b/.test(text) && !/\bsummer\b/.test(text)) return false;
  var years = text.match(/\b20\d{2}\b/g) || [];
  return !years.some(function (year) { return year !== '2027'; });
}

/**
 * Read-only review of recent, non-Target Summer-2027 applications that have
 * current recruiter data.  It deliberately makes no outreach decision: the
 * result distinguishes companies with no accepted cold email but a pending
 * queue from companies that are still fully uncontacted.
 */
function auditRecentOffTargetSummer2027RecruiterGaps() {
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
  var targetCompanies = outreachReferralTargetCompanies_(tracker);
  if (targetCompanies === null) throw new Error('Target tab is unavailable.');
  var appSheet = tracker.getSheetByName(TAB_APP);
  var queueSheet = tracker.getSheetByName(TAB_QUEUE);
  if (!appSheet) throw new Error('App tab is unavailable.');
  var today = outreachMidnight_(new Date());
  var cutoff = new Date(today.getTime());
  cutoff.setDate(cutoff.getDate() - 21);
  var tomorrow = new Date(today.getTime());
  tomorrow.setDate(tomorrow.getDate() + 1);
  var applications = appSheet.getLastRow() < 2 ? []
    : appSheet.getRange(2, 1, appSheet.getLastRow() - 1, APP_READ_WIDTH).getValues()
      .map(function (row, index) { return outreachParseApp_(row, index); })
      .filter(function (app) {
        return app.company && app.process !== STAGE_REJECTED && app.dateApplied
          && app.dateApplied >= cutoff && app.dateApplied < tomorrow
          && outreachRecentSummer2027Role_(app.role)
          && !outreachReferralCompanyIsTarget_(app.company, targetCompanies)
          && !outreachReferralIsQuantFirm_(app.company);
      });
  var groups = [];
  applications.forEach(function (app) {
    var tokens = outreachCompanyTokens_(app.company);
    var group = groups.filter(function (candidate) {
      return outreachSameEmployer_(tokens, candidate.tokens);
    })[0];
    if (!group) {
      group = {company: app.company, tokens: tokens, applications: []};
      groups.push(group);
    }
    group.applications.push(app);
  });
  var contacts = outreachReadContacts_(contactsBook);
  var queueEntries = queueSheet && queueSheet.getLastRow() >= 2
    ? queueSheet.getRange(2, 1, queueSheet.getLastRow() - 1, Q_WIDTH).getValues()
      .map(function (row, index) { return outreachParseQueue_(row, index + 2); }) : [];
  var campaignEntries = [];
  Object.keys(PropertiesService.getScriptProperties().getProperties()).forEach(function (key) {
    if (key.indexOf('TARGET_RECRUITER_CAMPAIGN_') !== 0
        && key.indexOf('OFFTARGET_RECRUITER_CAMPAIGN_') !== 0) return;
    try { campaignEntries = campaignEntries.concat(
      (JSON.parse(PropertiesService.getScriptProperties().getProperty(key)).entries || []));
    } catch (ignored) {}
  });
  var subjects = {};
  COLD_TEMPLATES.forEach(function (template) { subjects[template.subject] = true; });
  var stateCounts = function (entries, company) {
    var sent = 0, queued = 0;
    entries.forEach(function (entry) {
      if (!outreachSameEmployer_(outreachCompanyTokens_(company),
          outreachCompanyTokens_(entry.company))) return;
      var status = String(entry.status || '').toLowerCase();
      if (status === 'sent' || status === 'already-sent' || status === 'replied'
          || status === 'bounced') sent++;
      else if (status === 'pending' || status === 'queued' || status === 'drafted') queued++;
    });
    return {sent: sent, queued: queued};
  };
  var candidates = groups.map(function (group) {
    var people = outreachContactsFor_(contacts, group.company);
    if (!people.length) return null;
    var emails = people.map(function (person) { return person.email; });
    var query = 'from:me (' + emails.map(function (email) { return 'to:' + email; }).join(' OR ') + ')';
    var templateSent = 0;
    GmailApp.search(query, 0, 500).forEach(function (thread) {
      thread.getMessages().forEach(function (message) {
        if (subjects[message.getSubject()]) templateSent++;
      });
    });
    var direct = stateCounts(campaignEntries, group.company);
    var normal = stateCounts(queueEntries, group.company);
    var contactsMarkedSent = people.filter(function (person) { return person.sent; }).length;
    var hasColdEmailSent = templateSent > 0 || direct.sent > 0 || normal.sent > 0
      || contactsMarkedSent > 0;
    var queued = direct.queued + normal.queued;
    return {
      company: group.company,
      recruiterContacts: people.length,
      recruiterContactsUnsent: people.filter(function (person) { return !person.sent; }).length,
      applications: group.applications.map(function (app) {
        return {
          role: app.role || '(role missing; assumed Summer 2027)',
          dateApplied: Utilities.formatDate(app.dateApplied, 'America/New_York', 'yyyy-MM-dd'),
          process: app.process || '',
          jobLink: app.official || app.link || ''
        };
      }),
      coldEmail: {
        sent: hasColdEmailSent ? 1 : 0,
        queued: queued,
        templateMessages: templateSent,
        directCampaignSent: direct.sent,
        normalQueueSent: normal.sent,
        contactsMarkedSent: contactsMarkedSent
      },
      needsNewColdEmail: !hasColdEmailSent && queued === 0
    };
  }).filter(function (candidate) { return candidate && candidate.coldEmail.sent === 0; });
  candidates.sort(function (left, right) {
    return left.company.localeCompare(right.company);
  });
  return {
    asOf: Utilities.formatDate(new Date(), 'America/New_York', "yyyy-MM-dd'T'HH:mm:ssXXX"),
    windowStart: Utilities.formatDate(cutoff, 'America/New_York', 'yyyy-MM-dd'),
    windowEnd: Utilities.formatDate(today, 'America/New_York', 'yyyy-MM-dd'),
    rule: 'Active App within 21 days; explicit non-Summer intake or non-2027 year excluded; blank season/year assumed Summer 2027; Target and quant excluded.',
    counts: {
      recentOffTargetSummer2027Applications: applications.length,
      companiesWithRecruiterDataAndNoColdEmailSent: candidates.length,
      currentRecruiterContacts: candidates.reduce(function (total, candidate) {
        return total + candidate.recruiterContacts;
      }, 0),
      currentUnsentRecruiterContacts: candidates.reduce(function (total, candidate) {
        return total + candidate.recruiterContactsUnsent;
      }, 0),
      alreadyQueuedButNotSent: candidates.filter(function (candidate) {
        return candidate.coldEmail.queued > 0;
      }).length,
      needsNewColdEmail: candidates.filter(function (candidate) {
        return candidate.needsNewColdEmail;
      }).length
    },
    companies: candidates
  };
}

/**
 * Read-only source list for an owner-requested startup screen. It intentionally
 * keeps only companies without any recruiter record or existing cold-email
 * commitment, so later enrichment cannot duplicate the database or Email.
 */
function auditRecentOffTargetSWEInternWithoutRecruiterCoverage() {
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
  var targetCompanies = outreachReferralTargetCompanies_(tracker);
  if (targetCompanies === null) throw new Error('Target tab is unavailable.');
  var apps = targetMirrorApplications_(tracker);
  var queue = tracker.getSheetByName(TAB_QUEUE);
  var todayText = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  var today = new Date(todayText + 'T00:00:00-04:00');
  var cutoff = outreachAddDays_(today, -34);
  var tomorrow = outreachAddDays_(today, 1);
  var groups = [];
  apps.filter(function (app) {
    return app.company && app.process !== STAGE_REJECTED && app.dateApplied
      && app.dateApplied.getTime() >= cutoff.getTime() && app.dateApplied.getTime() < tomorrow.getTime()
      && offTargetSWEInternRole_(app.role)
      && !outreachReferralCompanyIsTarget_(app.company, targetCompanies)
      && !outreachReferralIsQuantFirm_(app.company);
  }).forEach(function (app) {
    var group = groups.filter(function (candidate) {
      return outreachSameEmployer_(outreachCompanyTokens_(candidate.company),
                                   outreachCompanyTokens_(app.company));
    })[0];
    if (!group) {
      group = {company: app.company, applications: []};
      groups.push(group);
    }
    group.applications.push(app);
  });
  var contacts = outreachReadContacts_(contactsBook);
  var queueRows = queue && queue.getLastRow() >= 2
    ? queue.getRange(2, 1, queue.getLastRow() - 1, Q_WIDTH).getValues()
      .map(function (row, index) { return outreachParseQueue_(row, index); }) : [];
  var campaignEntries = [];
  Object.keys(PropertiesService.getScriptProperties().getProperties()).forEach(function (key) {
    if (key.indexOf('TARGET_RECRUITER_CAMPAIGN_') !== 0
        && key.indexOf('OFFTARGET_RECRUITER_CAMPAIGN_') !== 0) return;
    try { campaignEntries = campaignEntries.concat(
      (JSON.parse(PropertiesService.getScriptProperties().getProperty(key)).entries || []));
    } catch (ignored) {}
  });
  var countState = function (rows, company) {
    return rows.filter(function (row) {
      return outreachSameEmployer_(outreachCompanyTokens_(row.company),
                                   outreachCompanyTokens_(company))
        && ['pending', 'queued', 'drafted', 'sent', 'already-sent', 'replied', 'bounced']
          .indexOf(String(row.status || '').toLowerCase()) !== -1;
    }).length;
  };
  var candidates = groups.map(function (group) {
    var matchingContacts = outreachContactsFor_(contacts, group.company);
    var committed = countState(queueRows, group.company) + countState(campaignEntries, group.company);
    if (matchingContacts.length || committed) return null;
    var newest = group.applications.slice().sort(function (left, right) {
      return Number(right.dateApplied || 0) - Number(left.dateApplied || 0)
        || String(left.role || '').localeCompare(String(right.role || ''));
    })[0];
    return {
      company: group.company,
      applications: group.applications.length,
      latestApplied: Utilities.formatDate(newest.dateApplied, 'America/New_York', 'yyyy-MM-dd'),
      role: newest.role,
      jobLink: newest.official || newest.link || ''
    };
  }).filter(function (candidate) { return !!candidate; }).sort(function (left, right) {
    return left.company.localeCompare(right.company);
  });
  return {
    applicationWindow: Utilities.formatDate(cutoff, 'America/New_York', 'yyyy-MM-dd') + ' through '
      + Utilities.formatDate(today, 'America/New_York', 'yyyy-MM-dd'),
    rule: 'Active off-Target, non-quant Software Engineer/Engineering Intern App; no recruiter in Contacts and no active Email/direct recruiter commitment.',
    candidates: candidates,
    count: candidates.length
  };
}

/** Read-only recruiter-contact and Target-list presence for one employer. */
function diagnoseCompanyAvailability(company) {
  var wanted = String(company || '').trim();
  if (!wanted) throw new Error('A company name is required.');
  var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var contacts = outreachContactsFor_(outreachReadContacts_(contactsBook), wanted);
  var employees = outreachEmployeesFor_(outreachReadEmployees_(contactsBook), wanted);
  var wantedTokens = outreachCompanyTokens_(wanted);
  var applications = targetMirrorApplications_(tracker).filter(function (app) {
    return app.process !== STAGE_REJECTED
      && outreachSameEmployer_(wantedTokens, outreachCompanyTokens_(app.company));
  }).map(function (app) {
    return {
      role: app.role,
      link: app.official || app.link,
      dateApplied: app.dateApplied
        ? Utilities.formatDate(app.dateApplied, 'America/New_York', 'yyyy-MM-dd') : '',
      process: app.process
    };
  });
  var jobs = tracker.getSheetByName('Jobs');
  var openJobs = [];
  if (jobs && jobs.getLastRow() >= 2) {
    jobs.getRange(2, 1, jobs.getLastRow() - 1, Math.min(3, jobs.getLastColumn())).getValues()
      .forEach(function (job) {
        if (outreachSameEmployer_(wantedTokens, outreachCompanyTokens_(job[0]))
            && targetAuditRoleEligible_(job[1])) {
          openJobs.push({role: String(job[1] || ''), link: String(job[2] || '')});
        }
      });
  }
  var targetCompanies = outreachReferralTargetCompanies_(tracker);
  if (targetCompanies === null) throw new Error('Target tab is unavailable.');
  return {
    company: wanted,
    recruiterContacts: contacts.length,
    recruiterContactsUnsent: contacts.filter(function (contact) { return !contact.sent; }).length,
    referralContacts: employees.length,
    activeApplications: applications,
    openJobs: openJobs,
    inTarget: !!targetCompanies[wantedTokens.join('\u0000')]
  };
}

/** Read one normal Email company row and its immediate physical neighbors. */
function diagnoseNormalQueueCompanyWindow(company) {
  var wanted = String(company || '').trim();
  if (!wanted) throw new Error('A company is required.');
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var queue = tracker.getSheetByName(TAB_QUEUE);
  if (!queue || queue.getLastRow() < 2) return [];
  var values = queue.getRange(2, 1, queue.getLastRow() - 1, Q_WIDTH).getValues();
  var rows = values.map(function (row, index) {
    var parsed = outreachParseQueue_(row, index);
    parsed.result = outreachCell_(row, Q_RESULT);
    return parsed;
  });
  var matches = rows.filter(function (row) {
    return outreachSameEmployer_(outreachCompanyTokens_(wanted), outreachCompanyTokens_(row.company));
  });
  var wantedRows = {};
  matches.forEach(function (row) {
    [row.rowNumber - 2, row.rowNumber - 1, row.rowNumber, row.rowNumber + 1, row.rowNumber + 2]
      .forEach(function (number) { wantedRows[number] = true; });
  });
  return rows.filter(function (row) { return wantedRows[row.rowNumber]; }).map(function (row) {
    return {rowNumber: row.rowNumber, company: row.company, role: row.role, status: row.status,
      mode: row.mode, draftId: !!row.draftId, result: row.result, scheduledAt: row.scheduledAt};
  });
}

/** Read-only Gmail and pipeline history for recruiter cold outreach to named employers. */
function diagnoseTargetRecruiterOutboundHistory(companies) {
  var requested = Array.isArray(companies) ? companies : [companies];
  var names = requested.map(function (company) { return String(company || '').trim(); })
    .filter(function (company) { return !!company; });
  if (!names.length) throw new Error('At least one company is required.');
  var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var contacts = outreachReadContacts_(contactsBook);
  var campaignEntries = [];
  Object.keys(PropertiesService.getScriptProperties().getProperties()).forEach(function (key) {
    if (key.indexOf('TARGET_RECRUITER_CAMPAIGN_') !== 0
        && key.indexOf('OFFTARGET_RECRUITER_CAMPAIGN_') !== 0) return;
    var text = PropertiesService.getScriptProperties().getProperty(key);
    try { campaignEntries = campaignEntries.concat((JSON.parse(text).entries || [])); }
    catch (ignored) {}
  });
  var queue = tracker.getSheetByName(TAB_QUEUE);
  var queueEntries = queue && queue.getLastRow() >= 2
    ? queue.getRange(2, 1, queue.getLastRow() - 1, Q_WIDTH).getValues()
      .map(function (values, index) { return outreachParseQueue_(values, index + 2); }) : [];
  return names.map(function (company) {
    var people = outreachContactsFor_(contacts, company);
    var emails = people.map(function (person) { return person.email; });
    var query = emails.length ? 'from:me (' + emails.map(function (email) {
      return 'to:' + email;
    }).join(' OR ') + ')' : '';
    var threads = query ? GmailApp.search(query, 0, 500) : [];
    var coldSubjects = {};
    COLD_TEMPLATES.forEach(function (template) { coldSubjects[template.subject] = true; });
    var coldTemplateMessages = 0;
    threads.forEach(function (thread) {
      thread.getMessages().forEach(function (message) {
        // The enclosing search already guarantees a message from this mailbox;
        // count only exact approved cold-template subjects in that thread.
        if (coldSubjects[message.getSubject()]) coldTemplateMessages++;
      });
    });
    var sameEmployer = function (entry) {
      return outreachSameEmployer_(outreachCompanyTokens_(company), outreachCompanyTokens_(entry.company));
    };
    var stateCounts = function (entries) {
      var sent = 0, queued = 0;
      entries.filter(sameEmployer).forEach(function (entry) {
        var status = String(entry.status || '').toLowerCase();
        if (status === 'sent' || status === 'already-sent' || status === 'replied' || status === 'bounced') sent++;
        else if (status === 'pending' || status === 'queued' || status === 'drafted') queued++;
      });
      return {sent: sent, queued: queued};
    };
    var direct = stateCounts(campaignEntries);
    var normal = stateCounts(queueEntries);
    return {
      company: company,
      currentRecruiterContacts: people.length,
      gmailOutboundThreadsToCurrentRecruiters: threads.length,
      gmailColdTemplateMessagesToCurrentRecruiters: coldTemplateMessages,
      directCampaignSent: direct.sent,
      directCampaignQueued: direct.queued,
      normalQueueSent: normal.sent,
      normalQueueQueued: normal.queued
    };
  });
}

/** Read exact recipient/template data for an explicitly requested draft mirror. */
function diagnoseTargetRecruiterCampaignEntries(propertyKey) {
  var key = String(propertyKey || '').trim();
  if (!/^TARGET_RECRUITER_CAMPAIGN_/.test(key)) {
    throw new Error('A Target recruiter campaign property key is required.');
  }
  var text = PropertiesService.getScriptProperties().getProperty(key);
  if (!text) return {propertyKey: key, status: 'not-scheduled', entries: []};
  var state = JSON.parse(text);
  return {
    propertyKey: key,
    status: state.status,
    timezone: state.timezone || 'America/New_York',
    entries: (state.entries || []).map(function (entry) {
      return {
        company: entry.company,
        name: entry.name,
        email: entry.email,
        title: entry.title,
        role: entry.role,
        jobLink: entry.jobLink,
        template: entry.template,
        status: entry.status,
        scheduledAt: Utilities.formatDate(new Date(entry.atMs), 'America/New_York', 'yyyy-MM-dd HH:mm z')
      };
    })
  };
}

/**
 * Read-only coverage audit for Target companies that still have an eligible,
 * non-rejected application or an eligible current Jobs posting. Direct Target
 * campaign state is deduplicated against the operational Referral history.
 */
function auditTargetOutreachCoverage(summerOnly) {
  summerOnly = summerOnly === true;
  var roleInScope = function (role) {
    return targetAuditRoleEligible_(role)
      && (!summerOnly || targetAuditSummerRoleEligible_(role));
  };
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var targets = targetAuditTargetCompanies_(tracker);
  var byKey = {};
  targets.forEach(function (target) {
    byKey[target.key] = {
      company: target.company, group: target.group,
      applications: 0, openJobs: 0,
      referral: {sent: 0, queued: 0, other: 0},
      recruiter: {sent: 0, queued: 0, other: 0}
    };
  });
  var match = function (company) {
    var tokens = outreachCompanyTokens_(company);
    var keys = Object.keys(byKey).filter(function (key) {
      return outreachSameEmployer_(tokens, outreachCompanyTokens_(byKey[key].company));
    });
    return keys.length ? byKey[keys[0]] : null;
  };
  var appRows = targetMirrorApplications_(tracker);
  var eligibleAppRows = 0;
  appRows.forEach(function (app) {
    var row = match(app.company);
    if (row && app.process !== STAGE_REJECTED && roleInScope(app.role)) {
      row.applications++;
      eligibleAppRows++;
    }
  });
  var jobs = tracker.getSheetByName('Jobs');
  var eligibleJobRows = 0;
  if (jobs && jobs.getLastRow() >= 2) {
    jobs.getRange(2, 1, jobs.getLastRow() - 1, Math.min(3, jobs.getLastColumn())).getValues()
      .forEach(function (job) {
        var row = match(job[0]);
        if (row && roleInScope(job[1])) {
          row.openJobs++;
          eligibleJobRows++;
        }
      });
  }

  var directReferral = {};
  Object.keys(PropertiesService.getScriptProperties().getProperties()).forEach(function (key) {
    if (key.indexOf('TARGET_REFERRAL_CAMPAIGN_') !== 0
        && key.indexOf('TARGET_RECRUITER_CAMPAIGN_') !== 0
        && key !== 'MICROSOFT_COLD_DRAFT_SCHEDULE_20260909') return;
    var text = PropertiesService.getScriptProperties().getProperty(key);
    var state;
    try { state = JSON.parse(text); } catch (ignored) { return; }
    (state.entries || []).forEach(function (entry) {
      var company = entry.company || (key === 'MICROSOFT_COLD_DRAFT_SCHEDULE_20260909' ? 'Microsoft' : '');
      var row = match(company);
      if (!row || !targetAuditRoleEligible_(entry.role || 'Software Engineer Intern')) return;
      var path = key.indexOf('TARGET_REFERRAL_CAMPAIGN_') === 0 ? 'referral' : 'recruiter';
      targetAuditAddState_(row[path], entry.status);
      if (path === 'referral' && entry.email) {
        directReferral[String(company).toLowerCase() + '|' + String(entry.email).toLowerCase()] = true;
      }
    });
  });
  var referral = tracker.getSheetByName(TAB_REFERRAL);
  if (referral) {
    outreachReadReferralRows_(referral).forEach(function (entry) {
      var row = match(entry.company);
      if (!row || !targetAuditRoleEligible_(entry.role)) return;
      var key = String(entry.company).toLowerCase() + '|' + String(entry.email || '').toLowerCase();
      if (entry.email && directReferral[key]) return;
      targetAuditAddState_(row.referral, entry.status);
    });
  }
  var email = tracker.getSheetByName(TAB_QUEUE);
  if (email && email.getLastRow() >= 2) {
    email.getRange(2, 1, email.getLastRow() - 1, Q_WIDTH).getValues()
      .map(function (values, index) { return outreachParseQueue_(values, index + 2); })
      .forEach(function (entry) {
        var row = match(entry.company);
        if (row && targetAuditRoleEligible_(entry.role)) targetAuditAddState_(row.recruiter, entry.status);
      });
  }
  var active = Object.keys(byKey).map(function (key) { return byKey[key]; })
    .filter(function (row) { return row.applications || row.openJobs; })
    .sort(function (left, right) { return left.company.localeCompare(right.company); });
  var withOutreach = active.filter(function (row) {
    return row.referral.sent || row.referral.queued || row.recruiter.sent || row.recruiter.queued;
  });
  var missing = active.filter(function (row) {
    return !(row.referral.sent || row.referral.queued)
      || !(row.recruiter.sent || row.recruiter.queued);
  });
  var missingBoth = missing.filter(function (row) {
    return !(row.referral.sent || row.referral.queued)
      && !(row.recruiter.sent || row.recruiter.queued);
  });
  var missingReferralOnly = missing.filter(function (row) {
    return !(row.referral.sent || row.referral.queued)
      && !!(row.recruiter.sent || row.recruiter.queued);
  });
  var missingRecruiterOnly = missing.filter(function (row) {
    return !!(row.referral.sent || row.referral.queued)
      && !(row.recruiter.sent || row.recruiter.queued);
  });
  return {
    scope: {summerOnly: summerOnly, targetCompanies: targets.length, appRows: appRows.length, eligibleAppRows: eligibleAppRows,
            eligibleJobRows: eligibleJobRows, eligibleTargetCompanies: active.length, withOutreach: withOutreach.length,
            missingOneOrBoth: missing.length, missingBoth: missingBoth.length,
            missingReferralOnly: missingReferralOnly.length,
            missingRecruiterOnly: missingRecruiterOnly.length},
    sentOrQueued: withOutreach.map(targetAuditDisplayRow_),
    missingReferralOrRecruiter: missing.map(function (row) {
      var display = targetAuditDisplayRow_(row);
      display.missingReferral = !(row.referral.sent || row.referral.queued);
      display.missingRecruiter = !(row.recruiter.sent || row.recruiter.queued);
      return display;
    })
  };
}

/** Read-only Target coverage limited to companies with a current eligible Summer role. */
function auditTargetSummerOutreachCoverage() {
  return auditTargetOutreachCoverage(true);
}

/** Flatten one company so `clasp run` exposes all path counts rather than [Object]. */
function targetAuditDisplayRow_(row) {
  return {
    company: row.company, group: row.group, applications: row.applications, openJobs: row.openJobs,
    referralSent: row.referral.sent, referralQueued: row.referral.queued, referralOther: row.referral.other,
    recruiterSent: row.recruiter.sent, recruiterQueued: row.recruiter.queued, recruiterOther: row.recruiter.other
  };
}

/** Target company names and P0–P3 group read from the visible four-block tab. */
function targetAuditTargetCompanies_(tracker) {
  var sheet = tracker.getSheetByName('Target');
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, REFERRAL_TARGET_READ_WIDTH).getValues();
  var found = {};
  values.forEach(function (row) {
    REFERRAL_TARGET_BLOCK_COLS.forEach(function (column, index) {
      var company = outreachCell_(row, column);
      var tokens = outreachCompanyTokens_(company);
      if (!tokens.length) return;
      var key = tokens.join('\u0000');
      if (!found[key]) found[key] = {company: company, group: 'P' + String(index), key: key};
    });
  });
  return Object.keys(found).map(function (key) { return found[key]; });
}

/** The user-approved SWE intern/co-op/software-developer scope, excluding design and embedded. */
function targetAuditRoleEligible_(role) {
  var text = String(role || '').toLowerCase();
  if (/\b(design|embedded)\b/.test(text)) return false;
  if (/\bsoftware\s+developer\b/.test(text)) return true;
  return /\bsoftware\b/.test(text) && /\b(engineer|engineering)\b/.test(text)
    && /\b(intern|internship|co[ -]?op)\b/.test(text);
}

/** The Summer-only audit gate, layered on the shared SWE role scope. */
function targetAuditSummerRoleEligible_(role) {
  return /\bsummer\b/i.test(String(role || '')) && targetAuditRoleEligible_(role);
}

/** Collapse direct campaign and operational queue state into sent, queued, or other. */
function targetAuditAddState_(bucket, status) {
  var state = String(status || '').toLowerCase();
  if (state === 'sent' || state === 'already-sent' || state === 'replied' || state === 'bounced') bucket.sent++;
  else if (state === 'pending' || state === 'queued' || state === 'drafted') bucket.queued++;
  else if (state) bucket.other++;
}

/** Preview the exact unsent people a direct Target referral campaign would select. */
function diagnoseTargetReferralCandidates(company, maxContacts) {
  var wanted = String(company || '').trim();
  if (!wanted) throw new Error('A company name is required.');
  var limit = Number(maxContacts || 10);
  if (!(limit > 0)) throw new Error('maxContacts must be positive.');
  var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var referral = tracker.getSheetByName(TAB_REFERRAL);
  if (!referral) throw new Error('Referral tab is missing.');
  var used = {};
  outreachReadReferralRows_(referral).forEach(function (row) {
    if (row.email) used[row.email.toLowerCase()] = true;
  });
  return outreachEmployeesFor_(outreachReadEmployees_(contactsBook), wanted)
    .filter(function (person) {
      var email = String(person.email || '').toLowerCase();
      return email && !used[email] && !GmailApp.search('from:me to:' + email, 0, 1).length;
    })
    .sort(function (left, right) {
      return (left.name || left.email).localeCompare(right.name || right.email);
    })
    .slice(0, limit)
    .map(function (person) {
      var greeting = outreachGreetingInfo_(person.name);
      return {
        name: person.name,
        vietnameseStyle: greeting.vietnamese,
        givenName: greeting.given,
        suggestedTitle: greeting.gender === 'man' ? 'anh'
          : (greeting.gender === 'woman' ? 'chị' : '')
      };
    });
}

/** Send one due Target referral entry and finalize the seed snapshot. */
function runTargetReferralCampaignTickFor_(config) {
  var propertyKey = config.propertyKey;
  var handler = config.handler;
  var stateText = '';
  var state = null;
  var due = null;
  var messageWasSent = false;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return {skipped: true, reason: 'lock busy'};
  try {
    var props = PropertiesService.getScriptProperties();
    stateText = props.getProperty(propertyKey);
    if (!stateText) return {skipped: true, reason: 'state absent'};
    state = JSON.parse(stateText);
    if (state.status !== 'scheduled') return {skipped: true, status: state.status};
    var now = new Date().getTime();
    due = state.entries.filter(function (entry) {
      return entry.status === 'pending' && entry.atMs <= now;
    }).sort(function (left, right) { return left.atMs - right.atMs; })[0];
    if (!due) return {skipped: true, reason: 'nothing due'};
    var minGapMinutes = Number(state.minGapMinutes || 8);
    if (state.lastSentAtMs && now - state.lastSentAtMs < minGapMinutes * 60000) {
      return {skipped: true, reason: 'minimum gap', next: due.email};
    }

    if (GmailApp.search('from:me to:' + due.email, 0, 1).length) {
      due.status = 'already-sent';
      due.completedAt = new Date().toISOString();
      props.setProperty(propertyKey, JSON.stringify(state));
      try { refreshTargetQueueTabs_(); }
      catch (mirrorError) { Logger.log('Target mirror refresh failed: ' + mirrorError); }
      return {skippedAlreadySent: true, email: due.email};
    }

    var rejection = outreachGmailApiRejectedTarget_(due);
    if (rejection.rejected) {
      due.status = 'cancelled';
      due.completedAt = new Date().toISOString();
      due.error = 'Blocked before sending: Gmail API found a matching rejection (' + rejection.why + ').';
      if (!state.entries.some(function (entry) { return entry.status === 'pending'; })) {
        state.status = 'complete';
        state.completedAt = new Date().toISOString();
        ScriptApp.getProjectTriggers().forEach(function (trigger) {
          if (trigger.getHandlerFunction() === handler) ScriptApp.deleteTrigger(trigger);
        });
      }
      props.setProperty(propertyKey, JSON.stringify(state));
      try { refreshTargetQueueTabs_(); }
      catch (mirrorError) { Logger.log('Target mirror refresh failed: ' + mirrorError); }
      return {blocked: true, company: due.company, reason: 'matching Gmail rejection',
              pending: state.entries.filter(function (entry) { return entry.status === 'pending'; }).length};
    }

    var mail = due.customCopy === 'lyft-referral-0911'
      ? outreachLyftReferralCompose_(due)
      : due.copy === 'henry_vietnamese'
      ? outreachVietnameseReferralCompose_({
          personName: due.name, vietnameseName: due.vietnameseName,
          vietnameseTitle: due.vietnameseTitle, vietnameseVariant: due.vietnameseVariant,
          company: due.company, role: due.role
        })
      : outreachReferralCompose_({
          personName: due.name, personTitle: due.title, seniority: due.seniority,
          company: due.company, angle: due.angle, bucket: due.bucket,
          role: due.role, jobLink: due.jobLink, template: due.template,
          today: new Date()
        });
    var resume = DriveApp.getFileById(OFFICIAL_RESUME_FILE_ID).getBlob()
      .setName('Henry_Nguyen_Resume.pdf');
    GmailApp.sendEmail(due.email, mail.subject, mail.plain, {
      htmlBody: mail.html, inlineImages: mail.inlineImages,
      attachments: [resume], name: SENDER_NAME
    });

    // GmailApp.sendEmail returns void. The search is only for an audit id; the
    // send itself is considered accepted once sendEmail returns successfully.
    messageWasSent = true;
    var sentMatches = GmailApp.search(
      'in:sent to:' + due.email + ' subject:"' + mail.subject + '"', 0, 1);
    var messageId = sentMatches.length && sentMatches[0].getMessages().length
      ? sentMatches[0].getMessages()[0].getId() : '';
    due.status = 'sent';
    due.completedAt = new Date().toISOString();
    due.messageId = messageId;
    state.lastSentAtMs = now;
    try {
      appendTargetReferralHistory_(due, messageId);
      outreachMarkEmployeesSent_([due.email]);
    } catch (historyError) {
      due.historyError = String(historyError.message || historyError).slice(0, 250);
    }
    try {
      markTargetOutreachStatus_(due.company, 'refer');
      refreshTargetSendableCounts_();
    } catch (targetSyncError) {
      due.targetSyncError = String(targetSyncError.message || targetSyncError).slice(0, 250);
    }
    var pending = state.entries.some(function (entry) { return entry.status === 'pending'; });
    if (!pending) {
      var historyErrors = ensureTargetReferralHistories_(state);
      if (historyErrors.length) {
        state.finalizationError = historyErrors.join(' | ').slice(0, 500);
        props.setProperty(propertyKey, JSON.stringify(state));
        return {sent: true, company: due.company, name: due.name, email: due.email,
                template: due.template, pending: 0, historyPending: historyErrors};
      }
      state.status = 'complete';
      state.completedAt = new Date().toISOString();
      state.seedRefresh = refreshReferralSeedCounts();
      ScriptApp.getProjectTriggers().forEach(function (trigger) {
        if (trigger.getHandlerFunction() === handler) ScriptApp.deleteTrigger(trigger);
      });
    }
    props.setProperty(propertyKey, JSON.stringify(state));
    try { refreshTargetQueueTabs_(); }
    catch (mirrorError) { Logger.log('Target mirror refresh failed: ' + mirrorError); }
    return {sent: true, company: due.company, name: due.name, email: due.email,
            template: due.template, pending: state.entries.filter(function (e) { return e.status === 'pending'; }).length};
  } catch (error) {
    var text = String(error.message || error);
    if (messageWasSent && state && due) {
      due.status = 'sent';
      due.error = text.slice(0, 250);
      state.lastSentAtMs = new Date().getTime();
      try { PropertiesService.getScriptProperties().setProperty(propertyKey, JSON.stringify(state)); }
      catch (ignoredSent) {}
    } else if (stateText && state) {
      try {
        var failedDue = state.entries.filter(function (entry) {
          return entry.status === 'pending' && entry.atMs <= new Date().getTime();
        }).sort(function (left, right) { return left.atMs - right.atMs; })[0];
        if (failedDue) {
          failedDue.status = 'failed';
          failedDue.error = text.slice(0, 250);
          props.setProperty(propertyKey, JSON.stringify(state));
          try { refreshTargetQueueTabs_(); }
          catch (mirrorError) { Logger.log('Target mirror refresh failed: ' + mirrorError); }
        }
      } catch (ignored) {}
    }
    throw error;
  } finally {
    lock.releaseLock();
  }
}

/** Retry history rows before the final seed-count refresh. */
function ensureTargetReferralHistories_(state) {
  var errors = [];
  (state.entries || []).filter(function (entry) { return entry.status === 'sent'; })
    .forEach(function (entry) {
      try { appendTargetReferralHistory_(entry, entry.messageId || ''); }
      catch (error) { errors.push(entry.email + ': ' + String(error.message || error)); }
    });
  return errors;
}

/** Addresses reserved by an explicit referral campaign, optionally at one company. */
function targetReferralCampaignEmails_(propertyKey, company) {
  var text = PropertiesService.getScriptProperties().getProperty(propertyKey);
  if (!text) return [];
  return (JSON.parse(text).entries || []).filter(function (entry) {
    return !company || entry.company === company;
  }).map(function (entry) {
    return String(entry.email || '').toLowerCase();
  }).filter(Boolean);
}

/** Persist one successful direct ask so the sender's count snapshot deducts it. */
function appendTargetReferralHistory_(entry, messageId) {
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var referral = tracker.getSheetByName(TAB_REFERRAL);
  if (!referral) throw new Error('Referral tab is missing while recording ' + entry.email);
  var rows = outreachReadReferralRows_(referral);
  if (rows.some(function (row) { return row.email.toLowerCase() === entry.email.toLowerCase(); })) return;
  var row = new Array(R_WIDTH).fill('');
  row[R_COMPANY - 1] = entry.company;
  row[R_ROLE - 1] = entry.role;
  row[R_PERSON - 1] = entry.name;
  row[R_EMAIL - 1] = entry.email;
  row[R_TITLE - 1] = entry.title;
  row[R_TIER - 1] = outreachReferralTier_(entry.title, entry.seniority);
  row[R_TEMPLATE - 1] = entry.template;
  row[R_SCHEDULED - 1] = new Date(entry.atMs);
  row[R_STATUS - 1] = STATUS_SENT;
  row[R_JOB_LINK - 1] = entry.jobLink;
  row[R_SENT_AT - 1] = new Date();
  row[R_RESULT - 1] = messageId;
  row[R_ID - 1] = 'R-' + entry.email;
  row[R_VERSION - 1] = 1;
  referral.getRange(referral.getLastRow() + 1, 1, 1, R_WIDTH).setValues([row]);
}

/** Render the three owner-approved warm English Lyft referral messages. */
function outreachLyftReferralCompose_(entry) {
  var name = outreachFirstName_(entry.name);
  var subject = 'Referral ask - Lyft Software Engineering Intern, ' + entry.subjectRole;
  var intro = 'I’m Henry, a Math & CS student at Kenyon College, and I recently applied for Lyft’s '
    + entry.role + '.';
  if (outreachNameKey_(entry.name) === outreachNameKey_('Degao Chen')) {
    intro = 'I’m Henry, currently studying Math & CS at Kenyon College. I recently applied for Lyft’s '
      + entry.role + '.';
  }
  var ask = 'I’m sorry for reaching out out of the blue, especially since we haven’t met. I wanted to give myself the best chance to move forward in the process, so if you feel comfortable, would you be willing to refer me for this role?';
  var lines = ['Hi ' + name + ',', '', intro, '', entry.profile, '', ask, '', entry.resume, '', entry.thanks, '', 'Best,', 'Henry'];
  var html = '<p>Hi ' + outreachEscape_(name) + ',</p>'
    + '<p>' + outreachEscape_(intro) + '</p>'
    + '<p>' + outreachEscape_(entry.profile) + '</p>'
    + '<p><b>' + outreachEscape_(ask) + '</b></p>'
    + '<p>' + outreachEscape_(entry.resume) + '</p>'
    + '<p>' + outreachEscape_(entry.thanks) + '</p>'
    + '<p>Best,<br>Henry</p>';
  return {subject: subject, plain: lines.join('\n'), html: html, inlineImages: {}};
}

/**
 * Read-only status for the explicit Target referral waves. The normal referral
 * planner is paused, so these script-property campaigns are the authoritative
 * live schedule for the three waves requested by the owner.
 */
function diagnoseTargetReferralCampaigns() {
  return [
    ['Sierra, Waymo, Mastercard', 'TARGET_REFERRAL_CAMPAIGN_20260909_SIERRA_WAYMO_MASTERCARD'],
    ['PayPal, Dropbox, Scale AI', 'TARGET_REFERRAL_CAMPAIGN_20260910_PAYPAL_DROPBOX_SCALE_AI'],
    ['Datadog — 5 extra contacts', 'TARGET_REFERRAL_CAMPAIGN_20260910_DATADOG'],
    ['Datadog, Vercel, Coinbase, Red Hat', 'TARGET_REFERRAL_CAMPAIGN_20260911_DATADOG_VERCEL_COINBASE_RED_HAT'],
    ['Whatnot', 'TARGET_REFERRAL_CAMPAIGN_20260911_WHATNOT'],
    ['Dell Technologies — Hai La', 'TARGET_REFERRAL_CAMPAIGN_20260911_DELL_HAI_LA'],
    ['Lyft', 'TARGET_REFERRAL_CAMPAIGN_20260911_LYFT'],
    ['Cisco', 'TARGET_REFERRAL_CAMPAIGN_20260914_CISCO'],
    ['Dell Technologies', 'TARGET_REFERRAL_CAMPAIGN_20260914_DELL'],
    ['Plaid', 'TARGET_REFERRAL_CAMPAIGN_20260914_PLAID'],
    ['Lyft — five more contacts', 'TARGET_REFERRAL_CAMPAIGN_20260915_LYFT'],
    ['Figma', 'TARGET_REFERRAL_CAMPAIGN_20260918_FIGMA'],
    ['DoorDash', 'TARGET_REFERRAL_CAMPAIGN_20260916_DOORDASH']
  ].map(function (spec) {
    var text = PropertiesService.getScriptProperties().getProperty(spec[1]);
    if (!text) return {companies: spec[0], status: 'not-scheduled'};
    return summarizeTargetCampaignState_(JSON.parse(text), spec[0]);
  });
}

/** Read the source and scheduled forms of Lisa Huynh's Datadog referral record. */
function diagnoseDatadogLisaHuynh() {
  var company = 'Datadog';
  var nameKey = outreachNameKey_('Lisa Huynh');
  var contacts = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
  var employees = outreachEmployeesFor_(outreachReadEmployees_(contacts), company);
  var describe = function (person) {
    var name = String(person.name || '');
    return {
      company: person.company,
      name: name,
      nameCodePoints: Array.from(name).map(function (character) {
        return 'U+' + character.codePointAt(0).toString(16).toUpperCase();
      }),
      title: person.title,
      seniority: person.seniority,
      bucket: person.bucket,
      sourceRow: person.rowNumber
    };
  };
  var seedMatches = employees.filter(function (person) {
    return outreachNameKey_(person.name) === nameKey;
  }).map(describe);
  var campaignText = PropertiesService.getScriptProperties().getProperty(
    'TARGET_REFERRAL_CAMPAIGN_20260911_DATADOG_VERCEL_COINBASE_RED_HAT');
  var campaignMatches = campaignText ? (JSON.parse(campaignText).entries || []).filter(function (entry) {
    return entry.company === company && outreachNameKey_(entry.name) === nameKey;
  }).map(function (entry) {
    return {
      name: entry.name,
      nameCodePoints: Array.from(String(entry.name || '')).map(function (character) {
        return 'U+' + character.codePointAt(0).toString(16).toUpperCase();
      }),
      status: entry.status,
      scheduledAt: Utilities.formatDate(new Date(entry.atMs), 'America/New_York', 'yyyy-MM-dd HH:mm z'),
      template: entry.template
    };
  }) : [];
  return {seedMatches: seedMatches, campaignMatches: campaignMatches};
}

/** Read-only catalog of Vietnamese-style greeting names across both sendable seeds. */
function diagnoseVietnameseGreetingCatalog() {
  var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
  var people = outreachReadContacts_(contactsBook).filter(function (person) {
    return !person.sent;
  }).concat(outreachReadEmployees_(contactsBook));
  var names = {};
  people.forEach(function (person) {
    var info = outreachGreetingInfo_(person.name);
    if (!info.vietnamese || !info.givenKey) return;
    if (!names[info.givenKey]) {
      names[info.givenKey] = {
        given: info.given, greeting: info.greeting, gender: info.gender || 'untitled', count: 0
      };
    }
    names[info.givenKey].count++;
  });
  var rows = Object.keys(names).map(function (key) { return names[key]; }).sort(function (left, right) {
    if (left.gender !== right.gender) return left.gender.localeCompare(right.gender);
    if (right.count !== left.count) return right.count - left.count;
    return left.given.localeCompare(right.given);
  });
  var format = function (gender) {
    return rows.filter(function (row) { return row.gender === gender; }).map(function (row) {
      return row.given + ' | ' + row.greeting + ' | ' + row.count;
    }).join('\n');
  };
  return {men: format('man'), women: format('woman'), untitled: format('untitled')};
}

/** Read-only Vietnamese-style names among the still-scheduled 09/11 Target recipients. */
function diagnoseVietnameseNamesScheduled0911() {
  var campaigns = [
    {
      label: 'Referral',
      propertyKey: 'TARGET_REFERRAL_CAMPAIGN_20260911_DATADOG_VERCEL_COINBASE_RED_HAT'
    },
    {
      label: 'Recruiter',
      propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260911_NETAPP'
    }
  ];
  var props = PropertiesService.getScriptProperties();
  var rows = [];
  campaigns.forEach(function (campaign) {
    var text = props.getProperty(campaign.propertyKey);
    if (!text) return;
    (JSON.parse(text).entries || []).forEach(function (entry) {
      if (entry.status !== 'pending') return;
      var info = outreachGreetingInfo_(entry.name);
      if (!info.vietnamese) return;
      rows.push([
        campaign.label,
        entry.company || 'Unknown',
        String(entry.name || '').trim(),
        info.greeting,
        Utilities.formatDate(new Date(entry.atMs), 'America/New_York', 'HH:mm')
      ].join(' | '));
    });
  });
  return rows.sort();
}

/** Summarize a campaign without returning recruiter/employee addresses. */
function summarizeTargetCampaignState_(state, label) {
  var byCompany = {};
  (state.entries || []).forEach(function (entry) {
    var key = entry.company || 'Unknown';
    if (!byCompany[key]) {
      byCompany[key] = {total: 0, pending: 0, sent: 0, bounced: 0, failed: 0, skipped: 0};
    }
    byCompany[key].total++;
    if (entry.status === 'pending') byCompany[key].pending++;
    else if (entry.status === 'sent') byCompany[key].sent++;
    else if (entry.status === 'bounced') byCompany[key].bounced++;
    else if (entry.status === 'failed') byCompany[key].failed++;
    else byCompany[key].skipped++;
  });
  var entries = (state.entries || []).slice().sort(function (left, right) {
    return Number(left.atMs || 0) - Number(right.atMs || 0);
  });
  return {
    companies: label,
    status: state.status,
    timezone: state.timezone || 'America/New_York',
    createdAt: state.createdAt || '',
    completedAt: state.completedAt || '',
    byCompany: byCompany,
    firstAt: entries.length ? Utilities.formatDate(
      new Date(entries[0].atMs), 'America/New_York', 'yyyy-MM-dd HH:mm z') : '',
    lastAt: entries.length ? Utilities.formatDate(
      new Date(entries[entries.length - 1].atMs), 'America/New_York', 'yyyy-MM-dd HH:mm z') : ''
  };
}

/** Explicit Target recruiter campaign for Replit and five NVIDIA contacts on 2026-09-09. */
function scheduleTargetRecruiterCampaign0909() {
  return scheduleTargetRecruiterCampaign_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260909_REPLIT_NVIDIA',
    handler: 'runTargetRecruiterCampaignTick0909_',
    label: 'Replit, NVIDIA',
    startIso: '2026-09-09T13:30:00-04:00',
    spacingMinutes: 10,
    minGapMinutes: 9,
    companies: [
      {
        company: 'Replit',
        maxContacts: 10,
        role: 'Software Engineering Intern (Summer 2027)',
        jobLink: 'https://jobs.ashbyhq.com/replit/7e0dafe8-3eec-442e-aa76-a4d84d779fb1/application'
      },
      {
        company: 'NVIDIA',
        maxContacts: 5,
        role: 'Software Engineering Intern',
        jobLink: 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/NVIDIA-2027-Internships--Software-Engineering_JR2023495?utm_source=Simplify&ref=Simplify'
      }
    ]
  });
}

/** Explicit Target recruiter campaign for the remaining five NVIDIA contacts on 2026-09-10. */
function scheduleTargetRecruiterCampaign0910() {
  return scheduleTargetRecruiterCampaign_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260910_NVIDIA',
    handler: 'runTargetRecruiterCampaignTick0910_',
    label: 'NVIDIA',
    startIso: '2026-09-10T13:30:00-04:00',
    spacingMinutes: 10,
    minGapMinutes: 9,
    excludeEmails: targetRecruiterCampaignEmails_('TARGET_RECRUITER_CAMPAIGN_20260909_REPLIT_NVIDIA'),
    companies: [
      {
        company: 'NVIDIA',
        maxContacts: 5,
        role: 'Software Engineering Intern',
        jobLink: 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/NVIDIA-2027-Internships--Software-Engineering_JR2023495?utm_source=Simplify&ref=Simplify'
      }
    ]
  });
}

/** Explicit Target recruiter campaign for up to seven available Google contacts on 2026-09-10. */
function scheduleTargetRecruiterCampaign0910Google() {
  return scheduleTargetRecruiterCampaign_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260910_GOOGLE',
    handler: 'runTargetRecruiterCampaignTick0910Google_',
    label: 'Google',
    startIso: '2026-09-10T14:20:00-04:00',
    spacingMinutes: 10,
    minGapMinutes: 9,
    companies: [
      {
        company: 'Google',
        maxContacts: 7,
        role: 'Software Engineering Intern, BS, Summer 2027',
        jobLink: 'https://www.google.com/about/careers/applications/jobs/results/85564713261245126-software-engineering-intern-bs-summer-2027'
      }
    ]
  });
}

/** Explicit Target recruiter campaign for five Stripe and five NetApp contacts on 2026-09-10. */
function scheduleTargetRecruiterCampaign0910StripeNetApp() {
  return scheduleTargetRecruiterCampaign_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260910_STRIPE_NETAPP',
    handler: 'runTargetRecruiterCampaignTick0910StripeNetApp_',
    label: 'Stripe, NetApp',
    startIso: '2026-09-10T20:50:00-04:00',
    spacingMinutes: 10,
    minGapMinutes: 9,
    companies: [
      {
        company: 'Stripe',
        maxContacts: 5,
        role: 'Software Engineer, Intern',
        jobLink: 'https://stripe.com/jobs/search?gh_jid=8128745'
      },
      {
        company: 'NetApp',
        maxContacts: 5,
        role: 'Software Engineer Intern (San Jose)',
        jobLink: 'https://careers.netapp.com/job/san-jose/software-engineer-intern/27600/99761955632'
      }
    ]
  });
}

/** Explicit Target recruiter campaign for five NetApp contacts on 2026-09-11. */
function scheduleTargetRecruiterCampaign0911NetApp() {
  return scheduleTargetRecruiterCampaign_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260911_NETAPP',
    handler: 'runTargetRecruiterCampaignTick0911NetApp_',
    label: 'NetApp',
    startIso: '2026-09-11T13:10:00-04:00',
    spacingMinutes: 10,
    minGapMinutes: 9,
    companies: [{
      company: 'NetApp',
      maxContacts: 5,
      role: 'Software Engineer Intern (San Jose)',
      jobLink: 'https://careers.netapp.com/job/san-jose/software-engineer-intern/27600/99761955632'
    }]
  });
}

/** Explicit Target recruiter campaign for ten Stripe contacts on Monday 2026-09-14. */
function scheduleTargetRecruiterCampaign0914Stripe() {
  return scheduleTargetRecruiterCampaign_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260914_STRIPE',
    handler: 'runTargetRecruiterCampaignTick0914Stripe_',
    label: 'Stripe',
    startIso: '2026-09-14T09:00:00-04:00',
    spacingMinutes: 6,
    minGapMinutes: 5,
    companies: [{
      company: 'Stripe',
      maxContacts: 10,
      role: 'Software Engineer, Intern',
      jobLink: 'https://stripe.com/jobs/search?gh_jid=8128745'
    }]
  });
}

/** Explicit Target recruiter campaign for five Whatnot contacts on Monday 2026-09-14. */
function scheduleTargetRecruiterCampaign0914Whatnot() {
  return scheduleTargetRecruiterCampaign_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260914_WHATNOT',
    handler: 'runTargetRecruiterCampaignTick0914Whatnot_',
    label: 'Whatnot',
    startIso: '2026-09-14T10:00:00-04:00',
    spacingMinutes: 6,
    minGapMinutes: 5,
    companies: [{
      company: 'Whatnot',
      maxContacts: 5,
      role: 'Software Engineer Intern (Summer 2027)',
      jobLink: 'https://jobs.ashbyhq.com/whatnot/928ffdca-b316-40ce-b82b-94b570919bcd/application?utm_source=Simplify'
    }]
  });
}

/** Explicit Target recruiter campaign for four Motorola Solutions contacts on Monday 2026-09-14. */
function scheduleTargetRecruiterCampaign0914MotorolaSolutions() {
  return scheduleTargetRecruiterCampaign_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260914_MOTOROLA_SOLUTIONS',
    handler: 'runTargetRecruiterCampaignTick0914MotorolaSolutions_',
    label: 'Motorola Solutions',
    startIso: '2026-09-14T10:30:00-04:00',
    spacingMinutes: 6,
    minGapMinutes: 5,
    companies: [{
      company: 'Motorola Solutions',
      maxContacts: 4,
      role: 'Software Engineering Intern - Summer 2027',
      jobLink: 'https://jobright.ai/jobs/info/6aa0259c3b5aa83237b07236?utm_campaign=1079&utm_source=git'
    }]
  });
}

/** Manual Target recruiter campaign for ten Cisco contacts on Tuesday 2026-09-15. */
function scheduleTargetRecruiterCampaign0915Cisco() {
  return scheduleTargetRecruiterCampaign_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260915_CISCO',
    handler: 'runTargetRecruiterCampaignTick0915Cisco_',
    label: 'Cisco',
    startIso: '2026-09-15T09:00:00-04:00',
    spacingMinutes: 6,
    minGapMinutes: 5,
    companies: [{
      company: 'Cisco',
      maxContacts: 10,
      role: 'Software Consulting Engineer I (Intern) United States',
      jobLink: 'https://cisco.wd5.myworkdayjobs.com/cisco_careers/job/USA-RESEARCH-TRIANGLE-PARK/Software-Consulting-Engineer-I--Intern--United-States_2025180'
    }]
  });
}

/** Manual Target cold-email campaign for three older active SWE Intern applications. */
function scheduleTargetRecruiterCampaign0915HpIntuitOracle() {
  return scheduleTargetRecruiterCampaign_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260915_HP_INTUIT_ORACLE',
    handler: 'runTargetRecruiterCampaignTick0915HpIntuitOracle_',
    label: 'HP, Intuit, Oracle',
    // Starts after the existing 09:00–09:54 Cisco wave, preserving the five-minute gap.
    startIso: '2026-09-15T10:00:00-04:00',
    spacingMinutes: 6,
    minGapMinutes: 5,
    companies: [
      {
        company: 'HP', maxContacts: 7,
        role: 'Software Engineering Intern, Connectivity (Summer 2027)',
        jobLink: 'https://job-boards.greenhouse.io/hpiq/jobs/6176783004'
      },
      {
        company: 'Intuit', maxContacts: 7,
        role: 'Summer 2027: Software Engineering Intern - Full Stack',
        jobLink: 'https://jobs.intuit.com/job/mountain-view/summer-2027-software-engineering-intern-full-stack/27595/99856180864?cid=directBookmarked_directBookmarked'
      },
      {
        company: 'Oracle', maxContacts: 7,
        role: 'OCI Software Engineer Intern - OVIP',
        jobLink: 'https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/jobsearch/job/334333?jr_id=6a367d27649fdf16292fbc7a'
      }
    ]
  });
}

/** Manual Target cold-email campaign for older untouched SWE Intern applications. */
function scheduleTargetRecruiterCampaign0916IntelAtlassian() {
  return scheduleTargetRecruiterCampaign_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260916_INTEL_ATLASSIAN',
    handler: 'runTargetRecruiterCampaignTick0916IntelAtlassian_',
    label: 'Intel, Atlassian',
    startIso: '2026-09-16T09:00:00-04:00',
    spacingMinutes: 6,
    minGapMinutes: 5,
    companies: [
      {
        company: 'Intel', maxContacts: 7,
        role: 'Software Engineering - Intern, Bachelor’s',
        jobLink: 'https://jobright.ai/jobs/info/6a984018def18223c854e3ec?utm_campaign=1079&utm_source=git'
      },
      {
        company: 'Atlassian', maxContacts: 7,
        role: 'Software Engineer Intern, 2027 Summer U.S',
        jobLink: 'https://careers-americas.icims.com/jobs/26266/software-engineer-intern%2c-2027-summer-u.s./job?jr_id=6a970d90e4e60e4b8da5bcb8&mobile=false&width=1413&height=500&bga=true&needsRedirect=false&jan1offset=-300&jun1offset=-240'
      }
    ]
  });
}

/** Queue four additional Hunter-found Atlassian recruiters for 2026-09-16. */
function scheduleTargetRecruiterCampaign0916AtlassianHunter4() {
  appendTargetPriorityHunterRecruiters_();
  return scheduleTargetRecruiterCampaign_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260916_ATLASSIAN_HUNTER4',
    handler: 'runTargetRecruiterSharedTick_',
    label: 'Atlassian Hunter 4',
    startIso: '2026-09-16T09:30:00-04:00',
    spacingMinutes: 6,
    minGapMinutes: 5,
    reuseExistingTrigger: true,
    excludeEmails: targetRecruiterCampaignEmails_(
      'TARGET_RECRUITER_CAMPAIGN_20260916_INTEL_ATLASSIAN'),
    includeEmails: [
      'ceaton@atlassian.com', 'ctanner@atlassian.com',
      'nsingh@atlassian.com', 'rbrace@atlassian.com'
    ],
    companies: [{
      company: 'Atlassian', maxContacts: 4,
      role: 'Software Engineer Intern, 2027 Summer U.S',
      jobLink: 'https://careers-americas.icims.com/jobs/26266/software-engineer-intern%2c-2027-summer-u.s./job?jr_id=6a970d90e4e60e4b8da5bcb8&mobile=false&width=1413&height=500&bga=true&needsRedirect=false&jan1offset=-300&jun1offset=-240'
    }]
  });
}

/** Manual Target cold-email campaign three days after Dell's referral asks. */
function scheduleTargetRecruiterCampaign0917Dell() {
  return scheduleTargetRecruiterCampaign_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260917_DELL',
    handler: 'runTargetRecruiterCampaignTick0917Dell_',
    label: 'Dell Technologies',
    startIso: '2026-09-17T09:00:00-04:00',
    spacingMinutes: 6,
    minGapMinutes: 5,
    companies: [{
      company: 'Dell Technologies', maxContacts: 7,
      role: 'Software Engineer Intern - Client Solutions Group Engineering',
      jobLink: 'https://iawmqy.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/careers/job/298217?utm_source=Simplify&ref=Simplify'
    }]
  });
}

/** Manual Target cold-email campaign three days after Plaid's referral asks. */
function scheduleTargetRecruiterCampaign0917Plaid() {
  return scheduleTargetRecruiterCampaign_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260917_PLAID',
    handler: 'runTargetRecruiterCampaignTick0917Plaid_',
    label: 'Plaid',
    startIso: '2026-09-17T10:00:00-04:00',
    spacingMinutes: 6,
    minGapMinutes: 5,
    companies: [{
      company: 'Plaid', maxContacts: 7,
      role: 'Software Engineering Intern, Summer 2027',
      jobLink: 'https://app.ripplematch.com/v2/public/job/02cb6f70?from=AllJobsPage'
    }]
  });
}

// The owner met these two Plaid recruiting-team members at a live workshop on
// 2026-09-15. Tomba returned valid work-email results; Alex Perelygin was not
// included because public role evidence identifies him as an engineering lead.
var TARGET_PLAID_WORKSHOP_RECRUITERS_ = [
  {name: 'Jason Ling', email: 'jling@plaid.com', title: 'Technical Sourcer', verify: 'tomba:valid'},
  {name: 'Caroline Bavaro', email: 'cbavaro@plaid.com', title: 'Recruiter', verify: 'tomba:valid'}
];

/**
 * Repair the malformed Plaid Jason address and append the verified workshop
 * recruiter while the September 17 campaign is entirely future and pending.
 */
function repairTargetRecruiterCampaign0917PlaidWorkshopContacts() {
  var key = 'TARGET_RECRUITER_CAMPAIGN_20260917_PLAID';
  var props = PropertiesService.getScriptProperties();
  var text = props.getProperty(key);
  if (!text) throw new Error('Plaid recruiter campaign is missing.');
  var state = JSON.parse(text);
  var entries = state.entries || [];
  var jasonSlot = entries.filter(function (entry) {
    return String(entry.email || '').toLowerCase() === 'l@plaid.com';
  });
  if (state.status !== 'scheduled' || entries.some(function (entry) { return entry.status !== 'pending'; })) {
    throw new Error('Plaid repair is allowed only while every entry is pending.');
  }
  if (jasonSlot.length !== 1) throw new Error('Expected exactly one malformed Plaid Jason slot.');
  if (TARGET_PLAID_WORKSHOP_RECRUITERS_.some(function (person) {
    return entries.some(function (entry) { return String(entry.email || '').toLowerCase() === person.email; });
  })) throw new Error('A verified workshop recruiter is already in the Plaid campaign.');

  // This campaign is not due until Sep 17 and has one isolated property key.
  // Avoid the global sender lock, which currently has minute-tick contention;
  // the pending-only guard above prevents a delivery-time mutation.
  var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var contacts = outreachReadContacts_(contactsBook);
  var known = {}, direct = {}, spent = targetRecruiterSpentFingerprints_(tracker);
  var salt = outreachProperty_(PROP_SALT, true);
  contacts.forEach(function (contact) { known[String(contact.email || '').toLowerCase()] = contact; });
  targetMirrorCampaignEntries_(targetMirrorCampaignKeys_('TARGET_RECRUITER_CAMPAIGN_')).forEach(function (entry) {
    direct[String(entry.email || '').toLowerCase()] = true;
  });
  TARGET_PLAID_WORKSHOP_RECRUITERS_.forEach(function (person) {
    var current = known[person.email];
    var summer = outreachFingerprint_(person.email, salt, SEASON_SUMMER);
    var offcycle = outreachFingerprint_(person.email, salt, SEASON_OFFCYCLE);
    if ((current && current.sent) || direct[person.email] || spent[summer] || spent[offcycle] ||
        GmailApp.search('from:me to:' + person.email, 0, 1).length) {
      throw new Error('Plaid workshop contact is already spent or committed: ' + person.email);
    }
  });

  var manual = contactsBook.getSheetByName(TAB_CONTACTS_MANUAL);
  if (!manual) throw new Error('Contacts (manual) is missing.');
  var rows = [], added = [];
  TARGET_PLAID_WORKSHOP_RECRUITERS_.forEach(function (person) {
    if (known[person.email]) return;
    var row = new Array(C_WIDTH).fill('');
    row[C_COMPANY - 1] = 'Plaid'; row[C_NAME - 1] = person.name; row[C_EMAIL - 1] = person.email;
    row[C_ROLE - 1] = person.title; row[C_FOCUS - 1] = 'recruiting'; row[C_VERIFY - 1] = person.verify;
    row[C_FROM - 1] = 'Plaid workshop + Treg Tomba work-email verification — user approved 2026-09-15';
    rows.push(row); added.push(person.name);
  });
  if (rows.length) manual.getRange(manual.getLastRow() + 1, 1, rows.length, C_WIDTH).setValues(rows);

  var jason = TARGET_PLAID_WORKSHOP_RECRUITERS_[0], caroline = TARGET_PLAID_WORKSHOP_RECRUITERS_[1];
  var slot = jasonSlot[0];
  slot.name = jason.name; slot.email = jason.email; slot.title = jason.title;
  var lastAtMs = entries.reduce(function (latest, entry) { return Math.max(latest, Number(entry.atMs || 0)); }, 0);
  entries.push({company: 'Plaid', role: slot.role, jobLink: slot.jobLink, name: caroline.name,
    email: caroline.email, title: caroline.title,
    template: ((entries.length) % COLD_TEMPLATES.length) + 1,
    atMs: lastAtMs + Number(state.spacingMinutes || 6) * 60000, status: 'pending'});
  state.entries = entries;
  state.repairedAt = new Date().toISOString();
  state.repairNote = 'Replaced malformed l@plaid.com with Tomba-valid Jason Ling; appended workshop recruiter Caroline Bavaro.';
  props.setProperty(key, JSON.stringify(state));
  refreshTargetQueueTabs_();
  return {replaced: 'Jason L. <l@plaid.com>', replacement: jason.name,
    appended: caroline.name, contactsAdded: added,
    total: entries.length,
    firstAt: Utilities.formatDate(new Date(entries[0].atMs), 'America/New_York', 'yyyy-MM-dd HH:mm z'),
    lastAt: Utilities.formatDate(new Date(entries[entries.length - 1].atMs), 'America/New_York', 'yyyy-MM-dd HH:mm z')};
}

/** Remove the entirely pending Plaid recruiter wave until the owner reapplies. */
function cancelTargetRecruiterCampaign0917PlaidForReapplication() {
  var key = 'TARGET_RECRUITER_CAMPAIGN_20260917_PLAID';
  var props = PropertiesService.getScriptProperties();
  var text = props.getProperty(key);
  if (!text) return {alreadyRemoved: true, removed: 0};
  var state = JSON.parse(text);
  var entries = state.entries || [];
  if (state.status !== 'scheduled' || !entries.length || entries.some(function (entry) {
    return entry.status !== 'pending';
  })) throw new Error('Plaid recruiter wave can be removed only while every entry is pending.');
  // The wave is future-only and the shared router reads this property at send
  // time; deleting it removes all eight unsent slots without affecting any
  // accepted referral history or the reusable contact records.
  props.deleteProperty(key);
  refreshTargetQueueTabs_();
  return {removed: entries.length, reason: 'Plaid application requires reapplication before recruiter outreach.'};
}

/**
 * Owner-confirmed, immediate one-recipient Stripe recruiter send. It resolves
 * Alexandria from the live contacts database and rechecks the exact official
 * SWE Intern application before delegating the actual Gmail send to the shared
 * Target sender, which repeats the Gmail rejection preflight at send time.
 */
function sendTargetRecruiterNowStripeAlexandria() {
  var key = 'TARGET_RECRUITER_SENDNOW_20260915_STRIPE_ALEXANDRIA';
  var props = PropertiesService.getScriptProperties();
  var existing = props.getProperty(key);
  if (existing) {
    var existingState = JSON.parse(existing);
    if ((existingState.entries || []).some(function (entry) { return entry.status === 'sent'; })) {
      return {alreadySent: true, company: 'Stripe', name: 'Alexandria Bolinas Paynton'};
    }
    return runTargetRecruiterCampaignTickFor_({propertyKey: key,
      handler: 'runTargetRecruiterCampaignTickNowStripeAlexandria_', keepTrigger: true});
  }

  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
  var matches = outreachContactsFor_(outreachReadContacts_(contactsBook), 'Stripe').filter(function (contact) {
    return outreachNameKey_(contact.name).indexOf('alexandriabolinas') === 0;
  });
  if (matches.length !== 1) throw new Error('Expected one live Stripe Alexandria recruiter record; found ' + matches.length + '.');
  var contact = matches[0];
  var email = String(contact.email || '').toLowerCase();
  var salt = outreachProperty_(PROP_SALT, true);
  var spent = targetRecruiterSpentFingerprints_(tracker);
  var summer = outreachFingerprint_(email, salt, SEASON_SUMMER);
  var offcycle = outreachFingerprint_(email, salt, SEASON_OFFCYCLE);
  if (contact.sent || spent[summer] || spent[offcycle] || GmailApp.search('from:me to:' + email, 0, 1).length) {
    throw new Error('Alexandria is already sent or committed; no duplicate email was created.');
  }

  var jobLink = 'https://stripe.com/jobs/search?gh_jid=8128745';
  var role = 'Software Engineer, Intern';
  var applications = targetMirrorApplications_(tracker).filter(function (app) {
    return outreachSameEmployer_(outreachCompanyTokens_(app.company), outreachCompanyTokens_('Stripe'))
      && app.role === role && app.link === jobLink && outreachQualifies_(app.process);
  });
  if (applications.length !== 1) throw new Error('The exact active Stripe SWE Intern application is not available.');
  var entry = {company: 'Stripe', role: role, jobLink: jobLink, name: contact.name,
    email: email, title: contact.role || 'Technical Recruiter', template: 3,
    atMs: new Date().getTime(), status: 'pending'};
  var rejection = outreachGmailApiRejectedTarget_(entry);
  if (rejection.rejected) return {blocked: true, company: 'Stripe', reason: rejection.why};
  props.setProperty(key, JSON.stringify({status: 'scheduled', timezone: 'America/New_York',
    createdAt: new Date().toISOString(), lastSentAtMs: 0, spacingMinutes: 6,
    minGapMinutes: 5, entries: [entry]}));
  refreshTargetQueueTabs_();
  return runTargetRecruiterCampaignTickFor_({propertyKey: key,
    handler: 'runTargetRecruiterCampaignTickNowStripeAlexandria_', keepTrigger: true});
}

/** Cancel only the pending 09/10 Google Target recruiter sends. */
function cancelTargetRecruiterCampaign0910Google() {
  var propertyKey = 'TARGET_RECRUITER_CAMPAIGN_20260910_GOOGLE';
  var handler = 'runTargetRecruiterCampaignTick0910Google_';
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var props = PropertiesService.getScriptProperties();
    var stateText = props.getProperty(propertyKey);
    if (!stateText) return {status: 'not-scheduled', cancelledPending: 0, deletedTriggers: 0};
    var state = JSON.parse(stateText);
    var cancelled = 0;
    (state.entries || []).forEach(function (entry) {
      if (entry.status !== 'pending') return;
      entry.status = 'cancelled';
      entry.cancelledAt = new Date().toISOString();
      cancelled++;
    });
    if (cancelled) {
      state.status = 'cancelled';
      state.cancelledAt = new Date().toISOString();
      props.setProperty(propertyKey, JSON.stringify(state));
    }
    var deleted = 0;
    ScriptApp.getProjectTriggers().forEach(function (trigger) {
      if (trigger.getHandlerFunction() !== handler) return;
      ScriptApp.deleteTrigger(trigger);
      deleted++;
    });
    try { refreshTargetQueueTabs_(); }
    catch (mirrorError) { Logger.log('Target mirror refresh failed: ' + mirrorError); }
    return {
      status: state.status,
      cancelledPending: cancelled,
      sent: (state.entries || []).filter(function (entry) { return entry.status === 'sent'; }).length,
      deletedTriggers: deleted
    };
  } finally {
    lock.releaseLock();
  }
}

/** Cancel every still-pending Stripe/NetApp recruiter slot from the 09/10 wave. */
function cancelTargetRecruiterCampaign0910StripeNetApp() {
  var propertyKey = 'TARGET_RECRUITER_CAMPAIGN_20260910_STRIPE_NETAPP';
  var handler = 'runTargetRecruiterCampaignTick0910StripeNetApp_';
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var props = PropertiesService.getScriptProperties();
    var stateText = props.getProperty(propertyKey);
    if (!stateText) return {status: 'not-scheduled', cancelledPending: 0, deletedTriggers: 0};
    var state = JSON.parse(stateText);
    var cancelled = 0;
    (state.entries || []).forEach(function (entry) {
      if (entry.status !== 'pending') return;
      entry.status = 'cancelled';
      entry.cancelledAt = new Date().toISOString();
      cancelled++;
    });
    if (cancelled) {
      state.status = 'cancelled';
      state.cancelledAt = new Date().toISOString();
      props.setProperty(propertyKey, JSON.stringify(state));
    }
    var deleted = 0;
    ScriptApp.getProjectTriggers().forEach(function (trigger) {
      if (trigger.getHandlerFunction() !== handler) return;
      ScriptApp.deleteTrigger(trigger);
      deleted++;
    });
    try { refreshTargetQueueTabs_(); }
    catch (mirrorError) { Logger.log('Target mirror refresh failed: ' + mirrorError); }
    return {
      status: state.status,
      cancelledPending: cancelled,
      sent: (state.entries || []).filter(function (entry) { return entry.status === 'sent'; }).length,
      deletedTriggers: deleted
    };
  } finally {
    lock.releaseLock();
  }
}

/** Replace the original unsplit 09/10 schedule with the requested two-day split. */
function rescheduleTargetRecruiterCampaignSplit0909() {
  var keys = [
    'TARGET_RECRUITER_CAMPAIGN_20260909_REPLIT_NVIDIA',
    'TARGET_RECRUITER_CAMPAIGN_20260910_REPLIT_NVIDIA',
    'TARGET_RECRUITER_CAMPAIGN_20260910_NVIDIA'
  ];
  var handlers = ['runTargetRecruiterCampaignTick0909_', 'runTargetRecruiterCampaignTick0910_'];
  var props = PropertiesService.getScriptProperties();
  keys.forEach(function (key) { props.deleteProperty(key); });
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (handlers.indexOf(trigger.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(trigger);
  });
  return {
    september9: scheduleTargetRecruiterCampaign0909(),
    september10: scheduleTargetRecruiterCampaign0910()
  };
}

/** Read-only status for both halves of the explicit Target recruiter campaign. */
function diagnoseTargetRecruiterCampaign0910() {
  return [
    ['09/09 — Replit + 5 NVIDIA', 'TARGET_RECRUITER_CAMPAIGN_20260909_REPLIT_NVIDIA'],
    ['09/10 — 5 NVIDIA', 'TARGET_RECRUITER_CAMPAIGN_20260910_NVIDIA'],
    ['09/10 — Google', 'TARGET_RECRUITER_CAMPAIGN_20260910_GOOGLE'],
    ['09/10 — Stripe + NetApp', 'TARGET_RECRUITER_CAMPAIGN_20260910_STRIPE_NETAPP'],
    ['09/11 — NetApp', 'TARGET_RECRUITER_CAMPAIGN_20260911_NETAPP'],
    ['09/14 — Stripe', 'TARGET_RECRUITER_CAMPAIGN_20260914_STRIPE'],
    ['09/14 — Whatnot', 'TARGET_RECRUITER_CAMPAIGN_20260914_WHATNOT'],
    ['09/14 — Motorola Solutions', 'TARGET_RECRUITER_CAMPAIGN_20260914_MOTOROLA_SOLUTIONS'],
    ['09/15 — Cisco', 'TARGET_RECRUITER_CAMPAIGN_20260915_CISCO'],
    ['09/15 — HP + Intuit + Oracle', 'TARGET_RECRUITER_CAMPAIGN_20260915_HP_INTUIT_ORACLE'],
    ['09/15 — Anduril', 'TARGET_RECRUITER_CAMPAIGN_20260915_ANDURIL'],
    ['09/16 — Intel + Atlassian', 'TARGET_RECRUITER_CAMPAIGN_20260916_INTEL_ATLASSIAN'],
    ['09/16 — Atlassian Hunter 4', 'TARGET_RECRUITER_CAMPAIGN_20260916_ATLASSIAN_HUNTER4'],
    ['09/16 — Notion', 'TARGET_RECRUITER_CAMPAIGN_20260916_NOTION'],
    ['09/17 — Dell Technologies', 'TARGET_RECRUITER_CAMPAIGN_20260917_DELL'],
    ['09/17 — Plaid', 'TARGET_RECRUITER_CAMPAIGN_20260917_PLAID'],
    ['09/16 — Datadog', 'TARGET_RECRUITER_CAMPAIGN_20260916_DATADOG'],
    ['09/16 — Dropbox', 'TARGET_RECRUITER_CAMPAIGN_20260921_DROPBOX'],
    ['09/17 — Scale AI', 'TARGET_RECRUITER_CAMPAIGN_20260917_SCALE_AI'],
    ['09/17 — Lyft', 'TARGET_RECRUITER_CAMPAIGN_20260922_LYFT'],
    ['09/18 — Vercel', 'TARGET_RECRUITER_CAMPAIGN_20260918_VERCEL'],
    ['09/18 — Vercel supplement', 'TARGET_RECRUITER_CAMPAIGN_20260918_VERCEL_SUPPLEMENT'],
    ['09/18 — Mastercard', 'TARGET_RECRUITER_CAMPAIGN_20260923_MASTERCARD'],
    ['09/18 — PayPal', 'TARGET_RECRUITER_CAMPAIGN_20260918_PAYPAL'],
    ['09/18 — PayPal supplement', 'TARGET_RECRUITER_CAMPAIGN_20260918_PAYPAL_SUPPLEMENT'],
    ['09/22 — Intuit', 'TARGET_RECRUITER_CAMPAIGN_20260922_INTUIT'],
    ['09/22 — Intuit Hunter supplement', 'TARGET_RECRUITER_CAMPAIGN_20260922_INTUIT_HUNTER_SUPPLEMENT'],
    ['09/22 — Intuit queued remainder', 'TARGET_RECRUITER_CAMPAIGN_20260922_INTUIT_QUEUED_REMAINDER'],
    ['09/24 — Robinhood', 'TARGET_RECRUITER_CAMPAIGN_20260924_ROBINHOOD'],
    ['09/22 — Coinbase', 'TARGET_RECRUITER_CAMPAIGN_20260922_COINBASE'],
    ['09/22 — Walmart', 'TARGET_RECRUITER_CAMPAIGN_20260922_WALMART'],
    ['09/25 — Figma', 'TARGET_RECRUITER_CAMPAIGN_20260925_FIGMA'],
    ['09/25 — Figma supplement', 'TARGET_RECRUITER_CAMPAIGN_20260925_FIGMA_SUPPLEMENT'],
    ['09/25 — Figma supplement 2', 'TARGET_RECRUITER_CAMPAIGN_20260925_FIGMA_SUPPLEMENT2'],
    ['09/18 — Shield AI', 'TARGET_RECRUITER_CAMPAIGN_20260918_SHIELD_AI'],
    ['09/23 — Red Hat', 'TARGET_RECRUITER_CAMPAIGN_20260923_RED_HAT'],
    ['09/23 — DoorDash', 'TARGET_RECRUITER_CAMPAIGN_20260923_DOORDASH'],
    ['09/13 — Off-Target night', 'OFFTARGET_RECRUITER_CAMPAIGN_20260913_NIGHT'],
    ['09/14 — Off-Target early', 'OFFTARGET_RECRUITER_CAMPAIGN_20260914_EARLY']
  ].map(function (spec) {
    var text = PropertiesService.getScriptProperties().getProperty(spec[1]);
    if (!text) return {companies: spec[0], status: 'not-scheduled'};
    return summarizeTargetCampaignState_(JSON.parse(text), spec[0]);
  });
}

/** Read the active applications that can safely anchor the 09/10 Stripe/NetApp cold wave. */
function diagnoseTargetRecruiterCampaign0910StripeNetApp() {
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var apps = targetMirrorApplications_(tracker);
  return ['Stripe', 'NetApp'].map(function (company) {
    var companyTokens = outreachCompanyTokens_(company);
    var matches = apps.filter(function (app) {
      return app.process !== STAGE_REJECTED
        && outreachSameEmployer_(outreachCompanyTokens_(app.company), companyTokens);
    }).map(function (app) {
      return [
        app.role || '(no role)',
        app.link || '(no link)',
        app.dateApplied ? Utilities.formatDate(app.dateApplied, 'America/New_York', 'yyyy-MM-dd') : '',
        app.process || '(no process)'
      ].join(' | ');
    });
    return company + ': ' + (matches.length ? matches.join(' || ') : '(no active application)');
  });
}

/** Read-only status for the changed 09/10 Stripe/NetApp campaign, without contacts. */
function diagnoseTargetRecruiterCampaign0910StripeNetAppState() {
  var text = PropertiesService.getScriptProperties().getProperty(
    'TARGET_RECRUITER_CAMPAIGN_20260910_STRIPE_NETAPP');
  if (!text) return 'not-scheduled';
  var state = JSON.parse(text);
  var companies = {};
  (state.entries || []).forEach(function (entry) {
    var company = entry.company || 'Unknown';
    if (!companies[company]) companies[company] = {};
    var status = entry.status || 'unknown';
    companies[company][status] = (companies[company][status] || 0) + 1;
  });
  return Object.keys(companies).sort().map(function (company) {
    var totals = companies[company];
    return company + ': ' + Object.keys(totals).sort().map(function (status) {
      return status + '=' + totals[status];
    }).join(', ');
  }).join(' | ');
}

/** Addresses reserved by an already-scheduled half, without exposing them in diagnostics. */
function targetRecruiterCampaignEmails_(propertyKey) {
  var text = PropertiesService.getScriptProperties().getProperty(propertyKey);
  if (!text) return [];
  return (JSON.parse(text).entries || []).map(function (entry) {
    return String(entry.email || '').toLowerCase();
  });
}

/** Build and install one explicit Target recruiter campaign. */
function scheduleTargetRecruiterCampaign_(config) {
  var propertyKey = config.propertyKey;
  var handler = config.handler;
  var label = config.label || 'Target recruiter';
  var startMs = new Date(config.startIso).getTime();
  var spacingMinutes = Number(config.spacingMinutes || 10);
  var minGapMinutes = Number(config.minGapMinutes || Math.max(1, spacingMinutes - 1));
  if (new Date().getTime() >= startMs) {
    throw new Error('The recruiter campaign start time has passed.');
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var props = PropertiesService.getScriptProperties();
    var existingText = props.getProperty(propertyKey);
    if (existingText) {
      var existing = JSON.parse(existingText);
      if (existing.status === 'scheduled' || existing.status === 'complete') {
        return {alreadyStarted: true, state: summarizeTargetCampaignState_(existing, label)};
      }
    }
    var handlerTriggers = ScriptApp.getProjectTriggers().filter(function (trigger) {
      return trigger.getHandlerFunction() === handler;
    });
    if (config.reuseExistingTrigger) {
      if (!handlerTriggers.length) {
        throw new Error('The shared Target recruiter trigger is not installed.');
      }
    } else {
      handlerTriggers.forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
    }

    var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
    var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
    var contacts = outreachReadContacts_(contactsBook);
    var spent = targetRecruiterSpentFingerprints_(tracker);
    var salt = outreachProperty_(PROP_SALT, true);
    var excluded = {};
    var included = {};
    (config.excludeEmails || []).forEach(function (email) {
      excluded[String(email || '').toLowerCase()] = true;
    });
    (config.includeEmails || []).forEach(function (email) {
      included[String(email || '').toLowerCase()] = true;
    });
    var selected = config.companies.map(function (spec) {
      var companyContacts = outreachContactsFor_(contacts, spec.company)
        .filter(function (contact) {
          var email = String(contact.email || '').toLowerCase();
          if (Object.keys(included).length && !included[email]) return false;
          if (contact.sent) return false;
          if (excluded[email]) return false;
          var summer = outreachFingerprint_(contact.email, salt, SEASON_SUMMER);
          var offcycle = outreachFingerprint_(contact.email, salt, SEASON_OFFCYCLE);
          if (spent[summer] || spent[offcycle]) return false;
          return !GmailApp.search('from:me to:' + contact.email, 0, 1).length;
        })
        .sort(function (left, right) {
          return (left.name || left.email).localeCompare(right.name || right.email);
        });
      return {spec: spec, people: companyContacts.slice(0, Number(spec.maxContacts || 10))};
    });

    // A recruiter appearing in both company exports still receives one message.
    var used = {};
    selected.forEach(function (group) {
      group.people = group.people.filter(function (person) {
        if (used[person.email]) return false;
        used[person.email] = true;
        return true;
      });
    });

    var entries = [], position = 0, index = 0;
    while (selected.some(function (group) { return index < group.people.length; })) {
      selected.forEach(function (group) {
        if (index >= group.people.length) return;
        var person = group.people[index];
        entries.push({
          company: group.spec.company,
          role: group.spec.role,
          jobLink: group.spec.jobLink,
          name: person.name,
          email: person.email,
          title: person.role || '',
          // Position, not per-company contact ordinal: a one-recruiter-per-
          // company campaign still needs the ten approved templates balanced.
          template: (position % COLD_TEMPLATES.length) + 1,
          atMs: startMs + position * spacingMinutes * 60000,
          status: 'pending'
        });
        position++;
      });
      index++;
    }

    // A bounded owner request may require a minimum/exact wave rather than
    // silently shrinking when a contact was spent between research and setup.
    // Check before persisting state so an undersized campaign cannot later send.
    if (config.exactContacts !== undefined
        && entries.length !== Number(config.exactContacts)) {
      throw new Error('Campaign requires exactly ' + Number(config.exactContacts)
        + ' eligible contacts; found ' + entries.length + '.');
    }

    if (!entries.length) {
      var empty = {status: 'complete', timezone: 'America/New_York',
                   createdAt: new Date().toISOString(), entries: []};
      props.setProperty(propertyKey, JSON.stringify(empty));
      return {scheduled: 0, state: summarizeTargetCampaignState_(empty, label)};
    }

    var state = {
      status: 'scheduled', timezone: 'America/New_York',
      createdAt: new Date().toISOString(), lastSentAtMs: 0,
      spacingMinutes: spacingMinutes, minGapMinutes: minGapMinutes,
      entries: entries
    };
    props.setProperty(propertyKey, JSON.stringify(state));
    if (!config.reuseExistingTrigger) {
      try {
        ScriptApp.newTrigger(handler).timeBased().everyMinutes(1).create();
      } catch (error) {
        props.deleteProperty(propertyKey);
        throw error;
      }
    }
    try { refreshTargetQueueTabs_(); }
    catch (mirrorError) { Logger.log('Target mirror refresh failed: ' + mirrorError); }
    return {
      scheduled: entries.length,
      byCompany: summarizeTargetCampaignState_(state, label).byCompany,
      firstAt: Utilities.formatDate(new Date(entries[0].atMs), 'America/New_York', 'yyyy-MM-dd HH:mm z'),
      lastAt: Utilities.formatDate(new Date(entries[entries.length - 1].atMs), 'America/New_York', 'yyyy-MM-dd HH:mm z'),
      trigger: handler
    };
  } finally {
    lock.releaseLock();
  }
}

/** Safely retime an entirely pending direct Target recruiter campaign. */
function rescheduleTargetRecruiterCampaign_(propertyKey, startIso, expectedCompany) {
  var startMs = new Date(startIso).getTime();
  if (!isFinite(startMs) || new Date().getTime() >= startMs) {
    throw new Error('The new recruiter campaign start time must be in the future.');
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var props = PropertiesService.getScriptProperties();
    var text = props.getProperty(propertyKey);
    if (!text) throw new Error('Recruiter campaign does not exist: ' + propertyKey);
    var state = JSON.parse(text);
    if (state.status !== 'scheduled') {
      throw new Error('Only a scheduled recruiter campaign may be rescheduled.');
    }
    var entries = (state.entries || []).slice().sort(function (left, right) {
      return Number(left.atMs) - Number(right.atMs);
    });
    if (!entries.length || entries.some(function (entry) {
      return entry.status !== 'pending' || (expectedCompany && entry.company !== expectedCompany);
    })) {
      throw new Error('Campaign must contain only pending entries for ' + expectedCompany + '.');
    }
    var spacingMinutes = Number(state.spacingMinutes || 6);
    entries.forEach(function (entry, index) {
      entry.atMs = startMs + index * spacingMinutes * 60000;
    });
    state.entries = entries;
    state.rescheduledAt = new Date().toISOString();
    props.setProperty(propertyKey, JSON.stringify(state));
    try { refreshTargetQueueTabs_(); }
    catch (mirrorError) { Logger.log('Target mirror refresh failed: ' + mirrorError); }
    return {
      company: expectedCompany,
      moved: entries.length,
      firstAt: Utilities.formatDate(new Date(entries[0].atMs), 'America/New_York', 'yyyy-MM-dd HH:mm z'),
      lastAt: Utilities.formatDate(new Date(entries[entries.length - 1].atMs), 'America/New_York', 'yyyy-MM-dd HH:mm z')
    };
  } finally {
    lock.releaseLock();
  }
}

/** Fingerprints already committed by the normal cold queue. */
function targetRecruiterSpentFingerprints_(tracker) {
  var spent = {};
  var queue = tracker.getSheetByName(TAB_QUEUE);
  if (!queue || queue.getLastRow() < 2) return spent;
  queue.getRange(2, 1, queue.getLastRow() - 1, Q_WIDTH).getValues()
    .map(function (row, index) { return outreachParseQueue_(row, index + 2); })
    .forEach(function (row) {
      if (row.fingerprint && STATUS_SPENDS_CONTACT.indexOf(row.status) !== -1) {
        spent[row.fingerprint] = true;
      }
    });
  return spent;
}

/** Public wrapper for the 09/09 Target recruiter every-minute trigger. */
function runTargetRecruiterCampaignTick0909_() {
  return runTargetRecruiterCampaignTickFor_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260909_REPLIT_NVIDIA',
    handler: 'runTargetRecruiterCampaignTick0909_'
  });
}

/** Public wrapper for the 09/10 Target recruiter every-minute trigger. */
function runTargetRecruiterCampaignTick0910_() {
  return runTargetRecruiterCampaignTickFor_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260910_NVIDIA',
    handler: 'runTargetRecruiterCampaignTick0910_'
  });
}

/** Public wrapper for the 09/10 Google Target recruiter every-minute trigger. */
function runTargetRecruiterCampaignTick0910Google_() {
  return runTargetRecruiterCampaignTickFor_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260910_GOOGLE',
    handler: 'runTargetRecruiterCampaignTick0910Google_'
  });
}

/** Public wrapper for the 09/10 Stripe/NetApp Target recruiter every-minute trigger. */
function runTargetRecruiterCampaignTick0910StripeNetApp_() {
  return runTargetRecruiterCampaignTickFor_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260910_STRIPE_NETAPP',
    handler: 'runTargetRecruiterCampaignTick0910StripeNetApp_'
  });
}

/** Public wrapper for the 09/11 NetApp Target recruiter every-minute trigger. */
function runTargetRecruiterCampaignTick0911NetApp_() {
  return runTargetRecruiterCampaignTickFor_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260911_NETAPP',
    handler: 'runTargetRecruiterCampaignTick0911NetApp_'
  });
}

/** Public wrapper for the 09/14 Stripe Target recruiter every-minute trigger. */
function runTargetRecruiterCampaignTick0914Stripe_() {
  return runTargetRecruiterCampaignTickFor_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260914_STRIPE',
    handler: 'runTargetRecruiterCampaignTick0914Stripe_'
  });
}

/** Public wrapper for the 09/14 Whatnot Target recruiter every-minute trigger. */
function runTargetRecruiterCampaignTick0914Whatnot_() {
  return runTargetRecruiterCampaignTickFor_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260914_WHATNOT',
    handler: 'runTargetRecruiterCampaignTick0914Whatnot_'
  });
}

/** Public wrapper for the 09/14 Motorola Solutions Target recruiter every-minute trigger. */
function runTargetRecruiterCampaignTick0914MotorolaSolutions_() {
  return runTargetRecruiterCampaignTickFor_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260914_MOTOROLA_SOLUTIONS',
    handler: 'runTargetRecruiterCampaignTick0914MotorolaSolutions_'
  });
}

/** Public wrapper for the 09/15 Cisco Target recruiter every-minute trigger. */
function runTargetRecruiterCampaignTick0915Cisco_() {
  return runTargetRecruiterCampaignTickFor_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260915_CISCO',
    handler: 'runTargetRecruiterCampaignTick0915Cisco_'
  });
}

/** Send one due HP/Intuit/Oracle Target recruiter entry on 2026-09-15. */
function runTargetRecruiterCampaignTick0915HpIntuitOracle_() {
  return runTargetRecruiterCampaignTickFor_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260915_HP_INTUIT_ORACLE',
    handler: 'runTargetRecruiterCampaignTick0915HpIntuitOracle_'
  });
}

/** Send one due Intel/Atlassian Target recruiter entry on 2026-09-16. */
function runTargetRecruiterCampaignTick0916IntelAtlassian_() {
  return runTargetRecruiterCampaignTickFor_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260916_INTEL_ATLASSIAN',
    handler: 'runTargetRecruiterCampaignTick0916IntelAtlassian_'
  });
}

/** Send one due Dell Target recruiter entry on 2026-09-17. */
function runTargetRecruiterCampaignTick0917Dell_() {
  return runTargetRecruiterCampaignTickFor_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260917_DELL',
    handler: 'runTargetRecruiterCampaignTick0917Dell_'
  });
}

/** Send one due Plaid Target recruiter entry on 2026-09-17. */
function runTargetRecruiterCampaignTick0917Plaid_() {
  return runTargetRecruiterCampaignTickFor_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260917_PLAID',
    handler: 'runTargetRecruiterCampaignTick0917Plaid_'
  });
}

/** Send one due Target recruiter entry and update the Target snapshots. */
function runTargetRecruiterCampaignTickFor_(config) {
  var propertyKey = config.propertyKey;
  var handler = config.handler;
  var stateText = '';
  var state = null;
  var due = null;
  var messageWasSent = false;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return {skipped: true, reason: 'lock busy'};
  try {
    var props = PropertiesService.getScriptProperties();
    stateText = props.getProperty(propertyKey);
    if (!stateText) return {skipped: true, reason: 'state absent'};
    state = JSON.parse(stateText);
    if (state.status !== 'scheduled') return {skipped: true, status: state.status};
    var now = new Date().getTime();
    due = state.entries.filter(function (entry) {
      return entry.status === 'pending' && entry.atMs <= now;
    }).sort(function (left, right) { return left.atMs - right.atMs; })[0];
    if (!due) return {skipped: true, reason: 'nothing due'};
    var minGapMinutes = Number(state.minGapMinutes || 9);
    if (state.lastSentAtMs && now - state.lastSentAtMs < minGapMinutes * 60000) {
      return {skipped: true, reason: 'minimum gap', next: due.email};
    }

    var salt = outreachProperty_(PROP_SALT, true);
    var fingerprints = [
      outreachFingerprint_(due.email, salt, SEASON_SUMMER),
      outreachFingerprint_(due.email, salt, SEASON_OFFCYCLE)
    ];
    if (GmailApp.search('from:me to:' + due.email, 0, 1).length) {
      due.status = 'already-sent';
      due.completedAt = new Date().toISOString();
      outreachMarkColdContactsSent_(fingerprints);
      syncTargetAfterSend_(due.company, 'recruiter');
      state.lastSentAtMs = now;
    } else {
      var rejection = outreachGmailApiRejectedTarget_(due);
      if (rejection.rejected) {
        due.status = 'cancelled';
        due.completedAt = new Date().toISOString();
        due.error = 'Blocked before sending: Gmail API found a matching rejection (' + rejection.why + ').';
        if (!state.entries.some(function (entry) { return entry.status === 'pending'; })) {
          state.status = 'complete';
          state.completedAt = new Date().toISOString();
          if (!config.keepTrigger) {
            ScriptApp.getProjectTriggers().forEach(function (trigger) {
              if (trigger.getHandlerFunction() === handler) ScriptApp.deleteTrigger(trigger);
            });
          }
        }
        props.setProperty(propertyKey, JSON.stringify(state));
        try { refreshTargetQueueTabs_(); }
        catch (mirrorError) { Logger.log('Target mirror refresh failed: ' + mirrorError); }
        return {blocked: true, company: due.company, reason: 'matching Gmail rejection',
                pending: state.entries.filter(function (entry) { return entry.status === 'pending'; }).length};
      }
      var mail = outreachCompose_({
        template: due.template, company: due.company,
        role: due.role, recruiterName: due.name
      });
      var resume = DriveApp.getFileById(OFFICIAL_RESUME_FILE_ID).getBlob()
        .setName('Henry_Nguyen_Resume.pdf');
      GmailApp.sendEmail(due.email, mail.subject, mail.plain, {
        htmlBody: mail.html, inlineImages: mail.inlineImages,
        attachments: [resume], name: SENDER_NAME
      });
      messageWasSent = true;
      var sentMatches = GmailApp.search(
        'in:sent to:' + due.email + ' subject:"' + mail.subject + '"', 0, 1);
      due.messageId = sentMatches.length && sentMatches[0].getMessages().length
        ? sentMatches[0].getMessages()[0].getId() : '';
      due.status = 'sent';
      due.completedAt = new Date().toISOString();
      state.lastSentAtMs = now;
      // Gmail accepted the message; these are best-effort bookkeeping steps.
      outreachMarkColdContactsSent_(fingerprints);
      syncTargetAfterSend_(due.company, 'recruiter');
    }

    if (!state.entries.some(function (entry) { return entry.status === 'pending'; })) {
      state.status = 'complete';
      state.completedAt = new Date().toISOString();
      if (!config.keepTrigger) {
        ScriptApp.getProjectTriggers().forEach(function (trigger) {
          if (trigger.getHandlerFunction() === handler) ScriptApp.deleteTrigger(trigger);
        });
      }
    }
    props.setProperty(propertyKey, JSON.stringify(state));
    try { refreshTargetQueueTabs_(); }
    catch (mirrorError) { Logger.log('Target mirror refresh failed: ' + mirrorError); }
    return {sent: due.status === 'sent', skippedAlreadySent: due.status === 'already-sent',
            company: due.company, name: due.name,
            pending: state.entries.filter(function (entry) { return entry.status === 'pending'; }).length};
  } catch (error) {
    var errorText = String(error.message || error);
    if (messageWasSent && state && due) {
      due.status = 'sent';
      due.error = errorText.slice(0, 250);
      state.lastSentAtMs = new Date().getTime();
      try { PropertiesService.getScriptProperties().setProperty(propertyKey, JSON.stringify(state)); }
      catch (ignoredSent) {}
    } else if (stateText && state) {
      try {
        var failedDue = state.entries.filter(function (entry) {
          return entry.status === 'pending' && entry.atMs <= new Date().getTime();
        }).sort(function (left, right) { return left.atMs - right.atMs; })[0];
        if (failedDue) {
          failedDue.status = 'failed';
          failedDue.error = errorText.slice(0, 250);
          props.setProperty(propertyKey, JSON.stringify(state));
          try { refreshTargetQueueTabs_(); }
          catch (mirrorError) { Logger.log('Target mirror refresh failed: ' + mirrorError); }
        }
      } catch (ignored) {}
    }
    throw error;
  } finally {
    lock.releaseLock();
  }
}

/** One minute trigger that routes the earliest due direct Target recruiter email. */
function runTargetRecruiterSharedTick_() {
  var props = PropertiesService.getScriptProperties().getProperties();
  var earliest = null;
  Object.keys(props).forEach(function (key) {
    if (key.indexOf('TARGET_RECRUITER_CAMPAIGN_') !== 0) return;
    var state;
    try { state = JSON.parse(props[key]); } catch (ignored) { return; }
    if (state.status !== 'scheduled') return;
    var due = (state.entries || []).filter(function (entry) {
      return entry.status === 'pending' && Number(entry.atMs || 0) <= new Date().getTime();
    }).sort(function (left, right) { return Number(left.atMs) - Number(right.atMs); })[0];
    if (due && (!earliest || Number(due.atMs) < Number(earliest.atMs))) {
      earliest = {key: key, atMs: due.atMs};
    }
  });
  if (!earliest) return {skipped: true, reason: 'nothing due'};
  return runTargetRecruiterCampaignTickFor_({
    propertyKey: earliest.key, handler: 'runTargetRecruiterSharedTick_', keepTrigger: true
  });
}

/** Consolidate individual direct-Target recruiter triggers into one safe router. */
function consolidateTargetRecruiterCampaignTriggers() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var props = PropertiesService.getScriptProperties().getProperties();
    var scheduled = Object.keys(props).filter(function (key) {
      if (key.indexOf('TARGET_RECRUITER_CAMPAIGN_') !== 0) return false;
      try { return JSON.parse(props[key]).status === 'scheduled'; }
      catch (ignored) { return false; }
    });
    var deleted = [];
    ScriptApp.getProjectTriggers().forEach(function (trigger) {
      var handler = trigger.getHandlerFunction();
      if (/^runTargetRecruiterCampaignTick.*_$/.test(handler)) {
        ScriptApp.deleteTrigger(trigger);
        deleted.push(handler);
      }
    });
    var hasShared = ScriptApp.getProjectTriggers().some(function (trigger) {
      return trigger.getHandlerFunction() === 'runTargetRecruiterSharedTick_';
    });
    if (scheduled.length && !hasShared) {
      ScriptApp.newTrigger('runTargetRecruiterSharedTick_').timeBased().everyMinutes(1).create();
    }
    return {scheduledCampaigns: scheduled.length, deletedTriggers: deleted.length,
            sharedInstalled: scheduled.length > 0};
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------------- Target queue mirrors

// These headers intentionally mirror the operational queue schemas. Keeping the
// same order means a reviewer can compare a direct Target campaign with the
// normal queue without learning a second layout, while the separate tab name
// keeps the normal workers from treating a mirror as a send instruction.
var TARGET_REFERRAL_HEADERS_ = [
  'Company', 'Role', 'Person', 'Email', 'Title', 'Tier', 'Template', 'Drafted At',
  'Scheduled At', 'Priority', 'Status', 'Mode', 'Cancel', 'Job Link',
  'Gmail Draft ID', 'Sent At', 'Result', 'Last Error', 'Queue ID', 'Version'
];
var TARGET_EMAIL_HEADERS_ = [
  'Company', 'Role', 'Date Applied', 'Property', 'Recruiters', 'Attempt',
  'Template', 'Drafted At', 'Scheduled At', 'Priority', 'Status', 'Mode',
  'Follow Up', 'Follow Up Template', 'Follow Up Status',
  'Contact Fingerprint', 'Gmail Draft ID', 'Gmail Message ID', 'Sent At',
  'Result', 'Last Error', 'Queue ID', 'Version'
];

// Target mirrors are campaign reports, not editable working queues. Keep their
// choices short and make every displayed outcome visibly distinct. A campaign
// entry that was skipped or cancelled did not leave the mailbox, so it reads as
// Failed here rather than exposing a separate Cancelled option.
var TARGET_MIRROR_STATUSES = [
  STATUS_QUEUED, STATUS_DRAFTED, STATUS_SENT, STATUS_REPLIED,
  STATUS_BOUNCED, STATUS_FAILED
];
var TARGET_MIRROR_STATUS_COLOURS = [
  { name: STATUS_QUEUED,  bg: '#EDEDED', fg: '#4A4A4A' },
  { name: STATUS_DRAFTED, bg: '#FFF2CC', fg: '#BF9000' },
  { name: STATUS_SENT,    bg: '#CFE2F3', fg: '#1155CC' },
  { name: STATUS_REPLIED, bg: '#D9EAD3', fg: '#38761D' },
  { name: STATUS_BOUNCED, bg: '#F4CCCC', fg: '#CC0000' },
  { name: STATUS_FAILED,  bg: '#FCE5CD', fg: '#B45F06' }
];

/**
 * Initialize or refresh the two visible mirrors of explicit Target campaigns.
 * This writes no Gmail messages and does not add rows to the operational Email
 * or Referral tabs. The script-property campaign state remains authoritative.
 */
function initializeTargetQueueTabs() {
  return refreshTargetQueueTabs_();
}

/** Refresh Target mirrors after scheduling or a direct-send state transition. */
function refreshTargetQueueTabs_() {
  var referralKeys = targetMirrorCampaignKeys_('TARGET_REFERRAL_CAMPAIGN_');
  var recruiterKeys = targetMirrorCampaignKeys_('TARGET_RECRUITER_CAMPAIGN_').concat(
    targetMirrorCampaignKeys_('OFFTARGET_RECRUITER_CAMPAIGN_'));
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var apps = targetMirrorApplications_(tracker);
  var referralEntries = targetMirrorCampaignEntries_(referralKeys);
  var recruiterEntries = targetMirrorCampaignEntries_(recruiterKeys)
    .concat(microsoftColdDraftMirrorEntries_(apps))
    .sort(function (left, right) { return Number(left.atMs || 0) - Number(right.atMs || 0); });
  var referralRows = referralEntries.map(targetMirrorReferralRow_);
  var emailRows = recruiterEntries.map(function (entry, index) {
    return targetMirrorEmailRow_(entry, index, apps);
  });
  targetMirrorWrite_(tracker, TAB_REFERRAL_TARGET, TARGET_REFERRAL_HEADERS_,
    R_WIDTH, referralRows, 'referral');
  targetMirrorWrite_(tracker, TAB_EMAIL_TARGET, TARGET_EMAIL_HEADERS_,
    Q_WIDTH, emailRows, 'email');
  return {
    referralTarget: {tab: TAB_REFERRAL_TARGET, rows: referralRows.length,
                     byCompany: targetMirrorCounts_(referralEntries)},
    emailTarget: {tab: TAB_EMAIL_TARGET, rows: emailRows.length,
                  byCompany: targetMirrorCounts_(recruiterEntries)}
  };
}

/**
 * Every persisted Target campaign must appear in its visible mirror.
 * Discover keys instead of maintaining a parallel manual registry, so campaign
 * scheduling cannot succeed while the matching `*_target` tab omits it.
 */
function targetMirrorCampaignKeys_(prefix) {
  return Object.keys(PropertiesService.getScriptProperties().getProperties())
    .filter(function (key) { return key.indexOf(prefix) === 0; })
    .sort();
}

/** Read all entries from the explicit campaign properties, hiding no state. */
function targetMirrorCampaignEntries_(propertyKeys) {
  var entries = [];
  propertyKeys.forEach(function (propertyKey) {
    var text = PropertiesService.getScriptProperties().getProperty(propertyKey);
    if (!text) return;
    var state = JSON.parse(text);
    (state.entries || []).forEach(function (entry, index) {
      var copy = {};
      Object.keys(entry).forEach(function (key) { copy[key] = entry[key]; });
      copy.campaignKey = propertyKey;
      copy.campaignIndex = index + 1;
      entries.push(copy);
    });
  });
  return entries.sort(function (left, right) {
    return Number(left.atMs || 0) - Number(right.atMs || 0);
  });
}

/**
 * Include the separately scheduled Microsoft recruiter drafts in Email_target.
 * This pre-dates the Target mirror, so the matching draft body is used once to
 * recover its applied role and persist it in the campaign state.
 */
function microsoftColdDraftMirrorEntries_(apps) {
  var propertyKey = 'MICROSOFT_COLD_DRAFT_SCHEDULE_20260909';
  var props = PropertiesService.getScriptProperties();
  var text = props.getProperty(propertyKey);
  if (!text) return [];
  var state = JSON.parse(text);
  var changed = false;
  var entries = (state.entries || []).map(function (entry, index) {
    if (!entry.role) {
      var app = microsoftColdDraftApplicationForBody_(apps,
        microsoftColdDraftMessageBody_(entry));
      if (app) {
        entry.role = app.role;
        changed = true;
      }
    }
    entry.company = 'Microsoft';
    entry.template = entry.template || ('Microsoft draft ' + String(index + 1));
    entry.campaignKey = propertyKey;
    entry.campaignIndex = index + 1;
    return entry;
  });
  if (changed) props.setProperty(propertyKey, JSON.stringify(state));
  return entries;
}

/** Find a draft first, then its sent counterpart after a slot has run. */
function microsoftColdDraftMessageBody_(entry) {
  var recipient = String(entry.email || '').toLowerCase();
  var subject = String(entry.subject || '');
  var drafts = GmailApp.getDrafts().filter(function (draft) {
    var message = draft.getMessage();
    return String(message.getTo() || '').toLowerCase().indexOf(recipient) >= 0
      && message.getSubject() === subject;
  });
  if (drafts.length) return drafts[0].getMessage().getPlainBody();
  var sent = GmailApp.search('in:sent to:' + recipient + ' subject:"' + subject + '"', 0, 1);
  return sent.length && sent[0].getMessages().length
    ? sent[0].getMessages()[0].getPlainBody() : '';
}

/** Match a Microsoft draft's wording to one active Microsoft application. */
function microsoftColdDraftApplicationForBody_(apps, body) {
  var text = outreachNameKey_(body);
  var best = null;
  apps.filter(function (app) {
    return outreachNameKey_(app.company) === 'microsoft'
      && app.process !== STAGE_REJECTED;
  }).forEach(function (app) {
    var role = outreachNameKey_(app.role);
    var score = 0;
    if (text.indexOf('coreai') >= 0 && role.indexOf('coreai') >= 0) score += 20;
    if (text.indexOf('boston') >= 0 && role.indexOf('boston') >= 0) score += 30;
    if (text.indexOf('mountain view') >= 0 && role.indexOf('mountain view') >= 0) score += 30;
    if (text.indexOf('edge') >= 0 && role.indexOf('edge') >= 0) score += 30;
    if (text.indexOf('ai software engineering') >= 0
        && role.indexOf('ai software engineering') >= 0) score += 15;
    if (!best || score > best.score) best = {app: app, score: score};
  });
  return best && best.score ? best.app : null;
}

function targetMirrorStatus_(status) {
  if (status === 'sent' || status === 'already-sent') return STATUS_SENT;
  if (status === 'bounced') return STATUS_BOUNCED;
  if (status === 'failed' || status === 'cancelled' || status === 'skipped') {
    return STATUS_FAILED;
  }
  return STATUS_QUEUED;
}

function targetMirrorReferralRow_(entry) {
  var row = new Array(R_WIDTH).fill('');
  row[R_COMPANY - 1] = entry.company || '';
  row[R_ROLE - 1] = entry.role || '';
  row[R_PERSON - 1] = entry.name || '';
  row[R_EMAIL - 1] = entry.email || '';
  row[R_TITLE - 1] = entry.title || '';
  row[R_TIER - 1] = outreachReferralTier_(entry.title || '', entry.seniority || '');
  row[R_TEMPLATE - 1] = entry.template || '';
  row[R_SCHEDULED - 1] = entry.atMs ? new Date(entry.atMs) : '';
  row[R_STATUS - 1] = targetMirrorStatus_(entry.status);
  row[R_MODE - 1] = MODE_SEND;
  row[R_CANCEL - 1] = false;
  row[R_JOB_LINK - 1] = entry.jobLink || '';
  row[R_SENT_AT - 1] = entry.completedAt ? new Date(entry.completedAt) : '';
  row[R_RESULT - 1] = entry.messageId || '';
  row[R_ERROR - 1] = entry.error || entry.historyError || entry.targetSyncError || '';
  row[R_ID - 1] = 'TARGET-REF-' + String(entry.campaignKey || '').slice(-8)
    + '-' + String(entry.campaignIndex || '');
  row[R_VERSION - 1] = 1;
  return row;
}

function targetMirrorApplications_(tracker) {
  var app = tracker.getSheetByName(TAB_APP);
  if (!app || app.getLastRow() < 2) return [];
  var width = Math.min(APP_READ_WIDTH, app.getMaxColumns());
  return app.getRange(2, 1, app.getLastRow() - 1, width).getValues()
    .map(function (row, index) { return outreachParseApp_(row, index); })
    .filter(function (row) { return row.company || row.role; });
}

function targetMirrorApplicationFor_(apps, entry) {
  var companyKey = outreachNameKey_(entry.company);
  var roleKey = outreachNameKey_(entry.role);
  var exact = apps.filter(function (app) {
    return outreachNameKey_(app.company) === companyKey
      && outreachNameKey_(app.role) === roleKey;
  });
  if (exact.length) return exact[0];
  var sameCompany = apps.filter(function (app) {
    return outreachNameKey_(app.company) === companyKey
      || outreachSameEmployer_(outreachCompanyTokens_(app.company),
                               outreachCompanyTokens_(entry.company));
  });
  return sameCompany.length ? sameCompany[0] : null;
}

function targetMirrorEmailRow_(entry, index, apps) {
  var app = targetMirrorApplicationFor_(apps, entry);
  var row = new Array(Q_WIDTH).fill('');
  row[Q_COMPANY - 1] = entry.company || '';
  row[Q_ROLE - 1] = entry.role || '';
  row[Q_DATE_APPLIED - 1] = app && app.dateApplied ? app.dateApplied : '';
  row[Q_PROPERTY - 1] = app ? app.property : '';
  row[Q_RECRUITERS - 1] = 1;
  row[Q_ATTEMPT - 1] = 1;
  row[Q_TEMPLATE - 1] = entry.template || '';
  row[Q_SCHEDULED - 1] = entry.atMs ? new Date(entry.atMs) : '';
  row[Q_PRIORITY - 1] = false;
  row[Q_STATUS - 1] = targetMirrorStatus_(entry.status);
  row[Q_MODE - 1] = MODE_SEND;
  row[Q_SENT_AT - 1] = entry.completedAt ? new Date(entry.completedAt) : '';
  row[Q_RESULT - 1] = entry.messageId || '';
  row[Q_ERROR - 1] = entry.error || '';
  row[Q_ID - 1] = 'TARGET-EMAIL-' + String(entry.campaignKey || '').slice(-8)
    + '-' + String(entry.campaignIndex || (index + 1));
  row[Q_VERSION - 1] = 1;
  return row;
}

function targetMirrorCounts_(entries) {
  var counts = {};
  entries.forEach(function (entry) {
    if (!counts[entry.company]) {
      counts[entry.company] = {total: 0, queued: 0, sent: 0, bounced: 0, failed: 0};
    }
    counts[entry.company].total++;
    var status = targetMirrorStatus_(entry.status);
    if (status === STATUS_QUEUED) counts[entry.company].queued++;
    else if (status === STATUS_SENT) counts[entry.company].sent++;
    else if (status === STATUS_BOUNCED) counts[entry.company].bounced++;
    else if (status === STATUS_FAILED) counts[entry.company].failed++;
  });
  return counts;
}

/** Write one generated mirror while preserving its existing formatting. */
function targetMirrorWrite_(tracker, tabName, headers, width, rows, kind) {
  var sheet = tracker.getSheetByName(tabName);
  var created = false;
  if (!sheet) {
    sheet = tracker.insertSheet(tabName);
    created = true;
  }
  if (sheet.getMaxColumns() < width) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
  } else if (created && sheet.getMaxColumns() > width) {
    sheet.deleteColumns(width + 1, sheet.getMaxColumns() - width);
  }
  if (sheet.getMaxRows() > 1) {
    sheet.getRange(2, 1, sheet.getMaxRows() - 1, width).clearContent()
      .clearDataValidations();
  }
  sheet.getRange(1, 1, 1, width).setValues([headers])
    .setFontWeight('bold').setBackground('#d9eaf7')
    .setHorizontalAlignment('center').setWrap(true);
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, width).setValues(rows);
    var timestampColumns = kind === 'referral'
      ? [R_DRAFTED_AT, R_SCHEDULED, R_SENT_AT]
      : [Q_DRAFTED_AT, Q_SCHEDULED, Q_FOLLOWUP_AT, Q_SENT_AT];
    timestampColumns.forEach(function (column) {
      sheet.getRange(2, column, rows.length, 1).setNumberFormat(QUEUE_TIMESTAMP_FORMAT);
    });
    if (kind === 'email') {
      sheet.getRange(2, Q_DATE_APPLIED, rows.length, 1).setNumberFormat(QUEUE_DATE_FORMAT);
    }
    var statusColumn = kind === 'referral' ? R_STATUS : Q_STATUS;
    var modeColumn = kind === 'referral' ? R_MODE : Q_MODE;
    sheet.getRange(2, statusColumn, rows.length, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(
        TARGET_MIRROR_STATUSES, true)
        .setAllowInvalid(false).build());
    sheet.getRange(2, modeColumn, rows.length, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList([MODE_DRAFT, MODE_SEND], true)
        .setAllowInvalid(false).build());
    outreachColourQueueColumn_(sheet, statusColumn, TARGET_MIRROR_STATUS_COLOURS, rows.length);
  }
  sheet.setFrozenRows(1);
}
