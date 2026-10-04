// Owner-approved McKinsey QuantumBlack referral wave for 2026-09-25.

var TARGET_REFERRAL_20260925_MCKINSEY_CONTACTS_ = [
  {name: 'Aditi Jain', email: 'aditi_jain@mckinsey.com', title: 'Software Engineer'},
  {name: 'Vidhi Nagda', email: 'vidhi_nagda@mckinsey.com', title: 'Software Engineer II'},
  {name: 'Dinky Khatri', email: 'dinky_khatri@mckinsey.com', title: 'Senior Software Engineer'},
  {name: 'Rasheika Fulton', email: 'rasheika.fulton@mckinsey.com', title: 'Junior Software Engineer'},
  {name: 'Parth Sharma', email: 'parth.sharma@mckinsey.com', title: 'Senior Software Engineer'}
];

function scheduleTargetReferralCampaign20260925McKinsey(acknowledgeOver55) {
  if (acknowledgeOver55 !== true) {
    throw new Error('Pass acknowledgeOver55 = true after the owner confirms the over-55 total.');
  }
  var propertyKey = 'TARGET_REFERRAL_CAMPAIGN_20260925_MCKINSEY';
  var handler = 'runTargetReferralCampaignTick20260925McKinsey_';
  var role = 'Software Engineer Intern - QuantumBlack, AI by McKinsey';
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var props = PropertiesService.getScriptProperties();
    var existingText = props.getProperty(propertyKey);
    if (existingText) {
      var existing = JSON.parse(existingText);
      if (existing.status === 'scheduled' || existing.status === 'complete') {
        return {alreadyStarted: true, state: summarizeTargetCampaignState_(existing, 'McKinsey')};
      }
    }
    var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
    var applications = targetMirrorApplications_(tracker).filter(function (app) {
      return outreachSameEmployer_(outreachCompanyTokens_(app.company), outreachCompanyTokens_('McKinsey'))
        && app.role === role && outreachQualifies_(app.process);
    });
    if (applications.length !== 1) throw new Error('The exact active McKinsey QuantumBlack application is not available.');
    var jobLink = applications[0].link;
    var rejection = outreachGmailApiRejectedTarget_({company: 'McKinsey', role: role, jobLink: jobLink});
    if (rejection.rejected) return {blocked: true, company: 'McKinsey', reason: rejection.why};
    var referral = tracker.getSheetByName(TAB_REFERRAL);
    if (!referral) throw new Error('Referral tab is missing.');
    var used = {};
    outreachReadReferralRows_(referral).forEach(function (row) {
      if (row.email) used[String(row.email).toLowerCase()] = true;
    });
    var skipped = [], now = new Date().getTime(), entries = [];
    TARGET_REFERRAL_20260925_MCKINSEY_CONTACTS_.forEach(function (contact) {
      var email = contact.email.toLowerCase();
      if (used[email] || GmailApp.search('from:me to:' + email, 0, 1).length) {
        skipped.push({name: contact.name, email: email, reason: 'already-sent'}); return;
      }
      used[email] = true;
      entries.push({company: 'McKinsey', role: role, jobLink: jobLink, name: contact.name,
        email: email, title: contact.title, seniority: '', angle: '', bucket: '',
        template: entries.length + 1, atMs: now - 1000 + entries.length * 5 * 60000, status: 'pending'});
    });
    if (!entries.length) return {scheduled: [], skipped: skipped};
    ScriptApp.getProjectTriggers().forEach(function (trigger) {
      if (trigger.getHandlerFunction() === handler) ScriptApp.deleteTrigger(trigger);
    });
    var state = {status: 'scheduled', timezone: 'America/New_York', createdAt: new Date().toISOString(),
      lastSentAtMs: 0, spacingMinutes: 5, minGapMinutes: 5, entries: entries, skipped: skipped,
      volumeAcknowledged: true};
    props.setProperty(propertyKey, JSON.stringify(state));
    try { ScriptApp.newTrigger(handler).timeBased().everyMinutes(1).create(); }
    catch (error) { props.deleteProperty(propertyKey); throw error; }
    try { refreshTargetQueueTabs_(); } catch (mirrorError) { Logger.log('Target mirror refresh failed: ' + mirrorError); }
    return {scheduled: entries.map(function (entry) { return {name: entry.name, email: entry.email,
      at: Utilities.formatDate(new Date(entry.atMs), 'America/New_York', 'yyyy-MM-dd HH:mm z')}; }),
      skipped: skipped, trigger: handler};
  } finally { lock.releaseLock(); }
}

function runTargetReferralCampaignTick20260925McKinsey_() {
  return runTargetReferralCampaignTickFor_({propertyKey: 'TARGET_REFERRAL_CAMPAIGN_20260925_MCKINSEY',
    handler: 'runTargetReferralCampaignTick20260925McKinsey_'});
}

function sendTargetReferralCampaign20260925McKinseyNow() {
  return runTargetReferralCampaignTick20260925McKinsey_();
}

/** Add the owner-approved Vibhav replacement after a duplicate is skipped. */
function addTargetReferralCampaign20260925McKinseyReplacement() {
  var propertyKey = 'TARGET_REFERRAL_CAMPAIGN_20260925_MCKINSEY';
  var replacement = {name: 'Vibhav Bhangale', email: 'vibhav_bhangale@mckinsey.com',
    title: 'Senior Software Engineer'};
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var props = PropertiesService.getScriptProperties();
    var state = JSON.parse(props.getProperty(propertyKey) || '');
    if (state.status !== 'scheduled') throw new Error('McKinsey campaign is not scheduled.');
    if ((state.entries || []).some(function (entry) { return entry.email === replacement.email; })) {
      return {alreadyPresent: true};
    }
    if (GmailApp.search('from:me to:' + replacement.email, 0, 1).length) {
      return {skipped: true, reason: 'already-sent'};
    }
    var latest = Math.max.apply(null, state.entries.map(function (entry) { return Number(entry.atMs) || 0; }));
    state.entries.push({company: 'McKinsey', role: 'Software Engineer Intern - QuantumBlack, AI by McKinsey',
      jobLink: state.entries[0].jobLink, name: replacement.name, email: replacement.email,
      title: replacement.title, seniority: '', angle: '', bucket: '', template: 6,
      atMs: Math.max(new Date().getTime() + 5 * 60000, latest + 5 * 60000), status: 'pending'});
    props.setProperty(propertyKey, JSON.stringify(state));
    refreshTargetQueueTabs_();
    return {added: replacement.name, scheduledAt: Utilities.formatDate(
      new Date(state.entries[state.entries.length - 1].atMs), 'America/New_York', 'yyyy-MM-dd HH:mm z')};
  } finally { lock.releaseLock(); }
}

/** Read-only delivery state for the five McKinsey entries, without addresses. */
function diagnoseTargetReferralCampaign20260925McKinsey() {
  var text = PropertiesService.getScriptProperties().getProperty(
    'TARGET_REFERRAL_CAMPAIGN_20260925_MCKINSEY');
  if (!text) return {present: false};
  var state = JSON.parse(text);
  return {
    present: true,
    status: state.status,
    entries: (state.entries || []).map(function (entry) {
      return {name: entry.name, title: entry.title, status: entry.status,
        scheduledAt: entry.atMs ? Utilities.formatDate(new Date(entry.atMs),
          'America/New_York', 'yyyy-MM-dd HH:mm z') : '', error: entry.error || ''};
    })
  };
}
