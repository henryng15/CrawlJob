/**
 * Track App — turn the Process column into a coloured dropdown.
 *
 * How to run it:
 *   1. Open the "Track App" Google Sheet
 *   2. Extensions → Apps Script
 *   3. Delete the sample code and paste this whole file in
 *   4. Pick setupProcessDropdown from the toolbar and press Run
 *   5. The first time, Google asks for permission → Review permissions → pick the
 *      account → Advanced → Go to (project name) → Allow
 */

function setupProcessDropdown() {
  var SHEET_GID     = 1712615786;  // the tab, taken from #gid= in the URL
  var PROCESS_COL   = 6;           // column F
  var FIRST_ROW     = 2;           // row 1 is the header
  var LAST_ROW      = 500;         // leave room for new entries

  // This order is the order they appear in the dropdown, following the hiring pipeline
  var STAGES = [
    { name: 'Applied',      bg: '#CFE2F3', fg: '#1155CC' },  // blue — sent
    { name: 'OA',           bg: '#FFF2CC', fg: '#BF9000' },  // yellow — an assessment to do
    // Amber, between the yellow it came from and the purple ahead of it. The two
    // assessment stages are deliberately not the same colour: only this one puts
    // the row back in front of a recruiter, and telling them apart at a glance is
    // the reason the stage was split at all.
    { name: 'Completed OA', bg: '#FCE5CD', fg: '#B45F06' },  // amber — done, waiting on them
    { name: 'Interview',    bg: '#D9D2E9', fg: '#674EA7' },  // purple — reached the interview round
    { name: 'Offer',        bg: '#D9EAD3', fg: '#38761D' },  // green — it worked
    { name: 'Rejected',     bg: '#F4CCCC', fg: '#CC0000' }   // red — closed
  ];

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheets().filter(function (s) {
    return s.getSheetId() === SHEET_GID;
  })[0];
  if (!sheet) {
    throw new Error('No tab with gid ' + SHEET_GID + '. Check the URL.');
  }

  var range = sheet.getRange(FIRST_ROW, PROCESS_COL, LAST_ROW - FIRST_ROW + 1, 1);
  var names = STAGES.map(function (s) { return s.name; });

  // 1) The dropdown. setAllowInvalid(false) also blocks a misspelled value
  var validation = SpreadsheetApp.newDataValidation()
    .requireValueInList(names, true)
    .setAllowInvalid(false)
    .setHelpText('Pick one of: ' + names.join(', '))
    .build();
  range.setDataValidation(validation);

  // 2) Colour by value.
  //    Keep the rules that apply to other columns and replace only the Process
  //    ones, so running the script again does not duplicate rules.
  var kept = sheet.getConditionalFormatRules().filter(function (rule) {
    return rule.getRanges().every(function (r) {
      return r.getColumn() !== PROCESS_COL;
    });
  });

  var colorRules = STAGES.map(function (s) {
    return SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(s.name)
      .setBackground(s.bg)
      .setFontColor(s.fg)
      .setRanges([range])
      .build();
  });

  sheet.setConditionalFormatRules(kept.concat(colorRules));

  ss.toast('Process column (F2:F' + LAST_ROW + ') now has a dropdown and colours.', 'Done', 5);
}
