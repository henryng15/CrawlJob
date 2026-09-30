/**
 * outreach_qualcomm_betty_followup_0929.gs — one reply to Betty Vallar at Qualcomm tonight, on the
 * strength of Steph Savitz's away message naming her for intern questions.
 *
 * Owner request on 2026-09-29, after Steph Savitz (Qualcomm Campus Recruiting Lead) auto-replied to
 * tonight's 22:16 ET cold email: find Betty and write to her tonight.
 *
 * This is a **reply on the existing thread, not a new cold email**, because Betty was already cold-
 * emailed on 2026-09-24 at 15:29 ET, subject "SWE student: AI, cloud, and backend systems". She has
 * not answered and nothing bounced. Sending a fresh cold message would be a duplicate, and the
 * shared sender's duplicate guard would refuse it anyway.
 *
 * What makes tonight's note worth sending is new information rather than a nudge: Steph's away
 * message routes "Summer intern program and all intern-related questions" to Betty by name.
 *
 * Steph's message says she is on leave 2026-07-03 through 2026-09-25 — a window that closed four
 * days ago while the auto-reply still fires, so either she has not turned it off or the leave ran
 * long. Either way Betty is the named contact, and the 10-01 Qualcomm follow-up to Andrew Cordisco
 * in outreach_university_followups_1001.gs is untouched by this.
 *
 * Address: `bvallar@qualcomm.com`, BounceBan deliverable 99 on an accept-all domain, and the
 * address the 09-24 message already reached.
 */

var QUALCOMM_BETTY_0929_KEY_ = 'UNIVERSITY_FOLLOWUPS_20260929_QUALCOMM_BETTY';
var QUALCOMM_BETTY_0929_HANDLER_ = 'runQualcommBettyFollowUp20260929_';
var QUALCOMM_BETTY_0929_COMPANY_ = {
  name: 'Qualcomm',
  domain: 'qualcomm.com',
  role: 'Software Engineering Internship - Summer 2027',
  jobLink: 'https://qualcomm.eightfold.ai/careers?jr_id=6aadbe8a2e757fcb5c8ba2ca&start=0&pid=446720740529&sort_by=timestamp',
  sentAfter: '2026/09/23'
};
var QUALCOMM_BETTY_0929_PERSON_ = {
  company: 'Qualcomm', name: 'Betty Vallar', greeting: 'Betty', email: 'bvallar@qualcomm.com',
  title: 'Talent Acquisition Specialist, Senior',
  at: '2026-09-29T23:00:00-04:00',
  note: "Steph Savitz's away message points intern questions to you, so I wanted to bring my note "
    + "below to your attention. I applied to Qualcomm's Software Engineering Internship for Summer "
    + "2027 on September 19 and would be glad of any pointer on who owns that pipeline.",
  close: 'Thanks for your time,'
};

// Matched anywhere in the subject: Qualcomm's own out-of-office is what started this.
var QUALCOMM_BETTY_0929_AUTOREPLY_ =
  /(automatic reply|auto(matic)?[- ]?reply|out of (the )?office|on leave|on vacation|vacation \/|\booo\b|away from (my )?(desk|email|office))/i;

function qualcommBetty0929Body_() {
  var person = QUALCOMM_BETTY_0929_PERSON_;
  return ['Hi ' + person.greeting + ',', '', person.note, '', person.close, SENDER_NAME].join('\n');
}

/** The first message this account sent to Betty since the cut-off, or null. */
function qualcommBetty0929Original_() {
  var person = QUALCOMM_BETTY_0929_PERSON_;
  var threads = GmailApp.search('in:sent to:' + person.email + ' after:'
    + QUALCOMM_BETTY_0929_COMPANY_.sentAfter, 0, 5);
  for (var t = 0; t < threads.length; t++) {
    var messages = threads[t].getMessages();
    for (var m = 0; m < messages.length; m++) {
      if (String(messages[m].getTo() || '').toLowerCase().indexOf(person.email) >= 0) return messages[m];
    }
  }
  return null;
}

/**
 * Why Qualcomm counts as having answered, or '' if it has not. Betty's own thread is what matters
 * here; a company-wide test would read Steph's out-of-office as an answer on a bad day, and that
 * message is the reason this send exists.
 */
function qualcommBetty0929Answered_() {
  var me = String(Session.getActiveUser().getEmail() || 'hoanng15.work@gmail.com').toLowerCase();
  var original = qualcommBetty0929Original_();
  if (!original) return '';
  var others = original.getThread().getMessages().filter(function (message) {
    var from = String(message.getFrom() || '').toLowerCase();
    return from.indexOf(me) < 0 && !/mailer-daemon|postmaster/.test(from)
      && !QUALCOMM_BETTY_0929_AUTOREPLY_.test(String(message.getSubject() || ''));
  });
  return others.length ? 'reply on the Betty Vallar thread' : '';
}

/** Store the one follow-up and install its one-off trigger. */
function scheduleQualcommBettyFollowUp20260929() {
  var props = PropertiesService.getScriptProperties();
  var existing = props.getProperty(QUALCOMM_BETTY_0929_KEY_);
  if (existing && JSON.parse(existing).status !== 'cancelled') return {alreadyScheduled: JSON.parse(existing)};
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === QUALCOMM_BETTY_0929_HANDLER_) ScriptApp.deleteTrigger(trigger);
  });
  var person = QUALCOMM_BETTY_0929_PERSON_;
  var state = {status: 'scheduled', createdAt: new Date().toISOString(),
    entries: [{company: person.company, name: person.name, email: person.email,
               title: person.title, atMs: new Date(person.at).getTime(), status: 'pending'}]};
  props.setProperty(QUALCOMM_BETTY_0929_KEY_, JSON.stringify(state));
  ScriptApp.newTrigger(QUALCOMM_BETTY_0929_HANDLER_).timeBased()
    .at(new Date(state.entries[0].atMs)).create();
  return {scheduled: person.name + ' '
    + Utilities.formatDate(new Date(state.entries[0].atMs), 'America/New_York', 'yyyy-MM-dd HH:mm z')};
}

/** One-off trigger: send the reply if the guards still allow it. */
function runQualcommBettyFollowUp20260929_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return {skipped: true, reason: 'lock busy'};
  try {
    var props = PropertiesService.getScriptProperties();
    var text = props.getProperty(QUALCOMM_BETTY_0929_KEY_);
    if (!text) return {skipped: true, reason: 'state absent'};
    var state = JSON.parse(text);
    if (state.status !== 'scheduled') return {skipped: true, status: state.status};
    var now = new Date().getTime();
    var due = state.entries.filter(function (entry) {
      return entry.status === 'pending' && entry.atMs <= now + 60000;
    })[0];
    if (due) {
      var spec = QUALCOMM_BETTY_0929_COMPANY_;
      var answered = qualcommBetty0929Answered_();
      var rejection = answered ? {rejected: false}
        : outreachGmailApiRejectedTarget_({company: spec.name, role: spec.role, jobLink: spec.jobLink});
      if (answered) { due.status = 'cancelled'; due.reason = 'answered: ' + answered; }
      else if (rejection.rejected) { due.status = 'cancelled'; due.reason = 'Gmail rejection: ' + rejection.why; }
      else {
        var original = qualcommBetty0929Original_();
        var bounced = original && original.getThread().getMessages().some(function (message) {
          return /mailer-daemon|postmaster/i.test(String(message.getFrom() || ''));
        });
        if (!original) { due.status = 'skipped'; due.reason = 'original email not found'; }
        else if (bounced) { due.status = 'skipped'; due.reason = 'original email bounced'; }
        else {
          var sent = outreachSendFollowUp_(original, due.email, qualcommBetty0929Body_());
          due.status = 'sent';
          due.sentAt = new Date().toISOString();
          due.messageId = sent && sent.id;
        }
      }
    }
    if (!state.entries.some(function (entry) { return entry.status === 'pending'; })) {
      state.status = 'complete';
      ScriptApp.getProjectTriggers().forEach(function (trigger) {
        if (trigger.getHandlerFunction() === QUALCOMM_BETTY_0929_HANDLER_) ScriptApp.deleteTrigger(trigger);
      });
    }
    props.setProperty(QUALCOMM_BETTY_0929_KEY_, JSON.stringify(state));
    return {handled: due ? due.email + ' ' + due.status : 'nothing due', state: state.status};
  } finally {
    lock.releaseLock();
  }
}

/** Read-only: state, trigger count, the answer check, the original found and the body. */
function diagnoseQualcommBettyFollowUp20260929() {
  var text = PropertiesService.getScriptProperties().getProperty(QUALCOMM_BETTY_0929_KEY_);
  var original = qualcommBetty0929Original_();
  return {
    state: text ? JSON.parse(text) : null,
    triggers: ScriptApp.getProjectTriggers().filter(function (trigger) {
      return trigger.getHandlerFunction() === QUALCOMM_BETTY_0929_HANDLER_;
    }).length,
    answeredNow: qualcommBetty0929Answered_() || 'no',
    original: original ? original.getSubject() + ' (' + original.getDate() + ')' : 'not found',
    body: qualcommBetty0929Body_()
  };
}

/** Cancel the still-pending reply and remove the trigger. Safe to re-run. */
function cancelQualcommBettyFollowUp20260929() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === QUALCOMM_BETTY_0929_HANDLER_) ScriptApp.deleteTrigger(trigger);
  });
  var props = PropertiesService.getScriptProperties();
  var text = props.getProperty(QUALCOMM_BETTY_0929_KEY_);
  if (!text) return {cancelled: 0};
  var state = JSON.parse(text), cancelled = 0;
  state.entries.forEach(function (entry) {
    if (entry.status === 'pending') { entry.status = 'cancelled'; entry.reason = 'owner'; cancelled++; }
  });
  state.status = 'cancelled';
  props.setProperty(QUALCOMM_BETTY_0929_KEY_, JSON.stringify(state));
  return {cancelled: cancelled};
}
