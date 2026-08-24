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

/** Find the contact behind a fingerprint without the queue ever holding one. */
function outreachContactByFingerprint_(companyContacts, fingerprint, salt) {
  for (var i = 0; i < companyContacts.length; i++) {
    if (outreachFingerprint_(companyContacts[i].email, salt) === fingerprint) {
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
  // the other mailbox. Without it, a draft written at 09:00 goes out at 10:00
  // whatever happened at 09:30.
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
      if (thread.getMessageCount() > 1) {
        var replied = {};
        replied[Q_STATUS] = STATUS_REPLIED;
        replied[Q_RESULT] = 'Reply on ' + thread.getLastMessageDate();
        outreachWriteRow_(queue, row.rowNumber, replied);
        tally.replied++;
      }
    } catch (error) {
      // A deleted message is not a reply, and not worth failing a whole run for.
    }
  });

  // Bounces name the address in the body. Fingerprinting what we find keeps the
  // matching one-way: the queue is never told who bounced, only that this row did.
  var bounced = {};
  GmailApp.search('from:mailer-daemon newer_than:14d', 0, 50).forEach(function (thread) {
    thread.getMessages().forEach(function (message) {
      var body = message.getPlainBody() || '';
      (body.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []).forEach(function (address) {
        bounced[outreachFingerprint_(address, salt)] = true;
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
function runOutreachCycle() {
  var summary = {};
  var failures = [];

  // Before anything reads the queue, and deliberately outside the isolation
  // below: the schema has to be right or nothing may run. A tab still on the
  // pre-Priority layout read by this code has Status where Mode should be, so no
  // row matches any status, no row counts as having spent a contact, and enqueue
  // writes a second cold email to people already written to. A failure here must
  // stop the run, not be collected and worked around.
  summary.schema = outreachEnsurePriorityColumn_(
    SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true))
  ) ? 'inserted Priority' : 'ready';

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

  step('scan', scanOutreachReplies);
  step('rejections', scanRejectionEmails);
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
  step('projected', refreshOutreachSchedule);

  summary.failedSteps = failures;
  Logger.log(JSON.stringify(summary));
  // Thrown after everything else has had its turn, so the run still shows up red
  // in Executions rather than being quietly swallowed for the rest of the year.
  if (failures.length) throw new Error('Outreach steps failed: ' + failures.join(', '));
  return summary;
}

/**
 * Install the hourly trigger.
 *
 * Existing outreach triggers are cleared first, so running this twice does not
 * leave the queue being worked twice an hour.
 */
function installOutreachTriggers() {
  removeOutreachTriggers();
  // One hourly trigger rather than four on separate clocks. Four would drift
  // apart and leave the table describing four different moments.
  ScriptApp.newTrigger('runOutreachCycle').timeBased().everyHours(1).create();
  Logger.log('Installed. The kill switch is removeOutreachTriggers, and it is the only one.');
}

function removeOutreachTriggers() {
  var mine = ['runOutreachCycle', 'prepareOutreachDrafts', 'sendPreparedDrafts',
              'enqueueOutreach', 'refreshOutreachSchedule', 'scanOutreachReplies',
              'scanRejectionEmails'];
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (mine.indexOf(trigger.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(trigger);
  });
}
