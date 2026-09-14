/**
 * Append-only evidence ledger for cold emails sent outside the normal queue.
 *
 * This is deliberately separate from Email: normal workers never read it, so a
 * history entry can never be drafted or sent again. It records a Gmail-accepted
 * message only after a manual operator identifies it as a cold email.
 */

var EXTERNAL_COLD_HISTORY_HEADERS_ = [
  'Sent At', 'Company', 'Channel', 'Role', 'Job Link', 'Source',
  'Gmail Message ID', 'Recipient Fingerprint', 'Status'
];
var H_SENT_AT = 1, H_COMPANY = 2, H_CHANNEL = 3, H_ROLE = 4, H_JOB_LINK = 5;
var H_SOURCE = 6, H_MESSAGE_ID = 7, H_RECIPIENT_FINGERPRINT = 8, H_STATUS = 9;
var H_WIDTH = EXTERNAL_COLD_HISTORY_HEADERS_.length;

/** Create or repair the sender-owned external cold-email history ledger. */
function initializeOutreachHistory() {
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var sheet = tracker.getSheetByName(TAB_OUTREACH_HISTORY);
  var created = false;
  if (!sheet) {
    sheet = tracker.insertSheet(TAB_OUTREACH_HISTORY);
    created = true;
  }
  if (sheet.getMaxColumns() < H_WIDTH) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), H_WIDTH - sheet.getMaxColumns());
  }
  var header = sheet.getRange(1, 1, 1, H_WIDTH).getValues()[0];
  var populated = header.some(function (value) { return String(value || '').trim(); });
  if (populated && header.join('\u0000') !== EXTERNAL_COLD_HISTORY_HEADERS_.join('\u0000')) {
    throw new Error(TAB_OUTREACH_HISTORY + ' has an unexpected header. It was not changed.');
  }
  sheet.getRange(1, 1, 1, H_WIDTH).setValues([EXTERNAL_COLD_HISTORY_HEADERS_])
    .setFontWeight('bold').setBackground('#d9eaf7').setWrap(true);
  sheet.setFrozenRows(1);
  sheet.getRange('A:A').setNumberFormat(QUEUE_TIMESTAMP_FORMAT);
  return {tab: TAB_OUTREACH_HISTORY, created: created, records: Math.max(0, sheet.getLastRow() - 1)};
}

/** Read append-only external cold-email history; no worker ever uses this as a queue. */
function outreachReadExternalColdHistory_(tracker) {
  var sheet = tracker.getSheetByName(TAB_OUTREACH_HISTORY);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, H_WIDTH).getValues()
    .map(function (row, index) {
      return {
        rowNumber: index + 2,
        sentAt: outreachDate_(row[H_SENT_AT - 1]),
        company: String(row[H_COMPANY - 1] || '').trim(),
        channel: String(row[H_CHANNEL - 1] || '').trim(),
        role: String(row[H_ROLE - 1] || '').trim(),
        jobLink: String(row[H_JOB_LINK - 1] || '').trim(),
        source: String(row[H_SOURCE - 1] || '').trim(),
        messageId: String(row[H_MESSAGE_ID - 1] || '').trim(),
        recipientFingerprint: String(row[H_RECIPIENT_FINGERPRINT - 1] || '').trim(),
        status: String(row[H_STATUS - 1] || '').trim()
      };
    }).filter(function (entry) {
      return entry.company && entry.channel === 'Cold email' && entry.status === 'Sent';
    });
}

/**
 * Record one manual/off-template cold email only after locating its accepted
 * Gmail message. This does not send, draft, or schedule email.
 */
function recordExternalColdEmail(company, recipientEmail, role, jobLink, source) {
  company = String(company || '').trim();
  recipientEmail = String(recipientEmail || '').trim().toLowerCase();
  role = String(role || '').trim();
  jobLink = String(jobLink || '').trim();
  source = String(source || 'Manual external cold email').trim();
  if (!company) throw new Error('Company is required.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
    throw new Error('A valid recipient email is required to verify the Gmail send.');
  }

  var threads = GmailApp.search('from:me to:' + recipientEmail, 0, 50);
  var message = null;
  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (candidate) {
      if (String(candidate.getTo() || '').toLowerCase().indexOf(recipientEmail) < 0) return;
      if (!message || candidate.getDate().getTime() > message.getDate().getTime()) message = candidate;
    });
  });
  if (!message) {
    throw new Error('No sent Gmail message to this recipient was found; nothing was recorded.');
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    initializeOutreachHistory();
    var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
    var history = outreachReadExternalColdHistory_(tracker);
    var duplicate = history.filter(function (entry) { return entry.messageId === message.getId(); })[0];
    if (duplicate) return {alreadyRecorded: true, company: duplicate.company, sentAt: duplicate.sentAt};

    var fingerprint = outreachFingerprint_(recipientEmail, outreachProperty_(PROP_SALT, true), SEASON_SUMMER);
    var sheet = tracker.getSheetByName(TAB_OUTREACH_HISTORY);
    sheet.appendRow([
      message.getDate(), company, 'Cold email', role, jobLink, source,
      message.getId(), fingerprint, 'Sent'
    ]);
    try {
      outreachMarkColdContactsSent_([fingerprint]);
      syncTargetAfterSend_(company, 'recruiter');
    } catch (syncError) {
      Logger.log('External cold email recorded but contact/Target sync failed: '
        + String(syncError.message || syncError));
    }
    return {
      alreadyRecorded: false, company: company,
      sentAt: Utilities.formatDate(message.getDate(), 'America/New_York', 'yyyy-MM-dd HH:mm'),
      messageId: message.getId()
    };
  } finally {
    lock.releaseLock();
  }
}
