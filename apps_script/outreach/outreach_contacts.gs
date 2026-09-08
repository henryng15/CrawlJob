/**
 * Outreach — the contact list, and who counts as the same employer.
 *
 * Contacts live in a spreadsheet owned by the sending account, never in the
 * tracker. Two tabs, and the split is the whole point:
 *
 *   Contacts (seed)    overwritten wholesale by the ColdEmail export
 *   Contacts (manual)  only ever typed by hand, and never touched by automation
 *
 * One tab would mean a single re-export silently destroying months of contacts
 * gathered by hand. Two tabs make that impossible rather than merely unlikely.
 */

// Legal form and filler, dropped before comparing. Mirrors COMPANY_NOISE in
// job_sync/sources.py — the two lists have to agree or the tracker and the
// queue will disagree about what one employer is.
var COMPANY_NOISE = [
  'inc', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company',
  'companies', 'group', 'holdings', 'plc', 'gmbh', 'ag', 'nv', 'bv', 'sa',
  'technologies', 'technology', 'the', 'an', 'and'
];

function outreachNameKey_(value) {
  return String(value == null ? '' : value)
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** An employer as the words that actually name it, legal form dropped. */
function outreachCompanyTokens_(company) {
  var seen = {};
  outreachNameKey_(company).split(' ').forEach(function (word) {
    if (word && COMPANY_NOISE.indexOf(word) === -1) seen[word] = true;
  });
  return Object.keys(seen).sort();
}

/**
 * Either name contained in the other is enough: a contact list writes "Google
 * Cloud" where the application says "Google". Containment is over whole words,
 * so "Dice" does not match "Dicerna".
 */
function outreachSameEmployer_(left, right) {
  if (!left.length || !right.length) return false;
  var contains = function (big, small) {
    return small.every(function (word) { return big.indexOf(word) !== -1; });
  };
  return contains(right, left) || contains(left, right);
}

// The words a campus recruiter's title actually uses, as whole words rather than
// substrings: `intern` must not match `internal`, which is a different job and a
// different email. Early career and early talent are two spellings of one team.
var CAMPUS_TITLE =
  /\b(campus|university|college|school|students?|interns?|internships?|graduates?|grads?)\b|\bearly[\s-]?(career|talent)\b/;

/**
 * The focus a recruiter's own title implies, used only when Focus is empty.
 *
 * Only 'university' is worth deriving, because it is the one value
 * outreachVariantOrder_ reads: it moves the campus subject — the one that asks
 * whether Kenyon sits on the campus list this cycle — ahead of the industry hook.
 * Anything else a title might say is already carried by the company's bucket, so
 * inventing more values here would be guessing rather than reading.
 *
 * This exists for the hand-typed tab. A seed row arrives from ColdEmail with Focus
 * already filled; a row typed by hand carries a title and little else, and asking
 * for a second column whose only useful value is one word is how a tab stops being
 * used. An explicit Focus still wins — the caller only falls back to this.
 */
function outreachFocusFromRole_(role) {
  var text = String(role == null ? '' : role).toLowerCase().trim();
  if (!text) return '';
  return CAMPUS_TITLE.test(text) ? 'university' : '';
}

function outreachCell_(row, index) {
  var value = row[index - 1];
  return String(value == null ? '' : value).trim();
}

/**
 * Every contact worth writing to, from both tabs, newest-typed last.
 *
 * A manual row carries only Company, Recruiter Name and Email — that is all the
 * typing this system asks for. Hook and angle stay empty and are borrowed from the
 * company's seed contacts at compose time. Focus is borrowed from nobody: it
 * describes the person, not the employer, so an empty one is read off their own
 * title instead.
 */
function outreachReadContacts_(contactsSpreadsheet) {
  var out = [];
  var byEmail = {};

  [[TAB_CONTACTS_SEED, 'seed'], [TAB_CONTACTS_MANUAL, 'manual']].forEach(function (pair) {
    var sheet = contactsSpreadsheet.getSheetByName(pair[0]);
    if (!sheet) return;
    var last = sheet.getLastRow();
    if (last < 2) return;
    // C_WIDTH, not C_BUCKET: the Sent tick sits one past the last column this
    // used to read, and a row read too narrow reports every contact as unwritten.
    var rows = sheet.getRange(2, 1, last - 1, C_WIDTH).getValues();

    rows.forEach(function (row, index) {
      var email = outreachCell_(row, C_EMAIL).toLowerCase();
      var company = outreachCell_(row, C_COMPANY);
      if (!email || email.indexOf('@') === -1 || !company) return;

      // The seed tab is read first, so a hand-typed duplicate of a seed contact
      // loses — the seed row is the one carrying an angle and a hook.
      if (byEmail[email]) return;

      var verify = outreachCell_(row, C_VERIFY);
      if (verify === UNSENDABLE_VERIFY) return;

      var contact = {
        company: company,
        tokens: outreachCompanyTokens_(company),
        name: outreachCell_(row, C_NAME),
        email: email,
        role: outreachCell_(row, C_ROLE),
        // A hand-typed row carries a title and no Focus. Deriving it here rather
        // than at compose time means the Email tab's Template column names the
        // campus subject when the row is queued, which is before the message is
        // written and while there is still time to disagree with it.
        focus: outreachCell_(row, C_FOCUS)
          || outreachFocusFromRole_(outreachCell_(row, C_ROLE)),
        hook: outreachCell_(row, C_HOOK),
        angle: outreachCell_(row, C_ANGLE),
        bucket: outreachCell_(row, C_BUCKET),
        // Already written to, on any earlier run or before the rebuild. The
        // planner drops these; nothing downstream has to remember why.
        sent: outreachSentTicked_(row[C_SENT - 1]),
        rowNumber: 0,
        tab: pair[0],
        source: pair[1]
      };
      contact.rowNumber = index + 2;
      byEmail[email] = contact;
      out.push(contact);
    });
  });

  return out;
}

/**
 * The industry this employer sits in, borrowed the same way the angle is.
 *
 * A hand-typed contact carries no bucket, so it inherits the one its company's
 * seed contacts already have — which is what lets a hand-typed recruiter at a
 * fintech still get the payments subject line rather than a generic one.
 */
function outreachBucketFor_(companyContacts) {
  for (var i = 0; i < companyContacts.length; i++) {
    if (companyContacts[i].bucket) return companyContacts[i].bucket;
  }
  return '';
}

/** Every contact at one employer, seed before manual. */
function outreachContactsFor_(contacts, company) {
  var tokens = outreachCompanyTokens_(company);
  if (!tokens.length) return [];
  return contacts.filter(function (contact) {
    return outreachSameEmployer_(tokens, contact.tokens);
  });
}

/**
 * The company's opening line, borrowed from whichever contact has one.
 *
 * A hand-typed contact at a company ColdEmail has already written for inherits
 * that company's angle for free. A hand-typed contact at a company it has never
 * seen has none, and the caller sends that as a draft rather than as mail.
 */
function outreachAngleFor_(companyContacts) {
  for (var i = 0; i < companyContacts.length; i++) {
    if (companyContacts[i].angle) return companyContacts[i].angle;
  }
  return '';
}

/** How many people we could actually write to at this employer. */
function outreachRecruiterCount_(contacts, company) {
  return outreachContactsFor_(contacts, company).length;
}
