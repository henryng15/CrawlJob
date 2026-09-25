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
 * `specs`, `startIso` and `spacingMinutes` let the TD Bank follow-on reuse it.
 */
function referralWave0925Entries_(employees, used, specs, startIso, spacingMinutes) {
  var byEmail = {};
  employees.forEach(function (person) { byEmail[person.email.toLowerCase()] = person; });
  var startMs = new Date(startIso).getTime();
  var entries = [], skipped = [];
  specs.forEach(function (spec) {
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
        atMs: startMs + entries.length * spacingMinutes * 60000,
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
    var built = referralWave0925Entries_(outreachReadEmployees_(contactsBook), used,
      REFERRAL_WAVE_0925_, REFERRAL_WAVE_0925_START_, REFERRAL_WAVE_0925_SPACING_MINUTES_);
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
  var built = referralWave0925Entries_(outreachReadEmployees_(contactsBook), null,
    REFERRAL_WAVE_0925_, REFERRAL_WAVE_0925_START_, REFERRAL_WAVE_0925_SPACING_MINUTES_);
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

// ---- TD Bank follow-on (owner request 2026-09-25 00:2x ET) -------------------------------------
// About ten early-career / new-grad software engineers at TD Bank US. TD is not in Employees
// (seed); treg quickenrich returned only Canadian staff, so these came from Exa, current TD role in
// the United States, joined 2023 or later, no intern / senior / lead titles. Each address follows
// td.com's first.last pattern and returned BounceBan `deliverable` 99. Preet Shah and Travis Cook
// also verified but were held back: a name that common can reach a different person at a bank
// this size.
var REFERRAL_WAVE_0925_TD_KEY_ = 'TARGET_REFERRAL_CAMPAIGN_20260925_TD_BANK';
var REFERRAL_WAVE_0925_TD_HANDLER_ = 'runReferralWaveTickTdBank20260925_';
var REFERRAL_WAVE_0925_TD_ = [
  {company: 'TD Bank', role: '2027 Summer Internship Program - Global Technology & Solutions - Software Engineer (SWE)',
   jobLink: 'https://td.wd3.myworkdayjobs.com/TD_Bank_Careers/job/Mount-Laurel-New-Jersey/XMLNAME-2027-Summer-Internship-Program---Global-Technology---Solutions---Software-Engineer--SWE-_R_1510796-1',
   people: [
     {name: 'Arman Gasparyan', email: 'arman.gasparyan@td.com', title: 'Software Engineer I', source: 'treg Exa; BounceBan deliverable 99'},
     {name: 'Joseph Coiffman', email: 'joseph.coiffman@td.com', title: 'Software Engineer I', source: 'treg Exa; BounceBan deliverable 99'},
     {name: 'Ananya Seth', email: 'ananya.seth@td.com', title: 'Junior API Developer', source: 'treg Exa; BounceBan deliverable 99'},
     {name: 'Prayush Luitel', email: 'prayush.luitel@td.com', title: 'Software Engineer II', source: 'treg Exa; BounceBan deliverable 99'},
     {name: 'Mimi Meyer', email: 'mimi.meyer@td.com', title: 'Software Engineer', source: 'treg Exa; BounceBan deliverable 99'},
     {name: 'Henry Winczner', email: 'henry.winczner@td.com', title: 'Software Engineer', source: 'treg Exa; BounceBan deliverable 99'},
     {name: 'Meredith Quintana', email: 'meredith.quintana@td.com', title: 'Software Engineer', source: 'treg Exa; BounceBan deliverable 99'},
     {name: 'Molly Sproul', email: 'molly.sproul@td.com', title: 'Java Developer', source: 'treg Exa; BounceBan deliverable 99'},
     {name: 'Nafisa Huda', email: 'nafisa.huda@td.com', title: 'Software Engineer - DevSecOps', source: 'treg Exa; BounceBan deliverable 99'},
     {name: 'Melina Quezada', email: 'melina.quezada@td.com', title: 'Platform Engineer', source: 'treg Exa; BounceBan deliverable 99'}]}
];

/**
 * Schedule the TD Bank asks from `startIso`, `spacingMinutes` apart, on their own trigger. The
 * owner must acknowledge the day's over-55 total. Same preflight, skip rules and delivery tick as
 * the main 09-25 wave.
 */
function scheduleTdBankReferralWave20260925(startIso, spacingMinutes, acknowledgeOver55) {
  if (acknowledgeOver55 !== true) {
    throw new Error('The day total exceeds 55; pass acknowledgeOver55 = true after the owner confirms.');
  }
  var spacing = Number(spacingMinutes || 20);
  if (new Date().getTime() >= new Date(startIso).getTime()) throw new Error('The start time has passed.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var props = PropertiesService.getScriptProperties();
    var existingText = props.getProperty(REFERRAL_WAVE_0925_TD_KEY_);
    if (existingText) {
      var existing = JSON.parse(existingText);
      if (existing.status === 'scheduled' || existing.status === 'complete') {
        return {alreadyStarted: true, state: summarizeTargetCampaignState_(existing, 'TD Bank referral')};
      }
    }
    var spec = REFERRAL_WAVE_0925_TD_[0];
    var rejection = outreachGmailApiRejectedTarget_({company: spec.company, role: spec.role, jobLink: spec.jobLink});
    if (rejection.rejected) throw new Error('Gmail rejection preflight blocked TD Bank (' + rejection.why + ').');

    var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
    var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
    var referral = tracker.getSheetByName(TAB_REFERRAL);
    if (!referral) throw new Error('Referral tab is missing.');
    var used = {};
    outreachReadReferralRows_(referral).forEach(function (row) {
      if (row.email) used[String(row.email).toLowerCase()] = true;
    });
    var built = referralWave0925Entries_(outreachReadEmployees_(contactsBook), used,
      REFERRAL_WAVE_0925_TD_, startIso, spacing);
    if (!built.entries.length) return {scheduled: [], skipped: built.skipped};

    ScriptApp.getProjectTriggers().forEach(function (trigger) {
      if (trigger.getHandlerFunction() === REFERRAL_WAVE_0925_TD_HANDLER_) ScriptApp.deleteTrigger(trigger);
    });
    var state = {
      status: 'scheduled', timezone: 'America/New_York', createdAt: new Date().toISOString(),
      lastSentAtMs: 0, spacingMinutes: spacing, minGapMinutes: Math.max(5, spacing - 1),
      entries: built.entries, skipped: built.skipped, volumeAcknowledged: true
    };
    props.setProperty(REFERRAL_WAVE_0925_TD_KEY_, JSON.stringify(state));
    try { ScriptApp.newTrigger(REFERRAL_WAVE_0925_TD_HANDLER_).timeBased().everyMinutes(1).create(); }
    catch (error) { props.deleteProperty(REFERRAL_WAVE_0925_TD_KEY_); throw error; }
    try { refreshTargetQueueTabs_(); }
    catch (mirrorError) { Logger.log('Target mirror refresh failed: ' + mirrorError); }
    return {
      scheduled: built.entries.map(function (entry) {
        return {name: entry.name, email: entry.email, template: entry.template,
                at: Utilities.formatDate(new Date(entry.atMs), 'America/New_York', 'yyyy-MM-dd HH:mm z')};
      }),
      skipped: built.skipped, trigger: REFERRAL_WAVE_0925_TD_HANDLER_
    };
  } finally {
    lock.releaseLock();
  }
}

/** Send one due TD Bank referral entry. */
function runReferralWaveTickTdBank20260925_() {
  return runTargetReferralCampaignTickFor_({
    propertyKey: REFERRAL_WAVE_0925_TD_KEY_, handler: REFERRAL_WAVE_0925_TD_HANDLER_
  });
}

/**
 * Move only the still-pending asks from the two 09/25 referral campaigns.
 * Sent history stays untouched; a count mismatch aborts without writing so a
 * minute-trigger delivery cannot silently drop or duplicate an ask.
 */
function retimePendingReferralWaves20260925(targetIsos) {
  if (!Array.isArray(targetIsos) || !targetIsos.length) {
    throw new Error('Provide one future ISO timestamp for every pending referral ask.');
  }
  var nowMs = new Date().getTime();
  var targetTimes = targetIsos.map(function (value) {
    var time = new Date(String(value || '')).getTime();
    if (!isFinite(time) || time <= nowMs) throw new Error('Every new referral time must be in the future.');
    return time;
  });
  targetTimes.forEach(function (time, index) {
    if (index && time <= targetTimes[index - 1]) {
      throw new Error('New referral times must be strictly increasing.');
    }
  });

  var keys = [REFERRAL_WAVE_0925_KEY_, REFERRAL_WAVE_0925_TD_KEY_];
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var props = PropertiesService.getScriptProperties();
    var states = {};
    var pending = [];
    keys.forEach(function (key) {
      var text = props.getProperty(key);
      if (!text) throw new Error('Referral campaign is missing: ' + key);
      var state = JSON.parse(text);
      if (state.status !== 'scheduled') throw new Error('Referral campaign is not scheduled: ' + key);
      states[key] = state;
      (state.entries || []).forEach(function (entry) {
        if (entry.status === 'pending') pending.push({key: key, entry: entry});
      });
    });
    pending.sort(function (left, right) { return Number(left.entry.atMs) - Number(right.entry.atMs); });
    if (pending.length !== targetTimes.length) {
      throw new Error('Expected ' + pending.length + ' pending referral asks, received '
        + targetTimes.length + ' replacement times. No entries were changed.');
    }
    pending.forEach(function (item, index) { item.entry.atMs = targetTimes[index]; });
    keys.forEach(function (key) {
      states[key].retimedAt = new Date().toISOString();
      props.setProperty(key, JSON.stringify(states[key]));
    });
    refreshTargetQueueTabs_();
    return {
      moved: pending.length,
      firstAt: Utilities.formatDate(new Date(targetTimes[0]), 'America/New_York', 'yyyy-MM-dd HH:mm z'),
      lastAt: Utilities.formatDate(new Date(targetTimes[targetTimes.length - 1]), 'America/New_York', 'yyyy-MM-dd HH:mm z')
    };
  } finally {
    lock.releaseLock();
  }
}

/** Read-only preview of the TD Bank asks from `startIso`; sends nothing. */
function previewTdBankReferralWave20260925(startIso, spacingMinutes) {
  var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
  var built = referralWave0925Entries_(outreachReadEmployees_(contactsBook), null,
    REFERRAL_WAVE_0925_TD_, startIso, Number(spacingMinutes || 20));
  return built.entries.map(function (entry, index) {
    var mail = outreachReferralCompose_({
      personName: entry.name, personTitle: entry.title, seniority: entry.seniority,
      company: entry.company, angle: entry.angle, bucket: entry.bucket,
      role: entry.role, jobLink: entry.jobLink, template: ((entry.template - 1) % 10) + 1, today: new Date()
    });
    return {name: entry.name, email: entry.email,
            at: Utilities.formatDate(new Date(entry.atMs), 'America/New_York', 'HH:mm'),
            subject: mail.subject, plain: index === 0 ? mail.plain : undefined};
  });
}
