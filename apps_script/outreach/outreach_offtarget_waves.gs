// Off-Target manual recruiter waves.
//
// Two explicit recruiter waves for companies that are NOT on the Target shortlist: every one is
// an application already made, outside the quant set, with no rejection in the mailbox and an
// open Software Engineer Intern, Software Developer, or Software Engineering Co-op requisition.
// Roles containing Design or Embedded are excluded. One recruiter per employer, chosen by
// verification quality rather than by the alphabetical order the selector would otherwise use.
// Everyone else at that employer is listed in excludeEmails so the pick is forced.
//
// The hours sit outside SEND_HOUR_FIRST..SEND_HOUR_LAST because the owner asked for them
// explicitly. A direct campaign does not enter the normal Email queue and is not bound by the
// weekday DAILY_CAP. See docs/manual-outreach-trigger.md and
// docs/components/outreach-offtarget-waves.md.

/** Manual off-Target recruiter wave, 26 employers, 2026-09-13 23:00 to 23:50 ET. */
function scheduleOffTargetRecruiterCampaign0913Night() {
  return scheduleTargetRecruiterCampaign_({
    propertyKey: 'OFFTARGET_RECRUITER_CAMPAIGN_20260913_NIGHT',
    handler: 'runOffTargetRecruiterCampaignTick0913Night_',
    label: 'Off-Target night wave',
    startIso: '2026-09-13T23:00:00-04:00',
    spacingMinutes: 2,
    minGapMinutes: 1,
    companies: [
      {company: 'The Hartford', maxContacts: 1,
       role: 'Tech & Data Program Summer 2027 Software Engineer Intern (Charlotte)',
       jobLink: 'https://thehartford.wd5.myworkdayjobs.com/Careers_External/job/Charlotte-NC/Tech---Data-Program-Summer-2027---Software-Engineer-Intern--Charlotte-_R2626649'},
      {company: 'Northwood Space', maxContacts: 1,
       role: 'Software Engineer Intern, Multiple Teams',
       jobLink: 'https://jobs.ashbyhq.com/NorthwoodSpace/ce3d4b73-461e-4128-a6f1-f933897e8119/application?embed=true&utm_source=Simplify&ref=Simplify'},
      {company: 'Phillips Edison & Company', maxContacts: 1,
       role: 'Information Technology Intern, Software Development (Summer 2027)',
       jobLink: 'https://jobright.ai/jobs/info/6a95c2ecf28891320e85db8f?utm_campaign=1079&utm_source=git'},
      {company: 'Nokia', maxContacts: 1,
       role: 'Deepfield Software Engineer Co-op',
       jobLink: 'https://fa-evmr-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/39908'},
      {company: 'Progress Rail, A Caterpillar Company', maxContacts: 1,
       role: 'Software Engineer Intern, Advanced Rail Technology',
       jobLink: 'https://jobright.ai/jobs/info/6a8eeb81309e5f22487094ea?utm_campaign=1079&utm_source=git'},
      {company: 'C3.ai', maxContacts: 1,
       role: 'Software Engineer Intern',
       jobLink: 'https://c3.ai/job-description/8739037002?gh_jid=8739037002&utm_source=Simplify&ref=Simplify'},
      {company: 'K2 Space', maxContacts: 1,
       role: 'Software Engineer Intern, Summer 2027',
       jobLink: 'https://job-boards.greenhouse.io/k2spacecorporation/jobs/5411920008?utm_source=Simplify&ref=Simplify'},
      {company: 'Nike', maxContacts: 1,
       role: 'Software Engineer Intern',
       jobLink: 'https://nike.wd1.myworkdayjobs.com/nke/job/Beaverton-Oregon/NIKE--Inc-Software-Engineering-Undergraduate-Internship_R-91111?utm_source=Simplify&ref=Simplify'},
      {company: 'Valon', maxContacts: 1,
       role: 'Software Engineer Intern',
       jobLink: 'https://jobs.ashbyhq.com/valon/b5a62c0c-823c-42dd-8cb5-e4b1455bcc64/application?utm_source=Simplify&jr_id=6a9740e5b22f636c81416f7a'},
      {company: 'Momentive', maxContacts: 1,
       role: 'Summer 2027 Intern, Software Development',
       jobLink: 'https://momentive.wd1.myworkdayjobs.com/MC/job/US-NY-Niskayuna/Summer-2027-Intern---Software-Development_R9756'},
      {company: 'Johns Hopkins Applied Physics Laboratory', maxContacts: 1,
       role: 'Software Development Intern',
       jobLink: 'https://careers.jhuapl.edu/jobs/59745?icims=1&utm_source=Simplify&ref=Simplify'},
      {company: 'The Kraft Group & Affiliates', maxContacts: 1,
       role: 'Software Engineer Intern',
       jobLink: 'https://jobright.ai/jobs/info/6a996c9b040e5c3d075961cd?utm_campaign=1079&utm_source=git'},
      {company: 'Northmarq', maxContacts: 1,
       role: 'Software Engineering Intern, Summer 2027',
       jobLink: 'https://job-boards.greenhouse.io/northmarq/jobs/5414475008'},
      {company: 'PepsiCo', maxContacts: 1,
       role: '2027 Summer Intern: Technology Software Development & Engineering',
       jobLink: 'https://jobright.ai/jobs/info/6a983d5111f73b6462c8d5e6?utm_campaign=1079&utm_source=git'},
      {company: 'CIBC', maxContacts: 1,
       role: '2027 Summer Intern, Software Engineering',
       jobLink: 'https://cibc.wd3.myworkdayjobs.com/search/job/Chicago-IL/XMLNAME-2027-Summer-Intern---Software-Engineering_2618322-1'},
      {company: 'Garner Health', maxContacts: 1,
       role: 'Software Engineering Intern',
       jobLink: 'https://job-boards.greenhouse.io/garnerhealth/jobs/6164698004'},
      {company: 'Skillz', maxContacts: 1,
       role: 'Co-op, Software Engineer',
       jobLink: 'https://job-boards.greenhouse.io/skillzinc/jobs/8168006'},
      {company: 'Prescient Edge', maxContacts: 1,
       role: 'Junior Software Developer Intern',
       jobLink: 'https://jobright.ai/jobs/info/6a9ad00ed5ff1f3f1c39b53b?utm_campaign=1079&utm_source=git'},
      {company: 'Micron Technology', maxContacts: 1,
       role: 'Intern, Software Engineer',
       jobLink: 'https://micron.wd1.myworkdayjobs.com/External/job/Boise-ID---Main-Site/Intern---Software-Engineer_JR108550'},
      {company: 'Hearst Television', maxContacts: 1,
       role: 'Software Engineering Intern',
       jobLink: 'https://jobright.ai/jobs/info/6aa39919626f9945308b1c89?utm_campaign=1079&utm_source=git'},
      {company: 'ibotta', maxContacts: 1,
       role: 'Software Engineer Intern',
       jobLink: 'https://jobs.ashbyhq.com/ibotta/3130669e-16aa-4f63-834d-b83571c8d269/application?embed=true&utm_source=Simplify&ref=Simplify'},
      {company: 'US Foods', maxContacts: 1,
       role: 'Intern, Software Engineer, Digital Commerce',
       jobLink: 'https://jobright.ai/jobs/info/6a97381fd13b4819f39dfd07?utm_campaign=1079&utm_source=git'},
      {company: 'Amgen', maxContacts: 1,
       role: 'Software Engineer Intern, Technology & Medical Organizations',
       jobLink: 'https://amgen.wd1.myworkdayjobs.com/careers/job/United-States---Remote/Undergrad-Intern---Software-Engineer---Amgen-s-Technology---Medical-Organizations--Summer-2027-_R-255719?utm_source=Simplify&ref=Simplify'},
      {company: 'Copart', maxContacts: 1,
       role: 'Software Engineering Intern',
       jobLink: 'https://copart.wd12.myworkdayjobs.com/en-US/copart/job/Software-Engineering-Intern_JR101510'},
      {company: 'AbbVie', maxContacts: 1,
       role: 'Business Technology Solutions Intern, Data & Software Engineering',
       jobLink: 'https://jobs.smartrecruiters.com/AbbVie/3743990014697918?utm_source=Simplify&ref=Simplify'},
      {company: 'Advanced Space', maxContacts: 1,
       role: '2027 Software Engineering Summer Internship',
       jobLink: 'https://job-boards.greenhouse.io/advancedspace/jobs/4324855009'}
    ],
    excludeEmails: [
      'abby.motson@pepsico.com', 'adam.wigley@momentive.com', 'alex.leet@cibc.com',
      'ashley.farmer@nike.com', 'audra.mazur@gehealthcare.com', 'barry@gehealthcare.com',
      'brielle.lambert@pepsico.com', 'byron.wallace@nike.com', 'charlotte.kehoe@nike.com',
      'chaus.nicholson@nike.com', 'christa.maguire@nike.com', 'cody.goodmen@ibotta.com',
      'connor.snashall@nike.com', 'david.jasso@nike.com', 'elliott.dykman@c3.ai',
      'harp.dhanota@c3.ai', 'jalen.carter@ibotta.com', 'javier.vargas@copart.com',
      'jeff.porter@nokia.com', 'jessica.hacker@amgen.com', 'jordan.mills@hearst.com',
      'justin@ibotta.com', 'kevin.clemens@cibc.com', 'kristy.bortle@thehartford.com',
      'marianna.murphy@c3.ai', 'michael.berube@thehartford.com', 'michael.lee@c3.ai',
      'natalie.henry@pepsico.com', 'neha.patel@pepsico.com', 'nick.kimball@copart.com',
      'omar.alvarez@c3.ai', 'ryan.watson@bylight.com', 'stacy.gabriel@thehartford.com',
      'tandra.smith@thehartford.com', 'thomas.geraci@cibc.com', 'thomas.stuyvesant@nike.com',
      'vaishnavi.venugopal@gehealthcare.com', 'willa.woods@pepsico.com'
    ]
  });
}

/** Manual off-Target recruiter wave, 7 employers, 2026-09-14 03:00 to 04:12 ET. */
function scheduleOffTargetRecruiterCampaign0914Early() {
  return scheduleTargetRecruiterCampaign_({
    propertyKey: 'OFFTARGET_RECRUITER_CAMPAIGN_20260914_EARLY',
    handler: 'runOffTargetRecruiterCampaignTick0914Early_',
    label: 'Off-Target early wave',
    startIso: '2026-09-14T03:00:00-04:00',
    spacingMinutes: 12,
    minGapMinutes: 11,
    companies: [
      {company: 'Amtrak', maxContacts: 1,
       role: 'Fall 2026/Spring 2027 Software Engineering Intern, Washington',
       jobLink: 'https://jobright.ai/jobs/info/6a95ac98c8763a3a87ffb40d?utm_campaign=1079&utm_source=git'},
      {company: 'Entrust', maxContacts: 1,
       role: 'Intern, Software Developer, Ottawa',
       jobLink: 'https://jobright.ai/jobs/info/6a9ec3aedacf777321a933a7?utm_campaign=1079&utm_source=git'},
      {company: 'Fidelity Investments', maxContacts: 1,
       role: 'Co-op, Software Engineer',
       jobLink: 'https://fmr.wd1.myworkdayjobs.com/targeted/job/Boston-MA/Co-op--Software-Engineer_2135200'},
      {company: 'Veeam Software', maxContacts: 1,
       role: 'Software Engineering Intern, Summer 2027',
       jobLink: 'https://job-boards.greenhouse.io/embed/job_app?for=veeamsoftware&token=4955293101&jr_id=6aa433181d92e2d05d113c5d'},
      {company: 'Hudl', maxContacts: 1,
       role: 'Software Engineering Intern',
       jobLink: 'https://job-boards.greenhouse.io/hudl/jobs/8114314'},
      {company: 'Cboe Global Markets', maxContacts: 1,
       role: 'Software Engineer Intern',
       jobLink: 'https://cboe.wd1.myworkdayjobs.com/en-US/external_career_cboe/job/Chicago-IL/Software-Engineer-Intern_R-4654'},
      {company: 'whatnot', maxContacts: 1,
       role: 'Software Engineer Intern (Summer 2027)',
       jobLink: 'https://jobs.ashbyhq.com/whatnot/928ffdca-b316-40ce-b82b-94b570919bcd/application?utm_source=Simplify'},
      {company: 'Emerson Electric', maxContacts: 1,
       role: 'Software Engineering Co-op (Jun to Dec 2027)',
       jobLink: 'https://hdjq.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/26010738'}
    ],
    excludeEmails: targetRecruiterCampaignEmails_('TARGET_RECRUITER_CAMPAIGN_20260914_WHATNOT').concat([
      'alex.huynh@verkada.com', 'christine.higgins@verkada.com', 'courtney@whatnot.com',
      'david.in@verkada.com', 'davis.tat@verkada.com', 'heather.trippet@fidelity.com',
      'jcortez@cboe.com', 'julie.fowler@verkada.com', 'marlane.velthouse@fidelity.com',
      'rae@whatnot.com', 'shawn.ricker@fidelity.com', 'stephanie.kang@verkada.com',
      'steve.donahue@entrust.com', 'steve@whatnot.com', 'taylor.scott@fidelity.com',
      'tbewley@cboe.com', 'trey.martin@fidelity.com', 'tyler.nevin@veeam.com',
      'winnie.lee@verkada.com', 'winnie@whatnot.com'
    ])
  });
}

/** Every-minute trigger for the 09/13 off-Target night wave. */
function runOffTargetRecruiterCampaignTick0913Night_() {
  return runTargetRecruiterCampaignTickFor_({
    propertyKey: 'OFFTARGET_RECRUITER_CAMPAIGN_20260913_NIGHT',
    handler: 'runOffTargetRecruiterCampaignTick0913Night_'
  });
}

/** Every-minute trigger for the 09/14 off-Target early wave. */
function runOffTargetRecruiterCampaignTick0914Early_() {
  return runTargetRecruiterCampaignTickFor_({
    propertyKey: 'OFFTARGET_RECRUITER_CAMPAIGN_20260914_EARLY',
    handler: 'runOffTargetRecruiterCampaignTick0914Early_'
  });
}

/**
 * Snapshot the owner-approved recent-app audit into one recruiter per company.
 * The audit itself checks the separate recruiter database and cold-email
 * history.  A fresh Advanced Gmail rejection preflight excludes only matching
 * rejections before a campaign is persisted; delivery repeats that check.
 */
function offTargetWeekendRecruiterSpecs_() {
  var audit = auditRecentOffTargetSummer2027RecruiterGaps();
  var rejectionCandidates = outreachGmailApiRejectionCandidates_();
  var blocked = [], specs = [];
  audit.companies.filter(function (candidate) {
    return candidate.needsNewColdEmail;
  }).forEach(function (candidate) {
    var app = (candidate.applications || []).slice().sort(function (left, right) {
      return String(right.dateApplied || '').localeCompare(String(left.dateApplied || ''));
    })[0] || {};
    var spec = {
      company: candidate.company,
      maxContacts: 1,
      role: app.role === '(role missing; assumed Summer 2027)'
        ? 'Software Engineering Intern (Summer 2027)' : app.role,
      jobLink: app.jobLink || ''
    };
    var result = outreachGmailApiRejectedTarget_(spec, rejectionCandidates);
    if (result.rejected) {
      blocked.push({company: spec.company, role: spec.role, reason: result.why});
    } else {
      specs.push(spec);
    }
  });
  return {asOf: audit.asOf, eligible: specs, blocked: blocked};
}

/**
 * Owner-approved weekend cold-email wave: one recruiter at each eligible
 * non-Target company, forty Saturday slots and every remaining company Sunday.
 */
function scheduleOffTargetRecruiterWeekend0919And0920() {
  var selection = offTargetWeekendRecruiterSpecs_();
  var saturday = selection.eligible.slice(0, 40);
  var sunday = selection.eligible.slice(40);
  var saturdayState = scheduleTargetRecruiterCampaign_({
    propertyKey: 'OFFTARGET_RECRUITER_CAMPAIGN_20260919_WEEKEND_SATURDAY',
    handler: 'runOffTargetRecruiterCampaignTick0919WeekendSaturday_',
    label: 'Off-Target weekend Saturday',
    startIso: '2026-09-19T09:00:00-04:00',
    spacingMinutes: 12,
    minGapMinutes: 11,
    companies: saturday
  });
  var sundayState = scheduleTargetRecruiterCampaign_({
    propertyKey: 'OFFTARGET_RECRUITER_CAMPAIGN_20260920_WEEKEND_SUNDAY',
    handler: 'runOffTargetRecruiterCampaignTick0920WeekendSunday_',
    label: 'Off-Target weekend Sunday',
    startIso: '2026-09-20T09:00:00-04:00',
    spacingMinutes: 12,
    minGapMinutes: 11,
    excludeEmails: targetRecruiterCampaignEmails_(
      'OFFTARGET_RECRUITER_CAMPAIGN_20260919_WEEKEND_SATURDAY'),
    companies: sunday
  });
  return {
    auditAsOf: selection.asOf,
    candidates: selection.eligible.length,
    rejectionBlocked: selection.blocked,
    saturday: saturdayState,
    sunday: sundayState,
    note: 'Only ' + sunday.length + ' distinct companies remain after Saturday; Sunday is intentionally not padded with repeats.'
  };
}

/** Every-minute delivery handler for the Saturday 2026-09-19 off-Target wave. */
function runOffTargetRecruiterCampaignTick0919WeekendSaturday_() {
  return runTargetRecruiterCampaignTickFor_({
    propertyKey: 'OFFTARGET_RECRUITER_CAMPAIGN_20260919_WEEKEND_SATURDAY',
    handler: 'runOffTargetRecruiterCampaignTick0919WeekendSaturday_'
  });
}

/** Every-minute delivery handler for the Sunday 2026-09-20 off-Target wave. */
function runOffTargetRecruiterCampaignTick0920WeekendSunday_() {
  return runTargetRecruiterCampaignTickFor_({
    propertyKey: 'OFFTARGET_RECRUITER_CAMPAIGN_20260920_WEEKEND_SUNDAY',
    handler: 'runOffTargetRecruiterCampaignTick0920WeekendSunday_'
  });
}

/**
 * Keep the weekend wave aligned with the 71-company audit reported to the
 * owner. Baird and Dow Jones appeared only in the later live recheck; neither
 * belonged to the reported set. This is safe only before any delivery, then
 * restores the requested 40/31 split without changing a recipient selection.
 */
function resplitOffTargetRecruiterWeekend0919And0920ToReported71() {
  var excluded = {baird: true, 'dow jones': true};
  var campaigns = [
    {key: 'OFFTARGET_RECRUITER_CAMPAIGN_20260919_WEEKEND_SATURDAY',
     startIso: '2026-09-19T09:00:00-04:00', expected: 40},
    {key: 'OFFTARGET_RECRUITER_CAMPAIGN_20260920_WEEKEND_SUNDAY',
     startIso: '2026-09-20T09:00:00-04:00', expected: 31}
  ];
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var props = PropertiesService.getScriptProperties();
    var states = campaigns.map(function (campaign) {
      var text = props.getProperty(campaign.key);
      if (!text) throw new Error('Missing weekend campaign ' + campaign.key + '.');
      var state = JSON.parse(text);
      if (state.status !== 'scheduled' || (state.entries || []).some(function (entry) {
        return entry.status !== 'pending';
      })) {
        throw new Error(campaign.key + ' must contain only pending entries to re-split.');
      }
      return {campaign: campaign, state: state};
    });
    var entries = states.reduce(function (all, item) {
      return all.concat(item.state.entries || []);
    }, []).filter(function (entry) {
      return !excluded[outreachNameKey_(entry.company)];
    });
    if (entries.length !== 71) {
      throw new Error('Expected 71 reported companies after the live-only exclusions; found '
        + entries.length + '.');
    }
    states.forEach(function (item, campaignIndex) {
      var start = campaignIndex === 0 ? 0 : 40;
      var subset = entries.slice(start, start + item.campaign.expected);
      var startMs = new Date(item.campaign.startIso).getTime();
      subset.forEach(function (entry, index) {
        entry.atMs = startMs + index * Number(item.state.spacingMinutes || 12) * 60000;
      });
      item.state.entries = subset;
      item.state.rescheduledAt = new Date().toISOString();
      props.setProperty(item.campaign.key, JSON.stringify(item.state));
    });
    refreshTargetQueueTabs_();
    return {saturday: 40, sunday: 31, excludedLiveOnly: ['Baird', 'Dow Jones']};
  } finally {
    lock.releaseLock();
  }
}

/** The four windows that hold the owner-approved 71-company weekend wave. */
function offTargetWeekendRetimingCampaigns_() {
  return [
    {key: 'OFFTARGET_RECRUITER_CAMPAIGN_20260919_WEEKEND_SATURDAY',
     handler: 'runOffTargetRecruiterCampaignTick0919WeekendSaturday_',
     label: 'Off-Target weekend Saturday', startIso: '2026-09-19T09:00:00-04:00'},
    {key: 'OFFTARGET_RECRUITER_CAMPAIGN_20260920_WEEKEND_SUNDAY',
     handler: 'runOffTargetRecruiterCampaignTick0920WeekendSunday_',
     label: 'Off-Target weekend Sunday', startIso: '2026-09-20T09:00:00-04:00'},
    {key: 'OFFTARGET_RECRUITER_CAMPAIGN_20260926_RECENT_SATURDAY',
     handler: 'runOffTargetRecruiterCampaignTick0926RecentSaturday_',
     label: 'Off-Target recent-app Saturday', startIso: '2026-09-26T09:00:00-04:00'},
    {key: 'OFFTARGET_RECRUITER_CAMPAIGN_20260927_RECENT_SUNDAY',
     handler: 'runOffTargetRecruiterCampaignTick0927RecentSunday_',
     label: 'Off-Target recent-app Sunday', startIso: '2026-09-27T09:00:00-04:00'}
  ];
}

/** Replace a still-pending direct campaign without reselecting a recruiter. */
function offTargetWeekendWriteRetimedCampaign_(props, campaign, entries, now) {
  var triggers = ScriptApp.getProjectTriggers().filter(function (trigger) {
    return trigger.getHandlerFunction() === campaign.handler;
  });
  if (!entries.length) {
    triggers.forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
    props.deleteProperty(campaign.key);
    return;
  }
  var existingText = props.getProperty(campaign.key);
  var state = existingText ? JSON.parse(existingText) : {};
  var spacingMinutes = Number(state.spacingMinutes || 12);
  var startMs = new Date(campaign.startIso).getTime();
  entries.forEach(function (entry, index) {
    entry.atMs = startMs + index * spacingMinutes * 60000;
    entry.status = 'pending';
  });
  state.status = 'scheduled';
  state.label = campaign.label;
  state.propertyKey = campaign.key;
  state.handler = campaign.handler;
  state.startIso = campaign.startIso;
  state.spacingMinutes = spacingMinutes;
  state.entries = entries;
  state.rescheduledAt = now;
  props.setProperty(campaign.key, JSON.stringify(state));
  if (!triggers.length) {
    ScriptApp.newTrigger(campaign.handler).timeBased().everyMinutes(1).create();
  }
}

/**
 * Whether an App title is a Software Engineer/Engineering Intern role. The
 * acronym is accepted, but developer, co-op and general engineering roles are
 * intentionally not broadened into this owner-requested filter.
 */
function offTargetSWEInternRole_(role) {
  var text = String(role || '').toLowerCase();
  return /\bintern(?:ship)?\b/.test(text) && (/\bswe\b/.test(text)
    || /\bsoftware\s+(?:engineer|engineering)\b/.test(text))
    && !/\bembedded\b|\bco[\s-]?op\b/.test(text);
}

/**
 * Move only the already-selected off-Target companies with a Software
 * Engineer/Engineering Intern App application in the latest five calendar
 * weeks (inclusive) to the following weekend.
 *
 * This is deliberately a pending-only retime: it never re-runs contact
 * selection, creates a Gmail draft, or sends mail. The returned application
 * snapshot is read from App while the retime is made, so the owner can see the
 * current application count rather than the old 71-company audit total.
 */
function moveRecentOffTargetWeekendApplicationsTo0926And0927() {
  var campaigns = offTargetWeekendRetimingCampaigns_();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var props = PropertiesService.getScriptProperties();
    var states = campaigns.map(function (campaign) {
      var text = props.getProperty(campaign.key);
      if (!text) return {campaign: campaign, state: null};
      var state = JSON.parse(text);
      if (state.status !== 'scheduled' || (state.entries || []).some(function (entry) {
        return entry.status !== 'pending';
      })) {
        throw new Error(campaign.key + ' must contain only pending entries to retime.');
      }
      return {campaign: campaign, state: state};
    });
    var entries = states.reduce(function (all, item) {
      return all.concat(item.state ? item.state.entries || [] : []);
    }, []).sort(function (left, right) {
      return Number(left.atMs || 0) - Number(right.atMs || 0)
        || String(left.company || '').localeCompare(String(right.company || ''));
    });
    var companyKeys = {};
    entries.forEach(function (entry) {
      var key = outreachNameKey_(entry.company);
      if (!key || companyKeys[key]) throw new Error('Weekend campaign has a duplicate or blank company.');
      companyKeys[key] = true;
    });
    if (entries.length !== 71) {
      throw new Error('Expected the protected 71-company weekend wave; found ' + entries.length + '.');
    }

    var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
    var apps = targetMirrorApplications_(tracker).filter(function (app) {
      return app.company && app.process !== STAGE_REJECTED;
    });
    var todayText = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
    var today = new Date(todayText + 'T00:00:00-04:00');
    var cutoff = outreachAddDays_(today, -34);
    var tomorrow = outreachAddDays_(today, 1);
    var snapshots = {};
    entries.forEach(function (entry) {
      var companyApps = apps.filter(function (app) {
        return outreachSameEmployer_(outreachCompanyTokens_(entry.company),
                                     outreachCompanyTokens_(app.company));
      });
      var recentApps = companyApps.filter(function (app) {
        return app.dateApplied && app.dateApplied.getTime() >= cutoff.getTime()
          && app.dateApplied.getTime() < tomorrow.getTime()
          && offTargetSWEInternRole_(app.role);
      });
      var latest = companyApps.slice().sort(function (left, right) {
        return Number(right.dateApplied || 0) - Number(left.dateApplied || 0);
      })[0];
      var selected = recentApps.slice().sort(function (left, right) {
        return Number(right.dateApplied || 0) - Number(left.dateApplied || 0)
          || String(left.role || '').localeCompare(String(right.role || ''));
      })[0];
      snapshots[outreachNameKey_(entry.company)] = {
        company: entry.company,
        currentApplications: companyApps.length,
        recentApplications: recentApps.length,
        selectedRole: selected ? selected.role : '',
        selectedJobLink: selected ? selected.link || selected.official || '' : '',
        latestApplied: latest && latest.dateApplied
          ? Utilities.formatDate(latest.dateApplied, 'America/New_York', 'yyyy-MM-dd') : ''
      };
    });
    var recent = entries.filter(function (entry) {
      return snapshots[outreachNameKey_(entry.company)].recentApplications > 0;
    });
    var retained = entries.filter(function (entry) {
      return snapshots[outreachNameKey_(entry.company)].recentApplications === 0;
    });
    recent.forEach(function (entry) {
      var selected = snapshots[outreachNameKey_(entry.company)];
      entry.role = selected.selectedRole;
      entry.jobLink = selected.selectedJobLink;
    });
    var nextSaturdayCount = Math.ceil(recent.length / 2);
    var partitions = [
      retained.slice(0, 40), retained.slice(40),
      recent.slice(0, nextSaturdayCount), recent.slice(nextSaturdayCount)
    ];
    var now = new Date().toISOString();
    campaigns.forEach(function (campaign, index) {
      offTargetWeekendWriteRetimedCampaign_(props, campaign, partitions[index], now);
    });
    refreshTargetQueueTabs_();
    var moved = recent.map(function (entry) {
      return snapshots[outreachNameKey_(entry.company)];
    });
    return {
      applicationWindow: Utilities.formatDate(cutoff, 'America/New_York', 'yyyy-MM-dd')
        + ' through ' + Utilities.formatDate(today, 'America/New_York', 'yyyy-MM-dd'),
      companies: entries.length,
      currentApplications: Object.keys(snapshots).reduce(function (sum, key) {
        return sum + snapshots[key].currentApplications;
      }, 0),
      recentApplications: moved.reduce(function (sum, item) {
        return sum + item.recentApplications;
      }, 0),
      roleFilter: 'Software Engineer/Engineering Intern only',
      movedCompanies: moved,
      scheduled: {
        '2026-09-19': partitions[0].length,
        '2026-09-20': partitions[1].length,
        '2026-09-26': partitions[2].length,
        '2026-09-27': partitions[3].length
      }
    };
  } finally {
    lock.releaseLock();
  }
}

/** Every-minute delivery handler for the recent-app Saturday 2026-09-26 wave. */
function runOffTargetRecruiterCampaignTick0926RecentSaturday_() {
  return runTargetRecruiterCampaignTickFor_({
    propertyKey: 'OFFTARGET_RECRUITER_CAMPAIGN_20260926_RECENT_SATURDAY',
    handler: 'runOffTargetRecruiterCampaignTick0926RecentSaturday_'
  });
}

/** Every-minute delivery handler for the recent-app Sunday 2026-09-27 wave. */
function runOffTargetRecruiterCampaignTick0927RecentSunday_() {
  return runTargetRecruiterCampaignTickFor_({
    propertyKey: 'OFFTARGET_RECRUITER_CAMPAIGN_20260927_RECENT_SUNDAY',
    handler: 'runOffTargetRecruiterCampaignTick0927RecentSunday_'
  });
}

/**
 * Move the two off-Target direct waves into the operational Email queue.
 *
 * This is a one-time migration, not a second scheduler. It preserves the exact
 * recruiter selected for each company, checks the live App and Gmail-rejection
 * state before writing anything, then removes both direct-send triggers and
 * campaign properties. The ordinary cold queue owns all later drafting, sending
 * and scheduling under its weekday cap.
 */
function migrateOffTargetRecruiterCampaignsToEmail() {
  var campaigns = [
    {propertyKey: 'OFFTARGET_RECRUITER_CAMPAIGN_20260913_NIGHT',
     handler: 'runOffTargetRecruiterCampaignTick0913Night_', idPrefix: 'NIGHT'},
    {propertyKey: 'OFFTARGET_RECRUITER_CAMPAIGN_20260914_EARLY',
     handler: 'runOffTargetRecruiterCampaignTick0914Early_', idPrefix: 'EARLY'}
  ];
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var props = PropertiesService.getScriptProperties();
    var states = campaigns.map(function (campaign) {
      var text = props.getProperty(campaign.propertyKey);
      if (!text) throw new Error('Missing direct campaign ' + campaign.propertyKey + '.');
      var state = JSON.parse(text);
      if (state.status !== 'scheduled') {
        throw new Error(campaign.propertyKey + ' is ' + state.status + ', not safely migratable.');
      }
      if ((state.entries || []).some(function (entry) { return entry.status !== 'pending'; })) {
        throw new Error(campaign.propertyKey + ' already has a non-pending entry.');
      }
      return {campaign: campaign, state: state};
    });
    var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
    var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
    var queue = tracker.getSheetByName(TAB_QUEUE);
    if (!queue) throw new Error('No ' + TAB_QUEUE + ' tab.');
    var apps = targetMirrorApplications_(tracker);
    var contacts = outreachReadContacts_(contactsBook);
    var salt = outreachProperty_(PROP_SALT, true);
    var targetCompanies = outreachColdTargetCompanies_(tracker);
    if (!targetCompanies) throw new Error('Target tab could not be read.');
    var queueRows = queue.getLastRow() < 2 ? []
      : queue.getRange(2, 1, queue.getLastRow() - 1, Q_WIDTH).getValues()
        .map(function (row, index) { return outreachParseQueue_(row, index); });
    var usedIds = {}, spent = {};
    queueRows.forEach(function (row) {
      if (row.id) usedIds[row.id] = true;
      if (row.fingerprint && STATUS_SPENDS_CONTACT.indexOf(row.status) !== -1) {
        spent[row.fingerprint] = true;
      }
    });
    var rejectionCandidates = outreachGmailApiRejectionCandidates_();
    var entries = [], blocked = [];
    states.forEach(function (item) {
      item.state.entries.forEach(function (entry, index) {
        var app = targetMirrorApplicationFor_(apps, entry);
        var id = 'OFFTARGET-EMAIL-' + item.campaign.idPrefix + '-' + (index + 1);
        if (usedIds[id]) throw new Error('Migration queue row already exists: ' + id + '.');
        if (!app) throw new Error('No App row for ' + entry.company + '.');
        var qualification = outreachStillQualifies_(app);
        if (!qualification.ok) throw new Error(entry.company + ': ' + qualification.why + '.');
        if (outreachCompanyOnTarget_(entry.company, targetCompanies)) {
          throw new Error(entry.company + ' is in Target and cannot enter Email.');
        }
        var companyContacts = outreachContactsFor_(contacts, entry.company);
        var contact = companyContacts.filter(function (person) {
          return String(person.email || '').toLowerCase() === String(entry.email || '').toLowerCase();
        })[0];
        if (!contact || contact.sent) throw new Error(entry.company + ' no longer has its selected contact.');
        if (GmailApp.search('from:me to:' + entry.email, 0, 1).length) {
          throw new Error(entry.company + ' already has sent mail to its selected contact.');
        }
        var rejection = outreachGmailApiRejectedTarget_(entry, rejectionCandidates);
        if (rejection.rejected) {
          blocked.push({company: entry.company,
                        reason: 'matching Gmail rejection: ' + rejection.why});
          return;
        }
        var fingerprint = outreachFingerprint_(entry.email, salt, outreachSeason_(app.role));
        if (spent[fingerprint]) throw new Error(entry.company + ' contact is already committed in Email.');
        spent[fingerprint] = true;
        entries.push({id: id, app: app, entry: entry, contacts: companyContacts,
                      fingerprint: fingerprint});
      });
    });
    var templateLoad = outreachColdTemplateLoad_(queueRows);
    var values = entries.map(function (item) {
      var template = outreachColdTemplateFor_(templateLoad);
      templateLoad[template] = (templateLoad[template] || 0) + 1;
      return outreachQueueRowValues_({
        id: item.id, property: item.app.property, company: item.entry.company,
        role: item.app.role, dateApplied: item.app.dateApplied,
        recruiters: item.contacts.length, attempt: 1, template: template,
        status: STATUS_QUEUED, mode: outreachAngleFor_(item.contacts) ? MODE_SEND : MODE_DRAFT,
        fingerprint: item.fingerprint,
        result: 'Migrated from direct off-Target campaign before send.'
      });
    });
    if (values.length) {
      queue.getRange(queue.getLastRow() + 1, 1, values.length, Q_WIDTH).setValues(values);
      outreachRepairQueueLayout_(queue);
      refreshOutreachSchedule();
      outreachSortQueueByTime_(queue);
    }
    ScriptApp.getProjectTriggers().forEach(function (trigger) {
      campaigns.forEach(function (campaign) {
        if (trigger.getHandlerFunction() === campaign.handler) ScriptApp.deleteTrigger(trigger);
      });
    });
    campaigns.forEach(function (campaign) { props.deleteProperty(campaign.propertyKey); });
    refreshTargetQueueTabs_();
    return {migrated: values.length, queued: values.length, blocked: blocked,
            directCampaignsCancelled: campaigns.length};
  } finally {
    lock.releaseLock();
  }
}

/**
 * Move the pending September 19/20/26/27 off-Target weekend wave into Email.
 *
 * Unlike the original one-time migration, these rows retain their explicit
 * weekend timestamps and their campaign-selected template. The normal Email
 * planner deliberately ignores their `OFFTARGET-EMAIL-WEEKEND-*` ids; the
 * dedicated minute sender remains their sole delivery path.
 */
function migrateOffTargetWeekendRecruiterCampaignsToEmail() {
  var campaigns = offTargetWeekendRetimingCampaigns_();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var props = PropertiesService.getScriptProperties();
    var states = campaigns.map(function (campaign) {
      var text = props.getProperty(campaign.key);
      if (!text) throw new Error('Missing direct weekend campaign ' + campaign.key + '.');
      var state = JSON.parse(text);
      if (state.status !== 'scheduled' || (state.entries || []).some(function (entry) {
        return entry.status !== 'pending';
      })) {
        throw new Error(campaign.key + ' must contain only pending entries to migrate.');
      }
      return {campaign: campaign, state: state};
    });
    var planned = states.reduce(function (all, item) {
      return all.concat(item.state.entries.map(function (entry) {
        return {campaign: item.campaign, entry: entry};
      }));
    }, []).sort(function (left, right) {
      return Number(left.entry.atMs || 0) - Number(right.entry.atMs || 0);
    });
    if (planned.length !== 71) {
      throw new Error('Expected 71 pending weekend entries; found ' + planned.length + '.');
    }
    var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
    var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
    var queue = tracker.getSheetByName(TAB_QUEUE);
    if (!queue) throw new Error('No ' + TAB_QUEUE + ' tab.');
    var apps = targetMirrorApplications_(tracker);
    var contacts = outreachReadContacts_(contactsBook);
    var salt = outreachProperty_(PROP_SALT, true);
    var targetCompanies = outreachColdTargetCompanies_(tracker);
    if (!targetCompanies) throw new Error('Target tab could not be read.');
    var queueRows = queue.getLastRow() < 2 ? []
      : queue.getRange(2, 1, queue.getLastRow() - 1, Q_WIDTH).getValues()
        .map(function (row, index) { return outreachParseQueue_(row, index); });
    var usedIds = {}, spent = {};
    queueRows.forEach(function (row) {
      if (row.id) usedIds[row.id] = true;
      if (row.fingerprint && STATUS_SPENDS_CONTACT.indexOf(row.status) !== -1) {
        spent[row.fingerprint] = true;
      }
    });
    var cancelled = [];
    var rowsToWrite = planned.map(function (item, index) {
      var entry = item.entry;
      var app = apps.filter(function (candidate) {
        return outreachSameEmployer_(outreachCompanyTokens_(candidate.company),
                                     outreachCompanyTokens_(entry.company))
          && outreachNameKey_(candidate.role) === outreachNameKey_(entry.role);
      })[0];
      var id = 'OFFTARGET-EMAIL-WEEKEND-' + Utilities.formatDate(
        new Date(entry.atMs), 'America/New_York', 'yyyyMMdd') + '-' + (index + 1);
      if (usedIds[id]) throw new Error('Migration queue row already exists: ' + id + '.');
      var fingerprint = outreachFingerprint_(entry.email, salt, outreachSeason_(entry.role));
      var companyContacts = outreachContactsFor_(contacts, entry.company);
      var reason = '';
      if (!app) reason = 'No matching App row remains for the selected role.';
      else {
        var qualification = outreachStillQualifies_(app);
        if (!qualification.ok) reason = qualification.why;
        else if (outreachCompanyOnTarget_(entry.company, targetCompanies)) {
          reason = 'Company is now in Target and may not receive off-Target cold email.';
        }
      }
      var contact = !reason && companyContacts.filter(function (person) {
        return String(person.email || '').toLowerCase() === String(entry.email || '').toLowerCase();
      })[0];
      if (!reason && (!contact || contact.sent)) reason = 'The selected recruiter is unavailable.';
      if (!reason && GmailApp.search('from:me to:' + entry.email, 0, 1).length) {
        reason = 'Already sent to the selected recruiter.';
      }
      if (!reason && spent[fingerprint]) reason = 'The selected recruiter is already committed in Email.';
      if (reason) cancelled.push({company: entry.company, reason: reason});
      else spent[fingerprint] = true;
      var values = outreachQueueRowValues_({
        id: id, property: app ? app.property : '', company: entry.company, role: entry.role,
        dateApplied: app && app.dateApplied, recruiters: companyContacts.length, attempt: 1,
        template: entry.template, status: reason ? STATUS_CANCELLED : STATUS_QUEUED, mode: MODE_SEND,
        fingerprint: fingerprint,
        result: reason ? 'Cancelled during migration: ' + reason
          : 'Explicit off-Target weekend timing; dedicated queue sender owns delivery.'
      });
      values[Q_SCHEDULED - 1] = new Date(entry.atMs);
      return values;
    });
    queue.getRange(queue.getLastRow() + 1, 1, rowsToWrite.length, Q_WIDTH).setValues(rowsToWrite);
    outreachRepairQueueLayout_(queue);
    ScriptApp.getProjectTriggers().forEach(function (trigger) {
      campaigns.forEach(function (campaign) {
        if (trigger.getHandlerFunction() === campaign.handler) ScriptApp.deleteTrigger(trigger);
      });
    });
    campaigns.forEach(function (campaign) { props.deleteProperty(campaign.key); });
    if (!ScriptApp.getProjectTriggers().some(function (trigger) {
      return trigger.getHandlerFunction() === 'runOffTargetEmailQueueTick_';
    })) {
      ScriptApp.newTrigger('runOffTargetEmailQueueTick_').timeBased().everyMinutes(1).create();
    }
    refreshTargetQueueTabs_();
    return {migrated: rowsToWrite.length, queued: rowsToWrite.length - cancelled.length,
      cancelled: cancelled, schedule: {
      '2026-09-19': planned.filter(function (item) {
        return Utilities.formatDate(new Date(item.entry.atMs), 'America/New_York', 'yyyy-MM-dd') === '2026-09-19';
      }).length,
      '2026-09-20': planned.filter(function (item) {
        return Utilities.formatDate(new Date(item.entry.atMs), 'America/New_York', 'yyyy-MM-dd') === '2026-09-20';
      }).length,
      '2026-09-26': planned.filter(function (item) {
        return Utilities.formatDate(new Date(item.entry.atMs), 'America/New_York', 'yyyy-MM-dd') === '2026-09-26';
      }).length,
      '2026-09-27': planned.filter(function (item) {
        return Utilities.formatDate(new Date(item.entry.atMs), 'America/New_York', 'yyyy-MM-dd') === '2026-09-27';
      }).length
    }};
  } finally {
    lock.releaseLock();
  }
}

// Hunter Domain Search results selected after the owner requested a live
// startup growth/value screen. Each is a verified technical recruiter; no
// generic HR or engineering-manager substitute is included.
var OFFTARGET_WEEKEND_STARTUP_HUNTER_RECRUITERS_ = [
  {company: 'Hadrian', name: 'Sebastien Garcia', email: 'sebastien.garcia@hadrian.co',
   role: 'Technical Recruiter', focus: 'technical', verify: 'valid', confidence: 84,
   appRole: 'Software Engineer Intern (also open for Fall 2026, Spring 2027)',
   jobLink: 'https://jobs.ashbyhq.com/hadrian-automation/2b0423c6-947d-4226-8d23-90743bd5e63e',
   source: 'Hunter Domain Search — owner approved 2026-09-15'},
  {company: 'Neuralink', name: 'Brandon Calle', email: 'brandon@neuralink.com',
   role: 'Technical Recruiter', focus: 'technical', verify: 'valid', confidence: 84,
   appRole: 'Software Engineer Intern, Implant',
   jobLink: 'https://job-boards.greenhouse.io/neuralink/jobs/6569018003?gh_jid=6569018003&gh_src=c356a2533us',
   source: 'Hunter Domain Search — owner approved 2026-09-15'},
  {company: 'Pacific Fusion', name: 'Evan Sowards', email: 'evan.sowards@pacificfusion.com',
   role: 'Technical Recruiter', focus: 'technical', verify: 'valid', confidence: 99,
   appRole: 'Software Engineer Intern',
   jobLink: 'https://job-boards.greenhouse.io/pacificfusion/jobs/4398373009?utm_source=Simplify',
   source: 'Hunter Domain Search — owner approved 2026-09-15'}
];

/** Append only the selected Hunter-verified startup recruiters to Contacts (manual). */
function appendOffTargetWeekendStartupHunterRecruiters_() {
  var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
  var known = {};
  outreachReadContacts_(contactsBook).forEach(function (contact) { known[contact.email] = true; });
  var sheet = contactsBook.getSheetByName(TAB_CONTACTS_MANUAL);
  if (!sheet) throw new Error('Contacts (manual) is missing.');
  var rows = [], added = [];
  OFFTARGET_WEEKEND_STARTUP_HUNTER_RECRUITERS_.forEach(function (person) {
    var email = String(person.email || '').toLowerCase();
    if (!email || known[email]) return;
    var row = new Array(C_WIDTH).fill('');
    row[C_COMPANY - 1] = person.company;
    row[C_NAME - 1] = person.name;
    row[C_EMAIL - 1] = email;
    row[C_ROLE - 1] = person.role;
    row[C_FOCUS - 1] = person.focus;
    row[C_VERIFY - 1] = person.verify;
    row[C_FROM - 1] = person.source;
    rows.push(row);
    added.push({company: person.company, name: person.name, role: person.role,
                confidence: person.confidence});
    known[email] = true;
  });
  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, C_WIDTH).setValues(rows);
  return {added: added, existing: OFFTARGET_WEEKEND_STARTUP_HUNTER_RECRUITERS_.length - rows.length};
}

/**
 * Owner-approved startup supplement in the operational Email queue. The normal
 * planner ignores these explicit weekend ids; the existing dedicated minute
 * sender performs the final Gmail rejection check at delivery time.
 */
function scheduleOffTargetWeekendStartupRecruiters() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var contactsResult = appendOffTargetWeekendStartupHunterRecruiters_();
    var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
    var queue = tracker.getSheetByName(TAB_QUEUE);
    if (!queue) throw new Error('No ' + TAB_QUEUE + ' tab.');
    var apps = targetMirrorApplications_(tracker);
    var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
    var contacts = outreachReadContacts_(contactsBook);
    var salt = outreachProperty_(PROP_SALT, true);
    var targetCompanies = outreachColdTargetCompanies_(tracker);
    if (!targetCompanies) throw new Error('Target tab could not be read.');
    var queueRows = queue.getLastRow() < 2 ? []
      : queue.getRange(2, 1, queue.getLastRow() - 1, Q_WIDTH).getValues()
        .map(function (row, index) { return outreachParseQueue_(row, index); });
    var ids = {}, spent = {};
    queueRows.forEach(function (row) {
      if (row.id) ids[row.id] = true;
      if (row.fingerprint && STATUS_SPENDS_CONTACT.indexOf(row.status) !== -1) spent[row.fingerprint] = true;
    });
    var dayKey = '2026-09-20';
    var scheduled = queueRows.filter(function (row) {
      return row.scheduledAt && Utilities.formatDate(row.scheduledAt, 'America/New_York', 'yyyy-MM-dd') === dayKey
        && [STATUS_QUEUED, STATUS_DRAFTED, STATUS_SENT].indexOf(row.status) !== -1;
    }).length;
    Object.keys(PropertiesService.getScriptProperties().getProperties()).forEach(function (key) {
      if (key.indexOf('TARGET_RECRUITER_CAMPAIGN_') !== 0
          && key.indexOf('TARGET_REFERRAL_CAMPAIGN_') !== 0) return;
      try {
        (JSON.parse(PropertiesService.getScriptProperties().getProperty(key)).entries || []).forEach(function (entry) {
          if (entry.atMs && Utilities.formatDate(new Date(entry.atMs), 'America/New_York', 'yyyy-MM-dd') === dayKey
              && ['pending', 'queued', 'drafted', 'sent'].indexOf(String(entry.status || '').toLowerCase()) !== -1) {
            scheduled++;
          }
        });
      } catch (ignored) {}
    });
    if (scheduled + OFFTARGET_WEEKEND_STARTUP_HUNTER_RECRUITERS_.length > 55) {
      throw new Error('September 20 would exceed 55 planned emails.');
    }
    var startMs = new Date('2026-09-20T09:12:00-04:00').getTime();
    var rows = OFFTARGET_WEEKEND_STARTUP_HUNTER_RECRUITERS_.map(function (person, index) {
      var id = 'OFFTARGET-EMAIL-WEEKEND-STARTUP-20260920-' + (index + 1);
      if (ids[id]) throw new Error('Startup queue row already exists: ' + id + '.');
      var app = apps.filter(function (candidate) {
        return outreachSameEmployer_(outreachCompanyTokens_(candidate.company),
                                     outreachCompanyTokens_(person.company))
          && outreachNameKey_(candidate.role) === outreachNameKey_(person.appRole);
      })[0];
      if (!app) throw new Error('No matching App row for ' + person.company + '.');
      var qualification = outreachStillQualifies_(app);
      if (!qualification.ok) throw new Error(person.company + ': ' + qualification.why + '.');
      if (outreachCompanyOnTarget_(person.company, targetCompanies)) {
        throw new Error(person.company + ' is now in Target.');
      }
      var contact = outreachContactsFor_(contacts, person.company).filter(function (candidate) {
        return String(candidate.email || '').toLowerCase() === String(person.email).toLowerCase();
      })[0];
      if (!contact || contact.sent) throw new Error(person.company + ' recruiter is unavailable.');
      if (GmailApp.search('from:me to:' + person.email, 0, 1).length) {
        throw new Error(person.company + ' recruiter already has an outbound thread.');
      }
      var fingerprint = outreachFingerprint_(person.email, salt, outreachSeason_(person.appRole));
      if (spent[fingerprint]) throw new Error(person.company + ' recruiter is already committed.');
      spent[fingerprint] = true;
      var values = outreachQueueRowValues_({
        id: id, property: app.property, company: person.company, role: person.appRole,
        dateApplied: app.dateApplied, recruiters: outreachContactsFor_(contacts, person.company).length,
        attempt: 1, template: ((queueRows.length + index) % COLD_TEMPLATES.length) + 1,
        status: STATUS_QUEUED, mode: MODE_SEND, fingerprint: fingerprint,
        result: 'Owner-approved startup supplement; Hunter verified technical recruiter.'
      });
      values[Q_SCHEDULED - 1] = new Date(startMs + index * 12 * 60000);
      return values;
    });
    queue.getRange(queue.getLastRow() + 1, 1, rows.length, Q_WIDTH).setValues(rows);
    outreachRepairQueueLayout_(queue);
    if (!ScriptApp.getProjectTriggers().some(function (trigger) {
      return trigger.getHandlerFunction() === 'runOffTargetEmailQueueTick_';
    })) {
      ScriptApp.newTrigger('runOffTargetEmailQueueTick_').timeBased().everyMinutes(1).create();
    }
    return {contacts: contactsResult, queued: rows.length, date: dayKey,
      scheduledBefore: scheduled, scheduledAfter: scheduled + rows.length};
  } finally {
    lock.releaseLock();
  }
}

// Startup career contacts selected after a recruiter-free database screen. All
// names are complete and every email has a synchronous MillionVerifier `ok`
// verdict; incomplete, catch-all and invalid candidates are excluded.
var OFFTARGET_WEEKEND_STARTUP_CAREERS_CONTACTS_ = [
  {company: 'Allen Control Systems', name: 'Brandon Miller', email: 'brandon@allencontrolsystems.com',
   role: 'Technical Recruiting Manager', focus: 'technical', appRole: 'Software Engineering Intern, 2027',
   scheduled: '2026-09-19T13:24:00-04:00'},
  {company: 'Nominal', name: 'Tasha Vance', email: 'tasha.vance@nominal.io', role: 'Head of Talent',
   focus: 'leadership', appRole: 'Software Engineer - Internship (Summer 2027)',
   scheduled: '2026-09-19T13:36:00-04:00'},
  {company: 'Juicebox', name: 'Farron McDonald', email: 'farron@juicebox.ai', role: 'Founding Recruiter',
   focus: 'technical', appRole: 'Software Engineer Intern', scheduled: '2026-09-20T13:24:00-04:00'},
  {company: 'General Matter', name: 'Brittany Miller', email: 'brittany@generalmatter.com',
   role: 'Head of Recruiting', focus: 'leadership', appRole: 'Summer 2027 Internship - Software Engineering',
   scheduled: '2026-09-20T13:36:00-04:00'}
];

/** Queue the owner-approved startup career contacts, without drafting or sending. */
function scheduleOffTargetWeekendStartupCareersContacts() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
    var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
    var queue = tracker.getSheetByName(TAB_QUEUE);
    var manual = contactsBook.getSheetByName(TAB_CONTACTS_MANUAL);
    if (!queue || !manual) throw new Error('Email or Contacts (manual) is missing.');
    var apps = targetMirrorApplications_(tracker), contacts = outreachReadContacts_(contactsBook);
    var targetCompanies = outreachColdTargetCompanies_(tracker);
    if (!targetCompanies) throw new Error('Target tab could not be read.');
    var queueRows = queue.getLastRow() < 2 ? [] : queue.getRange(2, 1, queue.getLastRow() - 1, Q_WIDTH)
      .getValues().map(function (row, index) { return outreachParseQueue_(row, index); });
    var known = {}, ids = {}, spent = {}, byDay = {};
    contacts.forEach(function (contact) { known[String(contact.email || '').toLowerCase()] = true; });
    queueRows.forEach(function (row) {
      if (row.id) ids[row.id] = true;
      if (row.fingerprint && STATUS_SPENDS_CONTACT.indexOf(row.status) !== -1) spent[row.fingerprint] = true;
      if (row.scheduledAt && [STATUS_QUEUED, STATUS_DRAFTED, STATUS_SENT].indexOf(row.status) !== -1) {
        var day = Utilities.formatDate(row.scheduledAt, 'America/New_York', 'yyyy-MM-dd');
        byDay[day] = (byDay[day] || 0) + 1;
      }
    });
    Object.keys(PropertiesService.getScriptProperties().getProperties()).forEach(function (key) {
      if (key.indexOf('TARGET_RECRUITER_CAMPAIGN_') !== 0 && key.indexOf('TARGET_REFERRAL_CAMPAIGN_') !== 0) return;
      try {
        (JSON.parse(PropertiesService.getScriptProperties().getProperty(key)).entries || []).forEach(function (entry) {
          if (!entry.atMs || ['pending', 'queued', 'drafted', 'sent'].indexOf(String(entry.status || '').toLowerCase()) === -1) return;
          var day = Utilities.formatDate(new Date(entry.atMs), 'America/New_York', 'yyyy-MM-dd');
          byDay[day] = (byDay[day] || 0) + 1;
        });
      } catch (ignored) {}
    });
    OFFTARGET_WEEKEND_STARTUP_CAREERS_CONTACTS_.forEach(function (person) {
      var day = Utilities.formatDate(new Date(person.scheduled), 'America/New_York', 'yyyy-MM-dd');
      byDay[day] = (byDay[day] || 0) + 1;
      if (byDay[day] > 55) throw new Error(day + ' would exceed 55 planned emails.');
    });
    var manualRows = [], added = [];
    OFFTARGET_WEEKEND_STARTUP_CAREERS_CONTACTS_.forEach(function (person) {
      var email = String(person.email).toLowerCase();
      if (known[email]) return;
      var row = new Array(C_WIDTH).fill('');
      row[C_COMPANY - 1] = person.company; row[C_NAME - 1] = person.name; row[C_EMAIL - 1] = email;
      row[C_ROLE - 1] = person.role; row[C_FOCUS - 1] = person.focus;
      row[C_VERIFY - 1] = 'debounce:Safe to Send';
      row[C_FROM - 1] = 'Treg directory + email finder + MillionVerifier ok — owner approved 2026-09-15';
      manualRows.push(row); added.push({company: person.company, name: person.name, role: person.role});
      known[email] = true;
    });
    if (manualRows.length) manual.getRange(manual.getLastRow() + 1, 1, manualRows.length, C_WIDTH).setValues(manualRows);
    contacts = outreachReadContacts_(contactsBook);
    var salt = outreachProperty_(PROP_SALT, true);
    var rows = OFFTARGET_WEEKEND_STARTUP_CAREERS_CONTACTS_.map(function (person, index) {
      var dateKey = Utilities.formatDate(new Date(person.scheduled), 'America/New_York', 'yyyyMMdd');
      var id = 'OFFTARGET-EMAIL-WEEKEND-CAREERS-' + dateKey + '-' + (index + 1);
      if (ids[id]) throw new Error('Career-contact queue row already exists: ' + id + '.');
      var app = apps.filter(function (candidate) {
        return outreachSameEmployer_(outreachCompanyTokens_(candidate.company), outreachCompanyTokens_(person.company))
          && outreachNameKey_(candidate.role) === outreachNameKey_(person.appRole);
      })[0];
      if (!app) throw new Error('No matching App row for ' + person.company + '.');
      var qualification = outreachStillQualifies_(app);
      if (!qualification.ok) throw new Error(person.company + ': ' + qualification.why + '.');
      if (outreachCompanyOnTarget_(person.company, targetCompanies)) throw new Error(person.company + ' is now in Target.');
      var contact = outreachContactsFor_(contacts, person.company).filter(function (candidate) {
        return String(candidate.email || '').toLowerCase() === String(person.email).toLowerCase();
      })[0];
      if (!contact || contact.sent) throw new Error(person.company + ' contact is unavailable.');
      if (GmailApp.search('from:me to:' + person.email, 0, 1).length) throw new Error(person.company + ' already has an outbound thread.');
      var fingerprint = outreachFingerprint_(person.email, salt, outreachSeason_(person.appRole));
      if (spent[fingerprint]) throw new Error(person.company + ' contact is already committed.');
      spent[fingerprint] = true;
      var values = outreachQueueRowValues_({id: id, property: app.property, company: person.company,
        role: person.appRole, dateApplied: app.dateApplied, recruiters: outreachContactsFor_(contacts, person.company).length,
        attempt: 1, template: ((queueRows.length + index) % COLD_TEMPLATES.length) + 1,
        status: STATUS_QUEUED, mode: MODE_SEND, fingerprint: fingerprint,
        result: 'Owner-approved startup career-contact supplement; MillionVerifier confirmed email.'});
      values[Q_SCHEDULED - 1] = new Date(person.scheduled);
      return values;
    });
    queue.getRange(queue.getLastRow() + 1, 1, rows.length, Q_WIDTH).setValues(rows);
    outreachRepairQueueLayout_(queue);
    if (!ScriptApp.getProjectTriggers().some(function (trigger) { return trigger.getHandlerFunction() === 'runOffTargetEmailQueueTick_'; })) {
      ScriptApp.newTrigger('runOffTargetEmailQueueTick_').timeBased().everyMinutes(1).create();
    }
    return {contactsAdded: added, queued: rows.length, plannedByDay: byDay};
  } finally {
    lock.releaseLock();
  }
}

// Treg's free people directories identified this careers-adjacent fallback only
// after the bounded recruiter screen returned no safe address for the other
// owner-selected startups. MillionVerifier returned `ok`, not catch-all.
var OFFTARGET_WEEKEND_STARTUP_TREG_CONTACTS_ = [
  {company: 'Maximor AI', name: 'Ajay Amudan', email: 'ajay@maximor.ai',
   role: 'Co-Founder and CTO', focus: 'leadership', appRole: 'Software engineering Intern',
   scheduled: '2026-09-19T13:48:00-04:00'}
];

// Juicebox has one already-booked founding-recruiter email. The free people
// directory found exactly two further current recruiting/careers contacts with
// complete names; the broader engineering roster is not a substitute for a
// recruiting audience. TryKitt returned SMTP-valid work mailboxes and
// MillionVerifier independently returned `ok` for both.
var OFFTARGET_JUICEBOX_RECRUITER_EXPANSION_20260920_ = [
  {company: 'Juicebox', name: 'Michelle Benoit', email: 'michelle@juicebox.ai',
   role: 'Senior Technical Recruiter', focus: 'technical', appRole: 'Software Engineer Intern',
   scheduled: '2026-09-20T13:48:00-04:00'},
  {company: 'Juicebox', name: 'Lauren Hoe', email: 'lauren@juicebox.ai',
   role: 'Talent Partner', focus: 'careers', appRole: 'Software Engineer Intern',
   scheduled: '2026-09-20T14:00:00-04:00'}
];

/**
 * Add the two verified recruiting contacts to Juicebox's existing direct
 * weekend Email row. The owner asked to send more, not to repurpose founders
 * or engineers as recruiter contacts, so this bounded expansion brings the
 * recruiting/careers wave from one to three and stops there.
 */
function scheduleOffTargetJuiceboxRecruiterExpansion20260920() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
    var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
    var queue = tracker.getSheetByName(TAB_QUEUE);
    var manual = contactsBook.getSheetByName(TAB_CONTACTS_MANUAL);
    if (!queue || !manual) throw new Error('Email or Contacts (manual) is missing.');
    var apps = targetMirrorApplications_(tracker);
    var targetCompanies = outreachColdTargetCompanies_(tracker);
    if (!targetCompanies) throw new Error('Target tab could not be read.');
    var queueRows = queue.getLastRow() < 2 ? [] : queue.getRange(2, 1, queue.getLastRow() - 1, Q_WIDTH)
      .getValues().map(function (row, index) { return outreachParseQueue_(row, index); });
    var ids = {}, spent = {}, byDay = {}, known = {};
    queueRows.forEach(function (row) {
      if (row.id) ids[row.id] = true;
      if (row.fingerprint && STATUS_SPENDS_CONTACT.indexOf(row.status) !== -1) spent[row.fingerprint] = true;
      if (row.scheduledAt && [STATUS_QUEUED, STATUS_DRAFTED, STATUS_SENT].indexOf(row.status) !== -1) {
        var day = Utilities.formatDate(row.scheduledAt, 'America/New_York', 'yyyy-MM-dd');
        byDay[day] = (byDay[day] || 0) + 1;
      }
    });
    Object.keys(PropertiesService.getScriptProperties().getProperties()).forEach(function (key) {
      if (key.indexOf('TARGET_RECRUITER_CAMPAIGN_') !== 0 && key.indexOf('TARGET_REFERRAL_CAMPAIGN_') !== 0) return;
      try {
        (JSON.parse(PropertiesService.getScriptProperties().getProperty(key)).entries || []).forEach(function (entry) {
          if (!entry.atMs || ['pending', 'queued', 'drafted', 'sent'].indexOf(String(entry.status || '').toLowerCase()) === -1) return;
          var day = Utilities.formatDate(new Date(entry.atMs), 'America/New_York', 'yyyy-MM-dd');
          byDay[day] = (byDay[day] || 0) + 1;
        });
      } catch (ignored) {}
    });
    var pending = OFFTARGET_JUICEBOX_RECRUITER_EXPANSION_20260920_.filter(function (person, index) {
      return !ids['OFFTARGET-EMAIL-WEEKEND-JUICEBOX-20260920-' + (index + 1)];
    });
    if (!pending.length) return {alreadyQueued: true, plannedByDay: byDay};
    var dayKey = '2026-09-20';
    if ((byDay[dayKey] || 0) + pending.length > 55) {
      throw new Error(dayKey + ' would exceed 55 planned emails.');
    }
    var app = apps.filter(function (candidate) {
      return outreachSameEmployer_(outreachCompanyTokens_(candidate.company), outreachCompanyTokens_('Juicebox'))
        && outreachNameKey_(candidate.role) === outreachNameKey_('Software Engineer Intern');
    })[0];
    if (!app) throw new Error('No matching App row for Juicebox.');
    var qualification = outreachStillQualifies_(app);
    if (!qualification.ok) throw new Error('Juicebox: ' + qualification.why + '.');
    if (outreachCompanyOnTarget_('Juicebox', targetCompanies)) throw new Error('Juicebox is now in Target.');
    var rejection = outreachGmailApiRejectedTarget_(
      {company: 'Juicebox', role: 'Software Engineer Intern'}, outreachGmailApiRejectionCandidates_());
    if (rejection.rejected) throw new Error('Juicebox is blocked by a matching Gmail rejection: ' + rejection.why + '.');
    var contacts = outreachReadContacts_(contactsBook);
    contacts.forEach(function (contact) { known[String(contact.email || '').toLowerCase()] = true; });
    var manualRows = [], added = [];
    pending.forEach(function (person) {
      var email = String(person.email).toLowerCase();
      if (known[email]) return;
      var row = new Array(C_WIDTH).fill('');
      row[C_COMPANY - 1] = person.company; row[C_NAME - 1] = person.name; row[C_EMAIL - 1] = email;
      row[C_ROLE - 1] = person.role; row[C_FOCUS - 1] = person.focus;
      row[C_VERIFY - 1] = 'millionverifier:ok';
      row[C_FROM - 1] = 'Treg people search + TryKitt email finder + MillionVerifier ok — owner approved 2026-09-16';
      manualRows.push(row); added.push({company: person.company, name: person.name, role: person.role});
      known[email] = true;
    });
    if (manualRows.length) manual.getRange(manual.getLastRow() + 1, 1, manualRows.length, C_WIDTH).setValues(manualRows);
    contacts = outreachReadContacts_(contactsBook);
    var salt = outreachProperty_(PROP_SALT, true);
    var rows = pending.map(function (person, index) {
      var email = String(person.email).toLowerCase();
      var contact = outreachContactsFor_(contacts, person.company).filter(function (candidate) {
        return String(candidate.email || '').toLowerCase() === email;
      })[0];
      if (!contact || contact.sent) throw new Error(person.name + ' is unavailable.');
      if (GmailApp.search('from:me to:' + email, 0, 1).length) throw new Error(person.name + ' already has an outbound thread.');
      var fingerprint = outreachFingerprint_(email, salt, outreachSeason_(person.appRole));
      if (spent[fingerprint]) throw new Error(person.name + ' is already committed.');
      spent[fingerprint] = true;
      var id = 'OFFTARGET-EMAIL-WEEKEND-JUICEBOX-20260920-'
        + (OFFTARGET_JUICEBOX_RECRUITER_EXPANSION_20260920_.indexOf(person) + 1);
      var values = outreachQueueRowValues_({
        id: id, property: app.property, company: person.company, role: person.appRole,
        dateApplied: app.dateApplied, recruiters: outreachContactsFor_(contacts, person.company).length,
        attempt: 1, template: ((queueRows.length + index) % COLD_TEMPLATES.length) + 1,
        status: STATUS_QUEUED, mode: MODE_SEND, fingerprint: fingerprint,
        result: 'Owner-approved Juicebox recruiter expansion; Treg/TryKitt and MillionVerifier confirmed email.'
      });
      values[Q_SCHEDULED - 1] = new Date(person.scheduled);
      return values;
    });
    queue.getRange(queue.getLastRow() + 1, 1, rows.length, Q_WIDTH).setValues(rows);
    outreachRepairQueueLayout_(queue);
    if (!ScriptApp.getProjectTriggers().some(function (trigger) {
      return trigger.getHandlerFunction() === 'runOffTargetEmailQueueTick_';
    })) ScriptApp.newTrigger('runOffTargetEmailQueueTick_').timeBased().everyMinutes(1).create();
    byDay[dayKey] = (byDay[dayKey] || 0) + rows.length;
    return {contactsAdded: added, queued: rows.length, plannedByDay: byDay};
  } finally {
    lock.releaseLock();
  }
}

/**
 * Queue only the Treg-sourced startup contact that has a synchronous `ok`
 * verifier outcome. This is intentionally separate from the earlier bounded
 * career-contact run so its one-off evidence and idempotent queue id remain
 * auditable without retiming or reselecting existing weekend recipients.
 */
function scheduleOffTargetWeekendStartupTregContacts() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
    var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
    var queue = tracker.getSheetByName(TAB_QUEUE);
    var manual = contactsBook.getSheetByName(TAB_CONTACTS_MANUAL);
    if (!queue || !manual) throw new Error('Email or Contacts (manual) is missing.');
    var apps = targetMirrorApplications_(tracker), contacts = outreachReadContacts_(contactsBook);
    var targetCompanies = outreachColdTargetCompanies_(tracker);
    if (!targetCompanies) throw new Error('Target tab could not be read.');
    var queueRows = queue.getLastRow() < 2 ? [] : queue.getRange(2, 1, queue.getLastRow() - 1, Q_WIDTH)
      .getValues().map(function (row, index) { return outreachParseQueue_(row, index); });
    var ids = {}, spent = {}, byDay = {}, known = {};
    queueRows.forEach(function (row) {
      if (row.id) ids[row.id] = true;
      if (row.fingerprint && STATUS_SPENDS_CONTACT.indexOf(row.status) !== -1) spent[row.fingerprint] = true;
      if (row.scheduledAt && [STATUS_QUEUED, STATUS_DRAFTED, STATUS_SENT].indexOf(row.status) !== -1) {
        var day = Utilities.formatDate(row.scheduledAt, 'America/New_York', 'yyyy-MM-dd');
        byDay[day] = (byDay[day] || 0) + 1;
      }
    });
    contacts.forEach(function (contact) { known[String(contact.email || '').toLowerCase()] = true; });
    Object.keys(PropertiesService.getScriptProperties().getProperties()).forEach(function (key) {
      if (key.indexOf('TARGET_RECRUITER_CAMPAIGN_') !== 0 && key.indexOf('TARGET_REFERRAL_CAMPAIGN_') !== 0) return;
      try {
        (JSON.parse(PropertiesService.getScriptProperties().getProperty(key)).entries || []).forEach(function (entry) {
          if (!entry.atMs || ['pending', 'queued', 'drafted', 'sent'].indexOf(String(entry.status || '').toLowerCase()) === -1) return;
          var day = Utilities.formatDate(new Date(entry.atMs), 'America/New_York', 'yyyy-MM-dd');
          byDay[day] = (byDay[day] || 0) + 1;
        });
      } catch (ignored) {}
    });
    var person = OFFTARGET_WEEKEND_STARTUP_TREG_CONTACTS_[0];
    var id = 'OFFTARGET-EMAIL-WEEKEND-TREG-20260919-1';
    if (ids[id]) return {alreadyQueued: true, id: id, plannedByDay: byDay};
    var dayKey = Utilities.formatDate(new Date(person.scheduled), 'America/New_York', 'yyyy-MM-dd');
    if ((byDay[dayKey] || 0) + 1 > 55) throw new Error(dayKey + ' would exceed 55 planned emails.');
    var app = apps.filter(function (candidate) {
      return outreachSameEmployer_(outreachCompanyTokens_(candidate.company), outreachCompanyTokens_(person.company))
        && outreachNameKey_(candidate.role) === outreachNameKey_(person.appRole);
    })[0];
    if (!app) throw new Error('No matching App row for ' + person.company + '.');
    var qualification = outreachStillQualifies_(app);
    if (!qualification.ok) throw new Error(person.company + ': ' + qualification.why + '.');
    if (outreachCompanyOnTarget_(person.company, targetCompanies)) throw new Error(person.company + ' is now in Target.');
    if (GmailApp.search('from:me to:' + person.email, 0, 1).length) throw new Error(person.company + ' already has an outbound thread.');
    var salt = outreachProperty_(PROP_SALT, true);
    var fingerprint = outreachFingerprint_(person.email, salt, outreachSeason_(person.appRole));
    if (spent[fingerprint]) throw new Error(person.company + ' contact is already committed.');
    var added = false;
    if (!known[String(person.email).toLowerCase()]) {
      var manualRow = new Array(C_WIDTH).fill('');
      manualRow[C_COMPANY - 1] = person.company; manualRow[C_NAME - 1] = person.name;
      manualRow[C_EMAIL - 1] = String(person.email).toLowerCase(); manualRow[C_ROLE - 1] = person.role;
      manualRow[C_FOCUS - 1] = person.focus; manualRow[C_VERIFY - 1] = 'debounce:Safe to Send';
      manualRow[C_FROM - 1] = 'Treg directory + email finder + MillionVerifier ok — owner approved 2026-09-15';
      manual.getRange(manual.getLastRow() + 1, 1, 1, C_WIDTH).setValues([manualRow]);
      added = true;
      contacts = outreachReadContacts_(contactsBook);
    }
    var contact = outreachContactsFor_(contacts, person.company).filter(function (candidate) {
      return String(candidate.email || '').toLowerCase() === String(person.email).toLowerCase();
    })[0];
    if (!contact || contact.sent) throw new Error(person.company + ' contact is unavailable.');
    var values = outreachQueueRowValues_({id: id, property: app.property, company: person.company,
      role: person.appRole, dateApplied: app.dateApplied, recruiters: outreachContactsFor_(contacts, person.company).length,
      attempt: 1, template: (queueRows.length % COLD_TEMPLATES.length) + 1,
      status: STATUS_QUEUED, mode: MODE_SEND, fingerprint: fingerprint,
      result: 'Owner-approved startup career-contact supplement; Treg and MillionVerifier confirmed email.'});
    values[Q_SCHEDULED - 1] = new Date(person.scheduled);
    queue.getRange(queue.getLastRow() + 1, 1, 1, Q_WIDTH).setValues([values]);
    outreachRepairQueueLayout_(queue);
    if (!ScriptApp.getProjectTriggers().some(function (trigger) { return trigger.getHandlerFunction() === 'runOffTargetEmailQueueTick_'; })) {
      ScriptApp.newTrigger('runOffTargetEmailQueueTick_').timeBased().everyMinutes(1).create();
    }
    byDay[dayKey] = (byDay[dayKey] || 0) + 1;
    return {contactsAdded: added ? [{company: person.company, name: person.name, role: person.role}] : [],
      queued: 1, scheduled: person.scheduled, plannedByDay: byDay};
  } finally {
    lock.releaseLock();
  }
}

/**
 * Owner-approved pending-only rebalance of the explicit Sep 19/20 off-Target
 * Email wave. Keeps the first 22 Saturday recipients in place and moves the
 * remaining 18 Saturday recipients after the four existing Sunday rows, for
 * exactly 22 queued sends each day. It neither drafts nor sends mail.
 */
function rebalanceOffTargetWeekendEmail0919And0920() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
    var queue = tracker.getSheetByName(TAB_QUEUE);
    if (!queue || queue.getLastRow() < 2) throw new Error('No Email rows found.');
    var rows = queue.getRange(2, 1, queue.getLastRow() - 1, Q_WIDTH).getValues()
      .map(function (row, index) { return outreachParseQueue_(row, index); });
    var saturday = rows.filter(function (row) {
      return row.status === STATUS_QUEUED && outreachOffTargetEmailQueueRow_(row)
        && row.scheduledAt && Utilities.formatDate(row.scheduledAt, 'America/New_York', 'yyyy-MM-dd') === '2026-09-19';
    }).sort(function (left, right) { return left.scheduledAt - right.scheduledAt; });
    var sunday = rows.filter(function (row) {
      return row.status === STATUS_QUEUED && outreachOffTargetEmailQueueRow_(row)
        && row.scheduledAt && Utilities.formatDate(row.scheduledAt, 'America/New_York', 'yyyy-MM-dd') === '2026-09-20';
    }).sort(function (left, right) { return left.scheduledAt - right.scheduledAt; });
    if (saturday.length !== 40 || sunday.length !== 4) {
      throw new Error('Expected 40 pending Sep 19 and 4 pending Sep 20 off-Target rows; found '
        + saturday.length + ' and ' + sunday.length + '.');
    }
    var retainedSaturday = saturday.slice(0, 22);
    var movedToSunday = saturday.slice(22);
    var saturdayStart = new Date('2026-09-19T09:00:00-04:00').getTime();
    var sundayStart = new Date('2026-09-20T09:00:00-04:00').getTime();
    retainedSaturday.forEach(function (row, index) {
      var updates = {};
      updates[Q_SCHEDULED] = new Date(saturdayStart + index * 12 * 60000);
      updates[Q_RESULT] = 'Explicit off-Target weekend timing; rebalanced by owner request (22/22).';
      outreachWriteRow_(queue, row.rowNumber, updates);
    });
    sunday.concat(movedToSunday).forEach(function (row, index) {
      var updates = {};
      updates[Q_SCHEDULED] = new Date(sundayStart + index * 12 * 60000);
      updates[Q_RESULT] = 'Explicit off-Target weekend timing; rebalanced by owner request (22/22).';
      outreachWriteRow_(queue, row.rowNumber, updates);
    });
    return {saturday: retainedSaturday.length, sunday: sunday.length + movedToSunday.length,
      moved: movedToSunday.length, spacingMinutes: 12};
  } finally {
    lock.releaseLock();
  }
}

/** Read-only confirmation of the off-Target rows now owned by the Email queue. */
function diagnoseOffTargetMigrationToEmail() {
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var queue = tracker.getSheetByName(TAB_QUEUE);
  if (!queue || queue.getLastRow() < 2) return {total: 0, byStatus: {}, bySchedule: {}};
  var byStatus = {}, bySchedule = {};
  queue.getRange(2, 1, queue.getLastRow() - 1, Q_WIDTH).getValues()
    .map(function (row, index) { return outreachParseQueue_(row, index); })
    .filter(function (row) { return /^OFFTARGET-EMAIL-/.test(row.id || ''); })
    .forEach(function (row) {
      byStatus[row.status || 'blank'] = (byStatus[row.status || 'blank'] || 0) + 1;
      var day = row.scheduledAt
        ? Utilities.formatDate(row.scheduledAt, 'America/New_York', 'yyyy-MM-dd')
        : 'unscheduled';
      bySchedule[day] = (bySchedule[day] || 0) + 1;
    });
  var total = Object.keys(byStatus).reduce(function (sum, status) { return sum + byStatus[status]; }, 0);
  return {total: total, byStatus: byStatus, bySchedule: bySchedule};
}

/** Restore the requested 23:00 and 03:00 timings after the one-time Email migration. */
function restoreOffTargetEmailQueueTiming() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
    var queue = tracker.getSheetByName(TAB_QUEUE);
    if (!queue || queue.getLastRow() < 2) throw new Error('No migrated Email rows found.');
    var rows = queue.getRange(2, 1, queue.getLastRow() - 1, Q_WIDTH).getValues()
      .map(function (row, index) { return outreachParseQueue_(row, index); });
    var restored = 0;
    rows.forEach(function (row) {
      if (!outreachOffTargetEmailQueueRow_(row) || row.status !== STATUS_QUEUED) return;
      var match = /^OFFTARGET-EMAIL-(NIGHT|EARLY)-(\d+)$/.exec(row.id);
      if (!match) return;
      var start = match[1] === 'NIGHT'
        ? new Date('2026-09-13T23:00:00-04:00')
        : new Date('2026-09-14T03:00:00-04:00');
      var spacing = match[1] === 'NIGHT' ? 2 : 12;
      var at = new Date(start.getTime() + (Number(match[2]) - 1) * spacing * 60000);
      var updates = {};
      updates[Q_DRAFTED_AT] = '';
      updates[Q_SCHEDULED] = at;
      updates[Q_RESULT] = 'Explicit off-Target Email timing; direct queue sender owns delivery.';
      outreachWriteRow_(queue, row.rowNumber, updates);
      restored++;
    });
    ScriptApp.getProjectTriggers().forEach(function (trigger) {
      if (trigger.getHandlerFunction() === 'runOffTargetEmailQueueTick_') {
        ScriptApp.deleteTrigger(trigger);
      }
    });
    ScriptApp.newTrigger('runOffTargetEmailQueueTick_').timeBased().everyMinutes(1).create();
    return {restored: restored, trigger: 'runOffTargetEmailQueueTick_'};
  } finally {
    lock.releaseLock();
  }
}

/** Restore Micron's original 23:36 Email row after its false rejection block. */
function restoreMicronOffTargetEmailRow() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
    var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
    var queue = tracker.getSheetByName(TAB_QUEUE);
    var apps = targetMirrorApplications_(tracker);
    var app = apps.filter(function (item) {
      return outreachNameKey_(item.company) === outreachNameKey_('Micron Technology')
        && outreachNameKey_(item.role) === outreachNameKey_('Intern, Software Engineer');
    })[0];
    if (!app) throw new Error('Micron Software Engineer Intern App row is missing.');
    var qualification = outreachStillQualifies_(app);
    if (!qualification.ok) throw new Error('Micron: ' + qualification.why + '.');
    var rows = queue.getLastRow() < 2 ? []
      : queue.getRange(2, 1, queue.getLastRow() - 1, Q_WIDTH).getValues()
        .map(function (row, index) { return outreachParseQueue_(row, index); });
    if (rows.some(function (row) { return row.id === 'OFFTARGET-EMAIL-NIGHT-19'; })) {
      return {alreadyRestored: true};
    }
    var contacts = outreachReadContacts_(contactsBook);
    var salt = outreachProperty_(PROP_SALT, true);
    var spent = {};
    rows.forEach(function (row) {
      if (row.fingerprint && STATUS_SPENDS_CONTACT.indexOf(row.status) !== -1) spent[row.fingerprint] = true;
    });
    var contact = outreachContactsFor_(contacts, app.company).filter(function (person) {
      if (person.sent || GmailApp.search('from:me to:' + person.email, 0, 1).length) return false;
      var fingerprint = outreachFingerprint_(person.email, salt, outreachSeason_(app.role));
      return !spent[fingerprint];
    }).sort(function (left, right) {
      return (left.name || left.email).localeCompare(right.name || right.email);
    })[0];
    if (!contact) throw new Error('No sendable Micron recruiter remains.');
    var rejection = outreachGmailApiRejectedTarget_({company: app.company, role: app.role, jobLink: app.link});
    if (rejection.rejected) throw new Error('Micron has a matching Gmail rejection: ' + rejection.why + '.');
    var templateLoad = outreachColdTemplateLoad_(rows);
    var template = outreachColdTemplateFor_(templateLoad);
    var row = outreachQueueRowValues_({
      id: 'OFFTARGET-EMAIL-NIGHT-19', property: app.property, company: app.company,
      role: app.role, dateApplied: app.dateApplied,
      recruiters: outreachContactsFor_(contacts, app.company).length, attempt: 1,
      template: template, status: STATUS_QUEUED,
      mode: outreachAngleFor_(outreachContactsFor_(contacts, app.company)) ? MODE_SEND : MODE_DRAFT,
      fingerprint: outreachFingerprint_(contact.email, salt, outreachSeason_(app.role)),
      result: 'Restored after acknowledgment email was confirmed not to be a rejection.'
    });
    row[Q_SCHEDULED - 1] = new Date('2026-09-13T23:36:00-04:00');
    queue.getRange(queue.getLastRow() + 1, 1, 1, Q_WIDTH).setValues([row]);
    outreachRepairQueueLayout_(queue);
    return {restored: true, scheduled: '2026-09-13 23:36 EDT'};
  } finally {
    lock.releaseLock();
  }
}

/** Send one due explicitly timed off-Target Email row, preserving its queue record. */
function runOffTargetEmailQueueTick_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return {skipped: true, reason: 'lock busy'};
  try {
    var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
    var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
    var queue = tracker.getSheetByName(TAB_QUEUE);
    var now = new Date();
    var rows = queue.getLastRow() < 2 ? []
      : queue.getRange(2, 1, queue.getLastRow() - 1, Q_WIDTH).getValues()
        .map(function (row, index) { return outreachParseQueue_(row, index); });
    var due = rows.filter(function (row) {
      return outreachOffTargetEmailQueueRow_(row) && row.status === STATUS_QUEUED
        && row.scheduledAt && row.scheduledAt.getTime() <= now.getTime();
    }).sort(function (left, right) { return left.scheduledAt.getTime() - right.scheduledAt.getTime(); })[0];
    if (!due) return {skipped: true, reason: 'nothing due'};
    var apps = targetMirrorApplications_(tracker);
    var app = apps.filter(function (item) { return item.property === due.property; })[0];
    var qualification = outreachStillQualifies_(app);
    if (!qualification.ok) {
      var cancelled = {}; cancelled[Q_STATUS] = STATUS_CANCELLED; cancelled[Q_RESULT] = qualification.why;
      outreachWriteRow_(queue, due.rowNumber, cancelled);
      return {cancelled: true, company: due.company, reason: qualification.why};
    }
    var contacts = outreachReadContacts_(contactsBook);
    var salt = outreachProperty_(PROP_SALT, true);
    var contact = outreachContactByFingerprint_(outreachContactsFor_(contacts, due.company), due.fingerprint, salt);
    if (!contact || contact.sent) {
      var unavailable = {}; unavailable[Q_STATUS] = STATUS_CANCELLED;
      unavailable[Q_RESULT] = 'The selected recruiter is no longer available.';
      outreachWriteRow_(queue, due.rowNumber, unavailable);
      return {cancelled: true, company: due.company, reason: 'contact unavailable'};
    }
    if (GmailApp.search('from:me to:' + contact.email, 0, 1).length) {
      var already = {}; already[Q_STATUS] = STATUS_CANCELLED;
      already[Q_RESULT] = 'Already sent to this recruiter; direct send skipped.';
      outreachWriteRow_(queue, due.rowNumber, already);
      return {cancelled: true, company: due.company, reason: 'already sent'};
    }
    var rejection = outreachGmailApiRejectedTarget_({company: due.company, role: due.role},
                                                     outreachGmailApiRejectionCandidates_());
    if (rejection.rejected) {
      var blocked = {}; blocked[Q_STATUS] = STATUS_CANCELLED;
      blocked[Q_RESULT] = 'Blocked before sending: Gmail API found a matching rejection (' + rejection.why + ').';
      outreachWriteRow_(queue, due.rowNumber, blocked);
      return {blocked: true, company: due.company, reason: 'matching Gmail rejection'};
    }
    var mail = outreachCompose_({template: due.template, company: due.company,
                                 role: app.role || due.role, recruiterName: contact.name});
    var resume = DriveApp.getFileById(OFFICIAL_RESUME_FILE_ID).getBlob()
      .setName('Henry_Nguyen_Resume.pdf');
    GmailApp.sendEmail(contact.email, mail.subject, mail.plain, {
      htmlBody: mail.html, inlineImages: mail.inlineImages, attachments: [resume], name: SENDER_NAME
    });
    var updates = {}; updates[Q_STATUS] = STATUS_SENT; updates[Q_SENT_AT] = now;
    updates[Q_RESULT] = 'Sent: ' + due.template;
    outreachWriteRow_(queue, due.rowNumber, updates);
    outreachMarkColdContactsSent_([due.fingerprint]);
    return {sent: true, company: due.company};
  } finally {
    lock.releaseLock();
  }
}

/**
 * Queue exactly one owner-requested cold recruiter email for each newly surfaced
 * off-Target SWE application. These are ordinary Email rows with no explicit
 * time or dedicated sender, so paused Automatic outreach cannot send them.
 */
function queueOwnerApprovedOffTargetRecruiters0916() {
  var specs = [
    {
      company: 'Baird',
      role: 'Software Developer Intern',
      jobLink: 'https://baird.wd1.myworkdayjobs.com/careers/job/WI-Milwaukee/Internship---Software-Developer--Year-Round-_R20261024-1?utm_source=Simplify&ref=Simplify'
    },
    {
      company: 'Dow Jones',
      role: 'Summer 2027 Internship Program – Software Engineering Intern',
      jobLink: 'https://jobright.ai/jobs/info/6aa870e12ed333b4ea5cf7bb?utm_campaign=1079&utm_source=git'
    },
    {
      company: 'Textron GSE',
      role: '2027 Intern - Software Engineer (Crewed Land) - Slidell, LA',
      jobLink: 'https://jobright.ai/jobs/info/6aa8efb33387a3d9b67d3624?utm_campaign=1079&utm_source=git'
    }
  ];
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
    var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
    var queue = tracker.getSheetByName(TAB_QUEUE);
    if (!queue) throw new Error('No ' + TAB_QUEUE + ' tab.');
    var queueRows = queue.getLastRow() < 2 ? []
      : queue.getRange(2, 1, queue.getLastRow() - 1, Q_WIDTH).getValues()
        .map(function (row, index) { return outreachParseQueue_(row, index); });
    var targetCompanies = outreachColdTargetCompanies_(tracker);
    if (!targetCompanies) throw new Error('Target tab could not be read.');
    var apps = targetMirrorApplications_(tracker);
    var contacts = outreachReadContacts_(contactsBook);
    var salt = outreachProperty_(PROP_SALT, true);
    var spent = {};
    queueRows.forEach(function (row) {
      if (row.fingerprint && STATUS_SPENDS_CONTACT.indexOf(row.status) !== -1) {
        spent[row.fingerprint] = true;
      }
    });
    var rejectionCandidates = outreachGmailApiRejectionCandidates_();
    var templateLoad = outreachColdTemplateLoad_(queueRows);
    var added = [], alreadyQueued = [];
    specs.forEach(function (spec) {
      var existing = queueRows.filter(function (row) {
        return outreachSameEmployer_(outreachCompanyTokens_(row.company),
          outreachCompanyTokens_(spec.company))
          && [STATUS_QUEUED, STATUS_DRAFTED, STATUS_SENT, STATUS_REPLIED].indexOf(row.status) !== -1;
      });
      if (existing.length) {
        alreadyQueued.push({company: spec.company, rows: existing.length});
        return;
      }
      if (outreachCompanyOnTarget_(spec.company, targetCompanies)) {
        throw new Error(spec.company + ' is in Target and cannot enter the off-Target Email queue.');
      }
      var app = apps.filter(function (candidate) {
        var link = candidate.official || candidate.link || '';
        return outreachSameEmployer_(outreachCompanyTokens_(candidate.company),
          outreachCompanyTokens_(spec.company))
          && candidate.role === spec.role && link === spec.jobLink;
      })[0];
      var qualification = outreachStillQualifies_(app);
      if (!qualification.ok) throw new Error(spec.company + ': ' + qualification.why + '.');
      var rejection = outreachGmailApiRejectedTarget_(spec, rejectionCandidates);
      if (rejection.rejected) {
        throw new Error(spec.company + ' has a matching Gmail rejection: ' + rejection.why + '.');
      }
      var season = outreachSeason_(app.role);
      var companyContacts = outreachContactsFor_(contacts, app.company).filter(function (contact) {
        return !GmailApp.search('from:me to:' + contact.email, 0, 1).length;
      });
      var pick = outreachPickContact_(companyContacts, spent, salt, season, new Date());
      if (!pick) throw new Error(spec.company + ' has no uncommitted recruiter contact.');
      var template = outreachColdTemplateFor_(templateLoad);
      templateLoad[template] = (templateLoad[template] || 0) + 1;
      spent[pick.fingerprint] = true;
      added.push({
        values: outreachQueueRowValues_({
          id: 'MANUAL-EMAIL-20260916-' + spec.company.toUpperCase().replace(/[^A-Z0-9]+/g, '-'),
          property: app.property, company: app.company, role: app.role,
          dateApplied: app.dateApplied, recruiters: companyContacts.length, attempt: 1,
          template: template, status: STATUS_QUEUED, mode: MODE_SEND,
          fingerprint: pick.fingerprint,
          result: 'Owner-approved ordinary Email queue entry; Automatic outreach remains paused.'
        }),
        company: spec.company,
        role: app.role,
        contacts: companyContacts.length
      });
    });
    if (added.length) {
      queue.getRange(queue.getLastRow() + 1, 1, added.length, Q_WIDTH)
        .setValues(added.map(function (item) { return item.values; }));
      outreachRepairQueueLayout_(queue);
    }
    return {
      queued: added.map(function (item) {
        return {company: item.company, role: item.role, recruiterContacts: item.contacts};
      }),
      alreadyQueued: alreadyQueued,
      delivery: 'No Gmail draft, message, explicit timestamp, or sender trigger was created.'
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Expand the owner's 09/16 ordinary Email queue to exactly five recruiters at
 * each approved off-Target employer. The externally sourced roster is fixed;
 * a rerun never searches, appends, or queues a sixth person.
 */
function expandOwnerApprovedOffTargetRecruiters0916ToFive() {
  var source = 'Treg people search/email finder + MillionVerifier ok — owner approved 2026-09-16';
  var roster = [
    {company: 'Baird', name: 'Bonnie Hoeft', email: 'bhoeft@rwbaird.com',
     role: 'University Relations Manager / Senior Vice President', focus: 'university',
     verify: 'debounce:Safe to Send'},
    {company: 'Baird', name: 'Barb Pesich', email: 'bpesich@rwbaird.com',
     role: 'Sr. Campus Recruiter', focus: 'university', verify: 'debounce:Safe to Send'},
    {company: 'Dow Jones', name: 'Jocelyn Kakalecik', email: 'jocelyn.kakalecik@dowjones.com',
     role: 'Manager, Global Campus Recruitment', focus: 'university', verify: 'debounce:Safe to Send'},
    {company: 'Dow Jones', name: 'Christina Brunetti', email: 'christina.brunetti@dowjones.com',
     role: 'Manager, Talent Acquisition', verify: 'debounce:Safe to Send'},
    {company: 'Dow Jones', name: 'Sydnie Smart', email: 'sydnie.smart@dowjones.com',
     role: 'Senior Recruiter', verify: 'debounce:Safe to Send'},
    {company: 'Dow Jones', name: 'Anabelle Robinson', email: 'anabelle.robinson@dowjones.com',
     role: 'Senior Recruiter', verify: 'debounce:Safe to Send'},
    {company: 'Textron GSE', name: 'Jamie Lewis', email: 'jlewis@textron.com',
     role: 'University Relations Associate', focus: 'university', verify: 'debounce:Safe to Send'},
    {company: 'Textron GSE', name: 'Amelia Frueh', email: 'afrueh@textron.com',
     role: 'University Relations Associate', focus: 'university', verify: 'debounce:Safe to Send'},
    {company: 'Textron GSE', name: 'Carrie Saber', email: 'cs@textron.com',
     role: 'Sr. Manager, Early Career Programs', focus: 'university', verify: 'debounce:Safe to Send'},
    {company: 'Textron GSE', name: 'Rafael Cedeno', email: 'rcedeno@textron.com',
     role: 'Corporate Recruiter', verify: 'debounce:Safe to Send'},
    {company: 'Textron GSE', name: 'Marissa McClurg', email: 'mmcclurg@textron.com',
      role: 'Talent Acquisition Associate', verify: 'debounce:Safe to Send'},
    {company: 'Textron GSE', name: 'Erin Koehler', email: 'ekoehler@textron.com',
      role: 'Talent Specialist', verify: 'debounce:Safe to Send'}
  ];
  var specs = [
    {
      company: 'Baird', role: 'Software Developer Intern',
      jobLink: 'https://baird.wd1.myworkdayjobs.com/careers/job/WI-Milwaukee/Internship---Software-Developer--Year-Round-_R20261024-1?utm_source=Simplify&ref=Simplify'
    },
    {
      company: 'Dow Jones', role: 'Summer 2027 Internship Program – Software Engineering Intern',
      jobLink: 'https://jobright.ai/jobs/info/6aa870e12ed333b4ea5cf7bb?utm_campaign=1079&utm_source=git'
    },
    {
      company: 'Textron GSE', role: '2027 Intern - Software Engineer (Crewed Land) - Slidell, LA',
      jobLink: 'https://jobright.ai/jobs/info/6aa8efb33387a3d9b67d3624?utm_campaign=1079&utm_source=git'
    }
  ];
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var contactsResult = appendApprovedManualRecruiters_(roster, source);
    var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
    var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
    var queue = tracker.getSheetByName(TAB_QUEUE);
    if (!queue) throw new Error('No ' + TAB_QUEUE + ' tab.');
    var queueRows = queue.getLastRow() < 2 ? []
      : queue.getRange(2, 1, queue.getLastRow() - 1, Q_WIDTH).getValues()
        .map(function (row, index) { return outreachParseQueue_(row, index); });
    var targetCompanies = outreachColdTargetCompanies_(tracker);
    if (!targetCompanies) throw new Error('Target tab could not be read.');
    var apps = targetMirrorApplications_(tracker);
    var contacts = outreachReadContacts_(contactsBook);
    var salt = outreachProperty_(PROP_SALT, true);
    var spent = {};
    queueRows.forEach(function (row) {
      if (row.fingerprint && STATUS_SPENDS_CONTACT.indexOf(row.status) !== -1) {
        spent[row.fingerprint] = true;
      }
    });
    var rejectionCandidates = outreachGmailApiRejectionCandidates_();
    var templateLoad = outreachColdTemplateLoad_(queueRows);
    var added = [], totals = [];
    specs.forEach(function (spec) {
      if (outreachCompanyOnTarget_(spec.company, targetCompanies)) {
        throw new Error(spec.company + ' is in Target and cannot enter the off-Target Email queue.');
      }
      var app = apps.filter(function (candidate) {
        var link = candidate.official || candidate.link || '';
        return outreachSameEmployer_(outreachCompanyTokens_(candidate.company),
          outreachCompanyTokens_(spec.company))
          && candidate.role === spec.role && link === spec.jobLink;
      })[0];
      var qualification = outreachStillQualifies_(app);
      if (!qualification.ok) throw new Error(spec.company + ': ' + qualification.why + '.');
      var rejection = outreachGmailApiRejectedTarget_(spec, rejectionCandidates);
      if (rejection.rejected) {
        throw new Error(spec.company + ' has a matching Gmail rejection: ' + rejection.why + '.');
      }
      var active = queueRows.filter(function (row) {
        return outreachSameEmployer_(outreachCompanyTokens_(row.company),
          outreachCompanyTokens_(spec.company))
          && [STATUS_QUEUED, STATUS_DRAFTED, STATUS_SENT, STATUS_REPLIED].indexOf(row.status) !== -1;
      });
      var companyContacts = outreachContactsFor_(contacts, app.company).filter(function (contact) {
        return !GmailApp.search('from:me to:' + contact.email, 0, 1).length;
      });
      var season = outreachSeason_(app.role);
      while (active.length < 5) {
        var pick = outreachPickContact_(companyContacts, spent, salt, season, new Date());
        if (!pick) throw new Error(spec.company + ' has only ' + active.length
          + ' uncommitted recruiter contacts; cannot reach five.');
        var template = outreachColdTemplateFor_(templateLoad);
        templateLoad[template] = (templateLoad[template] || 0) + 1;
        spent[pick.fingerprint] = true;
        var ordinal = active.length + 1;
        added.push(outreachQueueRowValues_({
          id: 'MANUAL-EMAIL-20260916-' + spec.company.toUpperCase().replace(/[^A-Z0-9]+/g, '-')
            + '-TOPUP-' + ordinal,
          property: app.property, company: app.company, role: app.role,
          dateApplied: app.dateApplied, recruiters: companyContacts.length, attempt: 1,
          template: template, status: STATUS_QUEUED, mode: MODE_SEND,
          fingerprint: pick.fingerprint,
          result: 'Owner-approved expansion to five ordinary Email queue entries; Automatic outreach remains paused.'
        }));
        active.push({fingerprint: pick.fingerprint});
      }
      totals.push({company: spec.company, queued: active.length, contacts: companyContacts.length});
    });
    if (added.length) {
      queue.getRange(queue.getLastRow() + 1, 1, added.length, Q_WIDTH).setValues(added);
      outreachRepairQueueLayout_(queue);
    }
    return {
      contacts: contactsResult,
      addedQueueRows: added.length,
      totals: totals,
      delivery: 'No Gmail draft, message, explicit timestamp, or sender trigger was created.'
    };
  } finally {
    lock.releaseLock();
  }
}
