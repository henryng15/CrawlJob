/**
 * Owner-requested one-recipient Rippling recruiter send for the Full Stack
 * application.  This is intentionally isolated from the normal queue: the
 * owner supplied the address in chat and asked for the additional cold email.
 */
function sendTargetRecruiterNowRipplingLinda0925() {
  var key = 'TARGET_RECRUITER_CAMPAIGN_20260925_RIPPLING_LINDA';
  var handler = 'runTargetRecruiterCampaignTickNowRipplingLinda0925_';
  var props = PropertiesService.getScriptProperties();
  var existingText = props.getProperty(key);
  if (existingText) {
    var existing = JSON.parse(existingText);
    if ((existing.entries || []).some(function (entry) { return entry.status === 'sent'; })) {
      return {alreadySent: true, company: 'Rippling', email: 'linda.le@rippling.com'};
    }
    return runTargetRecruiterCampaignTickFor_({
      propertyKey: key, handler: handler, keepTrigger: false
    });
  }

  var email = 'linda.le@rippling.com';
  var company = 'Rippling';
  var role = 'Full Stack Software Engineer Intern - Summer 2027';
  var jobLink = 'https://ats.rippling.com/en-GB/rippling/jobs/f64b6158-9534-4bab-9457-45556166b262/apply?jobBoardSlug=rippling&jobId=f64b6158-9534-4bab-9457-45556166b262&step=confirmation';
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
  var contacts = outreachReadContacts_(contactsBook);
  var matches = outreachContactsFor_(contacts, company).filter(function (contact) {
    return String(contact.email || '').toLowerCase() === email;
  });
  if (matches.length > 1) {
    throw new Error('Expected at most one Rippling record for ' + email + '; found ' + matches.length + '.');
  }
  if (!matches.length) {
    appendApprovedManualRecruiters_([{
      company: company, name: 'Linda', email: email, role: 'Recruiter',
      verify: 'owner-supplied', source: 'Owner supplied 2026-09-25'
    }], 'Owner supplied 2026-09-25');
    contacts = outreachReadContacts_(contactsBook);
    matches = outreachContactsFor_(contacts, company).filter(function (contact) {
      return String(contact.email || '').toLowerCase() === email;
    });
  }
  if (matches.length !== 1) throw new Error('Rippling Linda contact was not persisted.');
  var contact = matches[0];
  var spent = targetRecruiterSpentFingerprints_(tracker);
  var salt = outreachProperty_(PROP_SALT, true);
  var fingerprints = [
    outreachFingerprint_(email, salt, SEASON_SUMMER),
    outreachFingerprint_(email, salt, SEASON_OFFCYCLE)
  ];
  if (contact.sent || fingerprints.some(function (fingerprint) { return spent[fingerprint]; })
      || GmailApp.search('from:me to:' + email, 0, 1).length) {
    return {alreadySent: true, company: company, email: email,
      reason: 'Gmail history or sender contact state already records an outbound message.'};
  }

  var applications = targetMirrorApplications_(tracker).filter(function (app) {
    return outreachSameEmployer_(outreachCompanyTokens_(app.company), outreachCompanyTokens_(company))
      && app.role === role
      && String(app.link || app.official || '') === jobLink
      && outreachQualifies_(app.process);
  });
  if (applications.length !== 1) {
    throw new Error('The exact active Rippling Full Stack application is not available.');
  }
  var entry = {company: company, role: role, jobLink: jobLink, name: contact.name || 'Linda',
    email: email, title: contact.role || 'Recruiter', template: 1,
    atMs: new Date().getTime() - 1000, status: 'pending'};
  var rejection = outreachGmailApiRejectedTarget_(entry);
  if (rejection.rejected) return {blocked: true, company: company, email: email, reason: rejection.why};

  props.setProperty(key, JSON.stringify({status: 'scheduled', timezone: 'America/New_York',
    createdAt: new Date().toISOString(), lastSentAtMs: 0, spacingMinutes: 1,
    minGapMinutes: 0, entries: [entry]}));
  refreshTargetQueueTabs_();
  ScriptApp.newTrigger(handler).timeBased().everyMinutes(1).create();
  return runTargetRecruiterCampaignTickFor_({propertyKey: key, handler: handler, keepTrigger: false});
}

/** Retry the owner-requested Linda send and remove its trigger after completion. */
function runTargetRecruiterCampaignTickNowRipplingLinda0925_() {
  return runTargetRecruiterCampaignTickFor_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260925_RIPPLING_LINDA',
    handler: 'runTargetRecruiterCampaignTickNowRipplingLinda0925_', keepTrigger: false
  });
}

/** Owner-requested immediate retry for the existing Rippling Backend campaign entry. */
function sendTargetRecruiterNowRipplingChristopher0925() {
  var key = 'TARGET_RECRUITER_CAMPAIGN_20260925_GAP_RIPPLING';
  var text = PropertiesService.getScriptProperties().getProperty(key);
  if (!text) throw new Error('The Rippling Backend campaign is missing.');
  var state = JSON.parse(text);
  var entries = state.entries || [];
  if (entries.some(function (entry) { return entry.status === 'sent'; })) {
    return {alreadySent: true, company: 'Rippling', email: 'ctung@rippling.com'};
  }
  var pending = entries.filter(function (entry) {
    return entry.status === 'pending' && entry.email === 'ctung@rippling.com';
  });
  if (pending.length !== 1) throw new Error('Expected one pending Christopher Rippling entry.');
  if (pending[0].atMs > new Date().getTime()) {
    pending[0].atMs = new Date().getTime() - 1000;
    PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(state));
    refreshTargetQueueTabs_();
  }
  return runTargetRecruiterCampaignTickFor_({
    propertyKey: key, handler: 'runTargetRecruiterCampaignTickNowRipplingChristopher0925_',
    keepTrigger: false
  });
}

/** Internal retry handler for the owner-requested immediate Backend send. */
function runTargetRecruiterCampaignTickNowRipplingChristopher0925_() {
  return runTargetRecruiterCampaignTickFor_({
    propertyKey: 'TARGET_RECRUITER_CAMPAIGN_20260925_GAP_RIPPLING',
    handler: 'runTargetRecruiterCampaignTickNowRipplingChristopher0925_', keepTrigger: false
  });
}
