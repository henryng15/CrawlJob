/**
 * Outreach — deciding what goes into the queue, and what goes out today.
 *
 * The functions that decide are pure: they take rows and a date and return rows.
 * Only enqueueOutreach and the trigger entry point touch a spreadsheet, which is
 * what lets every rule below be tested without a Google account.
 */

function outreachDate_(value) {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  var text = String(value == null ? '' : value).trim();
  if (!text) return null;
  var parsed = new Date(text);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Every application that qualifies, oldest first.
 *
 * Oldest first is the whole ordering. The instinct is to send the freshest
 * application, and it is wrong here: the value of the email decays with the age
 * of the application, so the oldest row is the one nearest to being worthless.
 * A 25-day-old application sent today beats the same one sent in six days at 31.
 */
// The endings two trackers disagree about. Mirrors ROLE_SYNONYMS in
// job_sync/sources.py: "Software Engineering Intern" and "Software Engineer
// Internship" are one posting typed twice, and the sheet holds both spellings.
var ROLE_SYNONYMS = {
  engineering: 'engineer', engineers: 'engineer',
  internship: 'intern', internships: 'intern', interns: 'intern',
  development: 'developer', developers: 'developer'
};

var US_STATE = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI'
  + '|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA'
  + '|WV|WI|WY|DC|BC|ON';

// "- Charlotte, NC" and "(Clifton, NJ)" are where the job is, not what it is. Only
// a city followed by a state code is taken: a bare "New York" in the middle of a
// title is left alone, because dropping every word that could be a place name is
// how "Jersey" walks out of a title that meant the company.
var ROLE_LOCATION = new RegExp('[-,\u2013\u2014]?\\s*[A-Za-z .]+,\\s*(' + US_STATE + ')\\b', 'g');

/**
 * A role as the bag of words that say what the job is.
 *
 * Order is dropped because the two halves of the sheet describe one job from
 * opposite ends — "2027 Internship - Software Engineer" against "Software
 * Engineer Intern" — and word order is the last thing they agree on.
 *
 * The intake and the year are kept. Notion's Summer 2027 and Winter 2027 postings
 * share every other word, and a rule loose enough to fold them together would
 * spend one wave on two openings — the same reasoning role_key carries in
 * job_sync/sources.py, for the same pair of postings.
 */
function outreachRoleTokens_(role) {
  var text = String(role == null ? '' : role).replace(ROLE_LOCATION, ' ');
  var seen = {};
  text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').forEach(function (word) {
    if (!word) return;
    seen[ROLE_SYNONYMS[word] || word] = true;
  });
  return Object.keys(seen);
}

/**
 * Whether two roles at one employer are the same posting written twice.
 *
 * The share of words they have in common, against ROLE_MATCH. Two empty roles are
 * never the same posting: a blank role says nothing, and treating every blank as
 * one job would silence a whole employer on the strength of a cell nobody filled.
 */
function outreachSameRole_(left, right) {
  if (!left.length || !right.length) return false;
  var seen = {};
  left.forEach(function (word) { seen[word] = true; });
  var shared = 0;
  right.forEach(function (word) { if (seen[word]) shared++; });
  return shared / (left.length + right.length - shared) >= ROLE_MATCH;
}

function outreachRankApplications_(appRows) {
  return appRows.slice().sort(function (a, b) {
    var left = a.dateApplied ? a.dateApplied.getTime() : Infinity;
    var right = b.dateApplied ? b.dateApplied.getTime() : Infinity;
    return left - right;
  });
}

function outreachParseApp_(row, index) {
  var dateApplied = outreachDate_(row[APP_DATE_APPLIED - 1]);
  return {
    rowNumber: index + 2,
    property: outreachCell_(row, APP_PROPERTY),
    company: outreachCell_(row, APP_COMPANY),
    role: outreachCell_(row, APP_ROLE),
    process: outreachCell_(row, APP_PROCESS),
    // Carried for outreach_rejections.gs, which reads the host and the
    // requisition number out of them — the two things that name an application
    // when the company cell is misspelled or the sender is a bare ATS tenant.
    link: outreachCell_(row, APP_LINK),
    official: outreachCell_(row, APP_OFFICIAL),
    dateApplied: dateApplied
  };
}

function outreachParseQueue_(row, index) {
  var dateApplied = outreachDate_(row[Q_DATE_APPLIED - 1]);
  var attempt = Number(outreachCell_(row, Q_ATTEMPT)) || 0;
  return {
    rowNumber: index + 2,
    // Derived, not stored. It is a fixed offset from two cells already on the
    // row, and a stored copy is only ever a chance for the three to disagree.
    eligibleAt: dateApplied ? outreachEligibleDay_(dateApplied, attempt) : null,
    property: outreachCell_(row, Q_PROPERTY),
    company: outreachCell_(row, Q_COMPANY),
    role: outreachCell_(row, Q_ROLE),
    dateApplied: dateApplied,
    attempt: attempt,
    template: outreachCell_(row, Q_TEMPLATE),
    draftedAt: outreachDate_(row[Q_DRAFTED_AT - 1]),
    scheduledAt: outreachDate_(row[Q_SCHEDULED - 1]),
    recruiters: Number(outreachCell_(row, Q_RECRUITERS)) || 0,
    id: outreachCell_(row, Q_ID),
    status: outreachCell_(row, Q_STATUS),
    mode: outreachCell_(row, Q_MODE),
    // The three follow-up cells, read as one fact the way Drafted At and
    // Scheduled At are: the day the nudge is booked for, which of the twenty it
    // will use, and whether it has gone. A blank status is the important value
    // here — it means nothing has decided about this row yet, which is what makes
    // the planner idempotent without keeping a list of what it has already seen.
    followUpAt: outreachDate_(row[Q_FOLLOWUP_AT - 1]),
    followUpTemplate: Number(outreachCell_(row, Q_FOLLOWUP_TEMPLATE)) || 0,
    followUpStatus: outreachCell_(row, Q_FOLLOWUP_STATUS),
    fingerprint: outreachCell_(row, Q_FINGERPRINT),
    draftId: outreachCell_(row, Q_DRAFT_ID),
    // Parsed rather than read out of a second range the way scanOutreachReplies
    // does it. A follow-up is a reply on the thread this id names, so the id is
    // part of what a row *is* now, not an audit reference fetched when needed.
    messageId: outreachCell_(row, Q_MESSAGE_ID),
    sentAt: outreachDate_(row[Q_SENT_AT - 1]),
    priority: outreachTicked_(row[Q_PRIORITY - 1]),
    // The raw cell as well as the reading of it. Both are ticked; only the text
    // says whether it has already been retired, and without that the sweep would
    // rewrite the same cell on every firing.
    priorityText: outreachCell_(row, Q_PRIORITY)
  };
}

/**
 * How many more people at this employer this application should be written to.
 *
 * Everyone available is queued at once, one day apart, rather than the next
 * person waiting on silence from the last. Waiting cost four days each, so one
 * employer took twelve days to work through — and the application it is about
 * ages the whole time, which is the one thing this system orders around.
 *
 * A reply does not stop the rest. One recruiter answering "we will pass this on"
 * is not the same as being in, and the person who actually owns the req may be
 * the second or the third. What does stop everything is the application's own
 * Process leaving the qualifying set — that is the signal that means something.
 * Applied → Completed OA is not that: it is the same application, further along,
 * and the wave carries on from where it was rather than starting over.
 */
function outreachAttemptsWanted_(app, existing, available, total, headroom, today) {
  if (!outreachQualifies_(app.process)) return { count: 0, from: 1, why: 'process is ' + app.process };
  if (!app.company || !app.role) return { count: 0, from: 1, why: 'company or role is blank' };
  if (!app.dateApplied) return { count: 0, from: 1, why: 'no Date Applied to order by' };
  if (outreachDaysBetween_(today, app.dateApplied) > FUTURE_APPLICATION_GRACE_DAYS) {
    return { count: 0, from: 1, why: 'Date Applied is in the future — check the year' };
  }

  // Cancelled and Failed spend nothing: nothing went out.
  var used = existing.filter(function (r) {
    return r.status !== STATUS_CANCELLED && r.status !== STATUS_FAILED;
  }).length;

  // A finished wave needs silence before the next one opens. Mid-wave — which is
  // where a company with only two contacts sits until a third is typed in — the
  // gate does not apply, because those emails were always meant to go together.
  if (used && used % WAVE_SIZE === 0) {
    if (existing.some(function (r) { return r.status === STATUS_REPLIED; })) {
      return { count: 0, from: used + 1, why: 'someone replied; no further wave' };
    }
    var lastSent = null;
    existing.forEach(function (r) {
      if (r.sentAt && (!lastSent || r.sentAt.getTime() > lastSent.getTime())) lastSent = r.sentAt;
    });
    if (!lastSent) return { count: 0, from: used + 1, why: 'the current wave has not gone out yet' };
    if (outreachDaysBetween_(lastSent, today) < WAVE_GAP_DAYS) {
      return { count: 0, from: used + 1, why: 'waiting out the ' + WAVE_GAP_DAYS + '-day gap' };
    }
  }

  var room = Math.min(WAVE_SIZE - (used % WAVE_SIZE), available, headroom);
  if (room <= 0) {
    var why = available <= 0
      ? (total ? 'everyone there is written to, or inside the '
                 + SEASON_RECONTACT_DAYS + '-day gap since their other intake'
               : 'no usable contact there')
      : 'company is at its weekly cap';
    return { count: 0, from: used + 1, why: why };
  }
  return { count: room, from: used + 1, why: '' };
}

/**
 * How many emails this company is already committed to.
 *
 * Sent in the last seven days, rolling rather than calendar so nothing resets in
 * a burst on Monday morning — **plus everything still queued for them**, which is
 * the half an earlier version missed. Counting only what had been sent made the
 * cap useless on the run that matters most: on a first run nothing has been sent
 * at all, so every company reads as having its whole allowance free, and three
 * applications to one employer with ten contacts queue nine emails in one go.
 *
 * A queued row is an email this company is going to get. It counts.
 */
function outreachCompanySendsThisWeek_(queueRows, company, today) {
  var tokens = outreachCompanyTokens_(company);
  return queueRows.filter(function (r) {
    if (!outreachSameEmployer_(tokens, outreachCompanyTokens_(r.company))) return false;
    if (r.status === STATUS_QUEUED || r.status === STATUS_DRAFTED) return true;
    return !!r.sentAt && outreachDaysBetween_(r.sentAt, today) < 7;
  }).length;
}

/**
 * Whether this person can be written to about this intake, today.
 *
 * Two rules, and they are different in kind. Within one intake the fingerprint is
 * final: written to is written to, forever. Across intakes the block is a clock —
 * Winter and Summer are two occasions to write about, and the only thing that
 * makes the second one land is that enough has happened in between.
 *
 * An unsent row in the other bucket blocks outright rather than being measured.
 * There is no date to measure from: a row still Queued has a send date that moves
 * every time the queue does, and treating "not yet sent" as "sent long ago" would
 * schedule both intakes' emails into the same week.
 *
 * One predicate, used both to count what is free and to pick from it. Counting
 * with a looser rule than picking is how outreachAttemptsWanted_ ends up promising
 * three emails that outreachPickContact_ can only fill two of.
 */
function outreachContactAvailable_(contact, spent, salt, season, today) {
  if (spent[outreachFingerprint_(contact.email, salt, season)]) return false;
  var other = spent[outreachFingerprint_(contact.email, salt, outreachOtherSeason_(season))];
  if (!other) return true;
  if (other.final) return false;
  if (!other.sentAt) return false;
  return outreachDaysBetween_(other.sentAt, today) >= SEASON_RECONTACT_DAYS;
}

/**
 * The first contact at this company who may be written to about this intake.
 *
 * Fingerprints are checked across the whole queue, not just this application:
 * the same person reached through two different applications is still the same
 * person receiving a second cold email.
 */
function outreachPickContact_(companyContacts, spent, salt, season, today) {
  for (var i = 0; i < companyContacts.length; i++) {
    if (!outreachContactAvailable_(companyContacts[i], spent, salt, season, today)) continue;
    return {
      contact: companyContacts[i],
      fingerprint: outreachFingerprint_(companyContacts[i].email, salt, season)
    };
  }
  return null;
}

/**
 * Build the rows to append. Pure: hand it data, get back rows and reasons.
 */
function outreachPlanEnqueue_(appRows, queueRows, contacts, today, salt) {
  var byProperty = {};
  // Fingerprint to what is known about it: whether anything has actually gone, and
  // when. A boolean was enough while a person could only ever be written to once;
  // the across-intake rule needs a date, and the only date the queue holds for a
  // person is on the row that reached them.
  var spent = {};
  queueRows.forEach(function (r) {
    (byProperty[r.property] = byProperty[r.property] || []).push(r);
    if (!r.fingerprint || STATUS_SPENDS_CONTACT.indexOf(r.status) === -1) return;
    // Two endings are about the person, not about the posting, and no gap undoes
    // either. A bounce says the address is dead, and it will be just as dead for
    // the other intake. A reply says they have been reached — there is a human to
    // talk to now, and a cold email about the next opening talks past them. Both
    // close the person in every bucket, which is what the address being "spent for
    // good" has always meant.
    var final = r.status === STATUS_BOUNCED || r.status === STATUS_REPLIED;
    var known = spent[r.fingerprint];
    if (!known) { spent[r.fingerprint] = { sentAt: r.sentAt || null, final: final }; return; }
    if (final) known.final = true;
    // The latest send wins. Two rows sharing a fingerprint should not happen, but
    // the older of the two is the wrong one to measure a gap from if it does.
    if (r.sentAt && (!known.sentAt || r.sentAt.getTime() > known.sentAt.getTime())) {
      known.sentAt = r.sentAt;
    }
  });

  var planned = [];
  var skipped = [];
  var pretendSent = queueRows.slice();
  // Existing rows keep the template the tab already promised. New rows take the
  // least-used of the ten, so several people at one employer do not all read the
  // same message.
  var templateLoad = outreachColdTemplateLoad_(queueRows);

  // One posting gets one wave, however many times it was applied to.
  //
  // American Express advertised a single programme in Charlotte, New York and
  // Phoenix; three applications went in, and each asked for three emails to three
  // different recruiters. The company cap held the total to five that week, which
  // is five of American Express's five contacts spent on one job — and nobody left
  // to write to when the next one opens. IBM was worse: ten applications against
  // eight contacts, so the entire list went on a single employer.
  //
  // The wave is skipped, not merged. The queue row still belongs to the one
  // application that owns it, so a rejection arriving for that application still
  // cancels exactly its own rows, and a sibling application becomes eligible again
  // on the next firing — a refusal from the Charlotte posting should not silence
  // the New York one.
  var waves = [];
  queueRows.forEach(function (row) {
    if (STATUS_SPENDS_CONTACT.indexOf(row.status) === -1) return;
    waves.push({
      property: row.property,
      tokens: outreachCompanyTokens_(row.company),
      role: outreachRoleTokens_(row.role),
      season: outreachSeason_(row.role)
    });
  });
  // Two intakes are never one posting, however alike they read — and they read
  // very alike. "Software Engineer Intern - Winter 2027" against the same title
  // ending in Summer differs by one word in six, which is 0.67 overlap and sails
  // past ROLE_MATCH: without this line the Summer application is skipped as a
  // duplicate of the Winter one, which is the opposite of what it is.
  var waveOwner = function (tokens, role, season, property) {
    for (var i = 0; i < waves.length; i++) {
      if (waves[i].property === property) continue;
      if (waves[i].season !== season) continue;
      if (!outreachSameEmployer_(tokens, waves[i].tokens)) continue;
      if (outreachSameRole_(role, waves[i].role)) return waves[i].property;
    }
    return null;
  };

  outreachRankApplications_(appRows).forEach(function (app) {
    var existing = byProperty[app.property] || [];
    var companyContacts = outreachContactsFor_(contacts, app.company);
    var season = outreachSeason_(app.role);
    var free = companyContacts.filter(function (c) {
      return outreachContactAvailable_(c, spent, salt, season, today);
    });
    // pretendSent grows as this loop plans: two applications to one employer in a
    // single run must share the allowance, not each be told it is free.
    var headroom = COMPANY_WEEKLY_CAP
      - outreachCompanySendsThisWeek_(pretendSent, app.company, today);

    var tokens = outreachCompanyTokens_(app.company);
    var role = outreachRoleTokens_(app.role);
    var owner = waveOwner(tokens, role, season, app.property);
    if (owner) {
      skipped.push({
        property: app.property,
        company: app.company,
        why: 'the same ' + season + ' posting is already being written about on P' + owner
      });
      return;
    }

    var want = outreachAttemptsWanted_(
      app, existing, free.length, companyContacts.length, headroom, today);

    if (!want.count) {
      skipped.push({ property: app.property, company: app.company, why: want.why });
      return;
    }

    var angle = outreachAngleFor_(companyContacts);
    var bucket = outreachBucketFor_(companyContacts);
    for (var n = 0; n < want.count; n++) {
      var attempt = want.from + n;
      var pick = outreachPickContact_(companyContacts, spent, salt, season, today);
      if (!pick) break;
      // Nothing has gone to this person yet, so the other intake stays blocked
      // until it does. A row planned in this run must not read as an old send.
      spent[pick.fingerprint] = { sentAt: null, final: false };
      pretendSent.push({ company: app.company, status: STATUS_QUEUED, sentAt: null });
      if (n === 0) {
        waves.push({ property: app.property, tokens: tokens, role: role, season: season });
      }
      var template = outreachColdTemplateFor_(templateLoad);
      templateLoad[template] = (templateLoad[template] || 0) + 1;
      planned.push({
        id: 'P' + app.property + '-A' + attempt,
        recruiters: companyContacts.length,
        status: STATUS_QUEUED,
        property: app.property,
        company: app.company,
        role: app.role,
        dateApplied: app.dateApplied,
        attempt: attempt,
        // Decided here rather than at send time, so the tab says which of the ten
        // is coming before it goes rather than after.
        template: template,
        eligibleAt: outreachEligibleDay_(app.dateApplied, attempt),
        fingerprint: pick.fingerprint,
        contact: pick.contact,
        // No angle means a hand-typed contact at a company ColdEmail never wrote
        // for. The email still reads, but it has lost the sentence that made it
        // specific — so it waits as a draft rather than going out unattended.
        mode: angle ? MODE_SEND : MODE_DRAFT
      });
    }
  });

  return { planned: planned, skipped: skipped };
}

/**
 * The employers that look like they run two intakes.
 *
 * "Potentially" is doing real work in that description. Nothing here reads a
 * careers page; it reads what the tracker was told, under the rule that a role
 * naming Winter or Spring is off-cycle and every other role is Summer. So an
 * employer shows up here the moment one application says Winter — even with no
 * Summer row yet — because the Summer row is the one that does not have to say
 * anything to qualify, and it will arrive.
 *
 * Which is the point of the tab: the contact list is the scarce thing, and it is
 * worth knowing that a company will want a second wave *before* its five weekly
 * emails have been spent on the first.
 *
 * Employers with nothing off-cycle are left out. Under this rule they are the
 * whole rest of the sheet, and a report listing everything reports nothing.
 */
function outreachSeasonReport_(appRows, contacts) {
  var byCompany = {};
  var order = [];
  appRows.forEach(function (app) {
    if (!app.company) return;
    var tokens = outreachCompanyTokens_(app.company);
    if (!tokens.length) return;
    var key = tokens.join(' ');
    if (!byCompany[key]) {
      byCompany[key] = { company: app.company, offcycle: [], summer: [] };
      order.push(key);
    }
    var group = byCompany[key];
    // The name kept is the longest one seen. Two rows write one employer as
    // "Amex" and "American Express"; the tab is read by a person, and the short
    // one is the one that needs looking up.
    if (app.company.length > group.company.length) group.company = app.company;
    (outreachSeason_(app.role) === SEASON_OFFCYCLE ? group.offcycle : group.summer)
      .push(app);
  });

  var rows = [];
  order.forEach(function (key) {
    var group = byCompany[key];
    if (!group.offcycle.length) return;
    // Nobody to write to, nothing to plan. The tab exists to say where a second
    // wave is coming before the contact budget is spent on the first, and an
    // employer with no contacts has no budget to spend and no wave to expect —
    // it is a row that can only ever be read and then skipped over.
    var recruiters = outreachRecruiterCount_(contacts, group.company);
    if (!recruiters) return;
    var both = group.summer.length > 0;
    rows.push([
      group.company,
      group.offcycle.length,
      group.summer.length,
      both ? 'Both intakes applied to' : 'Off-cycle only — a Summer row is still to come',
      outreachSeasonProperties_(group.offcycle),
      outreachSeasonProperties_(group.summer),
      recruiters,
      // The roles as written, because the rule reads them literally and this is
      // the column that shows it misreading one. A title that lost its "Winter"
      // in the paste lands under Summer, and the only place that is visible is
      // next to the off-cycle row it should have joined.
      group.offcycle.concat(group.summer).map(function (a) {
        return a.role || '(blank)';
      }).join(' | ')
    ]);
  });
  // Most applications first: the employer with six rows across two intakes is the
  // one whose contact budget is about to be a problem.
  return rows.sort(function (a, b) {
    return (b[1] + b[2]) - (a[1] + a[2]) || String(a[0]).localeCompare(String(b[0]));
  });
}

function outreachSeasonProperties_(apps) {
  return apps.map(function (a) { return 'P' + a.property; }).join(', ');
}

var SEASON_HEADERS = ['Company', 'Off-cycle', 'Summer', 'Reading', 'Off-cycle rows',
                      'Summer rows', 'Recruiters', 'Roles as written'];
var SEASON_WIDTHS  = [200, 80, 80, 260, 150, 150, 90, 460];

/**
 * Rewrite the Season tab from App.
 *
 * Cleared and rewritten whole rather than reconciled row by row. It holds no
 * state anybody else reads — no fingerprint, no status, nothing the sender
 * consults — so the cheapest correct thing is to throw it away and say it again.
 *
 * Public and without the trailing underscore, so it can be run from the editor's
 * Run menu on its own; the hourly cycle calls it as its last step.
 */
function refreshSeasonTab() {
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
  var app = tracker.getSheetByName(TAB_APP);
  if (!app) throw new Error('No ' + TAB_APP + ' tab.');

  var sheet = tracker.getSheetByName(TAB_SEASON) || tracker.insertSheet(TAB_SEASON);
  var appLast = app.getLastRow();
  var appRows = appLast < 2 ? []
    : app.getRange(2, 1, appLast - 1, APP_RECRUITERS).getValues().map(outreachParseApp_);
  var rows = outreachSeasonReport_(appRows, outreachReadContacts_(contactsBook));

  sheet.clear();
  sheet.getRange(1, 1, 1, SEASON_HEADERS.length)
       .setValues([SEASON_HEADERS])
       .setFontWeight('bold')
       .setBackground('#D9EAD3')
       .setHorizontalAlignment('center');
  sheet.setFrozenRows(1);
  SEASON_WIDTHS.forEach(function (width, index) { sheet.setColumnWidth(index + 1, width); });
  if (rows.length) sheet.getRange(2, 1, rows.length, SEASON_HEADERS.length).setValues(rows);

  Logger.log('Season: ' + rows.length + ' employer(s) with an off-cycle intake.');
  return rows.length;
}

/**
 * Re-fingerprint the off-cycle rows that were written before intakes existed.
 *
 * Summer needed no migration — it hashes to what it always did. Off-cycle rows do,
 * and the failure without this is quiet rather than loud: a Winter row already sent
 * carries the unscoped hash, which is the hash the *Summer* bucket now uses. So the
 * queue reads that row as "this person has heard about Summer", the off-cycle
 * bucket looks untouched, and 25 days later the same recruiter is written to about
 * Winter a second time. One extra email rather than a flood, but it is the one
 * thing this whole change exists to prevent.
 *
 * Run once, by hand, after the new code is pushed and before the next cycle. It is
 * idempotent: a row already carrying its scoped fingerprint no longer resolves
 * under the legacy hash and is left alone.
 *
 * The address never lands in the sheet. The old fingerprint is matched back to a
 * contact in the contacts book, the new one is computed from that address, and only
 * the hash is written — the same one-way path the queue has always had.
 */
function backfillSeasonFingerprints() {
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
  var salt = outreachProperty_(PROP_SALT, true);
  var queue = tracker.getSheetByName(TAB_QUEUE);
  if (!queue) throw new Error('No ' + TAB_QUEUE + ' tab.');

  var last = queue.getLastRow();
  if (last < 2) return 0;
  var contacts = outreachReadContacts_(contactsBook);
  var rows = queue.getRange(2, 1, last - 1, Q_WIDTH).getValues().map(outreachParseQueue_);

  var moved = 0;
  var missing = [];
  rows.forEach(function (row) {
    if (!row.fingerprint) return;
    if (outreachSeason_(row.role) !== SEASON_OFFCYCLE) return;
    var companyContacts = outreachContactsFor_(contacts, row.company);
    var contact = outreachContactByFingerprint_(companyContacts, row.fingerprint, salt);
    if (!contact) {
      // The person has left the contact list. Without an address there is nothing
      // to recompute from, and inventing a hash is worse than leaving a stale one.
      missing.push(row.rowNumber);
      return;
    }
    var print = outreachFingerprint_(contact.email, salt, SEASON_OFFCYCLE);
    // Idempotent: a row migrated by an earlier run already holds this value.
    if (print === row.fingerprint) return;
    var update = {};
    update[Q_FINGERPRINT] = print;
    outreachWriteRow_(queue, row.rowNumber, update);
    moved++;
  });

  Logger.log('Re-fingerprinted ' + moved + ' off-cycle row(s); left '
           + missing.length + ' that no longer resolve to a contact.');
  return moved;
}

/**
 * Whether an edit landed on a Role cell in App.
 *
 * The crawlers are the reason this exists. A posting whose title carries its
 * intake reaches the sheet with that word dropped often enough that correcting one
 * by hand is routine, and the correction changes which intake the application is
 * for — which changes whether its recruiters may be written to again. Typed and
 * then left to be noticed an hour later, it reads as nothing having happened.
 */
function outreachEditTouchesRole_(tabName, range) {
  if (tabName !== TAB_APP) return false;
  if (range.getColumn() > APP_ROLE || range.getLastColumn() < APP_ROLE) return false;
  return range.getLastRow() >= 2;
}

/**
 * What a corrected Role means for that application's queue rows.
 *
 * Two different things, and the difference is what has already left the building.
 *
 * The Role text is copied onto every row, settled or not, because the tab is read
 * by a person and a queue row disagreeing with `App` about what the job is called
 * is a tab that cannot be trusted on the one column it exists to explain.
 *
 * The fingerprint moves bucket only on a row that has not gone out. A `Sent` row
 * records who was written to and which intake it was spent on; that is history,
 * and rewriting it would hand back a person who has already had their email. A
 * `Queued` row has spent nothing yet, so leaving it in the wrong bucket is the
 * actively dangerous half: the row would go out about Winter while still holding
 * Summer's hash, the off-cycle bucket would read as free, and the next enqueue
 * would write to the same person about Winter a second time.
 */
function outreachRolePlan_(queueRows, property, role, contacts, salt) {
  var season = outreachSeason_(role);
  var planned = [];
  queueRows.forEach(function (row) {
    if (row.property !== property) return;
    var updates = {};
    if (row.role !== role) updates[Q_ROLE] = role;

    var open = row.status === STATUS_QUEUED || row.status === STATUS_DRAFTED;
    if (open && row.fingerprint) {
      var contact = outreachContactByFingerprint_(
        outreachContactsFor_(contacts, row.company), row.fingerprint, salt);
      if (contact) {
        var print = outreachFingerprint_(contact.email, salt, season);
        if (print !== row.fingerprint) updates[Q_FINGERPRINT] = print;
      }
    }
    if (Object.keys(updates).length) {
      planned.push({ rowNumber: row.rowNumber, updates: updates });
    }
  });
  return planned;
}

/**
 * Carry a corrected Role out to the queue rows that repeat it.
 *
 * Deliberately does not enqueue. Everything here rearranges what is already
 * written; opening a wave is the hourly cycle's job, and an edit trigger that
 * could start one would mean a keystroke in a cell was the thing that decided an
 * email goes out. The unlocked recruiter is picked up at the next firing, within
 * the hour.
 */
function syncRoleEdit_(tracker, contactsBook, property, role, salt) {
  var done = { queue: 0 };

  // Alphabet_Order is deliberately not written to. It stopped being a hand-kept
  // copy of App and became a single array formula in its A1 that reads App live,
  // so the corrected Role is already there by the time this runs. Writing the
  // cell anyway would put a literal inside that formula's spill range, and Sheets
  // answers that by collapsing the whole tab to #REF! — a Role correction would
  // blank the tab it was meant to keep in step.

  var queue = tracker.getSheetByName(TAB_QUEUE);
  if (queue && queue.getLastRow() >= 2) {
    var queueRows = queue.getRange(2, 1, queue.getLastRow() - 1, Q_WIDTH)
                         .getValues().map(outreachParseQueue_);
    outreachRolePlan_(queueRows, property, role, outreachReadContacts_(contactsBook), salt)
      .forEach(function (item) {
        outreachWriteRow_(queue, item.rowNumber, item.updates);
        done.queue++;
      });
  }
  return done;
}

function outreachQueueRowValues_(item) {
  var row = new Array(Q_WIDTH).fill('');
  row[Q_ID - 1] = item.id;
  row[Q_PROPERTY - 1] = item.property;
  row[Q_COMPANY - 1] = item.company;
  row[Q_ROLE - 1] = item.role;
  row[Q_DATE_APPLIED - 1] = item.dateApplied;
  row[Q_RECRUITERS - 1] = item.recruiters;
  row[Q_ATTEMPT - 1] = item.attempt;
  row[Q_TEMPLATE - 1] = item.template || '';
  row[Q_STATUS - 1] = item.status;
  row[Q_MODE - 1] = item.mode;
  row[Q_FINGERPRINT - 1] = item.fingerprint;
  row[Q_RESULT - 1] = item.result || '';
  row[Q_VERSION - 1] = 1;
  // false, not blank: the column carries a checkbox, and a blank cell under a
  // checkbox rule renders as one nobody has decided about yet.
  row[Q_PRIORITY - 1] = false;
  return row;
}

/**
 * Read App and the queue, work out what is missing, append it.
 *
 * Appending only. Nothing here edits a row that already exists, so a run that
 * dies halfway leaves a shorter queue rather than a corrupted one.
 */
function enqueueOutreach() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
    var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
    var salt = outreachProperty_(PROP_SALT, true);

    var app = tracker.getSheetByName(TAB_APP);
    var queue = tracker.getSheetByName(TAB_QUEUE);
    if (!app) throw new Error('No ' + TAB_APP + ' tab.');
    if (!queue) throw new Error('No ' + TAB_QUEUE + ' tab. Run setupOutreachQueue first.');

    var appLast = app.getLastRow();
    var appRows = appLast < 2 ? []
      : app.getRange(2, 1, appLast - 1, APP_RECRUITERS).getValues().map(outreachParseApp_);

    var queueLast = queue.getLastRow();
    var queueRows = queueLast < 2 ? []
      : queue.getRange(2, 1, queueLast - 1, Q_WIDTH).getValues().map(outreachParseQueue_);

    var contacts = outreachReadContacts_(contactsBook);
    var plan = outreachPlanEnqueue_(appRows, queueRows, contacts, new Date(), salt);

    // Appending only. Nothing here edits a row that already exists, so a run
    // that dies halfway leaves a shorter table rather than a corrupted one.
    if (plan.planned.length) {
      var values = plan.planned.map(outreachQueueRowValues_);
      queue.getRange(queueLast + 1, 1, values.length, Q_WIDTH).setValues(values);
    }
    // An application with nobody to write to does not get a row — the table is
    // about emails, and that is not one. It gets a line in the log instead, so
    // the companies worth hunting contacts for are still nameable.
    var noContact = plan.skipped
      .filter(function (row) { return row.why === 'no usable contact there'; })
      .map(function (row) { return row.company; });
    Logger.log('Queued ' + plan.planned.length + ', skipped ' + plan.skipped.length + '.');
    if (noContact.length) Logger.log('Nobody to write to at: ' + noContact.join(', '));
    return plan;
  } finally {
    lock.releaseLock();
  }
}

/** Enqueue, then say when each of those rows is expected to go out. */
function enqueueAndProject() {
  var plan = enqueueOutreach();
  refreshOutreachSchedule();
  return plan;
}

/**
 * What the Email tab's header says about where Priority is.
 *
 * Kept apart from the sheet work so the one decision that can get this wrong —
 * reading a tab somebody has rearranged and shifting it anyway — is a pure
 * function with tests, rather than something only a live spreadsheet can prove.
 *
 * 'ready' means the column is already there. 'insert' means the tab predates it
 * and column 10 is still Status. Anything else throws: a header this does not
 * recognise is a tab that must not be shifted blind, because every row under it
 * would end up beneath the wrong name.
 */
/**
 * The header row, never wider than the sheet actually is.
 *
 * getRange past the last column throws, and both migrations below have to read
 * the header of a tab built before the columns they are adding existed — which is
 * precisely a tab narrower than Q_WIDTH. Reading blind was survivable while the
 * Email tab sat inside the twenty-six columns a new sheet is born with; the third
 * follow-up column is the one that could push a trimmed tab over.
 */
function outreachHeaderRow_(queue) {
  var width = Math.min(Q_WIDTH, queue.getMaxColumns());
  return queue.getRange(1, 1, 1, width).getValues()[0];
}

function outreachPriorityColumnAction_(headerRow) {
  var at = String((headerRow || [])[Q_PRIORITY - 1] || '').trim();
  if (at === 'Priority') return 'ready';
  if (at === 'Status') return 'insert';
  throw new Error(
    'Email column ' + Q_PRIORITY + ' is ' + JSON.stringify(at) + ', expected '
    + '"Priority" or "Status". This tab is not a layout the sender knows how to '
    + 'migrate, and it will not shift rows under a header it cannot read.'
  );
}

/**
 * Open the Priority column on a tab built before it existed.
 *
 * This runs inside the sender rather than as a button somebody remembers to press,
 * because the two have to change together. The column constants moved ten headers
 * to the right; a sheet on the old layout read by the new code has Status where
 * Mode should be, so no row matches any status, no row counts as having spent a
 * contact, and the next enqueue writes a second cold email to people already
 * written to. That is not a state to leave a gap for.
 *
 * As the first thing runOutreachCycle does, and outside the per-step isolation,
 * there is no gap: either the layout is right before anything reads the queue, or
 * the run stops without reading it.
 *
 * insertColumnBefore is what does the move — values, validation and colour rules
 * to the right of it travel with their columns. Writing headers over live rows
 * would have renamed the columns and left the data where it was.
 */
function outreachEnsurePriorityColumn_(tracker) {
  var queue = tracker.getSheetByName(TAB_QUEUE);
  if (!queue) throw new Error('No ' + TAB_QUEUE + ' tab.');

  if (outreachPriorityColumnAction_(outreachHeaderRow_(queue)) === 'ready') return false;

  queue.insertColumnBefore(Q_PRIORITY);
  queue.getRange(1, Q_PRIORITY)
       .setValue('Priority')
       .setFontWeight('bold')
       .setBackground('#D9EAD3')
       .setHorizontalAlignment('center');
  queue.setColumnWidth(Q_PRIORITY, 75);
  outreachDressQueueRows_(queue);
  Logger.log('Inserted the Priority column at ' + Q_PRIORITY + '.');
  return true;
}

// What the three new headers say, left to right, in the order they are inserted.
var FOLLOWUP_HEADERS = ['Follow Up', 'Follow Up Template', 'Follow Up Status'];

/**
 * What the Email tab's header says about where the follow-up columns are.
 *
 * The same shape as outreachPriorityColumnAction_, and separate from the sheet
 * work for the same reason: the decision that can go badly wrong — shifting a tab
 * somebody has rearranged — is a pure function with tests rather than something
 * only a live spreadsheet can prove.
 *
 * 'ready' means column 13 already says Follow Up. 'insert' means the tab predates
 * these three and column 13 is still Contact Fingerprint. Anything else throws,
 * because a header this does not recognise is a tab whose rows must not be moved
 * under names nobody has checked.
 */
function outreachFollowUpColumnsAction_(headerRow) {
  var at = String((headerRow || [])[Q_FOLLOWUP_AT - 1] || '').trim();
  if (at === FOLLOWUP_HEADERS[0]) return 'ready';
  if (at === 'Contact Fingerprint') return 'insert';
  throw new Error(
    'Email column ' + Q_FOLLOWUP_AT + ' is ' + JSON.stringify(at) + ', expected '
    + '"' + FOLLOWUP_HEADERS[0] + '" or "Contact Fingerprint". This tab is not a '
    + 'layout the sender knows how to migrate, and it will not shift rows under a '
    + 'header it cannot read.'
  );
}

/**
 * Open the three follow-up columns on a tab built before they existed.
 *
 * Runs inside the sender rather than as a button somebody remembers to press, for
 * exactly the reason outreachEnsurePriorityColumn_ above it does. The constants
 * moved eight headers to the right: a sheet on the old layout read by the new code
 * has Contact Fingerprint where Follow Up should be and Gmail Draft ID where the
 * template number goes, so no row matches any status, no row counts as having
 * spent a contact, and the next enqueue writes a second cold email to people
 * already written to. There is no version of that worth leaving a gap for.
 *
 * As the second thing runOutreachCycle does, and outside the per-step isolation,
 * there is no gap: either both layouts are right before anything reads the queue,
 * or the run stops without reading it.
 *
 * Three separate insertColumnBefore calls at the same index rather than
 * insertColumnsBefore(index, 3), so each one is the operation whose behaviour is
 * already known here — values, validation and colour rules to the right travel
 * with their columns — repeated. Inserting at Q_FOLLOWUP_AT three times leaves the
 * three new columns in the order the headers are then written across them.
 */
function outreachEnsureFollowUpColumns_(tracker) {
  var queue = tracker.getSheetByName(TAB_QUEUE);
  if (!queue) throw new Error('No ' + TAB_QUEUE + ' tab.');

  if (outreachFollowUpColumnsAction_(outreachHeaderRow_(queue)) === 'ready') return false;

  for (var i = 0; i < FOLLOWUP_HEADERS.length; i++) queue.insertColumnBefore(Q_FOLLOWUP_AT);
  queue.getRange(1, Q_FOLLOWUP_AT, 1, FOLLOWUP_HEADERS.length)
       .setValues([FOLLOWUP_HEADERS])
       .setFontWeight('bold')
       .setBackground('#D9EAD3')
       .setHorizontalAlignment('center');
  [130, 95, 120].forEach(function (width, index) {
    queue.setColumnWidth(Q_FOLLOWUP_AT + index, width);
  });
  outreachDressQueueRows_(queue);
  Logger.log('Inserted the three follow-up columns at ' + Q_FOLLOWUP_AT + '.');
  return true;
}

/**
 * Which blocks of rows inside the table are empty and should not be there.
 *
 * Returned as 1-based sheet rows, bottom-up, so deleting them in order does not
 * shift the ones still to come. Pure, because the alternative is proving a
 * row-deleting function correct against a live sheet.
 *
 * A row counts as real if any cell in it holds anything beyond an unticked
 * checkbox. Sheets reads a blank checkbox cell back as false rather than '', so
 * an emptiness test that trusted '' alone saw eight hundred occupied rows where
 * there were none.
 */
function outreachQueueGaps_(values) {
  var last = 0;
  for (var i = values.length - 1; i >= 1; i--) {
    if (outreachRowHasContent_(values[i])) { last = i; break; }
  }
  var blocks = [];
  var run = 0;
  for (var r = 1; r <= last; r++) {
    if (!outreachRowHasContent_(values[r])) { run++; continue; }
    if (run) blocks.push({ start: r - run + 1, count: run });
    run = 0;
  }
  return blocks.reverse();
}

function outreachRowHasContent_(row) {
  for (var i = 0; i < row.length; i++) {
    var cell = row[i];
    // false counts as empty, and so does 0, and neither is a shortcut.
    //
    // A blank row wearing checkbox validation reads back as false, not '', so
    // treating false as content made every row in the gap look real, found no gap
    // at all, and deleted nothing — the first version of this shipped and did
    // visibly nothing for exactly that reason.
    //
    // The zero is the same mistake one column over, and it is the one that kept
    // the gap alive after false was handled. refreshOutreachSchedule rewrites the
    // Recruiters column across everything getLastRow admits to, so every blank row
    // in the gap was stamped with a literal 0 once an hour. 0 === false is false in
    // JavaScript, so the guard above walked straight past it and read the row as
    // occupied. Eight hundred and seventy rows of nothing, each holding one zero,
    // and a gap that could not be seen from inside the function meant to find it.
    //
    // No real queue row is a bare unticked box or a bare zero: it would still have
    // a Company and a Queue ID, both strings.
    if (cell === '' || cell === null || cell === undefined
        || cell === false || cell === 0) continue;
    return true;
  }
  return false;
}

/**
 * Put the checkbox and the timestamp formats on the rows that exist, and only
 * those.
 *
 * The first version of this reached to getMaxRows, which was a thousand. Sheets
 * counts a cell carrying checkbox validation as content, so getLastRow answered
 * 1000 on a table of 123 rows and enqueueOutreach appended at 1001 — Capital One
 * and Goldman Sachs landed eight hundred blank rows below everything else. Those
 * rows were also past the 500 the bound script formats, so their Drafted At and
 * Scheduled At rendered as bare dates with the hour dropped.
 *
 * Bounded to the real last row and re-applied every cycle, so rows appended since
 * the last run are dressed without the range ever running away again.
 */
function outreachDressQueueRows_(queue) {
  var last = Math.max(queue.getLastRow(), 2);
  var rows = last - 1;
  queue.getRange(2, Q_PRIORITY, rows, 1)
       .setDataValidation(SpreadsheetApp.newDataValidation()
         // allowInvalid stays on: a cell somebody typed into is not worth failing
         // a run over, and outreachTicked_ reads those spellings anyway.
         .requireCheckbox().setAllowInvalid(true).build());
  [Q_DRAFTED_AT, Q_SCHEDULED, Q_SENT_AT, Q_FOLLOWUP_AT].forEach(function (column) {
    queue.getRange(2, column, rows, 1).setNumberFormat(QUEUE_TIMESTAMP_FORMAT);
  });
  // Date Applied belongs on that list even though it is not a timestamp. A cell
  // written by enqueue carried whatever format it was created with, so the column
  // held a mixture of "August 17, 2026" and "8/17/2026" — and because sorting
  // moves values between cells rather than moving the cells, a row changing places
  // changed how its date read. Dressing the column is what makes the sort's
  // assumption true rather than nearly true.
  queue.getRange(2, Q_DATE_APPLIED, rows, 1).setNumberFormat(QUEUE_DATE_FORMAT);
  // Status and Mode are dropdowns everywhere or they are dropdowns nowhere.
  //
  // A validation is a property of the cell, not of the range it happens to sit in,
  // and the bound script sets these once over rows 2..500 when it builds the tab.
  // Rows that arrived later never had one, and deleting the gap above them did not
  // give them one: the cells moved up carrying exactly what they held, which was
  // the bare string. Capital One read "Sent" as plain text next to a hundred rows
  // where the same word was a coloured chip you could open.
  //
  // allowInvalid is false here and true on the checkbox above, and the difference
  // is deliberate: a status nobody's code can produce is a bug worth seeing, while
  // a Priority cell somebody typed "yes" into is read correctly anyway.
  queue.getRange(2, Q_STATUS, rows, 1)
       .setDataValidation(SpreadsheetApp.newDataValidation()
         .requireValueInList(QUEUE_STATUSES, true).setAllowInvalid(false).build());
  queue.getRange(2, Q_MODE, rows, 1)
       .setDataValidation(SpreadsheetApp.newDataValidation()
         .requireValueInList(QUEUE_MODES, true).setAllowInvalid(false).build());
  // allowInvalid false, the same as Status and for the same reason: every word in
  // this column is written by this project, so a value the dropdown does not know
  // is a bug worth being shown rather than a spelling worth tolerating.
  queue.getRange(2, Q_FOLLOWUP_STATUS, rows, 1)
       .setDataValidation(SpreadsheetApp.newDataValidation()
         .requireValueInList(QUEUE_FOLLOWUP_STATUSES, true).setAllowInvalid(false).build());
  outreachColourQueueColumn_(queue, Q_STATUS, QUEUE_STATUS_COLOURS, rows);
  outreachColourQueueColumn_(queue, Q_MODE, QUEUE_MODE_COLOURS, rows);
  outreachColourQueueColumn_(queue, Q_FOLLOWUP_STATUS, QUEUE_FOLLOWUP_COLOURS, rows);
}

/**
 * Repaint one column's colour rules over the rows that exist.
 *
 * Conditional formatting is the opposite of a validation: it belongs to a range
 * rather than to a cell, so deleting eight hundred rows out of the middle shrank
 * the painted range from row 500 to row 130 and left everything below it grey.
 * Rebuilt against the real last row every cycle, it cannot fall behind the table
 * again in either direction.
 *
 * Rules on other columns are kept as they were found; only this column's are
 * replaced, so the two calls do not undo each other.
 */
function outreachColourQueueColumn_(queue, column, palette, rows) {
  var range = queue.getRange(2, column, rows, 1);
  var kept = queue.getConditionalFormatRules().filter(function (rule) {
    return rule.getRanges().every(function (r) { return r.getColumn() !== column; });
  });
  var added = palette.map(function (entry) {
    return SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(entry.name)
      .setBackground(entry.bg)
      .setFontColor(entry.fg)
      .setRanges([range])
      .build();
  });
  queue.setConditionalFormatRules(kept.concat(added));
}

/**
 * Pull the table back together after rows were appended below a gap, and dress
 * whatever rows are there afterwards.
 *
 * Deletes only rows that are empty across their whole width and sit above a row
 * that is not. Idempotent in what it deletes: with no gap it finds nothing and
 * removes nothing.
 *
 * The dressing runs either way, and that is the point rather than an oversight.
 * enqueueOutreach appends with setValues and no format, so a Date written into a
 * fresh cell gets whatever Sheets picks — a bare DATE, hour dropped. Dressing
 * only after a deletion meant the one path that fixed the format was the one that
 * almost never ran: Capital One and Goldman Sachs sat for days showing a day and
 * no hour, which is unreadable on a queue whose whole job is which hour a thing
 * goes out. Cheap enough to stop reasoning about — one validation and three
 * number formats over the rows that actually exist.
 */
function outreachRepairQueueLayout_(queue) {
  var last = queue.getLastRow();
  if (last < 2) return 0;
  var gaps = outreachQueueGaps_(queue.getRange(1, 1, last, Q_WIDTH).getValues());

  var removed = 0;
  gaps.forEach(function (gap) {
    queue.deleteRows(gap.start, gap.count);
    removed += gap.count;
  });
  outreachDressQueueRows_(queue);
  if (removed) Logger.log('Closed ' + gaps.length + ' gap(s), ' + removed + ' empty rows.');
  return removed;
}

/**
 * Close the gap by hand, right now, without sending anything.
 *
 * runOutreachCycle does this every hour, but it also scans, drafts and sends, and
 * sendPreparedDrafts is not gated by the sending window — run at one in the
 * morning it would post anything already Drafted and due. This is the half worth
 * running on demand: it deletes empty rows and re-dresses the ones left, and it
 * touches Gmail not at all.
 *
 * Public, and named without the trailing underscore, so it shows up in the Run
 * menu of the editor. That is the whole reason it exists.
 */
/**
 * Bring the table up to date, without sending anything.
 *
 * The half of runOutreachCycle that only rearranges. It closes the gap, calls off
 * the rows whose application was marked Rejected by hand, recomputes the two
 * projected columns over what is left, and files the result — the same four steps
 * in the same order the hourly firing runs them in, with the three that touch
 * recruiters left out.
 *
 * sendPreparedDrafts is deliberately not in it. That step is not gated by the
 * sending window, so the full cycle run at one in the morning would post anything
 * already Drafted and due — which is the last thing a button pressed to look at
 * the table should do.
 *
 * It can delete a draft, because a draft written for an application that has
 * since closed must not outlive it. It never composes or sends one.
 *
 * Public, and named without the trailing underscore, so it shows up in the Run
 * menu of the editor. That is the whole reason it exists, the same as
 * repairOutreachQueueLayout above it.
 */
function refileOutreachQueue() {
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var queue = tracker.getSheetByName(TAB_QUEUE);
  if (!queue) throw new Error('No ' + TAB_QUEUE + ' tab.');

  var removed = outreachRepairQueueLayout_(queue);
  var closed = cancelStaleOutreachRows();
  // Planned but never sent, which is the same line this whole function draws.
  // Booking a day writes three cells and touches nothing outside the tab, so it
  // belongs to the rearranging half; sendFollowUpReplies is the other half and is
  // as deliberately absent here as sendPreparedDrafts is.
  var followUp = planFollowUpReplies();
  var projected = refreshOutreachSchedule();
  var moved = outreachSortQueueByTime_(queue);

  Logger.log('Deleted ' + removed + ' empty row(s); called off ' + closed
           + ' row(s) whose application had already closed; booked '
           + followUp.booked + ' follow-up(s) and stopped ' + followUp.stopped
           + '; reprojected ' + projected + '; moved ' + moved + ' row(s) into place.');
  return { removed: removed, closed: closed, followUp: followUp,
           projected: projected, moved: moved };
}

function repairOutreachQueueLayout() {
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var queue = tracker.getSheetByName(TAB_QUEUE);
  if (!queue) throw new Error('No ' + TAB_QUEUE + ' tab.');

  var before = queue.getLastRow();
  var removed = outreachRepairQueueLayout_(queue);
  Logger.log(
    removed
      ? 'Closed the gap: deleted ' + removed + ' empty rows, and the rows below '
        + 'them moved up. Last row was ' + before + ', is now ' + queue.getLastRow() + '.'
      : 'No gap found — the table was already one block. Last row is ' + before + '.'
  );
  return removed;
}

/**
 * The company-and-role pairs someone has asked for by hand.
 *
 * Read from the whole queue rather than from the rows being ordered, so a tick on
 * a row that has already gone still lifts the ones behind it. That is the normal
 * case, not the corner: the row you notice is the one you can see, and by the time
 * a company is worth chasing its first attempt has usually already left.
 */
function outreachPriorityGroups_(queueRows) {
  var groups = [];
  queueRows.forEach(function (row) {
    if (!row.priority) return;
    groups.push({
      tokens: outreachCompanyTokens_(row.company),
      role: outreachRoleTokens_(row.role),
      season: outreachSeason_(row.role)
    });
  });
  return groups;
}

/**
 * Whether a row rides on someone else's tick.
 *
 * One tick lifts every row for the same posting, because the unit a person cares
 * about is the job, not the row: nobody wants attempt 2 at Stripe moved up and
 * attempt 3 left three days behind it. The same employer test and the same role
 * test the one-posting-one-wave rule already uses, so a tick groups rows exactly
 * as the rest of the system groups them, rather than by a second private idea of
 * what "the same job" means.
 */
function outreachPrioritised_(row, groups) {
  if (row.priority) return true;
  var tokens = outreachCompanyTokens_(row.company);
  var role = outreachRoleTokens_(row.role);
  var season = outreachSeason_(row.role);
  for (var i = 0; i < groups.length; i++) {
    // The intake test rides along with the role test for the same reason it does
    // at enqueue: chasing Winter at an employer is not asking for their Summer
    // opening to be moved up, and the two titles are alike enough that without
    // this the tick would take both.
    if (groups[i].season === season
        && outreachSameEmployer_(tokens, groups[i].tokens)
        && outreachSameRole_(role, groups[i].role)) return true;
  }
  return false;
}

/**
 * The order rows are worked in: asked for first, then employers taking turns,
 * oldest application leading.
 *
 * A tick reorders and does nothing else. It does not make a row eligible before
 * its two-day wait, does not raise the day's cap, and does not lift the weekly cap
 * on one company — it decides which rows get the slots that already existed. A
 * flag that could also grant slots would be a way to send forty emails on a Friday
 * by ticking forty boxes, which is the failure this whole cap table exists to
 * prevent.
 *
 * Two lines, ticked first, and the ticked one is served whole before the other is
 * looked at. A tick that only lifted a row above the rows applied for on the same
 * day would mean "slightly sooner"; ahead of everything unticked is what it means.
 *
 * Each line is then interleaved so employers take turns. Sorting by Date Applied
 * alone kept a company's rows adjacent — a wave of three shares one application
 * and therefore one date — so three near-identical notes went into one office back
 * to back while other employers waited a day. COMPANY_WEEKLY_CAP bounds a week and
 * had nothing to say about an afternoon. The referral path reached the same
 * arrangement from the other direction and outreachInterleaveByCompany_ is shared
 * between them.
 *
 * This orders and does not schedule, so the wave is not broken up: the same three
 * rows are still queued together and still spend the same three attempts. What
 * changes is which hours they land on, and — where a day fills — which day.
 *
 * Already-sent rows never reach here. Both callers hand over rows that are still
 * Queued: the projection filters on status, and the sender on what is due.
 *
 * Decorated before sorting rather than tokenising inside the comparator: a
 * comparator runs O(n log n) times and would re-tokenise the same company name on
 * every one of them.
 *
 * `all` is the full queue and `rows` the subset being ordered; they differ because
 * a tick is read from everywhere and applied here.
 */
function outreachOrderForSending_(rows, all) {
  var groups = outreachPriorityGroups_(all);
  var byAge = function (a, b) {
    var left = a.dateApplied ? a.dateApplied.getTime() : Infinity;
    var right = b.dateApplied ? b.dateApplied.getTime() : Infinity;
    return left === right ? a.rowNumber - b.rowNumber : left - right;
  };
  var ticked = [], plain = [];
  rows.forEach(function (row) {
    (outreachPrioritised_(row, groups) ? ticked : plain).push(row);
  });
  return outreachInterleaveByCompany_(ticked.sort(byAge))
    .concat(outreachInterleaveByCompany_(plain.sort(byAge)));
}

/**
 * The rows allowed to go out on this firing.
 *
 * The day's cap is spread across the firings left in the window rather than
 * being burned at 09:00, and it is recomputed each time, so a firing that was
 * missed is absorbed by the ones after it instead of being lost.
 *
 * Two limits now, not one. DAILY_CAP is what this path may send; the budget in
 * outreach_budget.gs is what the account may send across all three paths, and it
 * protects actual queued higher-priority work before this one is served. Without
 * that reservation the priority order would be decided by which trigger fired
 * first, and this one has been firing hourly for weeks; an empty higher path does
 * not strand its unused allowance.
 */
function outreachDueNow_(queueRows, now, referralRows) {
  var cap = outreachDailyCap_(now);
  if (!cap) return [];
  var hour = now.getHours();
  // Both bounds are the drafting ones, not the sending ones: what this picks is
  // written now and goes an hour later. So the day opens an hour before the first
  // send, which is the point of 08:00 — it is what makes 09:00 a sending hour
  // rather than the hour the first message is still being written in — and closes
  // an hour before the last, because 17:00 has nothing left to pick for.
  if (hour < DRAFT_HOUR_FIRST || hour > DRAFT_HOUR_LAST) return [];

  // A draft counts against the day as much as a send does. It has no Sent At, so
  // without the second half of this the cap never fills while Mode is Draft, and
  // a fifteen-a-day account quietly produces thirty-odd drafts instead.
  var spentToday = queueRows.filter(function (r) {
    if (r.sentAt) return outreachDaysBetween_(r.sentAt, now) === 0;
    return r.status === STATUS_DRAFTED && r.scheduledAt
        && outreachDaysBetween_(r.scheduledAt, now) === 0;
  }).length;
  var remaining = cap - spentToday;
  if (remaining <= 0) return [];

  // And never past what the whole mailbox has left for the day, which is a
  // different question from what this path's own cap allows. See
  // outreach_budget.gs; referralRows is optional because this is also called
  // from places that have no reason to have read the Referral tab, and an
  // unknown path counts as having spent nothing rather than as unlimited.
  remaining = Math.min(remaining,
    outreachBudgetRoom_(queueRows, referralRows, now, 'cold'));
  if (remaining <= 0) return [];

  var firingsLeft = DRAFT_HOUR_LAST - hour + 1;
  var slots = Math.min(remaining, Math.ceil(remaining / firingsLeft));

  var due = queueRows.filter(function (r) {
    return r.status === STATUS_QUEUED && r.eligibleAt
        && outreachMidnight_(r.eligibleAt).getTime() <= outreachMidnight_(now).getTime();
  });
  // Anything ticked by hand first, then oldest application, exactly as at enqueue
  // time. Row order would be a near-enough proxy most days and wrong on the day an
  // old application is queued after a new one — which is every day the backlog is
  // still draining.
  return outreachOrderForSending_(due, queueRows).slice(0, slots);
}

/**
 * The date each queued row is expected to go out.
 *
 * `Eligible At` says the earliest day a row *may* go; it does not say when it
 * will, because forty rows eligible today still leave over a fortnight of
 * weekday caps ahead of them. This walks the caps forward and hands each row the
 * day it actually lands on, which is the question worth asking of a queue.
 *
 * It is a projection, not a promise: a reply, a rejection or a row queued
 * tomorrow all move it. Recomputed from scratch on every enqueue run.
 */
function outreachProjectSchedule_(queueRows, from) {
  var start = outreachMidnight_(from);
  var sentToday = queueRows.filter(function (r) {
    return r.sentAt && outreachMidnight_(r.sentAt).getTime() === start.getTime();
  }).length;

  // The same order the writer itself will pick in, ticks included, so the date a
  // row shows is the date it lands on rather than the date it would have landed on
  // before anybody asked for anything.
  var pending = outreachOrderForSending_(
    queueRows.filter(function (r) { return r.status === STATUS_QUEUED; }), queueRows
  );

  var out = [];
  var day = start;
  // A year of weekdays is far past the point where the projection means
  // anything; the bound is here so a bad cap table cannot spin forever.
  for (var guard = 0; pending.length && guard < 400; guard++) {
    var today_ = day.getTime() === start.getTime();
    // The next firing, not this one. Drafting has already run by the time the
    // projection does — it is step 6 against step 7 of the same round — so a row
    // still Queued at this point missed its chance for this hour and the earliest
    // it can be written is the next one.
    var firstHour = today_ ? from.getHours() + 1 : DRAFT_HOUR_FIRST;
    var room = outreachDailyCap_(day) - (today_ ? sentToday : 0);
    // Past the last drafting hour there is no room left today whatever the cap
    // says, and these rows belong to tomorrow.
    if (firstHour > DRAFT_HOUR_LAST) room = 0;
    var today = [];
    for (var i = 0; i < pending.length && room > 0;) {
      var row = pending[i];
      var waiting = row.eligibleAt
        && outreachMidnight_(row.eligibleAt).getTime() > day.getTime();
      if (waiting) { i++; continue; }
      today.push(row);
      pending.splice(i, 1);
      room--;
    }
    // The hour matters as much as the day: "Aug 24" on fifteen rows reads as
    // fifteen emails at once, which is the one thing this is built not to do.
    // Both hours are projected, an hour apart, because both are shown: the row
    // says when it will appear in Drafts and when it will leave them.
    var hours = outreachDraftHoursForDay_(today.length, firstHour);
    today.forEach(function (row, index) {
      var draftAt = new Date(day.getTime());
      draftAt.setHours(hours[index], 0, 0, 0);
      var sendAt = new Date(draftAt.getTime() + DRAFT_LEAD_HOURS * 3600000);
      out.push({ rowNumber: row.rowNumber, draftAt: draftAt, sendAt: sendAt });
    });
    day = outreachAddDays_(day, 1);
  }
  return out;
}

/**
 * Rewrite the columns that are derived from everything else.
 *
 * `Drafted At` and `Scheduled At` because a row queued today moves every row
 * behind it, and `Recruiters` because a name typed into Contacts (manual) five
 * minutes ago should show up as a 2 where there was a 1. All are rewritten in
 * full on every firing rather than being stamped once at enqueue: a count from
 * three weeks ago is worse than no count, because it looks current.
 */
function refreshOutreachSchedule() {
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
  var queue = tracker.getSheetByName(TAB_QUEUE);
  var last = queue.getLastRow();
  if (last < 2) return 0;

  var rows = queue.getRange(2, 1, last - 1, Q_WIDTH).getValues().map(outreachParseQueue_);
  var contacts = outreachReadContacts_(contactsBook);

  // A row with no company gets no count. Writing one puts a literal 0 on a blank
  // row, and a blank row holding a 0 is content as far as getLastRow is concerned:
  // that is what pinned the table's last row at 1000 and sent every later append
  // eight hundred rows below the rest. Leave the cell as it was found.
  var counts = {};
  queue.getRange(2, Q_RECRUITERS, rows.length, 1).setValues(rows.map(function (row) {
    if (!row.company) return [''];
    if (counts[row.company] === undefined) {
      counts[row.company] = outreachRecruiterCount_(contacts, row.company);
    }
    return [counts[row.company]];
  }));
  return outreachWriteProjection_(queue);
}

/**
 * Rewrite the two projected times, and nothing else.
 *
 * Split out of refreshOutreachSchedule because the two halves answer to different
 * things. The Recruiters count changes when somebody adds a contact, which is a
 * different spreadsheet and a two-thousand-row read; the projection changes when
 * the order changes, which is one tick in one cell. Tying them together meant the
 * cheap half could only run at the speed of the expensive one, so a tick could not
 * be answered until the next hour.
 *
 * Nothing here opens the contacts book. That is the point.
 */
function outreachWriteProjection_(queue) {
  var last = queue.getLastRow();
  if (last < 2) return 0;
  var rows = queue.getRange(2, 1, last - 1, Q_WIDTH).getValues().map(outreachParseQueue_);

  var projected = {};
  outreachProjectSchedule_(rows, new Date()).forEach(function (item) {
    projected[item.rowNumber] = item;
  });
  // Only a Queued row gets a fresh projection. A row that has already been drafted
  // or sent keeps the two times it really happened at, which is both the honest
  // record and the only timestamp a draft has to be counted by.
  queue.getRange(2, Q_DRAFTED_AT, rows.length, 2).setValues(rows.map(function (row) {
    var slot = projected[row.rowNumber];
    if (slot) return [slot.draftAt, slot.sendAt];
    return [row.draftedAt || '', row.scheduledAt || ''];
  }));
  return Object.keys(projected).length;
}

/**
 * The hour a row belongs at, for reading order.
 *
 * Scheduled At first because that is the hour the message goes or went, and it is
 * the column a person scans. Drafted At is the fallback for the gap between being
 * written and being due. A row with neither — cancelled before it was ever drafted
 * — has no place on a timeline and sinks to the bottom rather than pretending to.
 *
 * Duck-typed rather than `instanceof Date`: the harness builds its rows outside
 * the vm realm the script is loaded into, where Date is a different constructor
 * and instanceof answers false for a perfectly good date.
 */
function outreachRowTime_(row) {
  var columns = [Q_SCHEDULED, Q_DRAFTED_AT];
  for (var i = 0; i < columns.length; i++) {
    var value = row[columns[i] - 1];
    if (value && typeof value.getTime === 'function') {
      var time = value.getTime();
      if (!isNaN(time)) return time;
    }
    if (typeof value === 'number' && value) return value;
  }
  return null;
}

/**
 * The rows in the order a person would file them: earliest hour first, and the
 * called-off ones underneath the rest.
 *
 * Pure, and returns the same row objects rearranged, so the caller can tell
 * whether anything actually moved before writing a hundred and fifty rows back.
 *
 * Cancelled is the one status whose time is not a fact about anything. Sent and
 * Failed each name an hour something really happened in, and they belong on the
 * timeline as the history they are. Cancelled names an hour that was planned and
 * then called off, so filing by it drops a row that can never go out into the
 * middle of the rows that will — Belvedere Trading held three of those, each
 * stamped for a lunchtime it was never going to see, sitting among live rows.
 *
 * They sink rather than vanish. What had been planned is worth reading back, just
 * not from among the rows still waiting; inside the block they stay in time order
 * like everything else.
 *
 * Ties keep the order they arrived in. Several rows share an hour by design — the
 * cap spreads three attempts across the same slot — and a comparator that reached
 * for something else to separate them would reshuffle the table on every run for
 * no reason a reader could see.
 */
function outreachTimeOrder_(values) {
  return values.map(function (row, index) {
    return {
      row: row,
      index: index,
      when: outreachRowTime_(row),
      calledOff: outreachCell_(row, Q_STATUS) === STATUS_CANCELLED ? 1 : 0
    };
  }).sort(function (a, b) {
    if (a.calledOff !== b.calledOff) return a.calledOff - b.calledOff;
    if (a.when === null || b.when === null) {
      if (a.when === b.when) return a.index - b.index;
      return a.when === null ? 1 : -1;
    }
    return a.when === b.when ? a.index - b.index : a.when - b.when;
  }).map(function (entry) { return entry.row; });
}

/**
 * Put the table in time order, and write only if that is not where it already is.
 *
 * The physical order was the order things were queued in, which stopped matching
 * the order they go out the first time an old application was queued after a new
 * one. After the gap was closed it read worse still: two blocks of already-sent
 * rows sitting in the middle of the queue because that is where the compaction
 * left them.
 *
 * Sorting values rather than calling Range.sort is what makes it testable, and it
 * is safe for the same reason it is cheap: every data row carries identical
 * dressing, so nothing travels with a row that needs to. The colours are keyed off
 * the values themselves, and the dropdowns and number formats are applied by
 * column to every row alike.
 *
 * That last part is a requirement, not an observation. Date Applied was outside
 * outreachDressQueueRows_ for a while and held two date styles at once, so rows
 * changing places changed how their dates read — the format stayed with the cell
 * while the value moved on.
 *
 * Row numbers are read fresh on every pass and never stored between runs, so
 * moving a row is invisible to everything except a person looking at the tab.
 *
 * "The bottom" is the bottom of the table, never the bottom of the sheet. This
 * rearranges one block of values and writes it back over itself, so the range it
 * started with is the range it ends with; step 1 of the same firing has already
 * deleted any empty row inside it. Nothing here can strand a row at 1000.
 */
function outreachSortQueueByTime_(queue) {
  var last = queue.getLastRow();
  if (last < 3) return 0;
  var range = queue.getRange(2, 1, last - 1, Q_WIDTH);
  var values = range.getValues();
  var sorted = outreachTimeOrder_(values);

  var moved = 0;
  for (var i = 0; i < values.length; i++) if (sorted[i] !== values[i]) moved++;
  if (!moved) return 0;
  range.setValues(sorted);
  return moved;
}

/**
 * Whether an edit is one worth reprojecting for.
 *
 * Pure and separate from the handler so it can be argued with in the harness: an
 * onEdit fires on every keystroke-sized change in the whole spreadsheet, and the
 * only one that moves the queue is a Priority cell on a data row.
 *
 * A range rather than a cell, because paste and fill-down hand over a block. The
 * test is overlap, not equality: a paste across the whole row includes Priority.
 */
/**
 * Whether an edit is one the Referral tab has to answer at once.
 *
 * Two columns, and both change what the tab says is happening next. `Cancel` calls
 * off an ask and frees its hours; `Priority` lifts the per-employer cap so a whole
 * group can go in one day. Left to the hourly cycle, both read as nothing having
 * happened — which is the thing outreachEditTouchesPriority_ was written to stop
 * on the Email tab, and this tab was simply never given the same treatment.
 *
 * A range rather than a cell, because paste, fill-down and undo hand over a block,
 * and a paste across the whole row includes both columns. Overlap, not equality.
 */
function outreachEditTouchesReferral_(tabName, range) {
  if (tabName !== TAB_REFERRAL) return false;
  var first = range.getColumn(), last = range.getLastColumn();
  var covers = function (column) { return first <= column && last >= column; };
  if (!covers(R_CANCEL) && !covers(R_PRIORITY)) return false;
  return range.getLastRow() >= 2;
}

function outreachEditTouchesPriority_(tabName, range) {
  if (tabName !== TAB_QUEUE) return false;
  if (range.getColumn() > Q_PRIORITY || range.getLastColumn() < Q_PRIORITY) return false;
  return range.getLastRow() >= 2;
}
