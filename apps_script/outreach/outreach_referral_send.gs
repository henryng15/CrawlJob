/**
 * Referral — the part that writes rows, drafts, and sends them.
 *
 * outreach_referral_queue.gs decides who is asked and in which hour; this file
 * is the hands. The split is the one outreach_send.gs makes against
 * outreach_queue.gs, for the same reason: every rule that chooses a person can
 * be argued with on a laptop, and only the three entry points below are able to
 * put anything in a mailbox.
 *
 * Three steps rather than two, and they run in the order they are written here:
 *
 *   planReferralAsks    appends the rows the planner booked. Touches no mailbox,
 *                       so it is safe at any hour and from any button.
 *   draftReferralAsks   writes the message an hour before its slot, resume and
 *                       all, and leaves it in Drafts where a person can read it.
 *   sendReferralAsks    sends what is still there when the hour arrives.
 *
 * The hour in the middle is the whole review mechanism, exactly as it is for a
 * cold email: deleting the draft in Gmail is how a referral ask is called off,
 * and the send finds nothing to send and says Cancelled. That makes reading them
 * a thing you do when you feel like it rather than a mode you have to remember
 * to be in.
 *
 * One thing here has no equivalent on the Email tab and is worth knowing before
 * reading further. The Referral tab has no Draft ID column — its seventeen
 * columns stop at Queue ID and Version — so the draft's id lives in Result until
 * the send replaces it with the id of the message that went. Result therefore
 * always holds the Gmail id this row is currently about, and never two different
 * kinds of thing at once.
 */

// ------------------------------------------------------------------ appending

/**
 * One booked ask, as the seventeen cells that will be appended for it.
 *
 * Queue ID is the person's address, prefixed, and not a uuid. The id on this tab
 * is not decoration: this path asks one person once and never again, and an id
 * that was fresh every time it was computed would let the same person be claimed
 * by two rows without either row looking wrong. Derived from the one field that
 * identifies a referral row — the same field outreachReferralAsked_ dedupes on —
 * a second row for a person who already has one is visibly a duplicate of the
 * first rather than a new booking that happens to rhyme with it. This is the
 * Email tab's rule in its own terms: 'P12-A2' is likewise the identity of that
 * row spelled out, not a number drawn for it.
 *
 * Mode is left blank on purpose. The column carries the tab's own default, and a
 * value written here would be this function overruling a person who set the
 * column to Draft — which is the one direction the mode rules never allow.
 *
 * Version is 1, written the same way and for the same reason the Email tab
 * writes it: the day a column is inserted, the rows that predate the change have
 * to be tellable from the rows that do not, and a blank cell cannot say which
 * side of a migration a row was written on.
 */
function outreachReferralRowValues_(item) {
  var row = new Array(R_WIDTH).fill('');
  row[R_COMPANY - 1] = item.company;
  row[R_ROLE - 1] = item.role;
  row[R_JOB_LINK - 1] = item.jobLink;
  row[R_PERSON - 1] = item.person.name;
  row[R_EMAIL - 1] = item.person.email;
  row[R_TITLE - 1] = item.person.title;
  row[R_TIER - 1] = item.tier;
  row[R_TEMPLATE - 1] = item.template;
  row[R_SCHEDULED - 1] = item.scheduled;
  row[R_STATUS - 1] = STATUS_QUEUED;
  row[R_ID - 1] = 'R-' + item.person.email;
  row[R_VERSION - 1] = 1;
  return row;
}

/**
 * The Referral tab, parsed, with each row knowing which row it is.
 *
 * outreachParseReferral_ takes the index it is handed rather than working one
 * out, so mapping it bare over getValues would give every row its 0-based
 * position in the array. Every write below addresses the sheet by that number:
 * the whole tab would be updated two rows above the rows being talked about, and
 * the first booking on the tab would stamp the header. The +2 is where the array
 * and the sheet are reconciled, and it is done once here so no caller can forget.
 */
function outreachReadReferralRows_(sheet) {
  var last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, R_WIDTH).getValues()
    .map(function (row, index) { return outreachParseReferral_(row, index + 2); });
}

/**
 * A company's domain, out of the employee export, remembered per company.
 *
 * outreachParseApplication_ needs it because jobs.apple.com and careers.google.com are
 * the best link a referral ask can carry and no allowlist will ever contain
 * them: the employer's own domain is what recognises them, and the ColdEmail
 * export is the only place this project holds one.
 *
 * Memoised, because the lookup is a token comparison against every employee and
 * the Jobs tab holds a posting per requisition. Asking per row rather than per
 * company turns a few hundred comparisons into a few hundred thousand, and that
 * is the kind of cost that surfaces months later as a run that times out on a
 * tab nobody thought had grown.
 */
function outreachReferralDomainFor_(employees) {
  var cache = {};
  return function (company) {
    var key = outreachNameKey_(company);
    if (!key) return '';
    if (!(key in cache)) {
      var people = outreachEmployeesFor_(employees, company);
      cache[key] = people.length ? people[0].domain : '';
    }
    return cache[key];
  };
}

/**
 * Read Jobs, Referral and the employee export; append what the planner booked.
 *
 * Appending only, like enqueueOutreach: nothing here edits a row that already
 * exists, so a run that dies halfway leaves a shorter tab rather than a
 * corrupted one.
 *
 * Running it twice in a row books nothing the second time, and that property is
 * not maintained here — it falls out of the planner reading the tab it is about
 * to be appended to. Every row this run writes carries the person's address, and
 * outreachReferralAsked_ treats an address on the tab as spent whatever became
 * of the row. So the second run sees the first run's work as history and has
 * nothing left to book. This matters because the natural trigger for this is
 * hourly: an idempotence that had to be remembered would be an idempotence that
 * failed the first time somebody clicked Run out of curiosity.
 */
function planReferralAsks() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
    var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
    var apps = tracker.getSheetByName(TAB_APP);
    var referral = tracker.getSheetByName(TAB_REFERRAL);
    if (!apps) throw new Error('No ' + TAB_APP + ' tab.');
    // A missing Referral tab is not a fault, it is a path nobody has switched on
    // yet, and the difference matters because runOutreachCycle calls this every
    // hour. Throwing would end every run red for as long as the tab is absent,
    // and a cycle that is always red is a cycle nobody reads: the day something
    // genuinely breaks, the log already says failed and has done for weeks.
    //
    // The App tab above still throws. That one is not optional: if it has gone,
    // the tracker itself is wrong and every other path is broken too.
    if (!referral) {
      Logger.log('No ' + TAB_REFERRAL + ' tab, so the referral path is not set up '
               + 'yet. Run setupReferralQueue once and this starts working.');
      return { booked: 0, skipped: 0, ready: false };
    }

    // Read before the postings, because an empty export is not a quiet day, it
    // is a broken one: every posting would be judged to have nobody at it and
    // the log would say a perfectly ordinary "booked 0". Said out loud instead.
    var employees = outreachReadEmployees_(contactsBook);
    if (!employees.length) {
      Logger.log('The ' + TAB_EMPLOYEES_SEED + ' tab is empty, so no application has '
               + 'anybody to ask. Nothing was booked; run ColdEmail\'s export first.');
      return { booked: 0, skipped: 0 };
    }

    var domainFor = outreachReferralDomainFor_(employees);
    var appLast = apps.getLastRow();
    // APP_READ_WIDTH, not getLastColumn: the tab can carry columns past the ones
    // this project knows about, and reading to the end of them would make the row
    // arrays longer than every index here expects for no gain.
    var appRows = appLast < 2 ? []
      : apps.getRange(2, 1, appLast - 1, APP_READ_WIDTH).getValues()
            .map(function (row, index) {
              return outreachParseApplication_(row, index + 2, domainFor);
            });

    var referralRows = outreachReadReferralRows_(referral);
    // The Email tab, read so the planner can ask what each day has left across all
    // three paths rather than only what this queue has taken. A day the cold path
    // has filled is a day to skip, not one to book into and discover at sending.
    var queue = tracker.getSheetByName(TAB_QUEUE);
    var queueRows = [];
    if (queue && queue.getLastRow() > 1) {
      queueRows = queue.getRange(2, 1, queue.getLastRow() - 1, Q_WIDTH).getValues()
        .map(function (row, index) { return outreachParseQueue_(row, index + 2); });
    }
    var plan = outreachReferralPlan_(appRows, referralRows, employees, new Date(),
                                     outreachReferralRoomOn_(queueRows, referralRows));

    // One setValues for the whole block. A write per row on a tab that can gain
    // a dozen rows in a run is a dozen round trips, and a run interrupted in the
    // middle of them leaves rows whose neighbours were never written.
    var referralLast = referral.getLastRow();
    if (plan.booked.length) {
      var values = plan.booked.map(outreachReferralRowValues_);
      referral.getRange(referralLast + 1, 1, values.length, R_WIDTH).setValues(values);
    }

    Logger.log('referral asks booked ' + plan.booked.length + ', already written to '
             + plan.skipped + '.');
    return { booked: plan.booked.length, skipped: plan.skipped };
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------------- drafting

/**
 * The rows whose message should exist by now.
 *
 * DRAFT_LEAD_HOURS ahead of the slot, not at it, because the hour in Drafts is
 * the entire review: a message written at the moment it is due is a message
 * nobody was ever given the chance to delete.
 *
 * A slot already gone by is still drafted. Triggers miss firings — a quota, a
 * deploy, a weekend of downtime — and a row whose hour passed unattended has to
 * be able to catch up. Dropping it instead would leave a Queued row on the tab
 * with a date in the past and no explanation anywhere.
 *
 * The address and the link are required here as well as at sending time, and
 * that is not belt and braces. A row missing either cannot become a message at
 * all, and drafting it would produce a Gmail error on a row that a person could
 * have fixed with one paste — outreachReferralDueNow_ refuses the same two
 * fields for the same reason.
 */
function outreachReferralToDraft_(referralRows, now) {
  var by = new Date(now.getTime() + DRAFT_LEAD_HOURS * 3600000);
  return referralRows.filter(function (row) {
    return row.status === STATUS_QUEUED && row.scheduled && row.scheduled <= by
        && row.email && row.jobLink;
  }).sort(function (left, right) {
    return left.scheduled - right.scheduled;
  });
}

/**
 * The attempt number behind the template a row is already advertising.
 *
 * The tab says which of the ten a person is getting before it goes out, and that
 * promise is only worth something if the message actually made is that one.
 * outreachReferralCompose_ does not take a template though — it takes an attempt
 * and derives the template from it with the company as a seed — so composing
 * from a row means recovering the number the planner used.
 *
 * The search is exact rather than approximate. outreachReferralIndex_ walks the
 * ten templates in step with the attempt, so over attempts one to ten it hits
 * every index once; the planner never books past REFERRAL_PER_COMPANY, so the
 * attempt it used is inside that range and this returns that very number. Which
 * matters beyond the wording: attempt also chooses which pair of resume bullets
 * the message carries, and a recovered attempt that merely agreed about the
 * template would hand the second person at a company the first person's bullets.
 */
/**
 * The key an application and a referral row agree on.
 *
 * Company and role together, both through the same normaliser the rest of this
 * project matches employers with, so "Software Engineer Intern " and "software
 * engineer intern" are one job rather than two.
 */
function outreachReferralAppKey_(company, role) {
  return outreachNameKey_(company) + '\u0000' + outreachNameKey_(role);
}

/**
 * When each application on the App tab was made, by company and role.
 *
 * Read once for the whole firing rather than per row: a dozen referral drafts in
 * one run would otherwise be a dozen reads of the same eight hundred rows.
 */
function outreachReferralAppliedOn_(tracker) {
  var apps = tracker.getSheetByName(TAB_APP);
  var out = {};
  if (!apps) return out;
  var last = apps.getLastRow();
  if (last < 2) return out;
  apps.getRange(2, 1, last - 1, APP_READ_WIDTH).getValues().forEach(function (row) {
    var company = outreachCell_(row, APP_COMPANY);
    var role = outreachCell_(row, APP_ROLE);
    var when = outreachDate_(row[APP_DATE_APPLIED - 1]);
    if (!company || !role || !when) return;
    var key = outreachReferralAppKey_(company, role);
    // The earliest wins. A company with two rows for one role applied once and
    // edited it; the first date is the one the recipient could verify.
    if (!out[key] || when < out[key]) out[key] = when;
  });
  return out;
}

function outreachReferralAttemptFor_(company, template) {
  var wanted = (Number(template) || 1) - 1;
  for (var attempt = 1; attempt <= 10; attempt++) {
    if (outreachReferralIndex_(company, attempt) === wanted) return attempt;
  }
  return 1;
}

/**
 * Everything the export knows about one address, or nothing.
 *
 * The tab carries the name, the address and the title, which is enough to write
 * a correct email. Seniority, angle and bucket are not on it and are worth
 * fetching, because they are what make the message about this employer rather
 * than about referrals in general.
 *
 * Not finding the person is deliberately not a cancellation, and this is where
 * the referral path parts company with the cold one. A cold row stores a
 * fingerprint and nothing else, so a contact who has left the export is a row
 * that can no longer be addressed at all — cancelling is the only honest answer.
 * Here the address is written on the row in front of you. Refusing to send to it
 * because a spreadsheet elsewhere was re-exported would call off a real ask over
 * a missing adjective.
 */
function outreachReferralPersonFor_(employees, email) {
  var wanted = String(email || '').toLowerCase();
  for (var i = 0; i < employees.length; i++) {
    if (employees[i].email === wanted) return employees[i];
  }
  return null;
}

/**
 * Write the next hour's referral asks into Drafts, addressed and complete.
 *
 * Nothing leaves here. Each row picked becomes a real draft to a real engineer,
 * with the resume attached — the same file, from the same property, through the
 * same DriveApp blob the cold path attaches, because two ways of naming the
 * resume is two files to keep current and one of them will eventually be last
 * year's.
 *
 * The resume is fetched once, above the loop, rather than per row. It is the
 * same blob for every message and Drive is a network call; fetching it inside
 * would also mean a Drive hiccup could fail some rows and not others, which is a
 * confusing shape for a failure that has nothing to do with any row.
 *
 * Every row is drafted inside its own try. One address Gmail refuses is one
 * Failed row with the reason on it; without the isolation it would be a thrown
 * run, and the rows after it — whose slots are the same afternoon — would never
 * be written at all. Failed is terminal by design: outreachReferralSpent_ counts
 * failed rows against the employer's three people, because retrying by picking
 * somebody else spends a company's remaining names on one broken run.
 */
function draftReferralAsks() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
    var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
    var referral = tracker.getSheetByName(TAB_REFERRAL);
    if (!referral) { Logger.log(outreachReferralNotSetUp_()); return outreachReferralIdle_(); }

    var now = new Date();
    var rows = outreachReadReferralRows_(referral);
    var due = outreachReferralToDraft_(rows, now);
    if (!due.length) {
      Logger.log('No referral ask is close enough to its hour to be written.');
      return { drafted: 0, failed: 0 };
    }

    var employees = outreachReadEmployees_(contactsBook);
    var appliedOn = outreachReferralAppliedOn_(tracker);
    var resume = DriveApp.getFileById(outreachProperty_(PROP_RESUME_ID, true)).getBlob();
    var tally = { drafted: 0, failed: 0 };

    due.forEach(function (row) {
      try {
        var person = outreachReferralPersonFor_(employees, row.email) || {};
        var mail = outreachReferralCompose_({
          personName: row.person,
          personTitle: row.title,
          seniority: person.seniority || '',
          company: row.company,
          angle: person.angle || '',
          bucket: person.bucket || '',
          role: row.role,
          // Looked up rather than stored, because the Referral tab has no column
          // for it and does not want one: the date belongs to the application,
          // and the application already has a row of its own two tabs away that
          // stays right when it is corrected there.
          //
          // It has to be here at all because every row on this tab now comes from
          // an application that was actually made. While this path read the Jobs
          // tab there was often no date and the email said "I am applying";
          // saying that about an application submitted three weeks ago is the same
          // falsehood the present tense was introduced to avoid, pointing the
          // other way.
          dateApplied: appliedOn[outreachReferralAppKey_(row.company, row.role)] || null,
          today: now,
          jobLink: row.jobLink,
          // The tab already names which of the ten this row is getting, and that
          // is what a person read before it went. Recomputing from scratch here
          // could quietly disagree with the cell.
          attempt: outreachReferralAttemptFor_(row.company, row.template)
        });

        var draft = GmailApp.createDraft(row.email, mail.subject, mail.plain, {
          htmlBody: mail.html,
          name: SENDER_NAME,
          attachments: [resume]
        });

        var updates = {};
        updates[R_STATUS] = STATUS_DRAFTED;
        updates[R_DRAFTED_AT] = now;
        // The draft's id, in the only column this tab has for it. Result holds
        // one Gmail id at every stage of a row's life and the send overwrites it
        // with the id of the message that went, so the cell never has to be read
        // as two things at once.
        updates[R_DRAFT_ID] = draft.getId();
        outreachWriteRow_(referral, row.index, updates);
        tally.drafted++;
      } catch (error) {
        var failed = {};
        failed[R_STATUS] = STATUS_FAILED;
        failed[R_ERROR] = String(error.message || error).slice(0, 250);
        outreachWriteRow_(referral, row.index, failed);
        tally.failed++;
      }
    });

    Logger.log('referral asks written ' + tally.drafted + ', failed ' + tally.failed + '.');
    return tally;
  } finally {
    lock.releaseLock();
  }
}

// -------------------------------------------------------------------- sending

/**
 * The drafted rows whose hour has arrived.
 *
 * outreachReferralDueNow_ owns every part of this question: the whole-timestamp
 * comparison, the order, the two fields a row cannot go without, and the day's
 * remaining share of the mailbox budget. This adds one thing to it, which is the
 * only part that is about sending rather than about being due.
 *
 * Mode is honoured here rather than at drafting time, exactly as the cold path
 * honours it. A row held to Draft is still written, so it exists to be read and
 * sent by hand; only this step passes it over. The global OUTREACH_MODE switch is
 * read here for the same reason it is read in outreachDraftsToSend_: a safety
 * switch consulted only where drafts are made is a switch over the wording of a
 * column and nothing else, and a safety switch that fails open is worse than no
 * switch because it is believed.
 */
function outreachReferralToSend_(referralRows, now, globalMode, queueRows) {
  return outreachReferralDueNow_(referralRows, now, queueRows)
    .filter(function (row) {
      return outreachModeFor_(row.mode, globalMode) !== MODE_DRAFT;
    });
}

/**
 * Send the referral asks that are still in Drafts when their hour comes.
 *
 * A draft that is gone was deleted on purpose, and that is the entire point of
 * writing it an hour early: reading it in Gmail and deleting it is how you call
 * one off. The row is marked Cancelled and not Failed, because nothing failed —
 * and the difference is not cosmetic. Failed is what the tab says when a send
 * broke and the reason is worth looking at, so a column of Failed rows that are
 * really a person's own decisions is a column nobody can read for problems any
 * more. The cold path draws the same line in sendPreparedDrafts, and the two
 * have to agree or the tabs stop meaning the same thing side by side.
 *
 * No lock. This only ever advances a row that drafting already finished with, so
 * two overlapping firings cost at worst one wasted Gmail lookup, and holding the
 * lock through a run of sends is how a drafting run gets starved out of its hour.
 */
function sendReferralAsks() {
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  // Two switches, and either alone holds a referral back. The narrow one exists so
  // this path can have its own first week without the cold path being stopped to
  // watch it, which is the arrangement the follow-up rollout already uses.
  var globalMode = outreachProperty_(PROP_REFERRAL_MODE, false) === MODE_DRAFT
    ? MODE_DRAFT : outreachProperty_(PROP_MODE, false);
  var referral = tracker.getSheetByName(TAB_REFERRAL);
  if (!referral) { Logger.log(outreachReferralNotSetUp_()); return outreachReferralIdle_(); }

  var last = referral.getLastRow();
  if (last < 2) return { sent: 0, cancelled: 0, failed: 0 };

  var now = new Date();
  var rows = outreachReadReferralRows_(referral);
  var due = outreachReferralToSend_(rows, now, globalMode);
  if (!due.length) { Logger.log('No referral ask is due this firing.'); return { sent: 0, cancelled: 0, failed: 0 }; }

  var tally = { sent: 0, cancelled: 0, failed: 0 };

  due.forEach(function (row) {
    var updates = {};
    // Carried by the parsed row now that the tab has a column for it, rather than
    // being fetched as a second range and matched back by row number. One read of
    // the tab, and the id arrives attached to the row it belongs to instead of to
    // an index into a parallel array.
    var draftId = row.draftId;

    // Drafted with no draft to show for it. Not Cancelled — nobody deleted
    // anything here, the row simply lost the one reference that made it sendable,
    // and calling that a person's decision would hide a real defect in the write
    // that drafting is supposed to have made.
    if (!draftId) {
      updates[R_STATUS] = STATUS_FAILED;
      updates[R_ERROR] = 'The row says Drafted but carries no draft to send.';
      outreachWriteRow_(referral, row.index, updates);
      tally.failed++;
      return;
    }

    try {
      var message = GmailApp.getDraft(draftId).send();
      updates[R_STATUS] = STATUS_SENT;
      updates[R_SENT_AT] = now;
      updates[R_RESULT] = message.getId();
      tally.sent++;
    } catch (error) {
      var missing = /not found|no longer exists|Invalid draft/i.test(String(error.message || error));
      updates[R_STATUS] = missing ? STATUS_CANCELLED : STATUS_FAILED;
      if (missing) {
        updates[R_RESULT] = 'The draft was deleted before its hour, so it was called off.';
      } else {
        updates[R_ERROR] = String(error.message || error).slice(0, 250);
      }
      missing ? tally.cancelled++ : tally.failed++;
    }
    outreachWriteRow_(referral, row.index, updates);
  });

  Logger.log('referral asks sent ' + tally.sent + ', called off ' + tally.cancelled
           + ', failed ' + tally.failed + '.');
  return tally;
}

// --------------------------------------------------------------------- probing

/**
 * Run by hand: say whether this path could work, without doing any of it.
 *
 * It checks different things than checkOutreachFollowUpService, and the reason
 * is worth stating: a follow-up needs the Gmail *advanced service*, which is a
 * manifest entry that can silently not be there, so that probe is a probe of one
 * thing. Referral asks go out through GmailApp like every cold email, so there
 * is no service to be missing — what can be missing here is the material. A tab
 * that was never created, an employee export nobody has run, a resume id that
 * points at a file this account cannot open.
 *
 * All three fail late and quietly if they are not checked: a missing export
 * books nothing and logs a perfectly ordinary zero, and a resume that will not
 * open throws once per row, inside the per-row try, and turns a whole afternoon
 * of good rows into Failed. Every one of them is cheaper to find here, in a
 * function that reads and sends nothing.
 *
 * Reports all the problems rather than the first. Being told about one missing
 * thing, fixing it, and being told about the next is three round trips through a
 * setup that could have been described in one.
 */
function checkReferralService() {
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
  var problems = [];

  var referral = tracker.getSheetByName(TAB_REFERRAL);
  if (!referral) problems.push('there is no ' + TAB_REFERRAL + ' tab to write to');
  if (!tracker.getSheetByName(TAB_APP)) {
    problems.push('there is no ' + TAB_APP + ' tab, so no application can be found');
  }

  var employees = outreachReadEmployees_(contactsBook);
  if (!employees.length) {
    problems.push('the ' + TAB_EMPLOYEES_SEED + ' tab is empty, so no application has '
                + 'anybody to ask');
  }

  try {
    DriveApp.getFileById(outreachProperty_(PROP_RESUME_ID, true)).getBlob();
  } catch (error) {
    problems.push('the resume did not open (' + String(error.message || error) + ')');
  }

  if (problems.length) {
    Logger.log('NOT ready: ' + problems.join('; ') + '. Nothing was read further '
             + 'and nothing was sent.');
    return false;
  }

  var rows = outreachReadReferralRows_(referral);
  var waiting = rows.filter(function (row) { return row.status === STATUS_QUEUED; }).length;
  var written = rows.filter(function (row) { return row.status === STATUS_DRAFTED; }).length;
  Logger.log('Ready. ' + employees.length + ' people in the export, ' + waiting
           + ' ask(s) booked and ' + written + ' waiting in Drafts. Nothing was sent.');
  return true;
}


/**
 * What the log says when the tab is not there, in one place so the three entry
 * points cannot drift into saying it three ways.
 */
function outreachReferralNotSetUp_() {
  return 'No ' + TAB_REFERRAL + ' tab, so the referral path is not set up yet. '
       + 'Run setupReferralQueue once and this starts working.';
}

/** A run that did nothing because there was nothing set up to do it with. */
function outreachReferralIdle_() {
  return { sent: 0, drafted: 0, cancelled: 0, failed: 0, ready: false };
}


/**
 * Take the cancellations, hand back the hours, and tighten the queue.
 *
 * Three jobs that have to happen together and in this order, because each one is
 * the reason the next has anything to do.
 *
 * First the drafts. A row cancelled on the tab leaves a written, addressed message
 * in Gmail, and the bound script cannot reach it: it runs as the tracker's account
 * and the drafts belong to the sender's. Left alone it is a message the tab says
 * was called off, sitting in Drafts waiting for somebody to send it by hand.
 *
 * Then the hours. Cancelling six rows on one day should move the line up, not
 * leave six unused hours in it with everything behind them still waiting a week.
 *
 * Then nothing else: the topping up is planReferralAsks' job, and it runs after
 * this in the cycle so that it sees the freed days.
 */
function replanReferralAsks() {
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var referral = tracker.getSheetByName(TAB_REFERRAL);
  if (!referral) { Logger.log(outreachReferralNotSetUp_()); return outreachReferralIdle_(); }

  var rows = outreachReadReferralRows_(referral);
  if (!rows.length) return { discarded: 0, moved: 0, cancelled: 0, ready: true };

  var tally = { discarded: 0, moved: 0, cancelled: 0, repointed: 0, retired: 0, ready: true };

  // A tick that the bound script's onEdit never saw — the box was filled by a
  // paste, a fill-down, or an undo, none of which fire a simple trigger. The tab
  // is the record either way, so the state is settled here rather than trusted to
  // have been settled there.
  //
  // Expanded to the whole ask, because six rows sharing a company and a posting
  // are one decision rather than six. onEdit does the same expansion for the
  // instant feedback; this is the half that is authoritative.
  outreachReferralToCancel_(rows).forEach(function (row) {
    var updates = {};
    updates[R_STATUS] = STATUS_CANCELLED;
    updates[R_CANCEL] = true;
    updates[R_SCHEDULED] = '';
    updates[R_DRAFTED_AT] = '';
    outreachWriteRow_(referral, row.index, updates);
    row.status = STATUS_CANCELLED;
    row.cancel = true;
    row.scheduled = null;
    tally.cancelled++;
  });

  // A row somebody dropped by hand, using the Status dropdown rather than the
  // checkbox. Nothing ran when they did it, so the row still shows the hour it was
  // going to leave at: a tab saying Cancelled in one column and 09:00 in the next.
  // The hour is already free as far as the planner is concerned — this is the cell
  // catching up with the decision.
  rows.forEach(function (row) {
    if (row.status !== STATUS_CANCELLED) return;
    if (!row.scheduled && !row.draftedAt) return;
    var updates = {};
    updates[R_SCHEDULED] = '';
    updates[R_DRAFTED_AT] = '';
    outreachWriteRow_(referral, row.index, updates);
    row.scheduled = null;
    row.draftedAt = null;
  });

  outreachReferralAbandoned_(rows).forEach(function (row) {
    var updates = {};
    try {
      GmailApp.getDraft(row.draftId).deleteDraft();
      tally.discarded++;
    } catch (error) {
      // Already gone is the outcome this wanted. Anything else is worth keeping,
      // because a draft that cannot be deleted is a message that can still be
      // sent by hand from a mailbox the tab says is finished with it.
      if (!/not found|no longer exists|Invalid draft/i.test(String(error.message || error))) {
        updates[R_ERROR] = 'Could not discard the draft: '
          + String(error.message || error).slice(0, 200);
      }
    }
    updates[R_DRAFT_ID] = '';
    outreachWriteRow_(referral, row.index, updates);
    row.draftId = '';
  });

  // A company that has gained a newer application. The ask that has not gone yet
  // should be about the newer one: it is the application still moving, and its
  // posting is the one most likely still open. A drafted row loses its draft with
  // its link, because a draft naming the old posting is worse than no draft.
  var apps = tracker.getSheetByName(TAB_APP);
  if (apps && apps.getLastRow() > 1) {
    var domainFor = outreachReferralDomainFor_(outreachReadEmployees_(
      SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true))));
    var applications = apps.getRange(2, 1, apps.getLastRow() - 1, APP_READ_WIDTH).getValues()
      .map(function (row, index) {
        return outreachParseApplication_(row, index + 2, domainFor);
      });
    var seen = outreachReferralReconcile_(rows, applications);

    seen.repoint.forEach(function (change) {
      var updates = {};
      updates[R_ROLE] = change.role;
      updates[R_JOB_LINK] = change.jobLink;
      if (change.draftId) {
        try { GmailApp.getDraft(change.draftId).deleteDraft(); } catch (error) { /* already gone */ }
        updates[R_DRAFT_ID] = '';
        updates[R_STATUS] = STATUS_QUEUED;
        updates[R_DRAFTED_AT] = '';
      }
      outreachWriteRow_(referral, change.index, updates);
      tally.repointed++;
    });

    // A row whose company has no qualifying application left. Closing it is the
    // point: left open it stays booked, stays due, and goes out asking a stranger
    // for a favour about an application this path would refuse to create a row for
    // today.
    seen.retire.forEach(function (change) {
      var updates = {};
      updates[R_STATUS] = STATUS_CANCELLED;
      updates[R_SCHEDULED] = '';
      updates[R_DRAFTED_AT] = '';
      updates[R_ERROR] = change.reason;
      if (change.draftId) {
        try { GmailApp.getDraft(change.draftId).deleteDraft(); } catch (error) { /* already gone */ }
        updates[R_DRAFT_ID] = '';
      }
      outreachWriteRow_(referral, change.index, updates);
      var stale = rows.filter(function (one) { return one.index === change.index; })[0];
      if (stale) { stale.status = STATUS_CANCELLED; stale.scheduled = null; }
      tally.retired++;
    });
  }

  var queue = tracker.getSheetByName(TAB_QUEUE);
  var queueRows = [];
  if (queue && queue.getLastRow() > 1) {
    queueRows = queue.getRange(2, 1, queue.getLastRow() - 1, Q_WIDTH).getValues()
      .map(function (row, index) { return outreachParseQueue_(row, index + 2); });
  }

  var moved = outreachReferralReplan_(rows, new Date(),
                                      outreachReferralRoomOn_(queueRows, rows));
  moved.forEach(function (change) {
    var updates = {};
    updates[R_SCHEDULED] = change.scheduled;
    outreachWriteRow_(referral, change.index, updates);
  });
  tally.moved = moved.length;

  Logger.log('Referral replan: ' + tally.cancelled + ' newly cancelled, '
           + tally.discarded + ' draft(s) discarded, ' + tally.repointed
           + ' row(s) moved to a newer application, ' + tally.retired
           + ' closed for want of a qualifying application, ' + tally.moved + ' re-timed.');
  return tally;
}
