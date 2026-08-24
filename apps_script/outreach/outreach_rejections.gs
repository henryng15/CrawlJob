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

// Read as: a sentence containing any of these is somebody declining.
//
// Every phrase here was taken from a real message in this account — 52 of them,
// harvested rather than guessed, and the current lists classify all 52 the way a
// person would. "Unfortunately" is deliberately absent: it opens as many
// delayed-req mails as rejections, and the cost of a wrong Rejected is a live
// application that quietly stops being worked.
var REJECTION_PHRASES = [
  // the standard brush-off, in the dozen shapes ATS templates write it
  'move forward with other candidate', 'moving forward with other candidate',
  'move forward with another candidate', 'forward with other applicant',
  'decided to move forward with other', 'proceed with other candidate',
  'pursue other candidate', 'pursue other applicant', 'chosen to pursue',
  'other applicants whose', 'other candidates whose',
  'continue our search', 'continuing our search',
  // refusals stated about you rather than about the other applicants
  'not to move forward', 'not be moving forward', 'are not moving forward',
  'arent moving forward', 'not moving forward with your',
  'will not be proceeding', 'not to proceed', 'decided not to proceed',
  'unable to proceed with your application', 'not be progressing',
  'no longer under consideration', 'no longer being considered',
  'not been selected', 'was not selected', 'were not selected',
  'not selected to', 'not selected for', 'wasnt selected', 'isnt selected',
  'has not been successful', 'was not successful', 'not be successful',
  'do not meet the minimum', 'does not meet the minimum',
  'regret to inform', 'regret to share', 'regret to let you know',
  'sorry to inform', 'we are unable to offer',
  // the req itself going away, which closes the application just as firmly.
  // Only the spellings that name what went away live here; the bare ones are in
  // REJECTION_PHRASES_NEEDING_SUBJECT below.
  'position has been filled', 'role has been filled', 'we have filled the',
  // the softeners that only ever appear at the end of a no
  'keep your resume on file', 'keep your application on file',
  'wish you the best in your job search', 'best of luck in your search',
  'best of luck with your search'
];

// The same refusals with the noun left out. "has been canceled" is a rejection
// when it is the req that was cancelled and nothing at all when it is a
// subscription — an Overleaf receipt reading "your Digital Science & Research
// Solutions Inc. subscription for Standard monthly has been canceled" was scored
// as a refusal, and only survived because no open application matched the sender.
//
// So these count only when the same sentence also says what was closed. The noun
// has to be in the sentence, not the message: every rejection mentions the
// application somewhere.
var REJECTION_PHRASES_NEEDING_SUBJECT = [
  'has been filled', 'has been canceled', 'has been cancelled',
  'has been closed', 'is now closed'
];

// What those phrases have to be talking about. "account" and "subscription" are
// pointedly absent.
var REJECTION_SUBJECT_NOUNS =
  /\b(position|role|req|requisition|posting|opening|vacancy|job|application|candidacy)\b/;

// An invitation is not a refusal. These are invitations only — deliberately not
// stage nouns like "next round" or "online assessment", because a real rejection
// says "your application was not selected for the next round of interviews" and a
// blocker on that noun would throw the message away.
var REJECTION_BLOCKERS = [
  'schedule an interview', 'schedule a call', 'schedule some time',
  'set up a time', 'book a time', 'invite you to', 'would like to invite',
  'you are invited', 'youre invited', 'pleased to offer', 'happy to offer',
  'offer letter', 'excited to move forward', 'like to move forward with your'
];

// A sentence opening on any of these is describing a hypothetical, not a
// decision. This one guard removed seven false positives in a row: Microsoft
// acknowledgements all carry the line "if you see the job moved to an inactive
// state, that means ... you were not selected for the role", which is an
// explanation of the careers portal and not a word about this application.
var REJECTION_CONDITIONALS =
  /\b(if|should you|unless|in the event|in case|until|when you|once you|whether)\b/;

// The Gmail query prefilter. Wider than the lists above on purpose — its only job
// is to keep the search from returning the whole mailbox, and every thread it
// returns is judged locally afterwards. Six real rejections were missed by an
// earlier, tighter version of this list, so it errs wide.
var REJECTION_QUERY_PHRASES = [
  'move forward with other candidates', 'not to move forward',
  'not be moving forward', 'moving forward with your application',
  'regret to inform', 'regret to share', 'sorry to inform',
  'no longer under consideration', 'not selected', 'has been filled',
  'has been canceled', 'has been cancelled', 'unable to proceed',
  'decided not to proceed', 'minimum qualifications', 'other candidates',
  'update on your application', 'your application status'
];

// ATS plumbing that appears in every sender line and names no employer. Without
// this, a rejection routed through Greenhouse reads as being from a company
// called Greenhouse.
var SENDER_NOISE = [
  'greenhouse', 'greenhousemail', 'lever', 'hire', 'myworkday', 'workday',
  'wd1', 'wd3', 'wd5', 'icims', 'nurture', 'taleo', 'oracle', 'smartrecruiters',
  'workable', 'workablemail', 'candidates', 'jobvite', 'ashbyhq', 'ashby',
  'breezy', 'bamboohr', 'successfactors', 'ns2cloud', 'newtonsoftware', 'echo',
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

// Only the top of a message is read. One real rejection put its refusal past the
// 4,000th character of an 18KB message, so this is generous; the rest is
// signature, legal footer and unsubscribe boilerplate.
var REJECTION_BODY_CHARS = 8000;

// Every thread the search returns gets exactly one of these, so no thread is ever
// judged twice and the search window stays small. They are also the audit trail:
// Check by hand is the pile worth opening on a Sunday.
var LABEL_REJECTED = 'Tracker/Rejected';
var LABEL_CHECK    = 'Tracker/Check by hand';
var LABEL_IGNORED  = 'Tracker/Not a rejection';

// Bump this whenever REJECTION_PHRASES, REJECTION_PHRASES_NEEDING_SUBJECT,
// REJECTION_SUBJECT_NOUNS, REJECTION_BLOCKERS, REJECTION_CONDITIONALS or
// outreachIsRejection_ changes.
//
// A label is what stops a thread being judged twice, and that is also what makes
// a bad run permanent: improved rules would never see the mail the old rules got
// wrong. On the first firing after this number moves, the scan reopens the two
// piles it is allowed to be wrong about — Check by hand, and Not a rejection —
// and judges them again with the new rules.
//
// Tracker/Rejected is deliberately never reopened. Those applications are already
// closed, so re-judging would find no open row to match and would move a correct
// closure into the review pile. That label stays the human's to audit: it is
// short, and every thread in it should read as a refusal at a glance.
var REJECTION_RULES_VERSION = 3;
var PROP_RULES_VERSION = 'REJECTION_RULES_SEEN';

// A reopen needs to remember what it has already been through, and the verdict
// labels cannot do it: a re-judged thread lands straight back under Check by hand
// or Not a rejection, which the reopen query no longer excludes, so it would come
// back on the next firing. With more threads than the scan cap that is not slow
// progress, it is no progress — the same first forty for ever, the rest never
// reached, and the version never recorded because the batch is always full.
//
// This marker is worn only during a reopen and deleted the moment one finishes,
// which is also what makes the next reopen start from a clean sheet.
var LABEL_REJUDGED = 'Tracker/Rejudged';

// ------------------------------------------------------------------ matching

/**
 * Lowercase, apostrophes removed, whitespace collapsed.
 *
 * Apostrophes go rather than being normalised to one shape, so a single phrase
 * matches "wasn't", "wasn\u2019t" and "wasnt". Writing every phrase twice was the
 * alternative, and one of the two spellings was always the one that got missed.
 */
function outreachNormalise_(text) {
  return String(text == null ? '' : text)
    .replace(/[\u2018\u2019']/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function outreachSentences_(text) {
  return text.split(/(?<=[.!?])\s+|\n+/).filter(function (s) { return s.trim(); });
}

/**
 * Whether this message is somebody saying no.
 *
 * Sentence by sentence rather than over the whole body, because the two mistakes
 * that matter are both sentence-shaped:
 *
 *   - a hypothetical. "If you are not selected, you will hear from us" is in half
 *     the acknowledgement mails ever sent, and reads exactly like a refusal to
 *     anything matching on the body as one string.
 *   - a polite closing. A genuine rejection often ends "we invite you to apply
 *     for other openings", so an invitation only overrules a refusal when it
 *     comes *first*. Order is the whole rule: invitation-then-nothing is an
 *     interview, refusal-then-invitation is still a refusal.
 */
/** Whether one sentence, on its own, is a refusal. */
function outreachSentenceRefuses_(sentence) {
  if (REJECTION_PHRASES.some(function (p) { return sentence.indexOf(p) !== -1; })) return true;
  if (!REJECTION_SUBJECT_NOUNS.test(sentence)) return false;
  return REJECTION_PHRASES_NEEDING_SUBJECT.some(function (p) {
    return sentence.indexOf(p) !== -1;
  });
}

function outreachIsRejection_(subject, body) {
  var text = outreachNormalise_(subject + '. ' + String(body || '').slice(0, REJECTION_BODY_CHARS));
  var said = outreachSentences_(text).filter(function (sentence) {
    return !REJECTION_CONDITIONALS.test(sentence);
  });

  var refused = -1, invited = -1;
  for (var i = 0; i < said.length; i++) {
    var sentence = said[i];
    if (refused < 0 && outreachSentenceRefuses_(sentence)) {
      refused = i;
    }
    if (invited < 0 && REJECTION_BLOCKERS.some(function (b) { return sentence.indexOf(b) !== -1; })) {
      invited = i;
    }
  }
  if (refused < 0) return false;
  return invited < 0 || invited > refused;
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
 * The day the rejection was sent, which is the day it happened.
 *
 * Stamping the scan time instead would date every rejection found on a first run
 * to that first run, and the Update column is the one place the shape of a search
 * over months can still be read. A missing or future date falls back to now: a
 * header that cannot be believed is worth less than the hour we are certain of.
 */
function outreachRejectedOn_(sentAt, now) {
  if (!sentAt || Object.prototype.toString.call(sentAt) !== '[object Date]') return now;
  if (isNaN(sentAt.getTime()) || sentAt.getTime() > now.getTime()) return now;
  return sentAt;
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
    if (row.status === STATUS_DRAFTED) outreachDiscardDraft_(row.draftId);
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

function outreachRejectionQuery_(reopen) {
  var phrases = REJECTION_QUERY_PHRASES.map(function (phrase) {
    return '"' + phrase + '"';
  }).join(' OR ');
  var query = 'newer_than:' + REJECTION_WINDOW_DAYS + 'd -in:chats'
            + ' -label:"' + LABEL_REJECTED + '"';
  query += reopen
    ? ' -label:"' + LABEL_REJUDGED + '"'
    : ' -label:"' + LABEL_CHECK + '" -label:"' + LABEL_IGNORED + '"';
  return query + ' (' + phrases + ')';
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

  var props = PropertiesService.getScriptProperties();
  var reopen = Number(props.getProperty(PROP_RULES_VERSION) || 0) < REJECTION_RULES_VERSION;
  var rejudged = reopen ? outreachLabel_(LABEL_REJUDGED) : null;
  var threads = GmailApp.search(outreachRejectionQuery_(reopen), 0, REJECTION_SCAN_LIMIT);
  if (reopen) Logger.log('Rules are newer than the last pass; reopening ' + threads.length + '.');

  threads.forEach(function (thread) {
    var found = null;
    // A reopened thread already carries a verdict from the old rules. Clearing it
    // first is what lets this pass overwrite it rather than stack a second label;
    // the marker is what stops it being handed back on the next firing.
    if (reopen) {
      thread.removeLabel(check);
      thread.removeLabel(ignored);
      thread.addLabel(rejudged);
    }

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
      // The message's own date, not the hour this happened to run. A rejection
      // sat unread for three weeks still happened on the day it was sent, and
      // that is the date the Update column and the Email tab both record.
      found = { from: message.getFrom(), subject: subject, body: body, at: message.getDate() };
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

    tally.cancelled += outreachRecordRejection_(app, queue, target.app, queueRows,
                                                outreachRejectedOn_(found.at, now));
    // The in-memory copy has to move too, or a second rejection for the same
    // employer in this same firing would still see the row as open.
    target.app.process = STAGE_REJECTED;
    thread.addLabel(rejected);
    tally.rejected++;
  });

  // Only once the backlog is drained, because the scan is capped per firing and a
  // reopen usually needs several. Recording the version after the first partial
  // pass would leave most of the mail judged by the rules that were replaced.
  //
  // A short batch is what "drained" means: every thread still owed a second look
  // is excluded by the marker, so the first firing that comes back under the cap
  // is the one that ran out of them.
  if (reopen && threads.length < REJECTION_SCAN_LIMIT) {
    props.setProperty(PROP_RULES_VERSION, String(REJECTION_RULES_VERSION));
    rejudged.deleteLabel();
    Logger.log('Reopen complete; rules version ' + REJECTION_RULES_VERSION + ' recorded.');
  }

  Logger.log('rejected ' + tally.rejected + ' (stopping ' + tally.cancelled + ' emails), '
           + tally.unclear + ' to check by hand, ' + tally.ignored + ' not rejections');
  unclear.forEach(function (line) { Logger.log('  check by hand: ' + line); });
  return tally;
}
