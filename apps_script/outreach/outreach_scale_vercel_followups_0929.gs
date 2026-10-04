/**
 * outreach_scale_vercel_followups_0929.gs — two owner-requested, conditional
 * threaded recruiter follow-ups: Vercel now and Scale AI on 2026-09-30.
 *
 * This is deliberately independent of the paused generic follow-up queue. The
 * owner explicitly requested the 09-30 Scale AI note before its normal five-day
 * window. Each send checks for a company answer, a Gmail rejection and a bounce
 * immediately beforehand; a positive result prevents delivery.
 */

var SCALE_VERCEL_FOLLOWUPS_0929_KEY_ = 'SCALE_VERCEL_FOLLOWUPS_20260929';
var SCALE_VERCEL_FOLLOWUPS_0929_HANDLER_ = 'runScaleVercelFollowUps20260929_';
var SCALE_VERCEL_FOLLOWUPS_0929_COMPANIES_ = {
  'Scale AI': {domain: 'scale.com', role: 'Software Engineering Intern (Summer 2027)',
    jobLink: 'https://job-boards.greenhouse.io/scaleai/jobs/4730845005/', sentAfter: '2026/09/26'},
  Vercel: {domain: 'vercel.com', role: 'Software Engineering Intern - Summer 27',
    jobLink: 'https://job-boards.greenhouse.io/vercel/jobs/6181759004?gh_src=Simplify', sentAfter: '2026/09/17'}
};
var SCALE_VERCEL_FOLLOWUPS_0929_PEOPLE_ = [
  {company: 'Scale AI', name: 'Sarah Ruhe', greeting: 'Sarah', email: 'sarah.ruhe@scale.com',
    at: '2026-09-30T16:00:00-04:00',
    note: "A quick follow-up on my note below about Scale AI's Software Engineering Intern role for Summer 2027. I'm still very interested in the opportunity and would appreciate any guidance on the recruiting process.",
    close: 'Thank you for your time,'},
  {company: 'Vercel', name: 'Robin Lee', greeting: 'Robin', email: 'robin.lee@vercel.com',
    at: '2026-09-29T10:50:00-04:00',
    note: "A quick follow-up on my note below about Vercel's Software Engineering Intern role for Summer 2027. I'm still very interested in the opportunity and would appreciate any guidance on the early-career recruiting process.",
    close: 'Thank you for your time,'}
];
var SCALE_VERCEL_FOLLOWUPS_0929_AUTOREPLY_ = /^(automatic reply|auto(matic)?[- ]?reply|out of (the )?office|ooo\b)/i;

function scaleVercelFollowUp0929Person_(email) {
  return SCALE_VERCEL_FOLLOWUPS_0929_PEOPLE_.filter(function (person) { return person.email === email; })[0];
}

function scaleVercelFollowUp0929Body_(person) {
  return ['Hi ' + person.greeting + ',', '', person.note, '', person.close, SENDER_NAME].join('\n');
}

function scaleVercelFollowUp0929Original_(person) {
  var since = SCALE_VERCEL_FOLLOWUPS_0929_COMPANIES_[person.company].sentAfter;
  var threads = GmailApp.search('in:sent to:' + person.email + ' after:' + since, 0, 5);
  for (var t = 0; t < threads.length; t++) {
    var messages = threads[t].getMessages();
    for (var m = 0; m < messages.length; m++) {
      if (String(messages[m].getTo() || '').toLowerCase().indexOf(person.email) >= 0) return messages[m];
    }
  }
  return null;
}

/** Return a company-level human answer, not an auto-reply or a job-alert receipt. */
function scaleVercelFollowUp0929Answered_(company) {
  var spec = SCALE_VERCEL_FOLLOWUPS_0929_COMPANIES_[company];
  var me = String(Session.getActiveUser().getEmail() || 'hoanng15.work@gmail.com').toLowerCase();
  var people = SCALE_VERCEL_FOLLOWUPS_0929_PEOPLE_.filter(function (person) { return person.company === company; });
  for (var i = 0; i < people.length; i++) {
    var original = scaleVercelFollowUp0929Original_(people[i]);
    if (!original) continue;
    var others = original.getThread().getMessages().filter(function (message) {
      var from = String(message.getFrom() || '').toLowerCase();
      return from.indexOf(me) < 0 && !/mailer-daemon|postmaster/.test(from)
        && !SCALE_VERCEL_FOLLOWUPS_0929_AUTOREPLY_.test(String(message.getSubject() || ''));
    });
    if (others.length) return 'reply on the ' + people[i].name + ' thread';
  }
  var exact = new RegExp('@' + spec.domain.replace('.', '\\.') + '>?$', 'i');
  var threads = GmailApp.search('(from:' + spec.domain + ' OR from:hackerrank.com OR from:codesignal.com) '
    + '-from:noreply -from:no-reply -from:donotreply -category:promotions after:' + spec.sentAfter, 0, 20);
  for (var t = 0; t < threads.length; t++) {
    var first = threads[t].getMessages()[0];
    if (SCALE_VERCEL_FOLLOWUPS_0929_AUTOREPLY_.test(String(first.getSubject() || ''))) continue;
    var from = String(first.getFrom() || '').trim();
    var shared = /[<\s]?(careers?|jobs?|recruit(ing|ment)?|talent|hr|university|campus|events?|notifications?|info|hello|team)@/i.test(from);
    var ownDomain = !shared && exact.test(from.replace(/[\s"]/g, ''));
    var assessment = /hackerrank\.com|codesignal\.com/i.test(from)
      && new RegExp(company, 'i').test(first.getSubject() + ' ' + first.getPlainBody().slice(0, 2000));
    if (ownDomain || assessment) return company + ' mail: "' + first.getSubject() + '" from ' + from;
  }
  return '';
}

/**
 * A company-scoped candidate set keeps the immediately-before-send rejection
 * preflight fast enough for this one-off path, while reusing the shared exact
 * rejection matcher below. The regular worker retains its broader mailbox scan.
 */
function scaleVercelFollowUp0929RejectionCandidates_(company) {
  var spec = SCALE_VERCEL_FOLLOWUPS_0929_COMPANIES_[company];
  var query = 'newer_than:' + REJECTION_WINDOW_DAYS + 'd -in:chats ('
    + '"' + company + '" OR from:' + spec.domain + ')';
  var listed = Gmail.Users.Messages.list('me', {q: query, maxResults: 20}) || {};
  return (listed.messages || []).map(function (item) {
    var message = Gmail.Users.Messages.get('me', item.id, {format: 'full'});
    var payload = message.payload || {}, body = '';
    try { body = outreachGmailApiBodyText_(payload); } catch (error) {}
    return {id: item.id, from: outreachGmailApiHeader_(payload, 'From'),
      subject: outreachGmailApiHeader_(payload, 'Subject'), body: body};
  });
}

/** Persist both requests and create recovery triggers; the caller may then run the handler now. */
function scheduleScaleVercelFollowUps20260929() {
  var props = PropertiesService.getScriptProperties();
  var existing = props.getProperty(SCALE_VERCEL_FOLLOWUPS_0929_KEY_);
  if (existing && JSON.parse(existing).status !== 'cancelled') return {alreadyScheduled: JSON.parse(existing)};
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === SCALE_VERCEL_FOLLOWUPS_0929_HANDLER_) ScriptApp.deleteTrigger(trigger);
  });
  var state = {status: 'scheduled', createdAt: new Date().toISOString(), entries: SCALE_VERCEL_FOLLOWUPS_0929_PEOPLE_.map(function (person) {
    return {company: person.company, name: person.name, email: person.email, atMs: new Date(person.at).getTime(), status: 'pending'};
  })};
  props.setProperty(SCALE_VERCEL_FOLLOWUPS_0929_KEY_, JSON.stringify(state));
  state.entries.forEach(function (entry) {
    ScriptApp.newTrigger(SCALE_VERCEL_FOLLOWUPS_0929_HANDLER_).timeBased().at(new Date(entry.atMs)).create();
  });
  return {scheduled: state.entries.map(function (entry) {
    return entry.company + ' ' + entry.name + ' ' + Utilities.formatDate(new Date(entry.atMs), 'America/New_York', 'yyyy-MM-dd HH:mm z');
  })};
}

/** Send the earliest due entry after every live preflight. */
function runScaleVercelFollowUps20260929_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return {skipped: true, reason: 'lock busy'};
  try {
    var props = PropertiesService.getScriptProperties();
    var text = props.getProperty(SCALE_VERCEL_FOLLOWUPS_0929_KEY_);
    if (!text) return {skipped: true, reason: 'state absent'};
    var state = JSON.parse(text);
    if (state.status !== 'scheduled') return {skipped: true, status: state.status};
    var now = new Date().getTime();
    var due = state.entries.filter(function (entry) { return entry.status === 'pending' && entry.atMs <= now + 60000; })
      .sort(function (left, right) { return left.atMs - right.atMs; })[0];
    if (due) {
      var person = scaleVercelFollowUp0929Person_(due.email);
      var spec = SCALE_VERCEL_FOLLOWUPS_0929_COMPANIES_[due.company];
      var stopCompany = function (reason) {
        state.entries.forEach(function (entry) {
          if (entry.company === due.company && entry.status === 'pending') { entry.status = 'cancelled'; entry.reason = reason; }
        });
      };
      var answered = scaleVercelFollowUp0929Answered_(due.company);
      var rejection = answered ? {rejected: false} : outreachGmailApiRejectedTarget_(
        {company: due.company, role: spec.role, jobLink: spec.jobLink},
        scaleVercelFollowUp0929RejectionCandidates_(due.company));
      if (answered) stopCompany('company answered: ' + answered);
      else if (rejection.rejected) stopCompany('Gmail rejection: ' + rejection.why);
      else {
        var original = scaleVercelFollowUp0929Original_(person);
        var bounced = original && original.getThread().getMessages().some(function (message) { return /mailer-daemon|postmaster/i.test(String(message.getFrom() || '')); });
        if (!original) { due.status = 'skipped'; due.reason = 'original email not found'; }
        else if (bounced) { due.status = 'skipped'; due.reason = 'original email bounced'; }
        else {
          var sent = outreachSendFollowUp_(original, due.email, scaleVercelFollowUp0929Body_(person));
          due.status = 'sent'; due.sentAt = new Date().toISOString(); due.messageId = sent && sent.id;
        }
      }
    }
    if (!state.entries.some(function (entry) { return entry.status === 'pending'; })) {
      state.status = 'complete';
      ScriptApp.getProjectTriggers().forEach(function (trigger) {
        if (trigger.getHandlerFunction() === SCALE_VERCEL_FOLLOWUPS_0929_HANDLER_) ScriptApp.deleteTrigger(trigger);
      });
    }
    props.setProperty(SCALE_VERCEL_FOLLOWUPS_0929_KEY_, JSON.stringify(state));
    return {handled: due ? due.email + ' ' + due.status : 'nothing due', state: state.status};
  } finally { lock.releaseLock(); }
}

/** Public execution-API wrapper for the same guarded one-off runner. */
function runScaleVercelFollowUps20260929() {
  return runScaleVercelFollowUps20260929_();
}

function diagnoseScaleVercelFollowUps20260929() {
  var text = PropertiesService.getScriptProperties().getProperty(SCALE_VERCEL_FOLLOWUPS_0929_KEY_);
  var state = text ? JSON.parse(text) : null;
  return {state: state ? {status: state.status, createdAt: state.createdAt,
      entries: state.entries.map(function (entry) { return {company: entry.company, email: entry.email, status: entry.status, reason: entry.reason || '', sentAt: entry.sentAt || ''}; })} : null,
    entrySummary: state ? state.entries.map(function (entry) {
      return entry.company + ' ' + entry.email + ': ' + entry.status + (entry.reason ? ' (' + entry.reason + ')' : '') + (entry.sentAt ? ' at ' + entry.sentAt : '');
    }) : [],
    triggers: ScriptApp.getProjectTriggers().filter(function (trigger) { return trigger.getHandlerFunction() === SCALE_VERCEL_FOLLOWUPS_0929_HANDLER_; }).length,
    answeredNow: Object.keys(SCALE_VERCEL_FOLLOWUPS_0929_COMPANIES_).map(function (company) { return company + ': ' + (scaleVercelFollowUp0929Answered_(company) || 'no'); }),
    originalsFound: SCALE_VERCEL_FOLLOWUPS_0929_PEOPLE_.map(function (person) { var original = scaleVercelFollowUp0929Original_(person); return person.email + ': ' + (original ? original.getSubject() : 'not sent yet'); }),
    threadMessages: SCALE_VERCEL_FOLLOWUPS_0929_PEOPLE_.map(function (person) {
      var original = scaleVercelFollowUp0929Original_(person);
      return person.email + ': ' + (original ? original.getThread().getMessages().map(function (message) {
        return Utilities.formatDate(message.getDate(), 'America/New_York', 'yyyy-MM-dd HH:mm z') + ' | ' + message.getFrom() + ' | ' + message.getSubject();
      }).join(' || ') : 'original absent');
    }),
    bodies: SCALE_VERCEL_FOLLOWUPS_0929_PEOPLE_.map(scaleVercelFollowUp0929Body_)};
}

function cancelScaleVercelFollowUps20260929() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) { if (trigger.getHandlerFunction() === SCALE_VERCEL_FOLLOWUPS_0929_HANDLER_) ScriptApp.deleteTrigger(trigger); });
  var props = PropertiesService.getScriptProperties(), text = props.getProperty(SCALE_VERCEL_FOLLOWUPS_0929_KEY_);
  if (!text) return {cancelled: 0};
  var state = JSON.parse(text), cancelled = 0;
  state.entries.forEach(function (entry) { if (entry.status === 'pending') { entry.status = 'cancelled'; entry.reason = 'owner'; cancelled++; } });
  state.status = 'cancelled'; props.setProperty(SCALE_VERCEL_FOLLOWUPS_0929_KEY_, JSON.stringify(state));
  return {cancelled: cancelled};
}
