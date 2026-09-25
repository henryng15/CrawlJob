/**
 * outreach_referral_wave_0925.gs — the 2026-09-25 referral wave.
 *
 * Owner request on 2026-09-25: at least five referral asks at each employer with a recent live
 * application and no referral ask yet — Rippling (from 09:00 ET), Together AI, Fidelity
 * Investments, Persona, Accenture and Target. Amazon, Figma, Robinhood and Intuit are excluded:
 * the owner already has referrals there, obtained outside this pipeline.
 *
 * People come from Employees (seed), mid-level software engineers first. Together AI and Target
 * had three eligible people each, so two more at each were found through treg people search and
 * accepted only on a BounceBan `deliverable`. They are not in the seed, which is why this wave is
 * a fixed recipient list rather than a `scheduleTargetReferralCampaign_` selection.
 */

var REFERRAL_WAVE_0925_KEY_ = 'TARGET_REFERRAL_CAMPAIGN_20260925_REFERRAL_WAVE';
var REFERRAL_WAVE_0925_HANDLER_ = 'runReferralWaveTick20260925_';
var REFERRAL_WAVE_0925_START_ = '2026-09-25T09:00:00-04:00';
var REFERRAL_WAVE_0925_SPACING_MINUTES_ = 8;

// One application per employer, in delivery order. Asks stay clustered by employer, as the
// normal Referral planner books them. Links are the employer's or its ATS's, tracking stripped.
var REFERRAL_WAVE_0925_ = [
  {company: 'Rippling', role: 'Software Engineer Intern - Backend Focused - Summer 2027',
   jobLink: 'https://ats.rippling.com/rippling/jobs/a07e4e46-3721-4934-b57b-0d58412e22ba',
   people: [
     {name: 'Allen Hu', email: 'ahu@rippling.com'},
     {name: 'Ray Li', email: 'rli@rippling.com'},
     {name: 'Raymond Ha', email: 'rha@rippling.com'},
     {name: 'Steve Yang', email: 'syang@rippling.com'},
     {name: 'Shlok Amin', email: 'samin@rippling.com'}]},
  {company: 'Together AI', role: 'Software Engineer Intern',
   jobLink: 'https://job-boards.greenhouse.io/togetherai/jobs/5232036007',
   people: [
     {name: 'Mike Huang', email: 'mhuang@together.ai'},
     {name: 'Garima Dhanania', email: 'gdhanania@together.ai'},
     {name: 'Cody Brown', email: 'cbrown@together.ai'},
     {name: 'Blaine Kasten', email: 'blaine@together.ai', title: 'Software Engineer',
      source: 'treg quickenrich; BounceBan deliverable 97'},
     {name: 'Helena Tanub', email: 'helena@together.ai', title: 'Software Engineer - HW Automation',
      source: 'treg quickenrich; BounceBan deliverable 97'}]},
  {company: 'Fidelity Investments', role: 'Summer 2027 Undergraduate Internship - Software',
   jobLink: 'https://fmr.wd1.myworkdayjobs.com/fidelitycareers/job/One-Destiny-Way-Westlake-TX/Summer-2027-Undergraduate-Internship---Software_2134524',
   people: [
     {name: 'Stephen Utley', email: 'stephen.utley@fidelity.com'},
     {name: 'Himeth Jayakody', email: 'himeth.jayakody@fidelity.com'},
     {name: 'Sean Khang', email: 'sean.khang@fidelity.com'},
     {name: 'Eric Hilhorst', email: 'eric.hilhorst@fidelity.com'},
     {name: 'Chinmay Chitnis', email: 'chinmay.chitnis@fidelity.com'}]},
  {company: 'Persona', role: 'Software Engineer, Intern (Summer 2027)',
   jobLink: 'https://jobs.ashbyhq.com/persona/eb77c97c-fa9d-4bf0-9566-e5ba4453b7d3',
   people: [
     {name: 'Dan Evans', email: 'dan.evans@withpersona.com'},
     {name: 'Christopher Solidum', email: 'chris.solidum@withpersona.com'},
     {name: 'Reyansh Patange', email: 'reyansh.patange@withpersona.com'},
     {name: 'Miles Song', email: 'miles@withpersona.com'},
     {name: 'Bill Valeriote', email: 'bill@withpersona.com'}]},
  {company: 'Accenture', role: 'Entry Level Technology Summer Analyst - Various Locations',
   jobLink: 'https://accenture.wd103.myworkdayjobs.com/en-US/AccentureCareers/job/Technology-Summer-Analyst---Various-Locations---NAELFY27_R00355981',
   people: [
     {name: 'Milly Prashar', email: 'milly.prashar@accenture.com'},
     {name: 'Josiah King', email: 'josiah.king@accenture.com'},
     {name: 'Alex Schmerber', email: 'alex.schmerber@accenture.com'},
     {name: 'Andrea Chen', email: 'andrea.chen@accenture.com'},
     {name: 'Sereiritiya Kaun', email: 'sereiritiya.kaun@accenture.com'}]},
  {company: 'Target', role: 'Software Engineering Summer Internship-Minneapolis, MN (Starting June 2027)',
   jobLink: 'https://target.wd5.myworkdayjobs.com/targetcareers/job/7000-Target-Pkwy-NNCD-0375-Brooklyn-ParkMN-55445/Software-Engineering-Summer-Internship-Minneapolis--MN--Starting-June-2027-_R0000451082',
   people: [
     {name: 'Minhal Ansari', email: 'minhal.ansari@target.com'},
     {name: 'Tanner Hobbs', email: 'tanner.hobbs@target.com'},
     {name: 'Nick Karlovich', email: 'nick.karlovich@target.com'},
     {name: 'Anisa Filfil', email: 'anisa.filfil@target.com', title: 'Software Engineer',
      source: 'treg quickenrich; BounceBan deliverable 99'},
     {name: 'Erik Iverson', email: 'erik.iverson@target.com', title: 'Software Engineer',
      source: 'treg quickenrich; BounceBan deliverable 99'}]}
];

/**
 * Build the wave's entries from the fixed list: a seed person carries the seed row's title,
 * seniority, angle and bucket; a researched person borrows the employer's angle and bucket from
 * its seed rows. Anyone already written to, or already on the Referral tab, is skipped and
 * reported rather than replaced, so the owner sees any employer that falls below five.
 */
function referralWave0925Entries_(employees, used) {
  var byEmail = {};
  employees.forEach(function (person) { byEmail[person.email.toLowerCase()] = person; });
  var startMs = new Date(REFERRAL_WAVE_0925_START_).getTime();
  var entries = [], skipped = [];
  REFERRAL_WAVE_0925_.forEach(function (spec) {
    var peers = outreachEmployeesFor_(employees, spec.company);
    var borrowed = peers.length ? peers[0] : {};
    var index = 0;
    spec.people.forEach(function (person) {
      var email = person.email.toLowerCase();
      if (used && (used[email] || GmailApp.search('from:me to:' + email, 0, 1).length)) {
        skipped.push({company: spec.company, email: email, reason: 'already-sent'});
        return;
      }
      if (used) used[email] = true;
      var seed = byEmail[email];
      if (!seed && !person.source) throw new Error(email + ' is neither in Employees (seed) nor researched.');
      entries.push({
        company: spec.company, role: spec.role, jobLink: spec.jobLink,
        name: person.name, email: email,
        title: seed ? seed.title : person.title,
        seniority: seed ? (seed.seniority || '') : '',
        angle: seed ? (seed.angle || '') : (borrowed.angle || ''),
        bucket: seed ? (seed.bucket || '') : (borrowed.bucket || ''),
        template: index + 1,
        atMs: startMs + entries.length * REFERRAL_WAVE_0925_SPACING_MINUTES_ * 60000,
        status: 'pending'
      });
      index++;
    });
  });
  return {entries: entries, skipped: skipped};
}

/**
 * Schedule the wave. The day's planned total is over 55, so it refuses to run unless
 * `acknowledgeOver55` is true. Every employer must clear the Gmail rejection preflight before
 * anything is written; the delivery tick repeats it immediately before each send.
 */
function scheduleReferralWave20260925(acknowledgeOver55) {
  if (acknowledgeOver55 !== true) {
    throw new Error('The 2026-09-25 total exceeds 55; pass acknowledgeOver55 = true after the owner confirms.');
  }
  if (new Date().getTime() >= new Date(REFERRAL_WAVE_0925_START_).getTime()) {
    throw new Error('The 09:00 start time has passed.');
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var props = PropertiesService.getScriptProperties();
    var existingText = props.getProperty(REFERRAL_WAVE_0925_KEY_);
    if (existingText) {
      var existing = JSON.parse(existingText);
      if (existing.status === 'scheduled' || existing.status === 'complete') {
        return {alreadyStarted: true, state: summarizeTargetCampaignState_(existing, 'Referral wave 09-25')};
      }
    }
    var candidates = outreachGmailApiRejectionCandidates_();
    var blocked = [];
    REFERRAL_WAVE_0925_.forEach(function (spec) {
      var rejection = outreachGmailApiRejectedTarget_(
        {company: spec.company, role: spec.role, jobLink: spec.jobLink}, candidates);
      if (rejection.rejected) blocked.push(spec.company + ' (' + rejection.why + ')');
    });
    if (blocked.length) throw new Error('Gmail rejection preflight blocked: ' + blocked.join('; '));

    var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
    var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
    var referral = tracker.getSheetByName(TAB_REFERRAL);
    if (!referral) throw new Error('Referral tab is missing.');
    var used = {};
    outreachReadReferralRows_(referral).forEach(function (row) {
      if (row.email) used[String(row.email).toLowerCase()] = true;
    });
    var built = referralWave0925Entries_(outreachReadEmployees_(contactsBook), used);
    if (!built.entries.length) return {scheduled: [], skipped: built.skipped};

    ScriptApp.getProjectTriggers().forEach(function (trigger) {
      if (trigger.getHandlerFunction() === REFERRAL_WAVE_0925_HANDLER_) ScriptApp.deleteTrigger(trigger);
    });
    var state = {
      status: 'scheduled', timezone: 'America/New_York', createdAt: new Date().toISOString(),
      lastSentAtMs: 0, spacingMinutes: REFERRAL_WAVE_0925_SPACING_MINUTES_, minGapMinutes: 7,
      entries: built.entries, skipped: built.skipped, volumeAcknowledged: true
    };
    props.setProperty(REFERRAL_WAVE_0925_KEY_, JSON.stringify(state));
    try { ScriptApp.newTrigger(REFERRAL_WAVE_0925_HANDLER_).timeBased().everyMinutes(1).create(); }
    catch (error) { props.deleteProperty(REFERRAL_WAVE_0925_KEY_); throw error; }
    try { refreshTargetQueueTabs_(); }
    catch (mirrorError) { Logger.log('Target mirror refresh failed: ' + mirrorError); }
    return {
      scheduled: built.entries.map(function (entry) {
        return {company: entry.company, name: entry.name, email: entry.email, template: entry.template,
                at: Utilities.formatDate(new Date(entry.atMs), 'America/New_York', 'yyyy-MM-dd HH:mm z')};
      }),
      skipped: built.skipped, trigger: REFERRAL_WAVE_0925_HANDLER_
    };
  } finally {
    lock.releaseLock();
  }
}

/** Send one due 09-25 referral-wave entry. */
function runReferralWaveTick20260925_() {
  return runTargetReferralCampaignTickFor_({
    propertyKey: REFERRAL_WAVE_0925_KEY_, handler: REFERRAL_WAVE_0925_HANDLER_
  });
}

/** Read-only: every planned subject and time, and the first body per employer. Sends nothing. */
function previewReferralWave20260925() {
  var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
  var built = referralWave0925Entries_(outreachReadEmployees_(contactsBook), null);
  var shown = {};
  return built.entries.map(function (entry) {
    var mail = outreachReferralCompose_({
      personName: entry.name, personTitle: entry.title, seniority: entry.seniority,
      company: entry.company, angle: entry.angle, bucket: entry.bucket,
      role: entry.role, jobLink: entry.jobLink, template: entry.template, today: new Date()
    });
    var first = !shown[entry.company];
    shown[entry.company] = true;
    return {company: entry.company, name: entry.name, email: entry.email,
            at: Utilities.formatDate(new Date(entry.atMs), 'America/New_York', 'HH:mm'),
            subject: mail.subject, plain: first ? mail.plain : undefined};
  });
}
