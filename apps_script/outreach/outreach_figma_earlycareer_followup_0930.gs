/**
 * outreach_figma_earlycareer_followup_0930.gs — one follow-up to Figma's early-career recruiter
 * Shelley H., on the morning of 2026-09-30.
 *
 * Owner request on 2026-09-29: also reply to the early-career recruiter first emailed in the
 * 09-21 Figma wave. Of those ten recipients only `shelley@figma.com` is an Early Career
 * Recruiter; the other nine are technical recruiters, sourcers or recruiting directors, so they
 * are out of scope here.
 *
 * Timing: 10:40 ET, which is after the 09-30 gap wave (09:00–10:24) and before the 11:00
 * early-career top-up. The day stood at 54 Target messages, so this makes 55 and needs no
 * over-55 acknowledgement.
 *
 * Rules are the same as outreach_followup.gs and the 10-01 university follow-ups: one plain-text
 * reply on the original thread, no attachment, two sentences. A reply from Figma, Figma mail, or a
 * matching Gmail rejection cancels it; a bounced or missing original skips it.
 *
 * One deliberate difference from outreach_university_followups_1001.gs: its automatic-reply
 * pattern is anchored at the start of the subject, which would read Figma's live
 * "Vacation / Out of Office Re: ..." bounce-back as a human answer and silently cancel this
 * follow-up. The pattern below matches anywhere in the subject. The cost of the looser test is a
 * nudge sent to someone who did answer while away; the cost of the tighter one is never nudging
 * at all, which is the failure the 09-28 Qualcomm note already recorded.
 *
 * The 2026-09-13 "Update from Figma" decline names Software Engineer Intern (Winter 2027), a
 * different application from the active Summer 2027 one confirmed on 09-14.
 */

var FIGMA_EARLYCAREER_FOLLOWUP_0930_KEY_ = 'UNIVERSITY_FOLLOWUPS_20260930_FIGMA_EARLYCAREER';
var FIGMA_EARLYCAREER_FOLLOWUP_0930_HANDLER_ = 'runFigmaEarlyCareerFollowUp20260930_';
var FIGMA_EARLYCAREER_FOLLOWUP_0930_COMPANY_ = {
  name: 'Figma',
  domain: 'figma.com',
  role: 'Software Engineer Intern (Summer 2027)',
  jobLink: 'https://job-boards.greenhouse.io/figma/jobs/6143238004',
  sentAfter: '2026/09/20'
};
var FIGMA_EARLYCAREER_FOLLOWUP_0930_PERSON_ = {
  company: 'Figma', name: 'Shelley H.', greeting: 'Shelley', email: 'shelley@figma.com',
  title: 'Early Career Recruiter',
  at: '2026-09-30T10:40:00-04:00',
  note: "Coming back to this once, in case it slipped past a busy week. I'm still very interested in "
    + "Figma's Software Engineer Intern role for Summer 2027, and if someone else on the early "
    + "career team owns the req, a name is plenty.",
  close: 'Have a good rest of your week,'
};

// Anywhere in the subject, not just at the start: Figma's own bounce-back reads
// "Vacation / Out of Office Re: ...".
var FIGMA_EARLYCAREER_FOLLOWUP_0930_AUTOREPLY_ =
  /(automatic reply|auto(matic)?[- ]?reply|out of (the )?office|on vacation|vacation \/|\booo\b|away from (my )?(desk|email|office))/i;

function figmaEarlyCareerFollowUp0930Body_() {
  var person = FIGMA_EARLYCAREER_FOLLOWUP_0930_PERSON_;
  return ['Hi ' + person.greeting + ',', '', person.note, '', person.close, SENDER_NAME].join('\n');
}

/** The first message this account sent to Shelley since the cut-off, or null. */
function figmaEarlyCareerFollowUp0930Original_() {
  var person = FIGMA_EARLYCAREER_FOLLOWUP_0930_PERSON_;
  var threads = GmailApp.search('in:sent to:' + person.email + ' after:'
    + FIGMA_EARLYCAREER_FOLLOWUP_0930_COMPANY_.sentAfter, 0, 5);
  for (var t = 0; t < threads.length; t++) {
    var messages = threads[t].getMessages();
    for (var m = 0; m < messages.length; m++) {
      if (String(messages[m].getTo() || '').toLowerCase().indexOf(person.email) >= 0) return messages[m];
    }
  }
  return null;
}

/** Why Figma counts as having answered, or '' if it has not. */
function figmaEarlyCareerFollowUp0930Answered_() {
  var spec = FIGMA_EARLYCAREER_FOLLOWUP_0930_COMPANY_;
  var me = String(Session.getActiveUser().getEmail() || 'hoanng15.work@gmail.com').toLowerCase();
  var original = figmaEarlyCareerFollowUp0930Original_();
  if (original) {
    var others = original.getThread().getMessages().filter(function (message) {
      var from = String(message.getFrom() || '').toLowerCase();
      return from.indexOf(me) < 0 && !/mailer-daemon|postmaster/.test(from)
        && !FIGMA_EARLYCAREER_FOLLOWUP_0930_AUTOREPLY_.test(String(message.getSubject() || ''));
    });
    if (others.length) return 'reply on the ' + FIGMA_EARLYCAREER_FOLLOWUP_0930_PERSON_.name + ' thread';
  }
  // A person at figma.com, or an assessment sender whose mail names Figma. Shared mailboxes and
  // no-reply senders are not a person answering.
  var exact = new RegExp('@' + spec.domain.replace('.', '\\.') + '>?$', 'i');
  var threads = GmailApp.search('(from:' + spec.domain + ' OR from:hackerrank.com OR from:codesignal.com) '
    + '-from:noreply -from:no-reply -from:donotreply -category:promotions after:' + spec.sentAfter, 0, 20);
  for (var t = 0; t < threads.length; t++) {
    var first = threads[t].getMessages()[0];
    if (FIGMA_EARLYCAREER_FOLLOWUP_0930_AUTOREPLY_.test(String(first.getSubject() || ''))) continue;
    var from = String(first.getFrom() || '').trim();
    var shared = /[<\s]?(careers?|jobs?|recruit(ing|ment)?|talent|hr|university|campus|events?|notifications?|info|hello|team)@/i
      .test(from);
    var ownDomain = !shared && exact.test(from.replace(/[\s"]/g, ''));
    var assessment = /hackerrank\.com|codesignal\.com/i.test(from)
      && /figma/i.test(first.getSubject() + ' ' + first.getPlainBody().slice(0, 2000));
    if (ownDomain || assessment) return 'Figma mail: "' + first.getSubject() + '" from ' + from;
  }
  return '';
}

/** Store the one follow-up and install its one-off trigger. */
function scheduleFigmaEarlyCareerFollowUp20260930() {
  var props = PropertiesService.getScriptProperties();
  var existing = props.getProperty(FIGMA_EARLYCAREER_FOLLOWUP_0930_KEY_);
  if (existing && JSON.parse(existing).status !== 'cancelled') return {alreadyScheduled: JSON.parse(existing)};
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === FIGMA_EARLYCAREER_FOLLOWUP_0930_HANDLER_) ScriptApp.deleteTrigger(trigger);
  });
  var person = FIGMA_EARLYCAREER_FOLLOWUP_0930_PERSON_;
  var state = {status: 'scheduled', createdAt: new Date().toISOString(),
    entries: [{company: person.company, name: person.name, email: person.email,
               title: person.title, atMs: new Date(person.at).getTime(), status: 'pending'}]};
  props.setProperty(FIGMA_EARLYCAREER_FOLLOWUP_0930_KEY_, JSON.stringify(state));
  ScriptApp.newTrigger(FIGMA_EARLYCAREER_FOLLOWUP_0930_HANDLER_).timeBased()
    .at(new Date(state.entries[0].atMs)).create();
  return {scheduled: person.company + ' ' + person.name + ' '
    + Utilities.formatDate(new Date(state.entries[0].atMs), 'America/New_York', 'yyyy-MM-dd HH:mm z')};
}

/** One-off trigger: send the follow-up if the guards still allow it. */
function runFigmaEarlyCareerFollowUp20260930_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return {skipped: true, reason: 'lock busy'};
  try {
    var props = PropertiesService.getScriptProperties();
    var text = props.getProperty(FIGMA_EARLYCAREER_FOLLOWUP_0930_KEY_);
    if (!text) return {skipped: true, reason: 'state absent'};
    var state = JSON.parse(text);
    if (state.status !== 'scheduled') return {skipped: true, status: state.status};
    var now = new Date().getTime();
    var due = state.entries.filter(function (entry) {
      return entry.status === 'pending' && entry.atMs <= now + 60000;
    })[0];
    if (due) {
      var spec = FIGMA_EARLYCAREER_FOLLOWUP_0930_COMPANY_;
      var answered = figmaEarlyCareerFollowUp0930Answered_();
      var rejection = answered ? {rejected: false}
        : outreachGmailApiRejectedTarget_({company: spec.name, role: spec.role, jobLink: spec.jobLink});
      if (answered) { due.status = 'cancelled'; due.reason = 'company answered: ' + answered; }
      else if (rejection.rejected) { due.status = 'cancelled'; due.reason = 'Gmail rejection: ' + rejection.why; }
      else {
        var original = figmaEarlyCareerFollowUp0930Original_();
        var bounced = original && original.getThread().getMessages().some(function (message) {
          return /mailer-daemon|postmaster/i.test(String(message.getFrom() || ''));
        });
        if (!original) { due.status = 'skipped'; due.reason = 'original email not found'; }
        else if (bounced) { due.status = 'skipped'; due.reason = 'original email bounced'; }
        else {
          var sent = outreachSendFollowUp_(original, due.email, figmaEarlyCareerFollowUp0930Body_());
          due.status = 'sent';
          due.sentAt = new Date().toISOString();
          due.messageId = sent && sent.id;
        }
      }
    }
    if (!state.entries.some(function (entry) { return entry.status === 'pending'; })) {
      state.status = 'complete';
      ScriptApp.getProjectTriggers().forEach(function (trigger) {
        if (trigger.getHandlerFunction() === FIGMA_EARLYCAREER_FOLLOWUP_0930_HANDLER_) ScriptApp.deleteTrigger(trigger);
      });
    }
    props.setProperty(FIGMA_EARLYCAREER_FOLLOWUP_0930_KEY_, JSON.stringify(state));
    return {handled: due ? due.email + ' ' + due.status : 'nothing due', state: state.status};
  } finally {
    lock.releaseLock();
  }
}

/** Read-only: state, trigger count, the answer check, the original found and the body. */
function diagnoseFigmaEarlyCareerFollowUp20260930() {
  var text = PropertiesService.getScriptProperties().getProperty(FIGMA_EARLYCAREER_FOLLOWUP_0930_KEY_);
  var original = figmaEarlyCareerFollowUp0930Original_();
  return {
    state: text ? JSON.parse(text) : null,
    triggers: ScriptApp.getProjectTriggers().filter(function (trigger) {
      return trigger.getHandlerFunction() === FIGMA_EARLYCAREER_FOLLOWUP_0930_HANDLER_;
    }).length,
    answeredNow: figmaEarlyCareerFollowUp0930Answered_() || 'no',
    original: original ? original.getSubject() + ' (' + original.getDate() + ')' : 'not found',
    body: figmaEarlyCareerFollowUp0930Body_()
  };
}

/** Cancel the still-pending follow-up and remove the trigger. Safe to re-run. */
function cancelFigmaEarlyCareerFollowUp20260930() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === FIGMA_EARLYCAREER_FOLLOWUP_0930_HANDLER_) ScriptApp.deleteTrigger(trigger);
  });
  var props = PropertiesService.getScriptProperties();
  var text = props.getProperty(FIGMA_EARLYCAREER_FOLLOWUP_0930_KEY_);
  if (!text) return {cancelled: 0};
  var state = JSON.parse(text), cancelled = 0;
  state.entries.forEach(function (entry) {
    if (entry.status === 'pending') { entry.status = 'cancelled'; entry.reason = 'owner'; cancelled++; }
  });
  state.status = 'cancelled';
  props.setProperty(FIGMA_EARLYCAREER_FOLLOWUP_0930_KEY_, JSON.stringify(state));
  return {cancelled: cancelled};
}
