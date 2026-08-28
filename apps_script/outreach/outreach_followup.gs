/**
 * Outreach — the one reply that chases a cold email nobody answered.
 *
 * A cold email that goes quiet is not evidence of a no. It is evidence of an
 * inbox. This is the second and last message that row will ever produce: one
 * short reply, on the original thread, five to ten days later.
 *
 * Four rules, and every one of them exists to keep this from becoming a second
 * campaign rather than a nudge on the first one:
 *
 *   Once           one follow-up per row, ever. There is no third message, and
 *                  Follow Up Status is what makes that permanent rather than
 *                  something the next run has to be trusted to remember.
 *   Company-wide   one person answering silences the whole employer. If Samsara
 *                  had three emails and one of them came back, none of the three
 *                  is chased. This is the opposite of the cold path's rule, and
 *                  deliberately so — see outreachCompanyHasReply_.
 *   Short          one or two sentences and a wish. Anything longer re-sends the
 *                  first email, which the recipient already has directly above it.
 *   Spread         a window rather than a day, and a cap of its own, so the
 *                  weekday a batch happened to go out does not become the weekday
 *                  a second batch lands on.
 *
 * The reply is plain text and carries no attachment. The resume is already on the
 * thread, one message up, and re-attaching it to a two-sentence nudge is the
 * single loudest bulk-mail signal this system could send.
 */

// -------------------------------------------------------------------- wording

/**
 * Twenty ways to say the same short thing.
 *
 * Twenty rather than the ten the cold path uses, and the number is doing real
 * work. A cold email varies its subject, its number and its ask across ten
 * variations, which is plenty of surface to be different on. A follow-up has one
 * sentence and no subject of its own, so the sentence is the only place variety
 * can live — and these go to people who are, by definition, on a thread that
 * already exists. Two identical nudges landing at one employer in the same week
 * is the failure this list is sized against.
 *
 * `note` is what the message is; `close` is the wish it ends on. They are kept
 * apart rather than written as one string so the two axes multiply when they are
 * read: twenty openings and twenty sign-offs, paired but never repeating either.
 *
 * House rules, the same as outreach_compose.gs: no dash anywhere, nothing over
 * about twenty-five words, and no claim the first email did not already make.
 * There is no new fact here on purpose. A follow-up that adds an argument is a
 * second pitch, and a second pitch is the thing this is built not to be.
 */
var FOLLOWUP_TEMPLATES = [
  { note: 'Floating this back to the top of your inbox in case it slipped by.',
    close: 'Have a great rest of your week,' },
  { note: 'Following up briefly on the note below, in case it is easier to answer now.',
    close: 'Hope your week is going well,' },
  { note: 'Circling back once on this one. No rush at all if the timing is wrong.',
    close: 'Wishing you a good week,' },
  { note: 'A short nudge on the message below, in case it got buried.',
    close: 'Have a lovely day,' },
  { note: 'Bumping this gently in case it landed in a busy week.',
    close: 'Enjoy the rest of your day,' },
  { note: 'Following up once on my note below. Happy to be pointed elsewhere if this req is not yours.',
    close: 'Have a great day,' },
  { note: 'Checking in briefly on the application below. Still very interested.',
    close: 'Hope the week treats you kindly,' },
  { note: 'One quick follow up, in case the note below slipped past.',
    close: 'Have a good one,' },
  { note: 'Sending this back up in case it is a better moment to look at it.',
    close: 'Wishing you a smooth week,' },
  { note: 'A brief nudge, and no reply needed if the answer is not right now.',
    close: 'Take care,' },
  { note: 'Following up in case there is anything else you need from my side.',
    close: 'Have a great week ahead,' },
  { note: 'Just checking this reached you. Happy to resend anything that did not.',
    close: 'Hope you have a good day,' },
  { note: 'Bringing this back once, in case the timing is better this week.',
    close: 'Enjoy your week,' },
  { note: 'A short follow up on the note below. I know inboxes fill fast.',
    close: 'Wishing you a good rest of the week,' },
  { note: 'Nudging this once. If someone else owns the req, a name is plenty.',
    close: 'Have a great rest of your day,' },
  { note: 'Following up briefly, and I will leave it here after this.',
    close: 'Hope your week goes well,' },
  { note: 'Quick check in on the application below. Still keen on it.',
    close: 'Have a good week,' },
  { note: 'One more note in case this is easier to answer today.',
    close: 'Wishing you a good day,' },
  { note: 'A short reminder about the message below, nothing more.',
    close: 'Enjoy the rest of the week,' },
  { note: 'Following up once, and no need to reply if it is not the right fit.',
    close: 'All the best,' }
];

/**
 * The template a row gets, as the number the Follow Up Template column shows.
 *
 * 1-based, because the column is read by a person and "template 0" is not a thing
 * anybody says. It is stored rather than recomputed for the same reason the
 * Template column is: what the tab said before the message went is what you read
 * afterwards to know what went, and a value derived twice is a value that can
 * disagree with itself.
 *
 * The company decides where in the list to start and the count decides how far
 * along, so two people at one employer never get the same sentence and two
 * employers rarely start at the same place. Deriving the start from the company's
 * own name rather than from a counter keeps it stable: replanning a row after a
 * reply was recorded hands back the number it already had.
 */
function outreachFollowUpStartFor_(company) {
  var key = outreachCompanyTokens_(company).join(' ');
  var hash = 0;
  for (var i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) % 100003;
  return hash % FOLLOWUP_TEMPLATES.length;
}

function outreachFollowUpTemplateFor_(company, index) {
  var start = outreachFollowUpStartFor_(company);
  return ((start + Math.max(Number(index) || 0, 0)) % FOLLOWUP_TEMPLATES.length) + 1;
}

/**
 * One follow-up, as the plain text that actually goes.
 *
 * Plain text and not HTML, which is a decision rather than a shortcut. The reply
 * quotes nothing, styles nothing and links nothing; every byte of it is the two
 * lines a person reads. An HTML part on a message this short adds a signature
 * block, a font stack and a second copy of the same words, all so that a nudge can
 * look like a newsletter.
 *
 * The sign-off is the name alone. The links are four lines up on the same thread,
 * in the message this is a reply to.
 */
function outreachFollowUpBody_(number, recruiterName) {
  var template = FOLLOWUP_TEMPLATES[(Number(number) || 1) - 1] || FOLLOWUP_TEMPLATES[0];
  return [
    'Hi ' + outreachFirstName_(recruiterName) + ',',
    '',
    template.note,
    '',
    template.close,
    SENDER_NAME
  ].join('\n');
}

/**
 * Run by hand: say whether the one thing this file needs from Gmail is actually
 * wired up, without sending anything.
 *
 * `Gmail.Users.Messages.send` is the only code path in this project that goes
 * through the advanced service rather than GmailApp, and it is therefore the only
 * one whose first real execution is also its first test. That execution is
 * otherwise a Saturday morning with six rows due — which is a bad place to find
 * out that a manifest entry did not take, or that the grant was never refreshed
 * to match it.
 *
 * getProfile is a read. It names the mailbox and touches nothing, so this can be
 * run as often as it is worth running, and the answer it gives is the same answer
 * the sender will get.
 */
function checkOutreachFollowUpService() {
  if (typeof Gmail === 'undefined') {
    Logger.log('NOT ready: the Gmail advanced service did not resolve. Check that '
             + 'Services in the editor lists Gmail, then run any function once to '
             + 'refresh the authorisation. Until it does, follow-ups are held '
             + 'rather than failed, so nothing is lost by fixing it late.');
    return false;
  }
  var profile = Gmail.Users.getProfile('me');
  Logger.log('Ready. Replies will be posted as ' + profile.emailAddress
           + ', onto the threads they answer. Nothing was sent.');
  return true;
}

/**
 * Run by hand: print all twenty, so the list can be read as a list.
 *
 * Twenty sentences that have to stay different from each other are twenty
 * sentences worth seeing side by side once, and a spreadsheet of numbers is the
 * wrong place to notice that two of them say the same thing.
 */
function previewOutreachFollowUps() {
  FOLLOWUP_TEMPLATES.forEach(function (template, index) {
    Logger.log((index + 1) + '. ' + template.note + '  /  ' + template.close);
  });
  Logger.log(FOLLOWUP_TEMPLATES.length + ' templates. Nothing was sent.');
  return FOLLOWUP_TEMPLATES.length;
}

// -------------------------------------------------------------------- deciding

/**
 * Whether anyone at this employer has already answered.
 *
 * This is the rule the user asked for by name, and it reverses the cold path on
 * purpose. outreachAttemptsWanted_ says a reply does not stop the rest, because
 * one recruiter saying "I will pass this on" is not the same as being in and the
 * person who owns the req may be the second or the third. That reasoning is about
 * a *first* email to a person who has not heard from us.
 *
 * A follow-up is the opposite case. The company has now answered once; chasing
 * two of their colleagues about the silence of a thread that is not silent is how
 * a careful sequence turns into the thing recruiters forward to each other. If
 * Samsara had three emails and one came back, none of the three is chased.
 *
 * Matched on employer rather than on the literal cell, so "Samsara" and "Samsara
 * Inc." are one company here exactly as they are everywhere else.
 */
function outreachCompanyHasReply_(queueRows, company) {
  var tokens = outreachCompanyTokens_(company);
  if (!tokens.length) return false;
  for (var i = 0; i < queueRows.length; i++) {
    if (queueRows[i].status !== STATUS_REPLIED) continue;
    if (outreachSameEmployer_(tokens, outreachCompanyTokens_(queueRows[i].company))) return true;
  }
  return false;
}

/**
 * Whether one row is the kind of row that earns a follow-up at all.
 *
 * Everything here is about the row itself. The company-wide reply rule is checked
 * by the caller, because it is the one condition that can also *undo* a booking
 * that has already been made, and a predicate that answers "may this be booked"
 * is the wrong shape for a question that has to be asked again later.
 *
 * Bounced never reaches this: the status has to be Sent, and a bounce moves the
 * row to Bounced. Replied, Cancelled and Failed are excluded the same way, by the
 * same line. That is worth stating because "skip the bounced ones" was asked for
 * explicitly and there is no line in this file that mentions bouncing.
 */
function outreachFollowUpEarns_(row, today) {
  if (row.followUpStatus) return { ok: false, why: 'already decided' };
  if (row.status !== STATUS_SENT) return { ok: false, why: 'status is ' + (row.status || 'blank') };
  if (!row.sentAt) return { ok: false, why: 'no send date' };
  if (!row.messageId) return { ok: false, why: 'no thread to reply on' };
  if (outreachDaysBetween_(row.sentAt, today) > FOLLOWUP_LATEST_DAYS) {
    return { ok: false, why: 'sent over ' + FOLLOWUP_LATEST_DAYS + ' days ago' };
  }
  return { ok: true, why: '' };
}

/**
 * The span of days one row's follow-up may land in.
 *
 * Normally five to ten days after the send. Two things bend it, and both bend it
 * forwards only:
 *
 * A window that has already started keeps its end but begins today, because a day
 * in the past is not a day anything can be scheduled on.
 *
 * A window that has already *finished* is replaced by a fresh one of the same
 * length starting today. That case is the whole difference between this feature
 * shipping quietly and this feature's first run replying to two weeks of backlog
 * in one afternoon: without it every row already sent has a window entirely in the
 * past, they all collapse onto today, and the daily cap spends the rest of the
 * week paying that off. With it they fan out over the next five days like anything
 * else. Rows older than FOLLOWUP_LATEST_DAYS never get here at all.
 */
function outreachFollowUpWindow_(sentAt, today) {
  var start = outreachMidnight_(today);
  var earliest = outreachMidnight_(outreachAddDays_(sentAt, FOLLOWUP_AFTER_DAYS));
  var latest = outreachMidnight_(outreachAddDays_(sentAt, FOLLOWUP_WINDOW_DAYS));
  if (latest.getTime() < start.getTime()) {
    earliest = start;
    latest = outreachAddDays_(start, FOLLOWUP_WINDOW_DAYS - FOLLOWUP_AFTER_DAYS);
  } else if (earliest.getTime() < start.getTime()) {
    earliest = start;
  }
  // The hard ceiling, and the reason it is on the window rather than checked by
  // the caller: a day picker that may look past `latest` has to be told where
  // past ends. FOLLOWUP_LATEST_DAYS is already the age at which a row stops being
  // worth chasing at all, so it is the honest edge — a row pushed to it is late,
  // a row pushed beyond it should not be sent.
  //
  // Never before `latest`. On the replaced-window branch above, sent + 21 days can
  // already be in the past, and a ceiling behind the window would leave the picker
  // nowhere to walk.
  var ceiling = outreachMidnight_(outreachAddDays_(sentAt, FOLLOWUP_LATEST_DAYS));
  if (ceiling.getTime() < latest.getTime()) ceiling = latest;
  return { earliest: earliest, latest: latest, ceiling: ceiling };
}

/**
 * The hours a full day of follow-ups is handed out at.
 *
 * FOLLOWUP_HOUR_FIRST to FOLLOWUP_HOUR_LAST — 08:00 to 19:00, wider than the cold
 * path at both ends, and spaced rather than filled from the front. Twelve hours
 * for six emails means the six can sit two and three hours apart instead of
 * finishing by lunchtime; see outreachSpaceHours_ for why the two distributions
 * differ.
 *
 * The whole day's shape is computed rather than each row's hour, because the hour
 * a row gets is decided by how many are already on that day — and that count is
 * the same number the cap is counting. One table, read by index.
 */
function outreachFollowUpHoursForDay_() {
  return outreachSpaceHours_(FOLLOWUP_DAILY_CAP, FOLLOWUP_HOUR_FIRST, FOLLOWUP_HOUR_LAST);
}

/**
 * A booked day plus the hour it belongs at, as one timestamp.
 *
 * The hour matters as much as the day, and this is the second time this project
 * has had to learn it. outreachProjectSchedule_ says so in as many words about
 * `Scheduled At`: "Aug 24" on fifteen rows reads as fifteen emails at once, which
 * is the one thing this is built not to do. The first version of this column
 * carried a bare date and six rows read as six replies at nine in the morning.
 *
 * `index` is how many follow-ups the day already holds. Past the cap the day is
 * saturated — the fallback in outreachFollowUpDay_ put a row there because no day
 * out to the ceiling had room — and those land on the last firing rather than
 * being given an hour the table does not have.
 */
function outreachFollowUpAt_(day, index) {
  var hours = outreachFollowUpHoursForDay_();
  var at = new Date(day.getTime());
  at.setHours(index < hours.length ? hours[index] : FOLLOWUP_HOUR_LAST, 0, 0, 0);
  return at;
}

/** A day, as the key the load table counts under. */
function outreachDayKey_(date) {
  return outreachMidnight_(date).getTime();
}

/**
 * The first day with room on it, starting at the front of the window.
 *
 * The first day under the cap wins rather than the emptiest, so a queue that is
 * nowhere near its cap still books everything as early as it may. Spreading for
 * its own sake would hold a nudge back four days to keep a number even, which
 * serves the table and not the message. In the ordinary case the answer is inside
 * the window and this is the whole function.
 *
 * When the window is full it keeps walking, out to the 21-day ceiling, rather than
 * putting a seventh row on a day inside the window.
 *
 * That is the opposite of what this did at first, and the first version was wrong
 * in a way only the live tab showed. Sixty-eight rows were already sent and quiet
 * when the feature shipped, and every one of their windows is at most six days
 * wide and ends at most ten days out — so the whole backlog wanted to land inside
 * nine days, which is fifty-four slots for seventy rows. Overloading the emptiest
 * day meant seven of those nine days ran at eight or nine, on a feature whose
 * stated point is that no day carries a pile. Walking past the window costs a
 * follow-up on day twelve instead of day nine; overloading cost the cap entirely,
 * and the cap is the thing that was asked for.
 *
 * Only when everything out to the ceiling is full does the emptiest day take it.
 * By then the queue is saturated and there is no day that is not a compromise; the
 * row still goes rather than being silently dropped.
 */
function outreachFollowUpDay_(window, load) {
  var best = null;
  var bestLoad = 0;
  var ceiling = window.ceiling || window.latest;
  var day = window.earliest;
  var guard = 0;
  while (day.getTime() <= ceiling.getTime() && guard < 60) {
    guard++;
    if (outreachFollowUpDayAllowed_(day)) {
      var count = load[outreachDayKey_(day)] || 0;
      if (count < FOLLOWUP_DAILY_CAP) return day;
      if (best === null || count < bestLoad) { best = day; bestLoad = count; }
    }
    day = outreachAddDays_(day, 1);
  }
  return best;
}

/**
 * Book every row that has earned a follow-up, and un-book every row that has
 * stopped deserving one.
 *
 * Pure: rows in, three lists out, nothing written. The whole rule set is
 * arguable from a laptop for the same reason the rest of this project is.
 *
 * `stopped` is the half that is easy to forget. A row booked on Monday for
 * Thursday has three days in which a colleague can answer, and on the run after
 * that answer is recorded the booking has to come off — otherwise the company-wide
 * rule only holds for rows that had not been looked at yet, which is the subset it
 * matters least for.
 *
 * Oldest send first, so the row that has been waiting longest takes the earliest
 * day left rather than whichever row happened to be typed in first.
 */
function outreachPlanFollowUps_(queueRows, today) {
  var load = {};
  var perCompany = {};
  var replied = {};

  var companyKey = function (company) {
    var tokens = outreachCompanyTokens_(company);
    return tokens.length ? tokens.join(' ') : '';
  };
  var hasReply = function (company) {
    var key = companyKey(company);
    if (replied[key] === undefined) replied[key] = outreachCompanyHasReply_(queueRows, company);
    return replied[key];
  };

  // Seed the day counts and the per-company template counter from what is already
  // on the tab. A plan that ignored existing bookings would put six more on a day
  // that already holds six, and would hand the second row at an employer the same
  // sentence the first one got.
  queueRows.forEach(function (row) {
    if (!row.followUpStatus) return;
    if (row.followUpTemplate) {
      var key = companyKey(row.company);
      perCompany[key] = (perCompany[key] || 0) + 1;
    }
    var counts = row.followUpStatus === FOLLOWUP_QUEUED
              || row.followUpStatus === FOLLOWUP_DRAFTED
              || row.followUpStatus === FOLLOWUP_SENT;
    if (counts && row.followUpAt) {
      var slot = outreachDayKey_(row.followUpAt);
      load[slot] = (load[slot] || 0) + 1;
    }
  });

  var stopped = [];
  var calledOff = {};
  queueRows.forEach(function (row) {
    if (row.followUpStatus !== FOLLOWUP_QUEUED) return;
    // Two ways a booking stops being one. A colleague answered, which is the rule
    // this feature was asked for; or the row itself left Sent, which is what a
    // rejection recorded by hand or by the scanner does to it. sendFollowUpReplies
    // catches both again on the day, but catching them here is what stops the tab
    // showing a nudge booked for Tuesday against an application closed on Friday.
    if (!hasReply(row.company) && row.status === STATUS_SENT) return;
    stopped.push({ rowNumber: row.rowNumber, company: row.company });
    calledOff[row.rowNumber] = true;
    if (row.followUpAt) {
      var slot = outreachDayKey_(row.followUpAt);
      load[slot] = Math.max((load[slot] || 0) - 1, 0);
    }
  });

  // Bookings made before the hour was part of the column, given the hour they
  // should have had.
  //
  // A booking is decided, and a decided row is one the planner will not touch —
  // that is what makes one follow-up per row permanent, and it is also why a
  // change to *when inside the day* a row goes cannot reach the rows already
  // booked. Seventy of them were carrying midnight, which is not a sending hour
  // and reads as seventy replies at the stroke of nothing.
  //
  // Narrow on purpose: it moves the hour and never the day, never touches a row
  // that is not Queued, and cannot un-stop a row the pass above just called off.
  // A booking that already has a real hour matches nothing here, so this stops
  // finding work the moment there is none — no flag, no second run to remember.
  var rehoured = [];
  var houred = {};
  var unhoured = {};
  queueRows.forEach(function (row) {
    if (row.followUpStatus !== FOLLOWUP_QUEUED || !row.followUpAt) return;
    if (calledOff[row.rowNumber]) return;
    var key = outreachDayKey_(row.followUpAt);
    if (row.followUpAt.getHours() >= FOLLOWUP_HOUR_FIRST) {
      houred[key] = (houred[key] || 0) + 1;
      return;
    }
    (unhoured[key] = unhoured[key] || []).push(row);
  });
  Object.keys(unhoured).forEach(function (key) {
    var start = houred[key] || 0;
    unhoured[key].forEach(function (row, index) {
      rehoured.push({
        rowNumber: row.rowNumber,
        day: outreachFollowUpAt_(row.followUpAt, start + index)
      });
    });
  });

  var booked = [];
  var skipped = [];
  queueRows.filter(function (row) { return !row.followUpStatus; })
    .sort(function (a, b) {
      var left = a.sentAt ? a.sentAt.getTime() : Infinity;
      var right = b.sentAt ? b.sentAt.getTime() : Infinity;
      return left === right ? a.rowNumber - b.rowNumber : left - right;
    })
    .forEach(function (row) {
      var earns = outreachFollowUpEarns_(row, today);
      // Only a row that would otherwise have been booked is worth writing a
      // Skipped on. Everything still queued, drafted or waiting on its own send is
      // not a follow-up decision yet, and stamping those would fill the column
      // with a word about rows that have not reached the question.
      if (!earns.ok) {
        if (row.status === STATUS_SENT) skipped.push({ rowNumber: row.rowNumber, why: earns.why });
        return;
      }
      if (hasReply(row.company)) {
        skipped.push({ rowNumber: row.rowNumber, why: 'somebody at this company replied' });
        return;
      }
      var day = outreachFollowUpDay_(outreachFollowUpWindow_(row.sentAt, today), load);
      if (!day) {
        skipped.push({ rowNumber: row.rowNumber, why: 'no day in the window may carry it' });
        return;
      }
      var key = companyKey(row.company);
      var template = outreachFollowUpTemplateFor_(row.company, perCompany[key] || 0);
      perCompany[key] = (perCompany[key] || 0) + 1;
      // Read before the increment: the hour a row gets is its position in the
      // day, and the row being booked is the (n+1)th of n already there.
      var slot = outreachDayKey_(day);
      var at = outreachFollowUpAt_(day, load[slot] || 0);
      load[slot] = (load[slot] || 0) + 1;
      booked.push({ rowNumber: row.rowNumber, day: at, template: template });
    });

  return { booked: booked, stopped: stopped, skipped: skipped, rehoured: rehoured };
}

/**
 * The follow-ups this firing may send.
 *
 * The same shape as outreachDueNow_, and for the same reason: the day's allowance
 * is spread over the firings left rather than emptied at ten in the morning, and
 * it is recomputed every hour so a firing that was missed is absorbed by the ones
 * after it instead of being lost.
 *
 * SEND_HOUR_LAST here, where the cold path uses DRAFT_HOUR_LAST. Nothing is
 * written an hour ahead, so the last firing of the day is a firing that can send.
 *
 * A row whose day has already gone by is still due. That is what makes a weekend
 * of downtime, or a day the cap could not absorb, catch up rather than silently
 * drop.
 */
function outreachFollowUpsDueNow_(queueRows, now) {
  var hour = now.getHours();
  if (hour < FOLLOWUP_HOUR_FIRST || hour > FOLLOWUP_HOUR_LAST) return [];
  if (!outreachFollowUpDayAllowed_(now)) return [];

  var today = outreachMidnight_(now).getTime();
  var gone = queueRows.filter(function (row) {
    return (row.followUpStatus === FOLLOWUP_SENT || row.followUpStatus === FOLLOWUP_DRAFTED)
        && row.followUpAt && outreachDayKey_(row.followUpAt) === today;
  }).length;
  var remaining = FOLLOWUP_DAILY_CAP - gone;
  if (remaining <= 0) return [];

  // A brake on catch-up, not the spreader it used to be. The hours are booked now,
  // so in the ordinary hour one row is due and this does not bind. It binds after a
  // day nothing ran on, when six rows come due together and sending them in one
  // firing would undo the point of having booked six different hours.
  var firingsLeft = FOLLOWUP_HOUR_LAST - hour + 1;
  var slots = Math.min(remaining, Math.ceil(remaining / firingsLeft));

  // The whole timestamp, not the day. Once the hour is booked it is the hour the
  // row goes at, exactly as Scheduled At is for a cold email — a row booked for
  // 14:00 is not due at 09:20 just because the date matches. An hour already past
  // is still due, which is what makes a missed firing catch up.
  return queueRows.filter(function (row) {
    return row.followUpStatus === FOLLOWUP_QUEUED && row.followUpAt
        && row.followUpAt.getTime() <= now.getTime();
  }).sort(function (a, b) {
    var left = a.sentAt ? a.sentAt.getTime() : Infinity;
    var right = b.sentAt ? b.sentAt.getTime() : Infinity;
    return left === right ? a.rowNumber - b.rowNumber : left - right;
  }).slice(0, slots);
}

// --------------------------------------------------------------------- sending

/**
 * The Message-ID header of a message this account sent.
 *
 * Needed because a reply is only a reply if In-Reply-To and References name the
 * message it answers. Gmail threads on those headers, not on the subject: without
 * them the nudge arrives as a separate conversation with "Re:" written on it,
 * which is worse than not threading at all because it looks like a mistake.
 *
 * getHeader is the cheap path. The fallback exists because getRawContent on a
 * message carrying the resume is a hundred and fifty kilobytes, and paying that
 * per follow-up when a one-line accessor will do is the kind of cost that only
 * shows up as a timeout months later.
 */
function outreachMessageIdHeader_(message) {
  try {
    if (typeof message.getHeader === 'function') {
      var header = message.getHeader('Message-ID') || message.getHeader('Message-Id');
      if (header) return String(header).trim();
    }
  } catch (error) {
    // An older runtime without getHeader falls through to the raw content below.
  }
  var raw = String(message.getRawContent() || '');
  var found = raw.match(/^Message-ID:\s*(<[^>]+>)/im);
  return found ? found[1] : '';
}

/**
 * Post one reply onto an existing thread.
 *
 * The Gmail advanced service rather than GmailApp, and this is the only place in
 * the project that needs it. GmailMessage.reply and GmailThread.reply both answer
 * *the sender of the message*, and on a thread this account started that sender is
 * this account: calling either would have mailed Henry a follow-up about Henry's
 * own email. There is no `to` override on those methods, so the raw message is
 * the only way to reply to the recipient of something we sent.
 *
 * threadId on the send is what files it in the right conversation; the two headers
 * are what make every other mail client agree that is where it belongs.
 */
function outreachSendFollowUp_(message, to, body) {
  var messageId = outreachMessageIdHeader_(message);
  var subject = String(message.getSubject() || '');
  if (!/^re:/i.test(subject)) subject = 'Re: ' + subject;

  var headers = [
    'To: ' + to,
    'Subject: ' + subject,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8'
  ];
  if (messageId) {
    headers.push('In-Reply-To: ' + messageId);
    headers.push('References: ' + messageId);
  }
  var raw = headers.join('\r\n') + '\r\n\r\n' + body;
  return Gmail.Users.Messages.send(
    { raw: Utilities.base64EncodeWebSafe(raw, Utilities.Charset.UTF_8),
      threadId: message.getThread().getId() },
    'me'
  );
}

/**
 * Write the plan onto the tab.
 *
 * Runs every firing, and is cheap enough to: it opens one spreadsheet, reads it
 * once, and writes only the rows whose three cells actually change. Nothing here
 * touches Gmail, so it is safe to call at any hour and from any button.
 */
function planFollowUpReplies() {
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var queue = tracker.getSheetByName(TAB_QUEUE);
  if (!queue) throw new Error('No ' + TAB_QUEUE + ' tab.');
  var last = queue.getLastRow();
  if (last < 2) return { booked: 0, stopped: 0, skipped: 0 };

  var rows = queue.getRange(2, 1, last - 1, Q_WIDTH).getValues().map(outreachParseQueue_);
  var plan = outreachPlanFollowUps_(rows, new Date());

  plan.booked.forEach(function (item) {
    var updates = {};
    updates[Q_FOLLOWUP_AT] = item.day;
    updates[Q_FOLLOWUP_TEMPLATE] = item.template;
    updates[Q_FOLLOWUP_STATUS] = FOLLOWUP_QUEUED;
    outreachWriteRow_(queue, item.rowNumber, updates);
  });
  // The booked day is cleared along with the status. A date left behind on a row
  // that will never use it reads as a plan, and the whole reason this column is
  // next to Status is that the two are meant to be read as one answer.
  plan.stopped.forEach(function (item) {
    var updates = {};
    updates[Q_FOLLOWUP_AT] = '';
    updates[Q_FOLLOWUP_STATUS] = FOLLOWUP_STOPPED;
    outreachWriteRow_(queue, item.rowNumber, updates);
  });
  plan.skipped.forEach(function (item) {
    var updates = {};
    updates[Q_FOLLOWUP_STATUS] = FOLLOWUP_SKIPPED;
    outreachWriteRow_(queue, item.rowNumber, updates);
  });
  // The hour only. Status and template are already right on these rows, and
  // rewriting a cell with the value it holds is a change to the sheet's revision
  // history that says nothing happened.
  plan.rehoured.forEach(function (item) {
    var updates = {};
    updates[Q_FOLLOWUP_AT] = item.day;
    outreachWriteRow_(queue, item.rowNumber, updates);
  });

  Logger.log('follow-ups booked ' + plan.booked.length + ', stopped '
           + plan.stopped.length + ', skipped ' + plan.skipped.length
           + ', given an hour ' + plan.rehoured.length);
  return { booked: plan.booked.length, stopped: plan.stopped.length,
           skipped: plan.skipped.length, rehoured: plan.rehoured.length };
}

/**
 * Run by hand: throw away every booking that has not gone yet, and book again.
 *
 * The planner will not touch a row that already has a Follow Up Status, which is
 * what makes one follow-up per row permanent. That is the right default and it is
 * also why a change to *how days are chosen* cannot reach the rows already booked
 * under the old rule: they are decided, so they are skipped forever.
 *
 * This is the way out, and it is deliberately narrow. Only `Queued` rows are
 * cleared — nothing that has been sent, drafted, skipped or stopped is touched, so
 * no follow-up is ever sent twice and no decision about a replying company is
 * undone. A cleared row is back to blank, which is the one state the planner reads.
 *
 * Public, and named without the trailing underscore, so it shows up in the Run
 * menu of the editor. That is the whole reason it exists.
 */
function replanOutreachFollowUps() {
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var queue = tracker.getSheetByName(TAB_QUEUE);
  if (!queue) throw new Error('No ' + TAB_QUEUE + ' tab.');
  var last = queue.getLastRow();
  if (last < 2) return { cleared: 0, booked: 0 };

  var rows = queue.getRange(2, 1, last - 1, Q_WIDTH).getValues().map(outreachParseQueue_);
  var cleared = 0;
  rows.forEach(function (row) {
    if (row.followUpStatus !== FOLLOWUP_QUEUED) return;
    var blank = {};
    blank[Q_FOLLOWUP_AT] = '';
    blank[Q_FOLLOWUP_TEMPLATE] = '';
    blank[Q_FOLLOWUP_STATUS] = '';
    outreachWriteRow_(queue, row.rowNumber, blank);
    cleared++;
  });

  var plan = planFollowUpReplies();
  Logger.log('Cleared ' + cleared + ' booking(s) and booked ' + plan.booked + ' again.');
  return { cleared: cleared, booked: plan.booked };
}

/**
 * Send the follow-ups whose day has come.
 *
 * Three checks are made again here rather than trusted from planning time, and
 * each one is a thing that can change in the days between: the application may
 * have closed, a colleague may have answered, and this very thread may have been
 * answered. The third is free — the thread has to be fetched to reply on it
 * anyway — and it is the one the reply scan can miss, because a reply that lands
 * inside the same hour has not been recorded yet.
 *
 * Mode is honoured exactly as the cold path honours it: a row held to Draft, or a
 * global OUTREACH_MODE of Draft, produces a draft on the thread instead of a sent
 * message, and the row says Drafted. Sending it is then a person's decision, and
 * the row keeps saying Drafted afterwards, which is the same thing a cold email in
 * Draft mode does.
 */
function sendFollowUpReplies() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
    var contactsBook = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
    var salt = outreachProperty_(PROP_SALT, true);
    var globalMode = outreachProperty_(PROP_MODE, false);
    // Two switches, and either one alone is enough to hold a reply back. The
    // narrow one exists so the follow-up can have its own first week without the
    // cold path being stopped to watch it.
    var followUpMode = outreachProperty_(PROP_FOLLOWUP_MODE, false) === MODE_DRAFT
      ? MODE_DRAFT : globalMode;
    var app = tracker.getSheetByName(TAB_APP);
    var queue = tracker.getSheetByName(TAB_QUEUE);
    var last = queue.getLastRow();
    if (last < 2) return { sent: 0, drafted: 0, stopped: 0, failed: 0 };

    var now = new Date();
    var rows = queue.getRange(2, 1, last - 1, Q_WIDTH).getValues().map(outreachParseQueue_);
    var due = outreachFollowUpsDueNow_(rows, now);
    if (!due.length) { Logger.log('No follow-up due this firing.'); return { sent: 0, drafted: 0, stopped: 0, failed: 0 }; }

    // The advanced service, checked once before the loop rather than discovered
    // inside it.
    //
    // Every other failure below is about one row and is recorded on that row as
    // Failed, which is terminal — the follow-up is spent and never tried again.
    // That is the right shape for "Gmail refused this address" and exactly the
    // wrong shape for "the service was not enabled on this deploy", which would
    // burn a whole day's allowance on a manifest problem. A setup that is not
    // ready touches nothing and says so; the rows keep their bookings and go on
    // the next firing.
    if (typeof Gmail === 'undefined') {
      Logger.log('The Gmail advanced service is not available yet, so nothing was '
               + 'chased. Open the editor once to authorise it; the '
               + due.length + ' row(s) due keep their day.');
      return { sent: 0, drafted: 0, stopped: 0, failed: 0 };
    }

    var appLast = app.getLastRow();
    var byProperty = {};
    if (appLast >= 2) {
      app.getRange(2, 1, appLast - 1, APP_RECRUITERS).getValues()
         .map(outreachParseApp_).forEach(function (row) { byProperty[row.property] = row; });
    }
    var contacts = outreachReadContacts_(contactsBook);
    var tally = { sent: 0, drafted: 0, stopped: 0, failed: 0 };

    due.forEach(function (row) {
      var updates = {};

      var check = outreachStillQualifies_(byProperty[row.property]);
      if (!check.ok || outreachCompanyHasReply_(rows, row.company)) {
        updates[Q_FOLLOWUP_AT] = '';
        updates[Q_FOLLOWUP_STATUS] = FOLLOWUP_STOPPED;
        outreachWriteRow_(queue, row.rowNumber, updates);
        tally.stopped++;
        return;
      }

      try {
        var message = GmailApp.getMessageById(row.messageId);
        var thread = message.getThread();
        // Answered since the last scan. Recording it costs one write and saves a
        // reply to somebody who is mid-conversation with us.
        if (thread.getMessageCount() > 1) {
          var answered = {};
          answered[Q_STATUS] = STATUS_REPLIED;
          answered[Q_RESULT] = 'Reply on ' + thread.getLastMessageDate();
          answered[Q_FOLLOWUP_AT] = '';
          answered[Q_FOLLOWUP_STATUS] = FOLLOWUP_STOPPED;
          outreachWriteRow_(queue, row.rowNumber, answered);
          tally.stopped++;
          return;
        }

        var companyContacts = outreachContactsFor_(contacts, row.company);
        var contact = outreachContactByFingerprint_(companyContacts, row.fingerprint, salt);
        // The address comes off the thread when the contact list no longer has the
        // person on it. The list is the source for the name; the thread is the
        // source for where this reply belongs, and it cannot go stale.
        var to = contact ? contact.email : String(message.getTo() || '').trim();
        if (!to) throw new Error('No address to reply to.');

        var body = outreachFollowUpBody_(row.followUpTemplate, contact ? contact.name : '');

        if (outreachModeFor_(row.mode, followUpMode) === MODE_DRAFT) {
          GmailApp.createDraft(to, 'Re: ' + message.getSubject(), body);
          updates[Q_FOLLOWUP_STATUS] = FOLLOWUP_DRAFTED;
          tally.drafted++;
        } else {
          outreachSendFollowUp_(message, to, body);
          updates[Q_FOLLOWUP_STATUS] = FOLLOWUP_SENT;
          updates[Q_FOLLOWUP_AT] = now;
          tally.sent++;
        }
        outreachWriteRow_(queue, row.rowNumber, updates);
      } catch (error) {
        var failed = {};
        failed[Q_FOLLOWUP_STATUS] = FOLLOWUP_FAILED;
        failed[Q_ERROR] = String(error.message || error).slice(0, 250);
        outreachWriteRow_(queue, row.rowNumber, failed);
        tally.failed++;
      }
    });

    Logger.log('follow-ups sent ' + tally.sent + ', drafted ' + tally.drafted
             + ', stopped ' + tally.stopped + ', failed ' + tally.failed);
    return tally;
  } finally {
    lock.releaseLock();
  }
}
