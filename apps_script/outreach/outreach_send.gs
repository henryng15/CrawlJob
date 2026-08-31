/**
 * Outreach — the part that touches Gmail.
 *
 * Everything that decides lives in outreach_queue.gs and is testable without an
 * account. This file is the hands: it re-reads the application, builds the
 * message, and either drafts it or sends it. Keeping the two apart is what lets
 * the rules be argued with on a laptop.
 *
 * It runs in the Apps Script project owned by the sending account, so GmailApp
 * sends as that account with no credential stored anywhere.
 */

/**
 * Re-read the application this queue row was built from.
 *
 * Days pass between enqueue and send, and Process moves in that time. This is
 * the single most important correctness rule in the system: an application that
 * has been rejected, or that has advanced to a stage where a human contact
 * already exists, must not receive a cold email about itself.
 */
function outreachStillQualifies_(appRow) {
  if (!appRow) return { ok: false, why: 'the App row has gone' };
  if (!outreachQualifies_(appRow.process)) {
    return { ok: false, why: 'Process is now ' + (appRow.process || 'blank') };
  }
  return { ok: true };
}

/**
 * Find the contact behind a fingerprint without the queue ever holding one.
 *
 * Both buckets are tried rather than the row's own Role deciding which to check.
 * Deriving the season from the Role read correctly right up until somebody fixed a
 * Role — which is a thing this tracker actively invites, because the crawlers miss
 * the season often enough that correcting one by hand is routine. A row whose Role
 * gained the word "Winter" after it was queued would stop resolving to any contact,
 * and sendPreparedDrafts cancels a row it cannot resolve: a correction to the sheet
 * would silently call off the email it was meant to improve.
 *
 * Trying both costs one extra hash and makes the lookup independent of a cell
 * anybody can edit. The fingerprint on the row stays the authority on which bucket
 * was actually spent.
 */
function outreachContactByFingerprint_(companyContacts, fingerprint, salt) {
  for (var i = 0; i < companyContacts.length; i++) {
    var email = companyContacts[i].email;
    if (outreachFingerprint_(email, salt, SEASON_SUMMER) === fingerprint
        || outreachFingerprint_(email, salt, SEASON_OFFCYCLE) === fingerprint) {
      return companyContacts[i];
    }
  }
  return null;
}

function outreachWriteRow_(queue, rowNumber, updates) {
  Object.keys(updates).forEach(function (column) {
    queue.getRange(rowNumber, Number(column), 1, 1).setValue(updates[column]);
  });
}

/**
 * Throw away a draft that must not go out.
 *
 * Already gone is the outcome we wanted, so a missing draft is not an error.
 * Leaving it in the mailbox would be worse than either: it would sit there
 * looking like something still waiting to be sent.
 */
function outreachDiscardDraft_(draftId) {
  if (!draftId) return;
  try {
    GmailApp.getDraft(draftId).deleteDraft();
  } catch (error) {
    // Deleted by hand, or never created. Both mean there is nothing to stop.
  }
}

/**
 * The hour a draft written now leaves in — the top of it, not the minute.
 *
 * A time-driven trigger fires at a minute Google picks and drifts a few either
 * way, so `now + one hour` produces a target the next firing can arrive *before*.
 * A draft written at 12:05 scheduled for exactly 13:05 is passed over by a 13:03
 * firing and waits until 14:03 — an hour late, on a row whose Scheduled At says
 * 13:05 and whose Error column is empty, which is the least debuggable shape a
 * delay can have.
 *
 * Anchoring to the top of the hour also makes the row agree with the projection
 * it replaces: outreachProjectSchedule_ has always promised whole hours, and a
 * drafted row is the same fact after the event.
 */
function outreachSendHourAfter_(now) {
  var goesAt = new Date(now.getTime() + DRAFT_LEAD_HOURS * 3600000);
  goesAt.setMinutes(0, 0, 0);
  return goesAt;
}

/**
 * The drafts whose hour has come.
 *
 * Mode is checked here rather than at drafting time, so a row whose message could
 * not be made specific — a hand-typed contact at a company ColdEmail never wrote
 * for — is written and then waits for a person, instead of never being written at
 * all. Its draft is in the mailbox either way; only this step passes it over.
 *
 * The global OUTREACH_MODE switch is read here too. It used to be consulted only
 * where the drafts were written, which made it a switch over the wording of the
 * Result column and nothing else: every row whose own Mode said Send still went
 * out with the rollout switch set to Draft. A safety switch that fails open is
 * worse than no switch, because it is believed.
 */
function outreachDraftsToSend_(queueRows, now, globalMode) {
  return queueRows.filter(function (row) {
    return row.status === STATUS_DRAFTED
        && outreachModeFor_(row.mode, globalMode) !== MODE_DRAFT
        && row.draftId
        && row.scheduledAt
        && row.scheduledAt.getTime() <= now.getTime();
  });
}

/**
 * Send what was written an hour ago.
 *
 * A draft that is gone was deleted on purpose, and that is the whole point of
 * writing an hour early: reading it in Gmail and deleting it is how you call one
 * off. The row is marked Cancelled rather than Failed, because nothing failed.
 *
 * The other way a send is called off is the application itself closing during
 * that hour, which is checked here rather than trusted from an hour ago.
 */
function sendPreparedDrafts() {
  // The minute tick and the hourly cycle can both notice the same due draft.
  // One script-wide lock makes that race one sender and one harmless later read,
  // never two calls to GmailApp.send() for one draft.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach send holds the lock.');
  try {
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var globalMode = outreachProperty_(PROP_MODE, false);
  var app = tracker.getSheetByName(TAB_APP);
  var queue = tracker.getSheetByName(TAB_QUEUE);
  var last = queue.getLastRow();
  if (last < 2) return { sent: 0, cancelled: 0, failed: 0, retired: 0 };

  var now = new Date();
  var rows = queue.getRange(2, 1, last - 1, Q_WIDTH).getValues().map(outreachParseQueue_);

  // App is re-read here as well as at drafting time, because an hour passes in
  // between and it is an hour in which the answer can change. The rejection scan
  // catches the ones that arrive by email; this catches every other way an
  // application closes — a Process moved by hand, or a rejection that landed in
  // the other mailbox. Without it, a draft written at 08:00 goes out at 09:00
  // whatever happened at 08:30.
  var appLast = app.getLastRow();
  var byProperty = {};
  if (appLast >= 2) {
    app.getRange(2, 1, appLast - 1, APP_RECRUITERS).getValues()
       .map(outreachParseApp_).forEach(function (row) { byProperty[row.property] = row; });
  }

  var tally = { sent: 0, cancelled: 0, failed: 0, retired: 0 };

  outreachDraftsToSend_(rows, now, globalMode).forEach(function (row) {
    var updates = {};

    var check = outreachStillQualifies_(byProperty[row.property]);
    if (!check.ok) {
      outreachDiscardDraft_(row.draftId);
      updates[Q_STATUS] = STATUS_CANCELLED;
      updates[Q_RESULT] = check.why + '; the draft was thrown away unsent.';
      outreachWriteRow_(queue, row.rowNumber, updates);
      tally.cancelled++;
      return;
    }

    try {
      var draft = GmailApp.getDraft(row.draftId);
      var message = draft.send();
      updates[Q_STATUS] = STATUS_SENT;
      updates[Q_MESSAGE_ID] = message.getId();
      updates[Q_SENT_AT] = new Date();
      updates[Q_RESULT] = 'Sent: ' + (row.template || 'application');
      tally.sent++;
    } catch (error) {
      var missing = /not found|no longer exists|Invalid draft/i.test(String(error.message || error));
      updates[Q_STATUS] = missing ? STATUS_CANCELLED : STATUS_FAILED;
      updates[missing ? Q_RESULT : Q_ERROR] = missing
        ? 'The draft was deleted before its hour, so it was called off.'
        : String(error.message || error).slice(0, 250);
      missing ? tally.cancelled++ : tally.failed++;
    }
    outreachWriteRow_(queue, row.rowNumber, updates);
  });

  // After the sends, so a row that went out this very firing is retired in the
  // same run rather than waiting an hour to catch up with itself.
  outreachPrioritiesToRetire_(rows).forEach(function (row) {
    var done = {};
    done[Q_PRIORITY] = PRIORITY_DONE;
    outreachWriteRow_(queue, row.rowNumber, done);
    tally.retired++;
  });

  Logger.log('sent ' + tally.sent + ', called off ' + tally.cancelled
           + ', failed ' + tally.failed + ', priorities retired ' + tally.retired);
  return tally;
  } finally {
    lock.releaseLock();
  }
}

/**
 * The ticked rows whose email has gone, and whose tick has not been retired yet.
 *
 * Three conditions, and each excludes a case that would be wrong to write:
 *
 *   sentAt      — nothing has gone from a Queued or Drafted row, so its tick is
 *                 still a live request and must stay a tick.
 *   priority    — a row nobody ticked has nothing to retire. Writing Done there
 *                 would claim a request that was never made, and because Done
 *                 reads as ticked it would enrol every sent row in the priority
 *                 groups, which is the whole feature inverted.
 *   not already — Done is already Done. Without this the same cells would be
 *                 rewritten on every firing, for nothing.
 */
function outreachPrioritiesToRetire_(rows) {
  return rows.filter(function (row) {
    if (!row.sentAt || !row.priority) return false;
    return String(row.priorityText == null ? '' : row.priorityText).trim() !== PRIORITY_DONE;
  });
}

/**
 * Write the next hour's emails into Drafts, addressed and complete.
 *
 * Nothing leaves here. Each row picked becomes a real Gmail draft to the real
 * recruiter, and its Scheduled At is set to the hour it will go, an hour from now.
 */
function prepareOutreachDrafts() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
    var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
    var salt = outreachProperty_(PROP_SALT, true);
    var globalMode = outreachProperty_(PROP_MODE, false);
    var app = tracker.getSheetByName(TAB_APP);
    var queue = tracker.getSheetByName(TAB_QUEUE);

    var appLast = app.getLastRow();
    var appRows = appLast < 2 ? []
      : app.getRange(2, 1, appLast - 1, APP_RECRUITERS).getValues().map(outreachParseApp_);
    var byProperty = {};
    appRows.forEach(function (row) { byProperty[row.property] = row; });

    var queueLast = queue.getLastRow();
    if (queueLast < 2) { Logger.log('Queue is empty.'); return { drafted: 0 }; }
    var queueRows = queue.getRange(2, 1, queueLast - 1, Q_WIDTH).getValues().map(outreachParseQueue_);

    var now = new Date();
    // The last firing of the day only sends; anything written then would have no
    // hour left to wait in, and would go out the next morning instead.
    if (now.getHours() > DRAFT_HOUR_LAST) {
      Logger.log('Last firing of the day: sending only, nothing new written.');
      return { drafted: 0 };
    }
    var due = outreachDueNow_(queueRows, now);
    if (!due.length) { Logger.log('Nothing due this firing.'); return { drafted: 0 }; }

    var contacts = outreachReadContacts_(contactsBook);
    var resume = DriveApp.getFileById(outreachProperty_(PROP_RESUME_ID, true)).getBlob();
    var tally = { drafted: 0, cancelled: 0, failed: 0 };

    due.forEach(function (item) {
      var appRow = byProperty[item.property];
      var check = outreachStillQualifies_(appRow);
      if (!check.ok) {
        var cancel = {};
        cancel[Q_STATUS] = STATUS_CANCELLED;
        cancel[Q_RESULT] = check.why;
        outreachWriteRow_(queue, item.rowNumber, cancel);
        tally.cancelled++;
        return;
      }

      var companyContacts = outreachContactsFor_(contacts, item.company);
      var contact = outreachContactByFingerprint_(companyContacts, item.fingerprint, salt);
      if (!contact) {
        // Cancelled rather than failed: nothing went wrong in the sending, the
        // person simply is not in the contact list any more. Cancelled also
        // hands the address back, in case they return on a later export.
        var gone = {};
        gone[Q_STATUS] = STATUS_CANCELLED;
        gone[Q_RESULT] = 'The contact behind this row is no longer in the list.';
        outreachWriteRow_(queue, item.rowNumber, gone);
        tally.cancelled++;
        return;
      }

      var mail = outreachCompose_({
        // The tab already names which of the ten this row is getting, and that is
        // what you read before it went. Recomputing here could quietly disagree.
        variant: item.template
          || outreachVariantFor_(item.attempt, contact.focus, outreachBucketFor_(companyContacts)),
        role: appRow.role,
        recruiterName: contact.name,
        dateApplied: appRow.dateApplied,
        // Read now, not when the row was queued. Days pass in between, and an
        // application that cleared its assessment in that time should say so.
        process: appRow.process,
        today: now,
        hook: contact.hook,
        angle: outreachAngleFor_(companyContacts)
      });

      var options = {
        htmlBody: mail.html,
        name: SENDER_NAME,
        attachments: [resume]
      };

      try {
        var draft = GmailApp.createDraft(contact.email, mail.subject, mail.plain, options);
        var goesAt = outreachSendHourAfter_(now);
        var updates = {};
        updates[Q_STATUS] = STATUS_DRAFTED;
        updates[Q_DRAFT_ID] = draft.getId();
        // Both times become fact here, replacing the projection the row carried
        // while it was queued: this is the minute it appeared in Drafts, and that
        // is the hour it leaves them.
        updates[Q_DRAFTED_AT] = now;
        updates[Q_SCHEDULED] = goesAt;
        updates[Q_RESULT] = outreachModeFor_(item.mode, globalMode) === MODE_DRAFT
          ? 'Written, and waiting for you: ' + mail.variant
          : 'Written, goes out at the next firing: ' + mail.variant;
        outreachWriteRow_(queue, item.rowNumber, updates);
        tally.drafted++;
      } catch (error) {
        var failed = {};
        failed[Q_STATUS] = STATUS_FAILED;
        failed[Q_ERROR] = String(error.message || error).slice(0, 250);
        outreachWriteRow_(queue, item.rowNumber, failed);
        tally.failed++;
      }
    });

    Logger.log('wrote ' + tally.drafted + ', cancelled ' + tally.cancelled
             + ', failed ' + tally.failed);
    return tally;
  } finally {
    lock.releaseLock();
  }
}

// A row worth asking Gmail about. Every sent row would mean one API call per
// row on every run, growing with the queue forever; a reply to a two-month-old
// cold email is not a thing that happens.
var REPLY_WINDOW_DAYS = 30;

function outreachRowsToScan_(rows, now) {
  return rows.filter(function (row) {
    return row.status === STATUS_SENT && row.sentAt
        && outreachDaysBetween_(row.sentAt, now) <= REPLY_WINDOW_DAYS;
  });
}

/**
 * Mark what has come back.
 *
 * Both checks read this account's own mailbox, which is the reason the sender is
 * an Apps Script project here rather than a worker elsewhere: no extra scope is
 * negotiated and no token is stored to make either of them possible.
 *
 * A reply is recorded, not acted on: the other people at that company still get
 * their email, because one recruiter answering is not the same as being in. A
 * bounce is different — the address is proven bad, so it leaves circulation.
 */
function scanOutreachReplies() {
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var salt = outreachProperty_(PROP_SALT, true);
  var queue = tracker.getSheetByName(TAB_QUEUE);
  var last = queue.getLastRow();
  if (last < 2) return { replied: 0, bounced: 0 };

  var now = new Date();
  var rows = queue.getRange(2, 1, last - 1, Q_WIDTH).getValues().map(outreachParseQueue_);
  var messageIds = queue.getRange(2, Q_MESSAGE_ID, last - 1, 1).getValues();
  var byRowNumber = {};
  outreachRowsToScan_(rows, now).forEach(function (row) { byRowNumber[row.rowNumber] = true; });
  var tally = { replied: 0, bounced: 0 };

  // A thread this account started holds one message until somebody answers.
  rows.forEach(function (row, index) {
    if (!byRowNumber[row.rowNumber]) return;
    var id = String(messageIds[index][0] || '').trim();
    if (!id) return;
    try {
      var thread = GmailApp.getMessageById(id).getThread();
      // Who sent them, not how many there are. This read `getMessageCount() > 1`
      // and the follow-up is posted onto this same thread, so every row that got
      // one came back Replied on the next scan — the queue reading its own second
      // message as the recruiter's first, and then calling off the follow-ups of
      // every colleague at that company. See outreachThreadVerdict_.
      var verdict = outreachThreadVerdict_(thread.getMessages().map(function (one) {
        return { id: one.getId(), from: one.getFrom() };
      }), id);
      if (verdict === STATUS_REPLIED) {
        var replied = {};
        replied[Q_STATUS] = STATUS_REPLIED;
        replied[Q_RESULT] = 'Reply on ' + thread.getLastMessageDate();
        outreachWriteRow_(queue, row.rowNumber, replied);
        tally.replied++;
      } else if (verdict === STATUS_BOUNCED) {
        // The bounce pass below finds these too, by reading mailer-daemon's own
        // mail, and writes the same status. Recording it here as well costs one
        // write and catches the failure whose notice never named the address in a
        // form that pass could match.
        var dead = {};
        dead[Q_STATUS] = STATUS_BOUNCED;
        dead[Q_ERROR] = 'Delivery failed; this contact will not be used again.';
        outreachWriteRow_(queue, row.rowNumber, dead);
        tally.bounced++;
      }
    } catch (error) {
      // A deleted message is not a reply, and not worth failing a whole run for.
    }
  });

  // Bounces name the address in the body. Fingerprinting what we find keeps the
  // matching one-way: the queue is never told who bounced, only that this row did.
  //
  // Both buckets per address, because the row that bounced could be from either
  // intake and the body says only who it went to. Fingerprinting the address once
  // was correct while there was one fingerprint per person; against a scoped one
  // it silently stopped matching every off-cycle row, and a bounce that matches
  // nothing is a dead address left in the queue looking delivered.
  var bounced = {};
  GmailApp.search('from:mailer-daemon newer_than:14d', 0, 50).forEach(function (thread) {
    thread.getMessages().forEach(function (message) {
      var body = message.getPlainBody() || '';
      (body.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []).forEach(function (address) {
        [SEASON_SUMMER, SEASON_OFFCYCLE].forEach(function (season) {
          bounced[outreachFingerprint_(address, salt, season)] = true;
        });
      });
    });
  });
  rows.forEach(function (row) {
    if (!byRowNumber[row.rowNumber] || !bounced[row.fingerprint]) return;
    var mark = {};
    mark[Q_STATUS] = STATUS_BOUNCED;
    mark[Q_ERROR] = 'Delivery failed; this contact will not be used again.';
    outreachWriteRow_(queue, row.rowNumber, mark);
    tally.bounced++;
  });

  Logger.log('replied ' + tally.replied + ', bounced ' + tally.bounced);
  return tally;
}

/**
 * Run by hand: undo the replies that were never replies.
 *
 * `scanOutreachReplies` shipped reading `thread.getMessageCount() > 1` as an
 * answer. The follow-up is posted onto that same thread, so five days after any
 * cold email the count reached two on its own and the row was marked Replied —
 * the queue reading its own second message as the recruiter's first. The Google
 * thread that exposed it held exactly two messages, both `From: Henry Nguyen`.
 *
 * Two things then followed from one wrong cell, and both are undone here:
 *
 *   the row itself   Replied is terminal. It leaves the wave arithmetic thinking
 *                    that company answered, and outreachFollowUpEarns_ refuses a
 *                    row whose status is not Sent.
 *   its colleagues   outreachCompanyHasReply_ stops every booked follow-up at that
 *                    employer, and Stopped is permanent: `if (row.followUpStatus)
 *                    return { ok: false, why: 'already decided' }`.
 *
 * The thread can be found by id here, unlike on the referral path, because the
 * cold tab keeps the message id in a column of its own rather than sharing one
 * with the outcome sentence.
 *
 * Conservative in both directions. A row is only corrected when the thread holds
 * nothing but this account's own messages — a real reply, or a bounce, is left
 * exactly where it is. A Stopped follow-up is only given back when its row is Sent
 * and its company has no genuine reply left, so a nudge called off by a rejection
 * stays called off.
 *
 * Nothing is sent and nothing is drafted. Safe to run twice: the second pass finds
 * nothing to change and says so.
 */
function repairMisreadReplies() {
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var queue = tracker.getSheetByName(TAB_QUEUE);
  if (!queue) throw new Error('No ' + TAB_QUEUE + ' tab.');
  var last = queue.getLastRow();
  if (last < 2) return { corrected: 0, restored: 0 };

  var values = queue.getRange(2, 1, last - 1, Q_WIDTH).getValues();
  var rows = values.map(outreachParseQueue_);
  var messageIds = queue.getRange(2, Q_MESSAGE_ID, last - 1, 1).getValues();

  var tally = { corrected: 0, restored: 0 };
  var freed = {};

  rows.forEach(function (row, index) {
    if (row.status !== STATUS_REPLIED) return;
    var id = String(messageIds[index][0] || '').trim();
    if (!id) return;
    try {
      var thread = GmailApp.getMessageById(id).getThread();
      var verdict = outreachThreadVerdict_(thread.getMessages().map(function (one) {
        return { id: one.getId(), from: one.getFrom() };
      }), id);
      // Only the case this is here for. A real reply and a real bounce both leave
      // the row alone.
      if (verdict) return;
      var updates = {};
      updates[Q_STATUS] = STATUS_SENT;
      updates[Q_RESULT] = row.template
        ? 'Sent: ' + row.template
        : 'Recorded as a reply in error and corrected.';
      outreachWriteRow_(queue, row.rowNumber, updates);
      row.status = STATUS_SENT;
      freed[outreachNameKey_(row.company)] = true;
      tally.corrected++;
    } catch (error) {
      // A deleted message is not evidence of anything, and not worth failing on.
    }
  });

  if (!tally.corrected) {
    Logger.log('No queue row was holding its own follow-up as a reply.');
    return tally;
  }

  // Recomputed from the corrected rows, so an employer that also has a genuine
  // reply keeps its follow-ups called off.
  var stillAnswered = {};
  rows.forEach(function (row) {
    if (row.status === STATUS_REPLIED) stillAnswered[outreachNameKey_(row.company)] = true;
  });

  rows.forEach(function (row) {
    if (row.followUpStatus !== FOLLOWUP_STOPPED) return;
    if (row.status !== STATUS_SENT) return;
    var key = outreachNameKey_(row.company);
    if (!freed[key] || stillAnswered[key]) return;
    // Blank rather than Queued: blank is what outreachFollowUpEarns_ reads as "not
    // decided yet", and planFollowUpReplies books it in the ordinary way on the
    // next cycle rather than this function inventing a day for it.
    var updates = {};
    updates[Q_FOLLOWUP_STATUS] = '';
    updates[Q_FOLLOWUP_AT] = '';
    outreachWriteRow_(queue, row.rowNumber, updates);
    tally.restored++;
  });

  Logger.log('Corrected ' + tally.corrected + ' row(s) from Replied back to Sent, and '
           + 'gave back ' + tally.restored + ' stopped follow-up(s). '
           + 'planFollowUpReplies will book them on the next cycle.');
  return tally;
}


/**
 * Run by hand: draft the next few emails **to yourself**, to read before anyone
 * else does.
 *
 * It builds them exactly as the sender would — the real recruiter's name, the
 * real company angle and personal hook, the role and date from the application,
 * the resume attached — and then puts your own address in the To field instead
 * of theirs.
 *
 * It ignores the weekday cap and the sending window, because those are about not
 * flooding strangers and there are no strangers here. It writes nothing back to
 * the queue: no row changes state, no contact is spent, and running it ten times
 * costs nothing but ten drafts to delete.
 *
 * This is the answer to "what does one actually look like" on a Saturday, when
 * the cap is zero and the real cycle correctly produces nothing at all.
 */
function previewOutreachEmail() {
  var PREVIEW_COUNT = 3;

  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
  var salt = outreachProperty_(PROP_SALT, true);
  var me = Session.getActiveUser().getEmail();
  if (!me) throw new Error('Cannot tell whose account this is; run it from the editor.');

  var app = tracker.getSheetByName(TAB_APP);
  var queue = tracker.getSheetByName(TAB_QUEUE);
  var appLast = app.getLastRow();
  var byProperty = {};
  if (appLast >= 2) {
    app.getRange(2, 1, appLast - 1, APP_RECRUITERS).getValues()
       .map(outreachParseApp_).forEach(function (row) { byProperty[row.property] = row; });
  }

  var queueLast = queue.getLastRow();
  if (queueLast < 2) throw new Error('The Email tab is empty. Run runOutreachCycle first.');
  var rows = queue.getRange(2, 1, queueLast - 1, Q_WIDTH).getValues().map(outreachParseQueue_);

  var waiting = rows.filter(function (r) { return r.status === STATUS_QUEUED; });
  if (!waiting.length) throw new Error('Nothing is queued to preview.');

  var contacts = outreachReadContacts_(contactsBook);
  var resume = DriveApp.getFileById(outreachProperty_(PROP_RESUME_ID, true)).getBlob();
  var now = new Date();
  var made = [];

  waiting.slice(0, PREVIEW_COUNT).forEach(function (item) {
    var appRow = byProperty[item.property] || {};
    var companyContacts = outreachContactsFor_(contacts, item.company);
    var contact = outreachContactByFingerprint_(companyContacts, item.fingerprint, salt);
    if (!contact) return;

    var mail = outreachCompose_({
      variant: item.template
        || outreachVariantFor_(item.attempt, contact.focus, outreachBucketFor_(companyContacts)),
      role: appRow.role || item.role,
      recruiterName: contact.name,
      dateApplied: appRow.dateApplied || item.dateApplied,
      process: appRow.process,
      today: now,
      hook: contact.hook,
      angle: outreachAngleFor_(companyContacts)
    });

    GmailApp.createDraft(me, mail.subject, mail.plain, {
      htmlBody: mail.html,
      name: SENDER_NAME,
      attachments: [resume]
    });
    made.push(item.company + ' / ' + mail.variant + ' — would have gone to ' + contact.name);
  });

  Logger.log('Drafted ' + made.length + ' preview(s) to ' + me
           + '. Nothing in the Email tab changed.');
  made.forEach(function (line) { Logger.log('  ' + line); });
  return made;
}


/**
 * One firing, doing the whole round in the order the steps depend on each other.
 *
 *   1. what came back      a reply seen now stops an attempt being created below
 *   2. who said no         rejections in the mailbox, closing App rows and drafts
 *   3. what is new         applications ticked Applied since the last firing
 *   4. what goes out       the drafts written an hour ago, unless one was deleted
 *   5. what is written     this hour's share of the cap, into Drafts, to sit an hour
 *   6. what happens next   the projection, recomputed over everything that is left
 *
 * Reversing any pair of these produces a table that is one firing out of date:
 * projecting before sending would date rows that are about to leave, and
 * enqueueing before scanning would create an attempt for a contact whose bounce
 * has not been recorded yet.
 *
 * Step 2 is where it is for the same reason: a rejection read now deletes the
 * draft that was about to go to that company, and stops step 3 opening a fresh
 * attempt underneath it.
 */
/**
 * A run stamps the tab before it does anything, and again when it is done.
 *
 * Two stamps rather than one, and that is the whole design. A summary written only
 * at the end says nothing about the failure that actually happened here: the cycle
 * stopped part way through — before the referral steps and before the sort — so
 * the end never ran, no summary was written, and the tab quietly went on describing
 * an arrangement no step had touched for days. A row that says it started and never
 * says it finished is the only record that failure leaves behind.
 *
 * Every call is wrapped by its caller, because a cycle must never fail on account
 * of its own bookkeeping.
 */
function outreachHealthStart_(tracker, runId) {
  var sheet = tracker.getSheetByName(TAB_HEALTH) || tracker.insertSheet(TAB_HEALTH);
  if (sheet.getLastRow() < 1) {
    sheet.getRange(1, 1, 1, 6)
         .setValues([['Run ID', 'Started At', 'Finished At', 'Status',
                      'Failed Steps', 'Summary']])
         .setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  // Newest first, so the tab answers "what happened last" without scrolling.
  sheet.insertRowBefore(2);
  sheet.getRange(2, 1, 1, 6).setValues([[runId, new Date(), '', 'running', '', '']]);

  // A log nobody trims becomes a second thing to clean up. Ten days of hourly runs
  // is enough to see a pattern and short enough to stay readable.
  var last = sheet.getLastRow();
  if (last > 241) sheet.deleteRows(242, last - 241);
  return sheet;
}

/** The second stamp: what the run did, written onto the row it opened. */
function outreachHealthFinish_(sheet, runId, summary, failures) {
  if (!sheet) return;
  var depth = Math.min(sheet.getLastRow() - 1, 5);
  if (depth < 1) return;
  var ids = sheet.getRange(2, 1, depth, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) !== runId) continue;
    sheet.getRange(i + 2, 3, 1, 4).setValues([[
      new Date(),
      failures.length ? 'failed' : 'ok',
      failures.join(', '),
      JSON.stringify(summary).slice(0, 400)
    ]]);
    return;
  }
}

function runOutreachCycle() {
  var summary = {};
  var failures = [];

  // Before anything reads the queue, and deliberately outside the isolation
  // below: the schema has to be right or nothing may run. A tab still on the
  // pre-Priority layout read by this code has Status where Mode should be, so no
  // row matches any status, no row counts as having spent a contact, and enqueue
  // writes a second cold email to people already written to. A failure here must
  // stop the run, not be collected and worked around.
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));

  // Stamped before the schema migration below, which is fatal by design — a run
  // that dies there is precisely the kind that has to leave a record. Its own try,
  // because a cycle must never fail on account of its own bookkeeping.
  var runId = Utilities.getUuid();
  var health = null;
  try { health = outreachHealthStart_(tracker, runId); }
  catch (error) { Logger.log('Health stamp failed: ' + String(error.message || error)); }

  var opened = [];
  if (outreachEnsurePriorityColumn_(tracker)) opened.push('Priority');
  // Second, and after Priority rather than beside it, because the two migrations
  // are written against different layouts: the follow-up check expects Contact
  // Fingerprint at column 13, which is only true once Priority has already been
  // opened. A tab two migrations behind is walked forward one at a time.
  if (outreachEnsureFollowUpColumns_(tracker)) opened.push('the follow-up columns');
  summary.schema = opened.length ? 'inserted ' + opened.join(' and ') : 'ready';

  // Each step is allowed to fail on its own. Run as one unbroken expression, a
  // Gmail search that throws in step 1 takes step 4 with it, so nothing is sent
  // that hour and the Email tab shows a row still Drafted with an empty Error
  // column — the delay is real and there is nothing on the row to read it from.
  // The order below still matters and is unchanged; only the blast radius is.
  var step = function (name, work) {
    try {
      summary[name] = work();
    } catch (error) {
      summary[name] = 'failed: ' + String(error.message || error);
      failures.push(name);
    }
  };

  // Before enqueue, so rows appended this run land against the ones above them
  // rather than below whatever gap was already there. Isolated rather than fatal:
  // a table with a gap in it still sends correctly, it only reads badly.
  step('layout', function () {
    return outreachRepairQueueLayout_(tracker.getSheetByName(TAB_QUEUE));
  });
  step('scan', scanOutreachReplies);
  step('rejections', scanRejectionEmails);
  // After the scanner, which closes applications of its own, and before enqueue,
  // so a contact freed here is available to the wave planned below in this same
  // firing rather than the next one.
  step('stale', cancelStaleOutreachRows);
  // The referral path goes first, and first is the whole point.
  //
  // EMAIL_PATH_ORDER puts it ahead of the cold email because it is the scarcest
  // thing here: three people per employer, no second attempt ever, so a referral
  // ask that loses its place today is not delayed, it is one of three chances at
  // that company spent on nothing. The budget in outreach_budget.gs reserves its
  // share, and running it first is the other half of the same promise: a
  // reservation nothing claims is a reservation that expires.
  //
  // Sending before writing, exactly as the cold path below does, so that no
  // message can be written and sent inside one firing and the hour in which it
  // could have been read always exists.
  // Before the planner, and the order is the point. This takes the cancellations,
  // discards the drafts they orphaned and hands their hours back to the rows
  // behind them; the planner then tops the queue up against days that already
  // reflect all of that. Run the other way round, a cancelled row's hour would be
  // filled by a new person and the row behind it would still be waiting a week.
  // Before the replan, and the order is the whole value of it. The replan is what
  // closes the rest of a group somebody has answered, and it can only close what
  // this step has already marked; run the other way round, a reply landing on
  // Monday would not call anything off until Tuesday, by which point Monday's
  // colleague has been written to.
  step('referralScan', function () { return scanReferralReplies().replied; });
  step('referralReplanned', function () { return replanReferralAsks().moved; });
  step('referralPlanned', function () { return planReferralAsks().booked; });
  step('referralSent', sendReferralAsks);
  step('referralDrafted', draftReferralAsks);
  step('queued', function () { return enqueueOutreach().planned.length; });
  // Send before writing, never the other way round. Drafting first would let a
  // message be written and sent inside one firing, and the hour in which it could
  // have been read would never have existed.
  //
  // Sending survives a failed scan on purpose: sendPreparedDrafts re-reads App
  // for every draft it is about to send, so a rejection recorded by any route
  // still stops it. A failed scan costs an hour of freshness, not the check.
  step('sent', sendPreparedDrafts);
  step('written', prepareOutreachDrafts);
  // Last of the three paths, and last is where it belongs. EMAIL_PATH_ORDER puts
  // it behind both because it is the only one that loses nothing by slipping a
  // day: the message it chases has already landed, and the window it may land in
  // is five to ten days wide.
  //
  // After the cold path, because a follow-up is the cheaper message of the two and
  // the cold email is the one with a deadline attached: an application ages while
  // it waits and a nudge does not, so on the firing where something has to give,
  // the nudge is what gives. It also means a row sent minutes ago is on the tab as
  // Sent before the planner reads it, and gets its day in the same run.
  //
  // Planning before sending, because the plan is what the send reads. A row
  // booked for today by the step above may go out on this very firing rather than
  // waiting an hour for the next one to notice it.
  step('followUpPlanned', planFollowUpReplies);
  step('followUpSent', sendFollowUpReplies);
  step('projected', refreshOutreachSchedule);
  // A report, so it goes after everything that could change what it reports on.
  // Rebuilt every firing rather than stamped once, for the reason the Recruiters
  // column is: a list of two-intake employers from three weeks ago is worse than
  // none, because it looks current.
  step('season', refreshSeasonTab);
  // Last, because it sorts on the times the step above has just written. Sorting
  // first would file the table by the previous hour's answer.
  step('sorted', function () {
    return outreachSortQueueByTime_(tracker.getSheetByName(TAB_QUEUE));
  });
  // The Referral tab gets the same treatment and for the same reason, after every
  // step that could have changed an hour on it. The tab used to sit in the order
  // the planner appended, which grouped an employer's people together; once the
  // planner became breadth-first those groups stopped being contiguous anyway, and
  // what the tab is opened to answer is what has gone and what is next.
  step('referralSorted', function () {
    return outreachSortReferralByTime_(tracker.getSheetByName(TAB_REFERRAL));
  });
  // Dead last, and last is a correctness requirement rather than a tidy finish.
  // This is the only step that moves rows on App, and half the steps above hold
  // App row numbers taken before it ran: scanRejectionEmails writes Process and
  // Update back by row number, cancelStaleOutreachRows and both referral planners
  // read the tab by row number. Sorting App while any of them still held an index
  // would file a rejection against a different application. Nothing reads App
  // after this, so nothing can.
  step('appWorklist', function () { return syncAppOfficialWorklist().needing; });

  summary.failedSteps = failures;
  try { outreachHealthFinish_(health, runId, summary, failures); }
  catch (error) { Logger.log('Health finish failed: ' + String(error.message || error)); }
  Logger.log(JSON.stringify(summary));
  // Thrown after everything else has had its turn, so the run still shows up red
  // in Executions rather than being quietly swallowed for the rest of the year.
  if (failures.length) throw new Error('Outreach steps failed: ' + failures.join(', '));
  return summary;
}

/**
 * Send only what is already due, every minute.
 *
 * Planning, scanning and drafting deliberately remain hourly: their quota and
 * fair-share arithmetic assume one pass per hour. Sending is different — it only
 * advances rows whose hour has arrived — so running it each minute turns the old
 * trigger's :21 delay into at most the next minute tick without changing volume.
 */
function runOutreachSendTick() {
  var summary = {}, failures = [];
  var step = function (name, work) {
    try { summary[name] = work(); }
    catch (error) {
      summary[name] = 'failed: ' + String(error.message || error);
      failures.push(name);
    }
  };
  step('referral', sendReferralAsks);
  step('cold', sendPreparedDrafts);
  step('followUp', sendFollowUpReplies);
  Logger.log('send tick ' + JSON.stringify(summary));
  if (failures.length) throw new Error('Outreach send tick failed: ' + failures.join(', '));
  return summary;
}

/**
 * Install the hourly trigger.
 *
 * Existing outreach triggers are cleared first, so running this twice does not
 * leave the queue being worked twice an hour.
 */
/**
 * Reproject the queue the moment somebody ticks Priority.
 *
 * The tick changes one thing — the order — and the order is what every projected
 * time in the table is computed from. Waiting for the hourly cycle meant ticking a
 * box and watching nothing happen, with no way to tell a tick that had registered
 * from one that had not.
 *
 * Three things make this safe to hang off an edit:
 *
 *   the filter    outreachEditTouchesPriority_ throws out every edit in the
 *                 spreadsheet that is not a Priority cell on a data row, which is
 *                 nearly all of them, before anything is opened or read.
 *   the lock      taken briefly and given up rather than waited on. If the hourly
 *                 cycle holds it, it is already going to project on its way out,
 *                 so there is nothing to do and nothing to report.
 *   no recursion  Apps Script does not fire an edit trigger for a change a script
 *                 made, so writing the two columns back cannot call this again.
 *
 * Installable, not simple: this project is standalone rather than bound to the
 * tracker, and a simple onEdit only exists in a bound script. Installable also
 * means it runs as whoever installed it, which is the account that owns the Gmail
 * side — the edit itself can come from either person with access.
 */
function onOutreachQueueEdit(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  var name = sheet.getName();

  // One installed trigger, two edits worth answering. Both filters run before
  // anything is opened or read, and between them they throw out every other edit
  // in the spreadsheet, which is nearly all of them.
  var priority = outreachEditTouchesPriority_(name, e.range);
  var role = outreachEditTouchesRole_(name, e.range);
  var referral = outreachEditTouchesReferral_(name, e.range);
  if (!priority && !role && !referral) return;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    if (priority) {
      outreachWriteProjection_(sheet);
      // The tick changed the order, the projection changed the times, and the
      // table is filed by those times — so it has to be refiled in the same breath
      // or it is left describing an order that no longer exists.
      outreachSortQueueByTime_(sheet);
      return;
    }

    // A Cancel or a Priority tick on the Referral tab, which used to be answered
    // by nothing at all until the hourly cycle came round. The same three things
    // the Email tab gets above, in the same breath and for the same reason: the
    // tick frees or reorders hours, the re-plan spends them, and the table is filed
    // by those hours. See settleReferralTab_.
    if (referral) {
      settleReferralTab_(SpreadsheetApp.openById(
        outreachProperty_(PROP_TRACKER_ID, true)));
      return;
    }

    // A Role edit can cover several rows at once — a paste down the column, or an
    // undo. Each is a different application, so each is carried out separately.
    var tracker = sheet.getParent();
    var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
    var salt = outreachProperty_(PROP_SALT, true);
    var first = Math.max(e.range.getRow(), 2);
    var rows = sheet.getRange(first, 1, e.range.getLastRow() - first + 1, APP_ROLE).getValues();
    rows.forEach(function (row) {
      var property = String(row[APP_PROPERTY - 1] == null ? '' : row[APP_PROPERTY - 1]).trim();
      if (!property) return;
      syncRoleEdit_(tracker, contactsBook, property, String(row[APP_ROLE - 1] || ''), salt);
    });

    // The report reads Role straight out of App, so it has to be said again for
    // the corrected word to reach it; the projection because a queue row whose
    // Role moved may now be ordered against different company.
    refreshSeasonTab();
    refreshOutreachSchedule();
  } finally {
    lock.releaseLock();
  }
}

function installOutreachTriggers() {
  removeOutreachTriggers();
  // One hourly trigger rather than four on separate clocks. Four would drift
  // apart and leave the table describing four different moments.
  ScriptApp.newTrigger('runOutreachCycle').timeBased().everyHours(1).create();
  // The full cycle may be pinned to any minute in its hour by Apps Script. A
  // separate one-minute tick sends only already-prepared drafts, so a message
  // scheduled for 14:00 is noticed at the first firing after 14:00 instead of
  // waiting for the full cycle's old :21 minute.
  ScriptApp.newTrigger('runOutreachSendTick').timeBased().everyMinutes(1).create();
  // And one that answers a tick straight away, on either tab. It sends nothing and
  // drafts nothing: on Email it rewrites the two projected columns, and on Referral
  // it settles a Cancel or a Priority tick and refiles the table. No mailbox is
  // opened on either path, which is what makes it safe to hang off a keystroke.
  //
  // Extending this handler needs no re-install — the trigger binds to the name.
  ScriptApp.newTrigger('onOutreachQueueEdit')
           .forSpreadsheet(outreachProperty_(PROP_TRACKER_ID, true))
           .onEdit()
           .create();
  Logger.log('Installed hourly planning plus one-minute sending. The kill switch is '
           + 'removeOutreachTriggers, and it is the only one.');
}

function removeOutreachTriggers() {
  var mine = ['runOutreachCycle', 'runOutreachSendTick', 'prepareOutreachDrafts', 'sendPreparedDrafts',
              'enqueueOutreach', 'refreshOutreachSchedule', 'scanOutreachReplies',
              'scanRejectionEmails', 'onOutreachQueueEdit',
              'planFollowUpReplies', 'sendFollowUpReplies', 'replanOutreachFollowUps',
              // The referral path's three. A kill switch that misses a handler is
              // worse than no kill switch, because the log will say every trigger
              // was removed and one of them will still be sending.
              'planReferralAsks', 'draftReferralAsks', 'sendReferralAsks',
              'replanReferralAsks'];
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (mine.indexOf(trigger.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(trigger);
  });
}
