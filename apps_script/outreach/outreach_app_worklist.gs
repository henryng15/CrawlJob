/**
 * The App worklist — which applications are waiting on a link, and where they sit.
 *
 * One question, asked once an hour against the whole App tab: is this an
 * application a referral could be asked for today, held up by nothing except the
 * absence of a link a referral can be submitted against? Every row where the
 * answer is yes is painted yellow and lifted to the top of the tab; every row
 * where it is no is cleared and put back in Property order.
 *
 * It lives in the sender rather than in the tracker script, and that is the whole
 * reason this file exists rather than a rule added to sync_applied_to_app.gs.
 * The question has four parts — the employer is one ColdEmail found engineers at,
 * the application has not been rejected, the posting names the intake being asked
 * about, and the link does not pass outreachReferralLinkOk_ — and the first of
 * those can only be answered from the Employees (seed) tab, which lives in the
 * contacts spreadsheet the sending account owns and the tracker script cannot
 * open. A tracker-side copy could answer three parts out of four, which is worse
 * than not answering: it would paint every linkless application at every company,
 * including the hundreds where there is nobody to ask, and a worklist mostly made
 * of work that cannot be done is one nobody reads twice.
 *
 * So the yellow means exactly what the referral planner means by it. It is
 * outreachReferralNeedsLink_ — the same function, not a second spelling of it —
 * and the two cannot drift because there is only one.
 *
 * Until 2026-08-30 the tracker script painted this tab hourly on a cruder rule:
 * yellow if neither Application Link nor Official started with "http". That rule
 * is loose in the direction that matters. A row carrying a jobright.ai link is
 * not yellow under it and is refused by the planner, so the applications most in
 * need of a pasted link were the ones the tab never mentioned. It is also tight
 * in the other direction, painting companies with no engineers on file. Both
 * halves of that sweep have been removed from the tracker script; what stays
 * there is the onEdit repaint, which is deliberately optimistic — see the note on
 * ordering below.
 */

/**
 * The yellow. The same one the tracker script used, because the tab has carried
 * it for months and a worklist that changes colour is a worklist people have to
 * be told about.
 */
var APP_WORKLIST_YELLOW = '#FFF2CC';

/**
 * A row with nothing on it.
 *
 * The two checkbox columns are why this cannot ask whether every cell is blank:
 * an unticked checkbox reads back as false rather than as an empty cell, and the
 * Python half writes FALSE down both columns across every row it covers. Counting
 * false as content would make a row that is nothing but two unticked boxes look
 * occupied, so it would sort in among the applications as though it were one.
 */
function outreachAppRowBlank_(row) {
  for (var c = 0; c < row.length; c++) {
    var cell = row[c];
    if (cell === false || cell === null || cell === undefined) continue;
    if (String(cell).trim() === '') continue;
    return false;
  }
  return true;
}

/**
 * The Property number of a row, as a number, or null when it has none.
 *
 * Null rather than 0 or Infinity, because "this row has no Property" is a third
 * answer and not a very large or very small one. A half-typed row sorts to the
 * end of whichever group it is in and keeps the position it already had, which is
 * the only handling that cannot move somebody's work out from under them.
 */
function outreachAppPropertyOf_(row) {
  var raw = row[APP_PROPERTY - 1];
  if (raw === null || raw === undefined) return null;
  var text = String(raw).trim();
  if (!text) return null;
  var value = Number(text);
  return isFinite(value) ? value : null;
}

/**
 * Order one group by Property, ascending, ties and blanks holding their place.
 *
 * Sorting by Property rather than leaving the group in the order it arrived is
 * the fix this file was written for. A stable sort keeps a row wherever it
 * currently is, which is correct exactly once: the first time a row is lifted to
 * the top it is right, and from then on the row has been moved and its "current"
 * position is the top. Paste the missing link and the row stops being yellow, but
 * a stable sort has no memory of where it came from, so it drops to the head of
 * the second group and stays a hundred rows above where it belongs — for good.
 *
 * Property is the memory. It is written once when the application crosses from
 * Jobs, it never changes, and it numbers the rows in the order they were applied
 * to, which is the order the tab is meant to be in. Sorting both groups by it
 * makes the whole sweep a pure function of the data: a row lifted for a missing
 * link goes home to its own number the moment the link arrives, and running the
 * sweep twice moves nothing the second time.
 *
 * Array.prototype.sort is not documented as stable in the Rhino runtime Apps
 * Script may still fall back to, so the arrival index is carried as an explicit
 * last tiebreak rather than trusted to the engine.
 */
function outreachSortAppGroup_(group) {
  group.forEach(function (entry, at) { entry.arrivedAt = at; });
  group.sort(function (left, right) {
    if (left.property === null && right.property === null) return left.arrivedAt - right.arrivedAt;
    if (left.property === null) return 1;
    if (right.property === null) return -1;
    if (left.property !== right.property) return left.property - right.property;
    return left.arrivedAt - right.arrivedAt;
  });
  return group;
}

/**
 * The ordering decision on its own — entries in, reordered entries out, no sheet —
 * so that what the sweep does can be argued with without a spreadsheet to argue on.
 *
 * Three groups, in this order: rows waiting on a link, everything else, then the
 * empty tail. The first two are each put into Property order; the tail is left
 * exactly as it was.
 *
 * The empty tail is held back rather than left to fall into the second group. A
 * blank row is not yellow, so a plain two-way split would sort the blanks in among
 * the applications by their absent Property. Pinning the tail makes "the blank
 * rows are at the bottom" true for any input instead of true by luck of this one.
 *
 * Only the genuinely trailing blanks are pinned. A blank row with real rows still
 * below it is a gap somebody left on purpose, and it sorts with its group.
 */
function outreachOrderAppEntries_(entries) {
  var end = entries.length;
  while (end > 0 && entries[end - 1].blank) end--;

  var needing = [], rest = [];
  for (var i = 0; i < end; i++) {
    (entries[i].needsLink ? needing : rest).push(entries[i]);
  }
  return outreachSortAppGroup_(needing)
    .concat(outreachSortAppGroup_(rest), entries.slice(end));
}

/**
 * Paint the App tab's worklist and bring it into order.
 *
 * Runs last in runOutreachCycle, and last is a correctness requirement rather
 * than a preference. scanRejectionEmails writes Process and Update back to App by
 * row number, and cancelStaleOutreachRows and both planners read the tab by row
 * number too. Every one of those holds indexes taken before this ran; moving a
 * row while any of them is still holding one would file a rejection against a
 * different application. Nothing reads App after this step, so nothing can.
 *
 * The colour is carried with the row through the sort rather than recomputed from
 * the row afterwards. The tracker script could recompute, because its rule was a
 * pure function of three cells on the row. This one is not: it needs the employee
 * list and the company's domain, so recomputing would mean reading the contacts
 * spreadsheet a second time and doing the whole match again to learn something
 * already known. Carrying it also removes the only way the values and the colours
 * can disagree, which matters more — a tab painting the wrong rows yellow is worse
 * than one not painted at all, because a colour that lies stops being read, and
 * the applications that really are waiting stop being read with it.
 *
 * One read and one write for the whole block, in both halves. Row by row this
 * would be one round trip per application, and Apps Script stops a trigger at
 * thirty seconds — the sweep would die somewhere in the middle of the tab.
 *
 * The race worth naming is highlight.py's. It reads App A:H, works out which rows
 * earn an alumni or recruiter tick, and writes the two checkbox columns back by
 * position, so a sort landing between that read and that write puts an alumnus
 * against the wrong application. The window is the seconds between two calls in
 * one sync, and this writes nothing at all in the ordinary case where no row
 * moved. That is what keeps the window narrow rather than what closes it. Stop
 * the hourly trigger while the Python half is being worked on.
 */
function syncAppOfficialWorklist() {
  var tally = { needing: 0, moved: false };
  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var app = tracker.getSheetByName(TAB_APP);
  if (!app) throw new Error('No ' + TAB_APP + ' tab.');

  var bottom = app.getLastRow();
  if (bottom < 2) return tally;
  var count = bottom - 1;

  // Not APP_READ_WIDTH: the App tab really can hold data past column L. Update is
  // where this project stops having an opinion, not where the row stops — an
  // operator's own column sits past it, and a row moved with only A..L in hand
  // would leave that cell on whatever row lands in its place, quietly reattaching
  // one application's notes to a different application.
  var width = Math.max(app.getLastColumn(), APP_UPDATE);
  var values = app.getRange(2, 1, count, width).getValues();

  var employees = outreachReadEmployees_(
    SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true)));
  var domainFor = outreachReferralDomainFor_(employees);
  var applications = values.map(function (row, i) {
    return outreachParseApplication_(row, i + 2, domainFor);
  });

  var needing = {};
  outreachReferralNeedsLink_(applications, employees).forEach(function (one) {
    needing[one.index] = true;
  });

  var entries = values.map(function (row, i) {
    return {
      values: row,
      needsLink: !!needing[i + 2],
      blank: outreachAppRowBlank_(row),
      property: outreachAppPropertyOf_(row)
    };
  });
  tally.needing = entries.filter(function (entry) { return entry.needsLink; }).length;

  var ordered = outreachOrderAppEntries_(entries);
  for (var i = 0; i < ordered.length; i++) {
    if (ordered[i] !== entries[i]) { tally.moved = true; break; }
  }
  // Nothing is written when nothing moved, which is what makes a second run a
  // genuine no-op rather than one that happens to write back the same bytes.
  if (tally.moved) {
    app.getRange(2, 1, count, width).setValues(ordered.map(function (entry) {
      return entry.values;
    }));
  }

  // The paint always runs, even when no row moved: a link pasted since the last
  // sweep changes a colour without changing an order, and that is the ordinary
  // case rather than the rare one.
  //
  // Out to APP_UPDATE and no further. A colour laid over somebody's own column
  // past Update would be this project painting a cell it has no opinion about.
  // null rather than white, because white is a colour and would paint over
  // whatever banding or manual highlight the row already had.
  app.getRange(2, 1, count, APP_UPDATE).setBackgrounds(ordered.map(function (entry) {
    var line = [];
    for (var c = 0; c < APP_UPDATE; c++) line.push(entry.needsLink ? APP_WORKLIST_YELLOW : null);
    return line;
  }));

  Logger.log('App worklist: ' + tally.needing + ' row(s) waiting on a link'
    + (tally.moved ? ', order rebuilt.' : ', order unchanged.'));
  return tally;
}
