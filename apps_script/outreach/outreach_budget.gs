/**
 * Outreach — one budget across all three paths.
 *
 * Three features send email from one Gmail account: the cold email to a
 * recruiter, the follow up that chases it, and the referral ask to an engineer.
 * Each was given a daily cap in isolation, and each cap is defensible on its own.
 * None of them could see the other two, so the real question — how many messages
 * leave this mailbox in a day — was answered only by adding three numbers up,
 * which nothing did.
 *
 * This file answers it. DAILY_EMAIL_BUDGET is the ceiling, EMAIL_PATH_ORDER is
 * who gives way when it binds, and the two functions here are consulted by each
 * path's own due-now at the moment before anything is sent.
 *
 * The check is at sending, not at planning, and that is deliberate. A planner
 * writes a date into a cell; it is the send that costs the account something. A
 * budget enforced at planning time can be defeated by a row that was planned last
 * week under a cap that has since changed, and a row that loses its place at send
 * time is not lost: every path here already treats a day it could not absorb as a
 * day to catch up on, because they all had to survive a weekend of downtime.
 *
 * A note on what today's numbers actually do. The individual caps may add to
 * more than the budget: 27 at the cold path's Tuesday peak, 6 for follow-up and
 * 20 for Referral add to fifty three against a budget of forty seven. That is
 * intentional. The budget is the load-bearing guard rail, and EMAIL_PATH_ORDER
 * makes Referral reserve first; cold and then follow-up defer rather than the
 * mailbox exceeding forty seven messages.
 */

/**
 * How much of a day each path has already spent.
 *
 * Drafted counts as spent, not only Sent. A draft is a message that exists,
 * addressed and complete, and will leave within the hour unless somebody
 * deletes it; not counting it would let a firing at the top of the hour book
 * against a budget the firing before it had already committed.
 *
 * Counted on the day the row is booked for rather than the day it went out. The
 * two are the same except when a row is catching up after downtime, and on that
 * day what the account did is what matters, so a row that slipped from Tuesday
 * and sent on Wednesday is spend against Wednesday.
 */
function outreachDaySpend_(queueRows, referralRows, day) {
  var key = outreachDayKey_(day);
  var spend = { cold: 0, followup: 0, referral: 0, total: 0 };

  (queueRows || []).forEach(function (row) {
    // The same two-part test the cold path's own due-now runs, spelled the same
    // way on purpose: a sent row is dated by Sent At, and a drafted row has no
    // Sent At yet and is dated by the hour it is booked to leave at.
    var coldToday = row.sentAt
      ? outreachDayKey_(row.sentAt) === key
      : (row.status === STATUS_DRAFTED && row.scheduledAt
         && outreachDayKey_(row.scheduledAt) === key);
    if (coldToday) spend.cold++;
    if ((row.followUpStatus === FOLLOWUP_SENT || row.followUpStatus === FOLLOWUP_DRAFTED)
        && row.followUpAt && outreachDayKey_(row.followUpAt) === key) {
      spend.followup++;
    }
  });

  (referralRows || []).forEach(function (row) {
    // A paused referral draft will not be sent by this project, so release its
    // reserved budget to the cold/reply paths. Already-sent referral mail still
    // counts against the day even after the path is paused.
    if (row.status === STATUS_SENT) {
      var sentDay = row.sentAt || row.scheduled;
      if (sentDay && outreachDayKey_(sentDay) === key) spend.referral++;
    } else if (!outreachReferralPaused_()
               && row.status === STATUS_DRAFTED
               && row.scheduled && outreachDayKey_(row.scheduled) === key) {
      spend.referral++;
    }
  });

  spend.total = spend.cold + spend.followup + spend.referral;
  return spend;
}

/** What one path's own cap allows on this day, before the budget is consulted. */
function outreachPathCap_(path, day) {
  if (path === 'cold') return outreachDailyCap_(day);
  if (path === 'followup') return FOLLOWUP_DAILY_CAP;
  if (path === 'referral') return REFERRAL_DAILY_CAP;
  return 0;
}

/**
 * How many more messages a path may send on a day.
 *
 * Two limits, and the smaller wins: the path's own cap, and what is left of the
 * budget once room has been held back for pending work in every path above it
 * in EMAIL_PATH_ORDER. An idle higher-priority path does not reserve an empty
 * allowance forever; only rows that can actually use that allowance today are
 * protected.
 *
 * That reservation is what makes the ordering mean anything. Without it the
 * priority would be decided by which planner happened to run first, and the cold
 * path runs on an hourly trigger that has been firing for weeks — it would take
 * the whole budget every morning and the ordering would be a comment rather than
 * a rule. Holding back Referral's twenty when Referral really has twenty queued
 * asks is the difference. When it has no work, lower paths may use that idle room.
 */
function outreachPendingPathDemand_(queueRows, referralRows, day, path) {
  var key = outreachDayKey_(day);
  if (path === 'referral') {
    if (outreachReferralPaused_()) return 0;
    return (referralRows || []).filter(function (row) {
      return row.status === STATUS_QUEUED && row.scheduled
        && outreachDayKey_(row.scheduled) === key && row.email && row.jobLink;
    }).length;
  }
  if (path === 'cold') {
    var dayKey = outreachMidnight_(day).getTime();
    return (queueRows || []).filter(function (row) {
      return row.status === STATUS_QUEUED && row.eligibleAt
        && outreachMidnight_(row.eligibleAt).getTime() <= dayKey;
    }).length;
  }
  return 0;
}

function outreachBudgetRoom_(queueRows, referralRows, day, path) {
  var spend = outreachDaySpend_(queueRows, referralRows, day);
  var reserved = 0;
  for (var i = 0; i < EMAIL_PATH_ORDER.length; i++) {
    var above = EMAIL_PATH_ORDER[i];
    if (above === path) break;
    var available = Math.max(0, outreachPathCap_(above, day) - spend[above]);
    reserved += Math.min(available,
      outreachPendingPathDemand_(queueRows, referralRows, day, above));
  }
  var left = DAILY_EMAIL_BUDGET - spend.total - reserved;
  var own = outreachPathCap_(path, day) - spend[path];
  return Math.max(0, Math.min(own, left));
}
