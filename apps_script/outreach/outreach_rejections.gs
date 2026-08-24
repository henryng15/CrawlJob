/**
 * Outreach — reading rejections out of the mailbox.
 *
 * The sending account receives the rejections, so the same project that writes
 * the cold emails is the only one that can see them without a second credential.
 * When one is recognised it does two things: marks the application Rejected in
 * App, and calls off every email still in flight for it — including deleting a
 * draft that is already sitting in Gmail waiting for its hour.
 *
 * This is the one place the outreach project writes to the App tab. It earns it:
 * the alternative is a cold email going out the morning after the rejection
 * arrived, which is the single worst thing this system could do.
 *
 * Everything that decides is a pure function over {from, subject, body} and the
 * App rows, so the matching can be argued with in the harness. Only
 * scanRejectionEmails() touches Gmail or the sheet.
 */

// ------------------------------------------------------------------ language

// Read as: any of these phrases means the sender is saying no. They are matched
// against subject + body, lowercased, with the curly quotes ATS templates use
// folded back to straight ones.
//
// Every phrase here is one a human would only write to decline. "Unfortunately"
// is deliberately NOT among them: it opens as many "unfortunately this req is
// delayed" mails as it does rejections, and the cost of a wrong Rejected is an
// application that quietly stops being worked.
var REJECTION_PHRASES = [
  'move forward with other candidates',
  'moving forward with other candidates',
  'move forward with another candidate',
  'proceed with other candidates',
  'pursue other candidates',
  'other applicants whose',
  'not to move forward',
  'not be moving forward',
  'will not be moving forward',
  'not moving forward with your',
  'decided not to proceed',
  'will not be proceeding',
  'not be progressing',
  'no longer under consideration',
  'not selected for',
  'were not selected',
  'was not successful',
  'not be successful',
  'regret to inform',
  'we are unable to offer',
  'position has been filled',
  'role has been filled',
  'we have filled the',
  'keep your resume on file',
  'keep your application on file',
  'wish you the best in your job search',
  'best of luck in your search',
  'best of luck with your search'
];

// Found anywhere, these outrank the list above. A message that also invites you
// to something is not a rejection however it is worded, and "we regret that the
// interview must move" is a reschedule.
var REJECTION_BLOCKERS = [
  'schedule an interview', 'schedule a call', 'set up a time', 'book a time',
  'invite you to', 'would like to invite', 'move to the next', 'next round',
  'online assessment', 'coding challenge', 'take home', 'offer letter',
  'congratulations', 'pleased to offer', 'happy to offer'
];

// The Gmail query prefilter. Wider than the list above on purpose — its only job
// is to keep the search from returning the whole mailbox, and every thread it
// returns is then judged locally by outreachIsRejection_.
var REJECTION_QUERY_PHRASES = [
  'move forward with other candidates', 'not to move forward',
  'not be moving forward', 'regret to inform', 'no longer under consideration',
  'not selected', 'has been filled', 'other candidates', 'your application'
];

// ATS plumbing that appears in every sender line and names no employer. Without
// this, a rejection routed through Greenhouse reads as being from a company
// called Greenhouse.
var SENDER_NOISE = [
  'greenhouse', 'greenhousemail', 'lever', 'hire', 'myworkday', 'workday',
  'wd1', 'wd3', 'wd5', 'icims', 'taleo', 'oracle', 'smartrecruiters', 'workable',
  'jobvite', 'ashbyhq', 'ashby', 'breezy', 'bamboohr', 'successfactors',
  'recruiting', 'recruitment', 'careers', 'career', 'jobs', 'job', 'talent',
  'noreply', 'no', 'reply', 'donotreply', 'mail', 'email', 'notification',
  'notifications', 'team', 'hello', 'info', 'apply', 'application', 'applications',
  'com', 'net', 'org', 'io', 'us', 'eu', 'uk', 'ai', 'app'
];

// Words a role title shares with every other role title, dropped before the two
// are compared. Summer/Fall and the year are deliberately kept: they are usually
// the only thing telling two intern reqs at one company apart.
var ROLE_NOISE = [
  'the', 'and', 'for', 'with', 'our', 'you', 'your', 'role', 'position', 'job',
  'opening', 'req', 'requisition', 'posting'
];

// How much of a role title has to be named before a rejection is pinned to one
// of several open roles at the same employer.
var ROLE_MATCH_FLOOR = 0.5;

// How far back to look, and how many threads to judge in one firing. Both are
// about bounding the work, not about correctness: a thread missed by the cap is
// picked up on the next firing, because nothing is labelled until it is judged.
var REJECTION_WINDOW_DAYS = 45;
var REJECTION_SCAN_LIMIT = 40;

// Only the top of a message is read. Rejection language is always in the first
// paragraph, and the rest is signature, legal footer and unsubscribe boilerplate
// that only adds words for the company matcher to trip over.
var REJECTION_BODY_CHARS = 4000;

// Every thread the search returns gets exactly one of these, so no thread is ever
// judged twice and the search window stays small. They are also the audit trail:
// Check by hand is the pile worth opening on a Sunday.
var LABEL_REJECTED = 'Tracker/Rejected';
var LABEL_CHECK    = 'Tracker/Check by hand';
var LABEL_IGNORED  = 'Tracker/Not a rejection';

// ------------------------------------------------------------------ matching

function outreachNormalise_(text) {
  return String(text == null ? '' : text)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Whether this message is somebody saying no. */
function outreachIsRejection_(subject, body) {
  var text = outreachNormalise_(subject + ' ' + String(body || '').slice(0, REJECTION_BODY_CHARS));
  if (!text.trim()) return false;
  var blocked = REJECTION_BLOCKERS.some(function (phrase) {
    return text.indexOf(phrase) !== -1;
  });
  if (blocked) return false;
  return REJECTION_PHRASES.some(function (phrase) { return text.indexOf(phrase) !== -1; });
}

/**
 * The distinct words in a piece of text, the same way a company name is broken up.
 *
 * Distinct because every use here is a set question — is this word present, is
 * every word of the company name present — and because a display name that
 * repeats the address ("Databricks <databricks@…>") would otherwise weigh twice.
 */
function outreachTextTokens_(text) {
  var seen = {};
  outreachNameKey_(text).split(' ').forEach(function (word) {
    if (word) seen[word] = true;
  });
  return Object.keys(seen);
}

/**
 * The words in a From line that could name an employer.
 *
 * '"Stripe Recruiting" <no-reply@us.greenhouse-mail.io>' gives ['stripe'], because
 * everything else in that line is either the ATS or the word "recruiting".
 */
function outreachSenderTokens_(from) {
  var text = String(from == null ? '' : from);
  var angle = text.indexOf('<');
  var display = angle === -1 ? '' : text.slice(0, angle);
  var address = angle === -1 ? text : text.slice(angle + 1).replace(/>/g, '');
  return outreachTextTokens_(display + ' ' + address).filter(function (word) {
    return SENDER_NOISE.indexOf(word) === -1 && COMPANY_NOISE.indexOf(word) === -1
        && !/^\d+$/.test(word);
  });
}

/** How much of a role title this text actually names, 0 to 1. */
function outreachRoleScore_(role, text) {
  var wanted = outreachTextTokens_(role).filter(function (word) {
    return word.length > 2 && ROLE_NOISE.indexOf(word) === -1;
  });
  if (!wanted.length) return 0;
  var have = {};
  outreachTextTokens_(text).forEach(function (word) { have[word] = true; });
  var hit = wanted.filter(function (word) { return have[word]; }).length;
  return hit / wanted.length;
}

/**
 * Which open application this rejection is about, or nothing and why not.
 *
 * The employer is matched on the sender line and the subject only. The body is
 * read for the rejection language and for telling two roles apart, but never for
 * naming the employer: bodies mention partners, tools and job boards, and one
 * stray "Stripe" in a footer would close an application at Stripe.
 *
 * Two things stop a write, and both are silence rather than a guess:
 *   - more than one employer matches, so the sender is ambiguous
 *   - one employer, several roles open there, and the email names none of them
 *
 * Marking the wrong row Rejected takes a live application out of the queue for
 * good, and nothing downstream would ever question it. A pile of threads labelled
 * "Check by hand" is the cheaper failure by a wide margin.
 */
function outreachRejectionTarget_(message, appRows) {
  var open = appRows.filter(function (row) {
    return row.process === QUALIFYING_PROCESS && row.company;
  });
  if (!open.length) return { app: null, why: 'no application is still open' };

  var pin = outreachSenderTokens_(message.from)
    .concat(outreachTextTokens_(message.subject));

  var byCompany = {};
  open.forEach(function (row) {
    var tokens = outreachCompanyTokens_(row.company);
    if (!outreachSameEmployer_(tokens, pin)) return;
    var key = tokens.join(' ');
    if (!byCompany[key]) byCompany[key] = [];
    byCompany[key].push(row);
  });

  var keys = Object.keys(byCompany);
  if (!keys.length) return { app: null, why: 'no open application matches the sender' };
  if (keys.length > 1) {
    return { app: null, why: 'the sender matches ' + keys.length + ' different employers' };
  }

  var rows = byCompany[keys[0]];
  if (rows.length === 1) return { app: rows[0], why: '' };

  var text = message.subject + ' ' + String(message.body || '').slice(0, REJECTION_BODY_CHARS);
  var scored = rows.map(function (row) {
    return { row: row, score: outreachRoleScore_(row.role, text) };
  }).sort(function (a, b) { return b.score - a.score; });

  if (scored[0].score >= ROLE_MATCH_FLOOR && scored[0].score > scored[1].score) {
    return { app: scored[0].row, why: '' };
  }
  return { app: null, why: rows.length + ' roles are open there and the email names none' };
}

// -------------------------------------------------------------------- writing

function outreachStamp_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), UPDATE_DATE_FORMAT);
}

/**
 * The stage named by the last line of the Update cell that names one.
 *
 * The Python audit reads the cell exactly this way and reports UNLOGGED when the
 * bottom line disagrees with Process, so a line appended here has to be the last
 * one — and appending a second Rejected under an existing one is what would make
 * it disagree.
 */
function outreachLastStage_(cell) {
  var lines = String(cell == null ? '' : cell).split('\n');
  for (var i = lines.length - 1; i >= 0; i--) {
    var stage = lines[i].split(':')[0].trim();
    if (stage) return stage;
  }
  return '';
}

/**
 * Write the rejection to both tabs.
 *
 * The App tab gets Process and a dated line in Update. onEdit does that line when
 * a human picks the dropdown, but a simple trigger does not fire for a write from
 * another script — so without doing it here the history would silently stop
 * matching Process, which is precisely what audit_app reports as UNLOGGED.
 */
function outreachRecordRejection_(app, queue, appRow, queueRows, when) {
  app.getRange(appRow.rowNumber, APP_PROCESS, 1, 1).setValue(STAGE_REJECTED);

  var cell = app.getRange(appRow.rowNumber, APP_UPDATE, 1, 1);
  var history = String(cell.getValue() == null ? '' : cell.getValue()).replace(/\s+$/, '');
  if (outreachLastStage_(history).toLowerCase() !== STAGE_REJECTED.toLowerCase()) {
    cell.setValue((history ? history + '\n' : '') + STAGE_REJECTED + ': ' + outreachStamp_(when))
        .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  }

  // Anything still in flight for this application is called off. A Drafted row is
  // the urgent one: its message is already addressed and sitting in Gmail, an
  // hour from going out to a company that has just said no.
  var stopped = 0;
  queueRows.forEach(function (row) {
    if (row.property !== appRow.property) return;
    if (row.status !== STATUS_QUEUED && row.status !== STATUS_DRAFTED) return;
    if (row.status === STATUS_DRAFTED && row.draftId) {
      try {
        GmailApp.getDraft(row.draftId).deleteDraft();
      } catch (error) {
        // Already gone is the outcome we wanted anyway.
      }
    }
    var updates = {};
    updates[Q_STATUS] = STATUS_CANCELLED;
    updates[Q_RESULT] = 'Rejected on ' + outreachStamp_(when) + '; nothing further goes out.';
    outreachWriteRow_(queue, row.rowNumber, updates);
    stopped++;
  });
  return stopped;
}

function outreachLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function outreachRejectionQuery_() {
  var phrases = REJECTION_QUERY_PHRASES.map(function (phrase) {
    return '"' + phrase + '"';
  }).join(' OR ');
  return 'newer_than:' + REJECTION_WINDOW_DAYS + 'd -in:chats'
       + ' -label:"' + LABEL_REJECTED + '"'
       + ' -label:"' + LABEL_CHECK + '"'
       + ' -label:"' + LABEL_IGNORED + '"'
       + ' (' + phrases + ')';
}

/**
 * Read the mailbox for rejections and act on the ones that can be pinned down.
 *
 * Every thread the search returns leaves with exactly one label, so no thread is
 * ever read twice and the search window cannot silt up. Threads that could not be
 * pinned to one application are labelled rather than guessed at, and that label is
 * the whole review surface: open it when there is a minute.
 */
function scanRejectionEmails() {
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var app = tracker.getSheetByName(TAB_APP);
  var queue = tracker.getSheetByName(TAB_QUEUE);
  var tally = { rejected: 0, cancelled: 0, unclear: 0, ignored: 0 };

  var appLast = app.getLastRow();
  if (appLast < 2) return tally;
  var appRows = app.getRange(2, 1, appLast - 1, APP_RECRUITERS).getValues().map(outreachParseApp_);

  var queueLast = queue.getLastRow();
  var queueRows = queueLast < 2 ? []
    : queue.getRange(2, 1, queueLast - 1, Q_WIDTH).getValues().map(outreachParseQueue_);

  var me = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  var rejected = outreachLabel_(LABEL_REJECTED);
  var check = outreachLabel_(LABEL_CHECK);
  var ignored = outreachLabel_(LABEL_IGNORED);
  var now = new Date();
  var unclear = [];

  GmailApp.search(outreachRejectionQuery_(), 0, REJECTION_SCAN_LIMIT).forEach(function (thread) {
    var found = null;

    thread.getMessages().forEach(function (message) {
      if (found) return;
      // Our own cold email is in this thread and contains none of the language;
      // skipping it anyway keeps a quoted reply from being read as ours. The
      // guard on `me` matters: indexOf('') is 0, so an account this call could
      // not name would otherwise skip every message in the mailbox.
      if (me && String(message.getFrom() || '').toLowerCase().indexOf(me) !== -1) return;
      var subject = message.getSubject();
      var body = message.getPlainBody();
      if (!outreachIsRejection_(subject, body)) return;
      found = { from: message.getFrom(), subject: subject, body: body };
    });

    if (!found) {
      thread.addLabel(ignored);
      tally.ignored++;
      return;
    }

    var target = outreachRejectionTarget_(found, appRows);
    if (!target.app) {
      thread.addLabel(check);
      tally.unclear++;
      unclear.push(found.subject + ' — ' + target.why);
      return;
    }

    tally.cancelled += outreachRecordRejection_(app, queue, target.app, queueRows, now);
    // The in-memory copy has to move too, or a second rejection for the same
    // employer in this same firing would still see the row as open.
    target.app.process = STAGE_REJECTED;
    thread.addLabel(rejected);
    tally.rejected++;
  });

  Logger.log('rejected ' + tally.rejected + ' (stopping ' + tally.cancelled + ' emails), '
           + tally.unclear + ' to check by hand, ' + tally.ignored + ' not rejections');
  unclear.forEach(function (line) { Logger.log('  check by hand: ' + line); });
  return tally;
}
