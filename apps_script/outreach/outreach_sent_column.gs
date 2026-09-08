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
