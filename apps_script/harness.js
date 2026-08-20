const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const SRC = require('path').join(__dirname, 'sync_applied_to_app.gs');

function makeSheet(name, data) {
  const grid = data.map((r) => r.slice());
  const sheet = {
    grid,
    getName: () => name,
    setColumnWidth(column, pixels) { widths.push([column, pixels]); return this; },
    getLastRow() {
      let last = 0;
      grid.forEach((row, i) => {
        if (row.some((c) => c !== '' && c !== null && c !== undefined)) last = i + 1;
      });
      return last;
    },
    getRange(row, col, numRows, numCols) {
      numRows = numRows === undefined ? 1 : numRows;
      numCols = numCols === undefined ? 1 : numCols;
      return {
        getRow: () => row,
        getColumn: () => col,
        getLastRow: () => row + numRows - 1,
        getLastColumn: () => col + numCols - 1,
        getSheet: () => sheet,
        getValues() {
          const out = [];
          for (let r = 0; r < numRows; r++) {
            const line = [];
            for (let c = 0; c < numCols; c++) {
              const v = (grid[row - 1 + r] || [])[col - 1 + c];
              line.push(v === undefined ? '' : v);
            }
            out.push(line);
          }
          return out;
        },
        setValues(values) {
          for (let r = 0; r < numRows; r++) {
            while (grid.length < row + r) grid.push([]);
            for (let c = 0; c < numCols; c++) grid[row - 1 + r][col - 1 + c] = values[r][c];
          }
          return this;
        },
        setValue(v) {
          return this.setValues([[v]]);
        },
        getValue() {
          const v = (grid[row - 1] || [])[col - 1];
          return v === undefined ? '' : v;
        },
        clearContent() {
          for (let r = 0; r < numRows; r++) {
            for (let c = 0; c < numCols; c++) {
              if (grid[row - 1 + r]) grid[row - 1 + r][col - 1 + c] = '';
            }
          }
          return this;
        },
        setNumberFormat() { return this; },
        setDataValidation() { validated.push([row, col, numRows, numCols]); return this; },
        setWrapStrategy(strategy) { wrapped.push([col, strategy]); return this; },
        copyTo(dest, type) { copied.push([row, type]); copiedWidth = numCols; return this; },
      };
    },
  };
  return sheet;
}

let copied = [];
let toasts = [];
let wrapped = [];
let validated = [];
let copiedWidth = 0;
let widths = [];
let jobs, app, ss;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function load() {
  copied = [];
  toasts = [];
  wrapped = [];
  validated = [];
  copiedWidth = 0;
  widths = [];
  ss = {
    getSheetByName: (n) => (n === 'Jobs' ? jobs : n === 'App' ? app : null),
    toast: (msg) => toasts.push(msg),
  };
  const validation = {
    requireCheckbox() { return this; },
    requireValueInList() { return this; },
    setAllowInvalid() { return this; },
    setHelpText() { return this; },
    build: () => ({}),
  };
  const sandbox = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      newDataValidation: () => validation,
      CopyPasteType: { PASTE_DATA_VALIDATION: 'PASTE_DATA_VALIDATION' },
      WrapStrategy: { WRAP: 'WRAP' },
    },
    Session: { getScriptTimeZone: () => 'America/New_York' },
    Utilities: {
      // Enough for UPDATE_DATE_FORMAT, the only format the .gs file uses. Throw
      // rather than return something plausible, so that changing the format over
      // there and forgetting this turns the tests red instead of quiet.
      formatDate(date, timeZone, format) {
        if (format !== 'MMM d, yyyy') throw new Error('the harness does not understand the format ' + format);
        return MONTHS[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear();
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox);
  return sandbox;
}

const JOBS_HEADER = ['Company', 'Role', 'Link Apply', 'Date Posted', 'Source',
                    'Applied', 'Expired'];
// The checkbox columns in the grid, 0-based: Source pushed in ahead of them, so
// both shifted one to the right.
const APPLIED = 5, EXPIRED = 6;
const APP_HEADER = ['Property', 'Company', 'Application Link', 'Date Applied',
                    'Location (State)', 'Process', 'Role', 'Note'];

/** Today's date, written exactly the way stamp() in the .gs file writes it. */
function today() {
  const now = new Date();
  return MONTHS[now.getMonth()] + ' ' + now.getDate() + ', ' + now.getFullYear();
}

function freshJobs() {
  return makeSheet('Jobs', [
    JOBS_HEADER,
    // App holds this job under a greenhouse link while Jobs holds the jobright one.
    ['IBM', 'Software Engineering Intern', 'https://jobright.ai/jobs/info/abc', '2026-08-14', 'Jobright', false, false],
    // The same link as App's, differing only by a trailing / and utm parameters.
    ['Notion', 'Software Engineer Intern',
     'https://jobs.ashbyhq.com/notion/1?utm_source=Simplify', '2026-08-15', 'Simplify', false, false],
    // Never applied to.
    ['Neuralink', 'Firmware Engineer Intern', 'https://jobright.ai/jobs/info/xyz', '2026-08-16', 'Ashby', false, false],
  ]);
}

function freshApp() {
  return makeSheet('App', [
    APP_HEADER,
    [1, 'IBM', 'https://job-boards.greenhouse.io/ibm/jobs/9', 'July 21, 2026', '', 'Applied',
     'Software Engineering  Intern', ''],
    [2, 'Notion', 'https://jobs.ashbyhq.com/notion/1/', 'July 26, 2026', '', 'OA',
     'Software Engineer Intern', ''],
    // A stray row carrying only a link, like the real ones already in App.
    ['', '', 'https://bambusdev.example/job/1', '', '', '', '', ''],
  ]);
}

function run(name, fn) {
  try {
    fn();
    console.log('  ok   ' + name);
  } catch (err) {
    console.log('  FAIL ' + name + '\n       ' + err.message);
    process.exitCode = 1;
  }
}

console.log('normalizeLink / identity');
{
  const s = load();
  run('utm and a trailing slash do not make one link into two jobs', () => {
    assert.strictEqual(
      s.normalizeLink('https://jobs.ashbyhq.com/notion/1?utm_source=Simplify&ref=Simplify'),
      s.normalizeLink('https://JOBS.ashbyhq.com/notion/1/')
    );
  });
  run('a parameter that identifies the posting itself is kept', () => {
    assert.notStrictEqual(
      s.normalizeLink('https://boards.example/j?gh_jid=1'),
      s.normalizeLink('https://boards.example/j?gh_jid=2')
    );
  });
  run('punctuation and extra whitespace do not split one job into two', () => {
    assert.strictEqual(
      s.identity('IBM', 'Software Engineering  Intern'),
      s.identity('ibm.', 'Software-Engineering Intern')
    );
  });
  run('with no company or no role there is no identity to match on', () => {
    assert.strictEqual(s.identity('', 'SWE Intern'), '');
    assert.strictEqual(s.identity('IBM', ''), '');
  });
}

console.log('backfillTicksFromApp');
{
  jobs = freshJobs();
  app = freshApp();
  const s = load();
  s.backfillTicksFromApp();
  run('Notion is ticked by link, IBM by company + role', () => {
    assert.strictEqual(jobs.grid[1][APPLIED], true, 'IBM');
    assert.strictEqual(jobs.grid[2][APPLIED], true, 'Notion');
  });
  run('a job not yet applied to is left alone', () => {
    assert.strictEqual(jobs.grid[3][APPLIED], false, 'Neuralink');
  });
  run('the toast reports the two kinds of match separately', () => {
    assert.match(toasts[0], /2 rows: 1 matched by link, 1 by company \+ role/);
  });
  run('the backfill touches nothing in App', () => {
    assert.strictEqual(app.getLastRow(), 4);
  });
}

console.log('the backfill run a second time');
{
  const s = load();
  s.backfillTicksFromApp();
  run('there is nothing further to tick', () => {
    assert.match(toasts[0], /No further rows to tick/);
  });
}

console.log('onEdit');
{
  jobs = freshJobs();
  app = freshApp();
  const s = load();
  // onEdit runs after the cell has already changed, so it must be true before firing.
  jobs.grid[3][APPLIED] = true;
  s.onEdit({ source: ss, range: jobs.getRange(4, APPLIED + 1, 1, 1) });
  run('ticking a job not yet in App adds a row', () => {
    assert.strictEqual(app.getLastRow(), 5);
  });
  run('Property continues from the largest number, not from the row count', () => {
    assert.strictEqual(app.grid[4][0], 3);
  });
  run('Company, link, Process and Role land in the right columns', () => {
    const row = app.grid[4];
    assert.strictEqual(row[1], 'Neuralink');
    assert.strictEqual(row[2], 'https://jobright.ai/jobs/info/xyz');
    assert.strictEqual(row[5], 'Applied');
    assert.strictEqual(row[6], 'Firmware Engineer Intern');
  });
  run('Date Applied is today', () => {
    // instanceof is no use here: a Date made inside the vm is from another realm.
    const written = app.grid[4][3];
    assert.strictEqual(Object.prototype.toString.call(written), '[object Date]');
    assert.strictEqual(written.toDateString(), new Date().toDateString());
  });
  run('Location is left empty because Jobs does not carry it', () => {
    assert.strictEqual(app.grid[4][4], '');
  });
  run('validation is copied from the last entry row, not from a link-only stray row', () => {
    assert.deepStrictEqual(copied, [[3, 'PASTE_DATA_VALIDATION']]);
  });
}

console.log('onEdit — the cases where it must do nothing');
{
  jobs = freshJobs();
  app = freshApp();
  const s = load();

  s.onEdit({ source: ss, range: jobs.getRange(2, 3, 1, 1) });
  run('an edit to another column is ignored', () => assert.strictEqual(app.getLastRow(), 4));

  jobs.grid[3][APPLIED] = false;
  s.onEdit({ source: ss, range: jobs.getRange(4, APPLIED + 1, 1, 1) });
  run('unticking does nothing', () => assert.strictEqual(app.getLastRow(), 4));

  jobs.grid[2][APPLIED] = true;
  s.onEdit({ source: ss, range: jobs.getRange(3, APPLIED + 1, 1, 1) });
  run('ticking a job already in App under that link is ignored', () => {
    assert.strictEqual(app.getLastRow(), 4);
    assert.match(toasts[toasts.length - 1], /Added no rows/);
  });

  jobs.grid[1][APPLIED] = true;
  s.onEdit({ source: ss, range: jobs.getRange(2, APPLIED + 1, 1, 1) });
  run('onEdit does NOT match by name: a different link is still recorded', () => {
    assert.strictEqual(app.getLastRow(), 5);
  });
}

console.log('onEdit — filling down many rows');
{
  jobs = freshJobs();
  app = freshApp();
  const s = load();
  jobs.grid[1][APPLIED] = true;
  jobs.grid[2][APPLIED] = true;
  jobs.grid[3][APPLIED] = true;
  s.onEdit({ source: ss, range: jobs.getRange(2, APPLIED + 1, 3, 1) });
  run('the whole block is handled, and no two Property numbers collide', () => {
    assert.strictEqual(app.getLastRow(), 6);
    assert.strictEqual(app.grid[4][0], 3);
    assert.strictEqual(app.grid[5][0], 4);
  });
  run('a row already in App is still skipped inside the block', () => {
    assert.match(toasts[toasts.length - 1], /Added 2 rows.*Skipped 1 row/);
  });
}

console.log('onEdit — Expired stops a row reaching App');
{
  jobs = freshJobs();
  app = freshApp();
  const s = load();
  jobs.grid[3][APPLIED] = true;   // Applied
  jobs.grid[3][EXPIRED] = true;   // Expired
  s.onEdit({ source: ss, range: jobs.getRange(4, APPLIED + 1, 1, 1) });
  run('ticking Applied on an Expired row adds nothing', () => {
    assert.strictEqual(app.getLastRow(), 4);
  });
  run('the toast says why the row was skipped', () => {
    assert.match(toasts[toasts.length - 1], /Skipped 1 row ticked Expired/);
  });

  jobs.grid[1][APPLIED] = true;   // IBM: Applied, not Expired
  s.onEdit({ source: ss, range: jobs.getRange(2, APPLIED + 1, 3, 1) });
  run('inside one block, a row that is not Expired still goes across', () => {
    assert.strictEqual(app.getLastRow(), 5);
    assert.strictEqual(app.grid[4][1], 'IBM');
  });
  run('a mixed block counts the two reasons for skipping separately', () => {
    assert.match(toasts[toasts.length - 1], /Added 1 row.*Skipped 1 row ticked Expired/s);
  });

  jobs.grid[3][EXPIRED] = false;  // take Expired off again
  s.onEdit({ source: ss, range: jobs.getRange(4, APPLIED + 1, 1, 1) });
  run('once Expired comes off, that row can go across', () => {
    assert.strictEqual(app.getLastRow(), 6);
    assert.strictEqual(app.grid[5][1], 'Neuralink');
  });
}

console.log('setupJobsCheckboxes');
{
  jobs = freshJobs();
  app = freshApp();
  const s = load();
  s.setupJobsCheckboxes();
  run('it builds the header for both columns', () => {
    assert.strictEqual(jobs.grid[0][APPLIED], 'Applied');
    assert.strictEqual(jobs.grid[0][EXPIRED], 'Expired');
  });
}

console.log('stageLabel / hasStage / stamp');
{
  const s = load();
  run('any casing resolves to one stage name', () => {
    assert.strictEqual(s.stageLabel('oa'), 'OA');
    assert.strictEqual(s.stageLabel('  Rejected '), 'Rejected');
  });
  run('a value outside the pipeline is not a stage', () => {
    assert.strictEqual(s.stageLabel('Phone screen'), '');
    assert.strictEqual(s.stageLabel(''), '');
  });
  run('hasStage reads what precedes the colon', () => {
    const cell = 'Applied: Jul 21, 2026\nOA: Aug 1, 2026';
    assert.strictEqual(s.hasStage(cell, 'OA'), true);
    assert.strictEqual(s.hasStage(cell, 'Offer'), false);
  });
  run('an empty cell holds no stage yet', () => {
    assert.strictEqual(s.hasStage('', 'Applied'), false);
  });
  run('a date that cannot be read becomes ?, not an empty string', () => {
    assert.strictEqual(s.stamp(''), '?');
    assert.strictEqual(s.stamp('July 21, 2026'), 'July 21, 2026');
  });
}

console.log('Jobs → App: seeding the first Update line');
{
  jobs = freshJobs();
  app = freshApp();
  const s = load();
  jobs.grid[3][APPLIED] = true;   // Neuralink: Applied
  s.onEdit({ source: ss, range: jobs.getRange(4, APPLIED + 1, 1, 1) });
  run('a row that has just reached App already carries the Applied stage', () => {
    assert.strictEqual(app.grid[4][10], 'Applied: ' + today());
  });
  run('column K is set to WRAP, or the cell would show only its first line', () => {
    assert.ok(wrapped.some((call) => call[0] === 11 && call[1] === 'WRAP'));
  });
}

console.log('onAppEdit');
{
  jobs = freshJobs();
  app = freshApp();
  const s = load();

  s.onEdit({ source: ss, range: app.getRange(3, 6, 1, 1) });   // Notion is at OA
  run('changing Process writes one "<Stage>: <date>" line', () => {
    assert.strictEqual(app.grid[2][10], 'OA: ' + today());
  });
  run('the toast names the date it just wrote', () => {
    assert.match(toasts[toasts.length - 1], /Wrote .+ to the Update column of 1 row/);
  });

  s.onEdit({ source: ss, range: app.getRange(3, 6, 1, 1) });
  run('firing again on the stage already set writes no further line', () => {
    assert.strictEqual(app.grid[2][10], 'OA: ' + today());
  });

  app.grid[2][5] = 'Interview';
  s.onEdit({ source: ss, range: app.getRange(3, 6, 1, 1) });
  run('a new stage is appended below and the old ones are left as they were', () => {
    assert.strictEqual(app.grid[2][10], 'OA: ' + today() + '\nInterview: ' + today());
  });

  app.grid[2][5] = 'OA';
  s.onEdit({ source: ss, range: app.getRange(3, 6, 1, 1) });
  run('going back to a stage already passed does not write it twice', () => {
    assert.strictEqual(app.grid[2][10].split('\n').length, 2);
  });

  const kept = app.grid[2][10];
  s.onEdit({ source: ss, range: app.getRange(3, 8, 1, 1) });   // the Note column
  run('an edit to another column leaves the Update column alone', () => {
    assert.strictEqual(app.grid[2][10], kept);
  });

  app.grid[2][5] = 'Offer';
  app.grid[3][5] = 'Phone screen';
  s.onEdit({ source: ss, range: app.getRange(3, 6, 2, 1) });
  run('inside one block a valid stage is written and an unrecognised value is not', () => {
    assert.match(app.grid[2][10], /Offer: /);
    assert.ok(!app.grid[3][10]);
  });
}

console.log('setupAppColumns');
{
  jobs = freshJobs();
  app = freshApp();
  const s = load();
  s.setupAppColumns();
  run('it builds the header in column K', () => {
    assert.strictEqual(app.grid[0][10], 'Update');
  });
  run('a row sitting at Applied takes its date from Date Applied', () => {
    assert.strictEqual(app.grid[1][10], 'Applied: July 21, 2026');
  });
  run('a row that has gone further marks the later stage ? rather than inventing a date', () => {
    assert.strictEqual(app.grid[2][10], 'Applied: July 26, 2026\nOA: ?');
  });
  run('a row with only a link and no Process is not an entry', () => {
    assert.ok(!app.grid[3][10]);
  });
  run('the toast counts the rows still needing to be filled in by hand separately', () => {
    assert.match(toasts[toasts.length - 1], /Filled in 2 rows.*1 at a stage past Applied/s);
  });
  run('it builds the header for the two checkbox columns', () => {
    assert.strictEqual(app.grid[0][8], 'Alumni');
    assert.strictEqual(app.grid[0][9], 'Recruiter');
  });
  run('the checkbox columns are narrow and Update is wide', () => {
    assert.deepStrictEqual(widths, [[9, 70], [10, 90], [11, 300]]);
  });
  run('the checkboxes cover only as far as the real last row, not to LAST_ROW', () => {
    // Covering to 500 would make the validation physically write FALSE all the way
    // down, getLastRow() would return 500, and onEdit would append new rows at 501.
    const boxes = validated.filter((call) => call[1] === 9);
    assert.strictEqual(boxes.length, 1);
    assert.deepStrictEqual(boxes[0], [2, 9, 3, 2]);   // I2:J4, exactly the 3 rows there are
  });

  const kept = app.grid[1][10];
  app.grid[2][10] = 'Applied: July 26, 2026\nOA: Aug 1, 2026';
  s.setupAppColumns();
  run('running again does not overwrite a cell that already has text', () => {
    assert.strictEqual(app.grid[1][10], kept);
    assert.strictEqual(app.grid[2][10], 'Applied: July 26, 2026\nOA: Aug 1, 2026');
  });
  run('the second run has nothing left to fill in', () => {
    assert.match(toasts[toasts.length - 1], /All three columns are already right/);
  });
}

console.log('setupAppColumns — moving the Update column from J to K');
{
  jobs = freshJobs();
  app = freshApp();
  const s = load();
  // The sheet of someone who ran yesterday's version: the history is in column J.
  app.grid[0][9] = 'Update';
  app.grid[1][9] = 'Applied: Jul 21, 2026';
  app.grid[2][9] = 'Applied: Jul 26, 2026\nOA: Aug 1, 2026';
  s.setupAppColumns();

  run('the history reaches column K intact', () => {
    assert.strictEqual(app.grid[1][10], 'Applied: Jul 21, 2026');
    assert.strictEqual(app.grid[2][10], 'Applied: Jul 26, 2026\nOA: Aug 1, 2026');
  });
  run('column J is handed over to Recruiter', () => {
    assert.strictEqual(app.grid[0][9], 'Recruiter');
    assert.strictEqual(app.grid[1][9], '');
    assert.strictEqual(app.grid[2][9], '');
  });
  run('the toast says how many rows it moved', () => {
    assert.match(toasts[toasts.length - 1], /Moved 2 rows of history from column J to K/);
  });

  const kept = app.grid[2][10];
  s.setupAppColumns();
  run('running again does not move a second time — text in K means stand still', () => {
    assert.strictEqual(app.grid[2][10], kept);
    assert.strictEqual(app.grid[0][9], 'Recruiter');
  });
}

console.log('onEdit — a new row picks up the validation of both checkboxes');
{
  jobs = freshJobs();
  app = freshApp();
  const s = load();
  jobs.grid[3][APPLIED] = true;
  s.onEdit({ source: ss, range: jobs.getRange(4, APPLIED + 1, 1, 1) });
  run('validation is copied out to the end of column J, not stopping at APP_WIDTH', () => {
    assert.strictEqual(copied.length, 1);
    assert.strictEqual(copied[0][1], 'PASTE_DATA_VALIDATION');
    assert.strictEqual(copiedWidth, 10);
  });
}
