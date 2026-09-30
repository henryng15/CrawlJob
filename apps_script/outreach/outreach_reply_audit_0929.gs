/**
 * outreach_reply_audit_0929.gs — read-only: who was emailed, and who answered.
 *
 * Owner question on 2026-09-29: which of the larger firms have not replied yet. Nothing in the
 * system answered that across companies. The queue tabs mark `Replied` only for rows the normal
 * queue owns, and the Target campaigns keep no reply state at all, so Gmail is the ground truth.
 *
 * Both functions send nothing and write nothing.
 *
 * An inbound message from the company's own domain is sorted into one of three kinds, because
 * "they answered" and "their ATS answered" are different facts:
 * - human reply: a person at the domain, not a shared mailbox, not an auto-reply;
 * - auto: out-of-office and vacation bounce-backs, matched anywhere in the subject (Figma's reads
 *   "Vacation / Out of Office Re: ...", so an anchored test would miss it);
 * - system: no-reply senders and shared mailboxes — application receipts, declines, event mail.
 */

var REPLY_AUDIT_AUTOREPLY_ =
  /(automatic reply|auto(matic)?[- ]?reply|out of (the )?office|on vacation|vacation \/|\booo\b|away from (my )?(desk|email|office))/i;
var REPLY_AUDIT_SHARED_ =
  /[<\s]?(careers?|jobs?|recruit(ing|ment)?|talent|hr|university|campus|events?|notifications?|info|hello|team|support|noreply|no-reply|donotreply|do-not-reply)@/i;

/** Every company this account has actually sent outreach to, with its send count. */
function diagnoseOutreachSentCompanies() {
  var counts = {};
  var bump = function (company, iso, source) {
    var name = String(company || '').trim();
    if (!name) return;
    var row = counts[name] || (counts[name] = {company: name, sent: 0, lastSentIso: '', sources: {}});
    row.sent++;
    row.sources[source] = (row.sources[source] || 0) + 1;
    if (iso && iso > row.lastSentIso) row.lastSentIso = iso;
  };
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  Object.keys(all).forEach(function (key) {
    if (!/CAMPAIGN_|FOLLOWUPS_/.test(key)) return;
    var state;
    try { state = JSON.parse(all[key]); } catch (ignored) { return; }
    (state.entries || []).forEach(function (entry) {
      var status = String(entry.status || '').toLowerCase();
      if (status !== 'sent' && status !== 'already-sent' && status !== 'replied') return;
      bump(entry.company, String(entry.sentAt || ''), key.indexOf('REFERRAL') >= 0 ? 'referral campaign' : 'recruiter campaign');
    });
  });
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var queue = tracker.getSheetByName(TAB_QUEUE);
  if (queue && queue.getLastRow() >= 2) {
    queue.getRange(2, 1, queue.getLastRow() - 1, Q_WIDTH).getValues().forEach(function (values, index) {
      var row = outreachParseQueue_(values, index + 2);
      var status = String(row.status || '').toLowerCase();
      if (status !== 'sent' && status !== 'replied') return;
      bump(row.company, row.sentAt ? row.sentAt.toISOString() : '', 'normal queue');
    });
  }
  var referral = tracker.getSheetByName(TAB_REFERRAL);
  if (referral && referral.getLastRow() >= 2) {
    referral.getRange(2, 1, referral.getLastRow() - 1, R_WIDTH).getValues().forEach(function (values, index) {
      var row = outreachParseReferral_(values, index);
      var status = String(row.status || '').toLowerCase();
      if (status !== 'sent' && status !== 'replied') return;
      bump(row.company, row.sentAt ? row.sentAt.toISOString() : '', 'referral queue');
    });
  }
  var rows = Object.keys(counts).map(function (name) { return counts[name]; })
    .sort(function (left, right) { return right.sent - left.sent; });
  return {companies: rows.length, totalSends: rows.reduce(function (sum, row) { return sum + row.sent; }, 0),
          rows: rows};
}

/** The domains this account has emailed for `company`, newest contact data first. */
function replyAuditDomainsFor_(contacts, company) {
  var domains = {};
  outreachContactsFor_(contacts, company).forEach(function (person) {
    var at = String(person.email || '').indexOf('@');
    if (at > 0) domains[String(person.email).slice(at + 1).toLowerCase()] = true;
  });
  return Object.keys(domains);
}

/**
 * For each company: how many messages went out, when the last one went, and every inbound message
 * from its domain split into human / auto / system. Pass at most ten companies per call.
 */
function diagnoseOutreachRepliesForCompanies(companies) {
  var names = (Array.isArray(companies) ? companies : [companies])
    .map(function (company) { return String(company || '').trim(); })
    .filter(function (company) { return !!company; });
  if (!names.length) throw new Error('At least one company is required.');
  var contacts = outreachReadContacts_(SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true)));
  var me = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  return names.map(function (company) {
    var domains = replyAuditDomainsFor_(contacts, company);
    if (!domains.length) return {company: company, note: 'no contact address on file, cannot search'};
    var toClause = domains.map(function (domain) { return 'to:' + domain; }).join(' OR ');
    var sentThreads = GmailApp.search('in:sent (' + toClause + ')', 0, 200);
    var sentMessages = 0, firstSent = null, lastSent = null, subjects = {};
    sentThreads.forEach(function (thread) {
      thread.getMessages().forEach(function (message) {
        var to = String(message.getTo() || '').toLowerCase();
        var hit = domains.some(function (domain) { return to.indexOf('@' + domain) >= 0; });
        if (!hit || String(message.getFrom() || '').toLowerCase().indexOf(me) < 0) return;
        sentMessages++;
        subjects[message.getSubject()] = true;
        var when = message.getDate();
        if (!firstSent || when < firstSent) firstSent = when;
        if (!lastSent || when > lastSent) lastSent = when;
      });
    });
    var human = [], auto = 0, system = [], bounces = 0;
    if (firstSent) {
      var since = Utilities.formatDate(new Date(firstSent.getTime() - 86400000), 'America/New_York', 'yyyy/MM/dd');
      var fromClause = domains.map(function (domain) { return 'from:' + domain; }).join(' OR ');
      GmailApp.search('(' + fromClause + ') after:' + since, 0, 100).forEach(function (thread) {
        thread.getMessages().forEach(function (message) {
          var from = String(message.getFrom() || '').trim();
          if (from.toLowerCase().indexOf(me) >= 0) return;
          if (!domains.some(function (domain) { return from.toLowerCase().indexOf('@' + domain) >= 0; })) return;
          var subject = String(message.getSubject() || '');
          if (/mailer-daemon|postmaster/i.test(from)) { bounces++; return; }
          if (REPLY_AUDIT_AUTOREPLY_.test(subject)) { auto++; return; }
          var when = Utilities.formatDate(message.getDate(), 'America/New_York', 'yyyy-MM-dd');
          if (REPLY_AUDIT_SHARED_.test(from)) { system.push(when + ' ' + subject); return; }
          human.push({from: from, subject: subject, date: when});
        });
      });
    }
    return {
      company: company,
      domains: domains,
      sentMessages: sentMessages,
      distinctSubjects: Object.keys(subjects).length,
      firstSent: firstSent ? Utilities.formatDate(firstSent, 'America/New_York', 'yyyy-MM-dd') : '',
      lastSent: lastSent ? Utilities.formatDate(lastSent, 'America/New_York', 'yyyy-MM-dd') : '',
      humanReplies: human,
      autoReplies: auto,
      bounces: bounces,
      systemMail: system
    };
  });
}

/** The same list as one newline-joined string, because a long array prints truncated. */
function diagnoseOutreachSentCompaniesCompact() {
  return diagnoseOutreachSentCompanies().rows.map(function (row) {
    return row.company + '|' + row.sent + '|' + String(row.lastSentIso || '').slice(0, 10);
  }).join('\n');
}

/** The audit as one newline-joined string: company, sends, dates, then each human reply. */
function diagnoseOutreachReplyAuditCompact(companies) {
  return diagnoseOutreachRepliesForCompanies(companies).map(function (row) {
    if (row.note) return row.company + ' | ' + row.note;
    return [row.company, 'sent ' + row.sentMessages, 'last ' + row.lastSent,
            'human ' + row.humanReplies.length, 'auto ' + row.autoReplies,
            'bounce ' + row.bounces, 'system ' + row.systemMail.length,
            row.humanReplies.map(function (reply) {
              return reply.date + ' ' + reply.from + ' :: ' + reply.subject;
            }).join(' ;; ')].join(' | ');
  }).join('\n');
}
