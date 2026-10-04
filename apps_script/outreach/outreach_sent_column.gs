/**
 * The Sent tick on the contacts tabs: who has been written to, for good.
 *
 * Before this, "has this person been written to?" was answered by the two queue
 * tabs -- a salted fingerprint on Email, a plain address on Referral. That works
 * while the queues are the only history there is, and it stops working the
 * moment they are cleared: emptying the Email tab makes every fingerprint look
 * unspent and re-opens everybody the account has ever written to.
 *
 * So the answer now also lives beside the person, on the tab that holds them.
 * The two mechanisms are kept together on purpose and a row is skipped when
 * either says so: the fingerprint still stops a second send inside one season
 * and still keeps addresses off the tracker, and this survives a rebuild.
 *
 * **The outreach script owns this column.** The planners read it
 * (outreachContactAvailable_, outreachReadEmployees_) and the two senders set
 * it, here, after Gmail has accepted the message and not before. Nothing else
 * may write it -- see the tab-ownership table in docs/components/README.md.
 *
 * Ticked after the send rather than at drafting, because a draft can still be
 * deleted in its review window and a person whose draft was thrown away has not
 * been written to. The cost of that choice is the one failure this cannot cover:
 * if the script dies between GmailApp.send() and this write, the message has
 * gone and the tick has not. The Email row is already marked Sent by then, so
 * the fingerprint still blocks a repeat, which is the other half of why both
 * mechanisms are kept.
 */

/**
 * Tick Sent for cold contacts, found by the fingerprints their queue rows carry.
 *
 * The queue never holds an address, so the only way back to the person is to
 * hash every contact and look for a match -- the same thing
 * outreachContactByFingerprint_ does for one row, done once for a whole batch.
 * Both seasons are hashed because a row planned off-cycle carries the other
 * fingerprint and is still the same person.
 *
 * Returns how many rows it ticked. Writes nothing when the batch is empty.
 */
function outreachMarkColdContactsSent_(fingerprints) {
  if (!fingerprints || !fingerprints.length) return 0;
  var wanted = {};
  fingerprints.forEach(function (one) { if (one) wanted[one] = true; });
  if (!Object.keys(wanted).length) return 0;

  var book = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
  var salt = outreachProperty_(PROP_SALT, true);
  var marked = 0;

  [TAB_CONTACTS_SEED, TAB_CONTACTS_MANUAL].forEach(function (name) {
    var sheet = book.getSheetByName(name);
    if (!sheet) return;
    var last = sheet.getLastRow();
    if (last < 2) return;

    var emails = sheet.getRange(2, C_EMAIL, last - 1, 1).getValues();
    var ticks = sheet.getRange(2, C_SENT, last - 1, 1).getValues();
    var changed = false;

    for (var i = 0; i < emails.length; i++) {
      var email = String(emails[i][0] || '').trim().toLowerCase();
      if (!email || outreachSentTicked_(ticks[i][0])) continue;
      if (!wanted[outreachFingerprint_(email, salt, SEASON_SUMMER)]
          && !wanted[outreachFingerprint_(email, salt, SEASON_OFFCYCLE)]) continue;
      ticks[i][0] = SENT_TICK;
      changed = true;
      marked++;
    }
    // One write for the tab, not one per person: a batch of twenty sends would
    // otherwise be twenty round trips into the same column.
    if (changed) sheet.getRange(2, C_SENT, last - 1, 1).setValues(ticks);
  });
  return marked;
}

/**
 * Tick Sent for referral contacts, found by address.
 *
 * The Referral tab does hold the address, so no hashing is needed here. That
 * asymmetry is the two tabs' rules, not an oversight: the Email tab deliberately
 * holds no address, and the Referral tab deliberately does.
 */
function outreachMarkEmployeesSent_(emails) {
  if (!emails || !emails.length) return 0;
  var wanted = {};
  emails.forEach(function (one) {
    var email = String(one || '').trim().toLowerCase();
    if (email) wanted[email] = true;
  });
  if (!Object.keys(wanted).length) return 0;

  var book = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
  var sheet = book.getSheetByName(TAB_EMPLOYEES_SEED);
  if (!sheet) return 0;
  var last = sheet.getLastRow();
  if (last < 2) return 0;

  var addresses = sheet.getRange(2, E_EMAIL, last - 1, 1).getValues();
  var ticks = sheet.getRange(2, E_SENT, last - 1, 1).getValues();
  var marked = 0, changed = false;

  for (var i = 0; i < addresses.length; i++) {
    var email = String(addresses[i][0] || '').trim().toLowerCase();
    if (!email || !wanted[email] || outreachSentTicked_(ticks[i][0])) continue;
    ticks[i][0] = SENT_TICK;
    changed = true;
    marked++;
  }
  if (changed) sheet.getRange(2, E_SENT, last - 1, 1).setValues(ticks);
  return marked;
}

/**
 * Clear the Sent tick on named cold contacts that no message ever reached.
 *
 * The tick is supposed to mean "Gmail accepted a message for this person", set by
 * outreachMarkColdContactsSent_ after the send and never before. A batch of contacts carries it
 * anyway without a message behind it: they sat on the Email tab as `Queued` when that tab was
 * cleared, and the rebuild read a spent row as a written-to person. Anduril is the clearest case —
 * fourteen contacts, all ticked, eight addresses in the mailbox.
 *
 * A wrong tick is silent and permanent. outreachContactAvailable_ drops the row, every planner and
 * campaign drops it after that, and nothing ever raises it again, so the person is simply gone
 * from the outreach universe with no error anywhere to say so.
 *
 * Three rules keep this from becoming the thing it repairs:
 *
 *  - It takes an explicit address list. There is no sweep-the-book mode, because the failure this
 *    fixes and a genuine send look identical from inside the sheet; only the mailbox can tell them
 *    apart, and only one address at a time.
 *  - The mailbox decides, not the caller. `from:me to:<address>` runs per address and any hit at
 *    all leaves the tick alone. Passing a name in is a request to check it, never an assertion
 *    about it.
 *  - A live queue row vetoes it too. If the Email tab still holds a spending row for that
 *    fingerprint the contact is committed right now, whatever the mailbox says, and un-ticking
 *    would let a second row be planned alongside the first.
 *
 * Returns a per-address verdict rather than a count, so a caller can see which names it did not
 * touch and why.
 */
function repairColdContactSentTicksNeverMailed(emails) {
  var wanted = {};
  (emails || []).forEach(function (one) {
    var email = String(one || '').trim().toLowerCase();
    if (email) wanted[email] = true;
  });
  if (!Object.keys(wanted).length) throw new Error('An explicit address list is required.');

  var book = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var salt = outreachProperty_(PROP_SALT, true);
  var spent = targetRecruiterSpentFingerprints_(tracker);
  var verdicts = {}, seen = {};

  [TAB_CONTACTS_SEED, TAB_CONTACTS_MANUAL].forEach(function (name) {
    var sheet = book.getSheetByName(name);
    if (!sheet) return;
    var last = sheet.getLastRow();
    if (last < 2) return;

    var addresses = sheet.getRange(2, C_EMAIL, last - 1, 1).getValues();
    var ticks = sheet.getRange(2, C_SENT, last - 1, 1).getValues();
    var changed = false;

    for (var i = 0; i < addresses.length; i++) {
      var email = String(addresses[i][0] || '').trim().toLowerCase();
      if (!email || !wanted[email]) continue;
      seen[email] = true;
      if (!outreachSentTicked_(ticks[i][0])) { verdicts[email] = 'already-clear'; continue; }
      if (spent[outreachFingerprint_(email, salt, SEASON_SUMMER)]
          || spent[outreachFingerprint_(email, salt, SEASON_OFFCYCLE)]) {
        verdicts[email] = 'kept: a live Email row still spends this contact';
        continue;
      }
      if (GmailApp.search('from:me to:' + email, 0, 1).length) {
        verdicts[email] = 'kept: the mailbox has a message to this address';
        continue;
      }
      ticks[i][0] = '';
      changed = true;
      verdicts[email] = 'cleared: ticked Sent with no message behind it';
    }
    if (changed) sheet.getRange(2, C_SENT, last - 1, 1).setValues(ticks);
  });

  Object.keys(wanted).forEach(function (email) {
    if (!seen[email]) verdicts[email] = 'not-found: no contact row carries this address';
  });
  return verdicts;
}

/**
 * Sweep the cold contact tabs and clear every Sent tick the mailbox cannot account for.
 *
 * repairColdContactSentTicksNeverMailed takes names because a caller naming four people has
 * checked four people. This is the other case: the owner asked for the whole book, so the list
 * comes from the sheet instead. What decides a row does not change — the tick survives only if
 * `from:me to:<address>` finds something, or a live Email row still spends the contact.
 *
 * Paged, and for a hard reason rather than tidiness. The check is one Gmail search per ticked
 * address and Apps Script stops a function at six minutes, so a whole-book pass would die
 * somewhere in the middle having already written some tabs — and the caller could not tell how
 * far it got. A page writes its tabs before it returns, `nextOffset` says where to resume, and
 * `more` says whether to. Re-running a page is safe: a cleared tick reads as `already-clear`.
 *
 * Offsets walk the ticked rows, not the sheet rows, and clearing a tick removes that row from the
 * set the next page walks. So the caller re-reads from the same offset until `more` is false
 * rather than advancing — advancing would step over the rows that shifted down into the gap.
 */
function repairColdContactSentTicksSweep(offset, limit) {
  var from = Number(offset) || 0;
  var size = Math.max(1, Number(limit) || 120);

  var book = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var salt = outreachProperty_(PROP_SALT, true);
  var spent = targetRecruiterSpentFingerprints_(tracker);

  // Every ticked row across both tabs, in one list, so a page means the same thing whichever tab
  // it lands in and the caller never has to know the tabs exist.
  var ticked = [];
  var sheets = {};
  [TAB_CONTACTS_SEED, TAB_CONTACTS_MANUAL].forEach(function (name) {
    var sheet = book.getSheetByName(name);
    if (!sheet) return;
    var last = sheet.getLastRow();
    if (last < 2) return;
    var addresses = sheet.getRange(2, C_EMAIL, last - 1, 1).getValues();
    var ticks = sheet.getRange(2, C_SENT, last - 1, 1).getValues();
    sheets[name] = {sheet: sheet, ticks: ticks, changed: false, last: last};
    for (var i = 0; i < addresses.length; i++) {
      var email = String(addresses[i][0] || '').trim().toLowerCase();
      if (email && outreachSentTicked_(ticks[i][0])) ticked.push({tab: name, index: i, email: email});
    }
  });

  var page = ticked.slice(from, from + size);
  var cleared = [], keptMailed = 0, keptSpent = 0;

  page.forEach(function (row) {
    if (spent[outreachFingerprint_(row.email, salt, SEASON_SUMMER)]
        || spent[outreachFingerprint_(row.email, salt, SEASON_OFFCYCLE)]) {
      keptSpent++;
      return;
    }
    if (GmailApp.search('from:me to:' + row.email, 0, 1).length) {
      keptMailed++;
      return;
    }
    var target = sheets[row.tab];
    target.ticks[row.index][0] = '';
    target.changed = true;
    cleared.push(row.email);
  });

  // Write before returning, so a page that finished is a page that persisted.
  Object.keys(sheets).forEach(function (name) {
    var target = sheets[name];
    if (target.changed) target.sheet.getRange(2, C_SENT, target.last - 1, 1).setValues(target.ticks);
  });

  return {
    tickedTotal: ticked.length,
    offset: from,
    examined: page.length,
    cleared: cleared.length,
    keptMailed: keptMailed,
    keptSpent: keptSpent,
    clearedAddresses: cleared.join('\n'),
    nextOffset: from + keptMailed + keptSpent,
    more: from + page.length < ticked.length
  };
}

/**
 * Delete named contact rows outright, for addresses that can never receive anything.
 *
 * Deleting rather than ticking, and the reason is specific to this repo. A tick means "Gmail
 * accepted a message" and repairColdContactSentTicksSweep enforces exactly that: ticked with an
 * empty mailbox gets cleared. An address that cannot receive mail has a permanently empty mailbox,
 * so a tick used to silence one would be cleared by the next sweep and the address would come
 * back. The two mechanisms would fight forever. A row that is gone is gone.
 *
 * Deletion is not durable by itself — a seed rebuild can re-add the same address from the research
 * exports — so the addresses also belong in ColdEmail's `treg/suppress_emails.txt`, which is what
 * keeps them from being bought and loaded again. One without the other only buys time.
 *
 * Guards, because this is the only call here that destroys a row:
 *
 *  - Explicit addresses only, and each row's own cell must still match the address given. A row
 *    that moved under the caller's feet is skipped, never deleted on position.
 *  - Bottom-up within each tab, so deleting one row cannot shift the next one out from under the
 *    index that was resolved for it.
 *  - A live Email row vetoes the delete. Whatever is wrong with the address, something is
 *    currently planned against that contact and the plan should be cancelled first.
 *
 * Deliberately not guarded on the mailbox: `d@hp.com` has a message behind it — that is the damage
 * being cleaned up, not a reason to keep the row.
 */
function removeContactRowsByAddress(emails) {
  var wanted = {};
  (emails || []).forEach(function (one) {
    var email = String(one || '').trim().toLowerCase();
    if (email) wanted[email] = true;
  });
  if (!Object.keys(wanted).length) throw new Error('An explicit address list is required.');

  var book = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var salt = outreachProperty_(PROP_SALT, true);
  var spent = targetRecruiterSpentFingerprints_(tracker);
  var deleted = [], kept = [], seen = {};

  [TAB_CONTACTS_SEED, TAB_CONTACTS_MANUAL].forEach(function (name) {
    var sheet = book.getSheetByName(name);
    if (!sheet) return;
    var last = sheet.getLastRow();
    if (last < 2) return;
    var addresses = sheet.getRange(2, C_EMAIL, last - 1, 1).getValues();

    var targets = [];
    for (var i = 0; i < addresses.length; i++) {
      var email = String(addresses[i][0] || '').trim().toLowerCase();
      if (!email || !wanted[email]) continue;
      seen[email] = true;
      if (spent[outreachFingerprint_(email, salt, SEASON_SUMMER)]
          || spent[outreachFingerprint_(email, salt, SEASON_OFFCYCLE)]) {
        kept.push(email + '\t' + name + ':' + (i + 2) + '\ta live Email row still plans this contact');
        continue;
      }
      targets.push({rowNumber: i + 2, email: email});
    }

    // Bottom-up: every earlier row keeps the number it was resolved at.
    targets.sort(function (left, right) { return right.rowNumber - left.rowNumber; });
    targets.forEach(function (target) {
      var current = String(sheet.getRange(target.rowNumber, C_EMAIL).getValue() || '')
        .trim().toLowerCase();
      if (current !== target.email) {
        kept.push(target.email + '\t' + name + ':' + target.rowNumber
          + '\trow no longer holds this address (found "' + current + '")');
        return;
      }
      sheet.deleteRow(target.rowNumber);
      deleted.push(target.email + '\t' + name + ':' + target.rowNumber);
    });
  });

  Object.keys(wanted).forEach(function (email) {
    if (!seen[email]) kept.push(email + '\t(no row)\tno contact row carries this address');
  });
  return {deleted: deleted.length, keptCount: kept.length,
          deletedRows: deleted.join('\n'), kept: kept.join('\n')};
}
