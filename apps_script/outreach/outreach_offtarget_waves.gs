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
