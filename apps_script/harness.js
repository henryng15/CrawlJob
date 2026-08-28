const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const SRC = require('path').join(__dirname, 'sync_applied_to_app.gs');

function makeSheet(name, data) {
  const grid = data.map((r) => r.slice());
  // A second grid holding only what setBackgrounds wrote, so a test can ask what
  // colour a row ended up rather than only that some call was made. null is a
  // cleared cell, which is what paintAppOfficialBlock_ writes to take yellow off.
  const colours = [];
  const sheet = {
    grid,
    colours,
    getName: () => name,
    setColumnWidth(column, pixels) { widths.push([column, pixels]); return this; },
    setFrozenRows(rows) { frozen.push([name, rows]); return this; },
    // Models the one thing the real insert does that these tests turn on: values
    // and conditional-format rules to the right of the new column move with it.
    // Without the second half a rule left behind at its old column would look
    // like colourQueueColumn_ had stacked a duplicate set, which it had not.
    insertColumnBefore(at) {
      grid.forEach((row) => row.splice(at - 1, 0, ''));
      formatRules[name] = (formatRules[name] || []).map((rule) => {
        const moved = rule.getRanges().map((r) => {
          const column = r.getColumn() >= at ? r.getColumn() + 1 : r.getColumn();
          return Object.assign({}, r, { getColumn: () => column });
        });
        return Object.assign({}, rule, { getRanges: () => moved });
      });
      return sheet;
    },
    // The real sheet throws on a getRange past its last column, and the migration
    // reads the header of a tab narrower than the layout it is moving towards.
    // Modelled as the widest row, which is what an inserted column grows.
    getMaxColumns() {
      let widest = 0;
      grid.forEach((row) => { if (row.length > widest) widest = row.length; });
      return widest;
    },
    // The allocated height, which is what a whole-column clear covers. Modelled as
    // the grid's own length: the migration strips the checkbox the insert brought
    // with it over the full column, so rows added later do not arrive wearing one.
    getMaxRows() { return grid.length; },
    getConditionalFormatRules() { return formatRules[name] || []; },
    setConditionalFormatRules(rules) { formatRules[name] = rules; return this; },
    getLastRow() {
      let last = 0;
      grid.forEach((row, i) => {
        if (row.some((c) => c !== '' && c !== null && c !== undefined)) last = i + 1;
      });
      return last;
    },
    // The real sheet's last column holding anything, which is what
    // sortAppOfficialBlock_ asks for so that an operator column past Update
    // travels with its row. getMaxColumns above is the allocated width and is a
    // different question; answering this one with that would have the sort move
    // columns that hold nothing, which is harmless on a real sheet but would hide
    // a test that meant to check the block stops at the data.
    getLastColumn() {
      let last = 0;
      grid.forEach((row) => {
        row.forEach((c, i) => {
          if (c !== '' && c !== null && c !== undefined && i + 1 > last) last = i + 1;
        });
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
          // Recorded the same way painted is, so a test can ask how many block
          // writes happened rather than only what the grid ended up holding —
          // which is the difference between "the sort is one write" and "the sort
          // reached the right answer somehow".
          wrote.push([row, col, numRows, numCols]);
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
        // Recorded rather than simulated: what the tests need to know is that the
        // migration cleared the column the insert had just given a checkbox to.
        clearDataValidations() { cleared.push([row, col, numRows, numCols]); return this; },
        setBackground() { return this; },
        setNumberFormat() { return this; },
        setBackgrounds(values) {
          for (let r = 0; r < numRows; r++) {
            while (colours.length < row + r) colours.push([]);
            for (let c = 0; c < numCols; c++) colours[row - 1 + r][col - 1 + c] = values[r][c];
          }
          painted.push([row, col, numRows, numCols]);
          return this;
        },
        setDataValidation() { validated.push([row, col, numRows, numCols]); return this; },
        setWrapStrategy(strategy) { wrapped.push([col, strategy]); return this; },
        setFontWeight() { return this; },
        setBackground() { return this; },
        setHorizontalAlignment() { return this; },
        copyTo(dest, type) { copied.push([row, type]); copiedWidth = numCols; return this; },
      };
    },
  };
  return sheet;
}

let copied = [];
let painted = [];
let wrote = [];
let toasts = [];
let wrapped = [];
let validated = [];
let cleared = [];
let copiedWidth = 0;
let widths = [];
let frozen = [];
let formatRules = {};
let jobs, app, outreach, referral, ss;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function load() {
  copied = [];
  painted = [];
  wrote = [];
  toasts = [];
  wrapped = [];
  validated = [];
  cleared = [];
  copiedWidth = 0;
  widths = [];
  frozen = [];
  ss = {
    getSheetByName: (n) => (
      n === 'Jobs' ? jobs : n === 'App' ? app : n === 'Email' ? outreach
        : n === 'Referral' ? referral : null
    ),
    insertSheet(name) {
      if (name === 'Email') return (outreach = makeSheet(name, []));
      if (name === 'Referral') return (referral = makeSheet(name, []));
      throw new Error('unexpected sheet ' + name);
    },
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
      newConditionalFormatRule() {
        const rule = { ranges: [], background: '', fontColor: '', text: '' };
        const builder = {
          whenTextEqualTo(text) { rule.text = text; return builder; },
          setBackground(colour) { rule.background = colour; return builder; },
          setFontColor(colour) { rule.fontColor = colour; return builder; },
          setRanges(ranges) { rule.ranges = ranges; return builder; },
          build: () => ({
            getRanges: () => rule.ranges,
            text: rule.text, background: rule.background, fontColor: rule.fontColor
          })
        };
        return builder;
      },
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

let passed = 0;
let failed = 0;

function run(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (err) {
    failed++;
    console.log('  FAIL ' + name + '\n       ' + err.message);
    process.exitCode = 1;
  }
}

// Counted and printed at the bottom rather than left to be eyeballed: a test that
// stops being reached — a block that throws before its run() calls — disappears
// silently otherwise, and a shrinking suite looks exactly like a passing one.
process.on('exit', () => {
  console.log('\n' + passed + ' ok, ' + failed + ' failures');
});

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

console.log('setupOutreachQueue');
{
  jobs = freshJobs();
  app = freshApp();
  outreach = null;
  const s = load();
  s.setupOutreachQueue();
  run('the two timestamps sit together, so one glance says written-then-goes', () => {
    const header = Array.from(s.OUTREACH_HEADERS);
    assert.strictEqual(header[7], 'Drafted At');
    assert.strictEqual(header[8], 'Scheduled At');
  });
  run('it creates the tab with the queue header only', () => {
    assert.ok(outreach);
    // OUTREACH_HEADERS came from the vm context, so copy it into this realm
    // before comparing it with the fake sheet's normal JavaScript array.
    assert.deepStrictEqual(outreach.grid[0], Array.from(s.OUTREACH_HEADERS));
    assert.strictEqual(outreach.getLastRow(), 1);
  });
  run('it freezes the header and validates the four dropdown columns without adding rows', () => {
    assert.deepStrictEqual(frozen, [['Email', 1]]);
    // Left to right: Priority, then Status and Mode, once the six columns a human
    // reads and the two timestamps lead the table. Follow Up Status is the fourth,
    // two columns further right, with the booked day and the template between.
    assert.deepStrictEqual(validated.slice(-4),
      [[2, 10, 499, 1], [2, 11, 499, 1], [2, 12, 499, 1], [2, 15, 499, 1]]);
    assert.strictEqual(outreach.getLastRow(), 1);
  });
  run('Priority is the column left of Status, and Version is still last', () => {
    const header = Array.from(s.OUTREACH_HEADERS);
    assert.strictEqual(header[9], 'Priority');
    assert.strictEqual(header[10], 'Status');
    assert.strictEqual(header[header.length - 1], 'Version');
    assert.strictEqual(header.length, 23);
  });
  run('the three follow-up columns sit immediately after Mode', () => {
    const header = Array.from(s.OUTREACH_HEADERS);
    assert.strictEqual(header[11], 'Mode');
    assert.strictEqual(header[12], 'Follow Up');
    assert.strictEqual(header[13], 'Follow Up Template');
    assert.strictEqual(header[14], 'Follow Up Status');
    // And the audit references start straight after them, where they always were
    // relative to the machinery rather than to a fixed number.
    assert.strictEqual(header[15], 'Contact Fingerprint');
  });
  run('Follow Up Status is coloured by value, and Queued is left plain there too', () => {
    const rules = (formatRules['Email'] || [])
      .filter((r) => r.getRanges()[0].getColumn() === 15);
    assert.strictEqual(rules.length, 5);
    assert.ok(!rules.some((r) => r.text === 'Queued'));
    rules.forEach((r) => assert.ok(
      Array.from(s.OUTREACH_FOLLOWUP_STATUS).indexOf(r.text) !== -1, r.text));
  });
  run('Status and Mode are coloured by value, and Queued is left plain', () => {
    const rules = formatRules['Email'] || [];
    const status = rules.filter((r) => r.getRanges()[0].getColumn() === 11);
    const mode = rules.filter((r) => r.getRanges()[0].getColumn() === 12);
    assert.strictEqual(status.length, 6);
    assert.strictEqual(mode.length, 2);
    assert.ok(!status.some((r) => r.text === 'Queued'));
    assert.strictEqual(status.filter((r) => r.text === 'Replied')[0].background, '#D9EAD3');
    assert.strictEqual(status.filter((r) => r.text === 'Bounced')[0].fontColor, '#CC0000');
  });
  run('every colour rule names a status that really exists', () => {
    const named = (formatRules['Email'] || [])
      .filter((r) => r.getRanges()[0].getColumn() === 11).map((r) => r.text);
    named.forEach((name) => assert.ok(Array.from(s.OUTREACH_STATUS).indexOf(name) !== -1, name));
  });
  run('running it again is idempotent and does not stack a second set of rules', () => {
    const before = (formatRules['Email'] || []).length;
    s.setupOutreachQueue();
    assert.strictEqual(outreach.getLastRow(), 1);
    assert.strictEqual((formatRules['Email'] || []).length, before);
    assert.match(toasts[toasts.length - 1], /No queue items changed/);
  });
}

console.log('migrateOutreachPriorityColumn — opening a gap on a tab that is already live');
{
  // The tab exactly as it stood before Priority existed: Status at column 10.
  const OLD_HEADER = [
    'Company', 'Role', 'Date Applied', 'Property', 'Recruiters', 'Attempt',
    'Template', 'Drafted At', 'Scheduled At', 'Status', 'Mode',
    'Contact Fingerprint', 'Gmail Draft ID', 'Gmail Message ID', 'Sent At',
    'Result', 'Last Error', 'Queue ID', 'Version'
  ];
  const oldRow = (company, status) => [
    company, 'SWE Intern', 'Aug 1, 2026', '12', 3, 1, 'a', '', '', status, 'Send',
    'fp-' + company, 'draft-1', '', '', '', '', 'P12-A1', 1
  ];
  const freshOld = () => makeSheet('Email', [OLD_HEADER, oldRow('Acme', 'Sent'),
                                             oldRow('Stripe', 'Queued')]);

  {
    jobs = freshJobs(); app = freshApp();
    const s = load();
    outreach = freshOld();
    s.migrateOutreachPriorityColumn();

    run('the header ends up as the new layout, Priority ahead of Status', () => {
      assert.deepStrictEqual(outreach.grid[0], Array.from(s.OUTREACH_HEADERS));
    });
    run('every value to the right of both gaps moved with them', () => {
      // Two migrations in one call: Status was column 10 and is column 11, and
      // everything from Contact Fingerprint on moved three further right again.
      // This is the half a header rewrite over live data would have got wrong.
      assert.strictEqual(outreach.grid[1][9], '');
      assert.strictEqual(outreach.grid[1][10], 'Sent');
      assert.strictEqual(outreach.grid[1][11], 'Send');
      assert.strictEqual(outreach.grid[2][10], 'Queued');
      // The three new columns are opened empty. A migration adds a place to put
      // something; the planner is what puts anything in it.
      assert.strictEqual(outreach.grid[1][12], '');
      assert.strictEqual(outreach.grid[1][13], '');
      assert.strictEqual(outreach.grid[1][14], '');
      assert.strictEqual(outreach.grid[1][15], 'fp-Acme');
      assert.strictEqual(outreach.grid[1][16], 'draft-1');
      assert.strictEqual(outreach.grid[1][21], 'P12-A1');
      assert.strictEqual(outreach.grid[1][22], 1);
    });
    run('the rows themselves are left alone — a migration adds a column, not data', () => {
      assert.strictEqual(outreach.getLastRow(), 3);
      assert.strictEqual(outreach.grid[1][0], 'Acme');
      assert.strictEqual(outreach.grid[2][0], 'Stripe');
    });
    run('the colour rules follow Status and Mode rather than stacking at the old columns', () => {
      const rules = formatRules['Email'] || [];
      assert.strictEqual(rules.filter((r) => r.getRanges()[0].getColumn() === 10).length, 0);
      assert.strictEqual(rules.filter((r) => r.getRanges()[0].getColumn() === 11).length, 6);
      assert.strictEqual(rules.filter((r) => r.getRanges()[0].getColumn() === 12).length, 2);
    });
    run('the toast says to deploy the sender before the trigger goes back on', () => {
      assert.match(toasts[toasts.length - 1], /Deploy the sender now/);
    });
    run('running it again does not open a second gap', () => {
      const width = outreach.grid[0].length;
      s.migrateOutreachPriorityColumn();
      assert.strictEqual(outreach.grid[0].length, width);
      assert.deepStrictEqual(outreach.grid[0], Array.from(s.OUTREACH_HEADERS));
      assert.strictEqual(outreach.grid[1][10], 'Sent');
      assert.strictEqual(outreach.grid[1][15], 'fp-Acme');
      assert.match(toasts[toasts.length - 1], /already on the current layout/);
    });
  }

  {
    jobs = freshJobs(); app = freshApp();
    const s = load();
    outreach = makeSheet('Email', [OLD_HEADER.slice()]);
    outreach.grid[0][9] = 'Something Else';
    run('a tab somebody has already rearranged is refused, and named in the error', () => {
      assert.throws(() => s.migrateOutreachPriorityColumn(), /Something Else/);
    });
    run('the refusal moves nothing', () => {
      assert.strictEqual(outreach.grid[0].length, OLD_HEADER.length);
    });
  }

  {
    jobs = freshJobs(); app = freshApp();
    outreach = null;
    const s = load();
    run('with no Email tab at all it just builds the current layout', () => {
      s.migrateOutreachPriorityColumn();
      assert.deepStrictEqual(outreach.grid[0], Array.from(s.OUTREACH_HEADERS));
      assert.strictEqual(outreach.getLastRow(), 1);
    });
  }
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
  run('Completed OA is its own stage, not the OA line read loosely', () => {
    // Two stage names where one is a suffix of the other. Both the label lookup
    // and the history check compare whole names, so having taken the assessment
    // and having finished it stay two separate lines.
    assert.strictEqual(s.stageLabel('completed oa'), 'Completed OA');
    const cell = 'Applied: Jul 21, 2026\nOA: Aug 1, 2026';
    assert.strictEqual(s.hasStage(cell, 'Completed OA'), false);
    assert.strictEqual(s.hasStage(cell + '\nCompleted OA: Aug 9, 2026', 'OA'), true);
    assert.strictEqual(s.hasStage(cell + '\nCompleted OA: Aug 9, 2026', 'Completed OA'), true);
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
    assert.strictEqual(app.grid[4][11], 'Applied: ' + today());
  });
  run('the Update column is set to WRAP, or the cell would show only its first line', () => {
    assert.ok(wrapped.some((call) => call[0] === 12 && call[1] === 'WRAP'));
  });
}

console.log('onAppEdit');
{
  jobs = freshJobs();
  app = freshApp();
  const s = load();

  s.onEdit({ source: ss, range: app.getRange(3, 6, 1, 1) });   // Notion is at OA
  run('changing Process writes one "<Stage>: <date>" line', () => {
    assert.strictEqual(app.grid[2][11], 'OA: ' + today());
  });
  run('the toast names the date it just wrote', () => {
    assert.match(toasts[toasts.length - 1], /Wrote .+ to the Update column of 1 row/);
  });

  s.onEdit({ source: ss, range: app.getRange(3, 6, 1, 1) });
  run('firing again on the stage already set writes no further line', () => {
    assert.strictEqual(app.grid[2][11], 'OA: ' + today());
  });

  app.grid[2][5] = 'Completed OA';
  s.onEdit({ source: ss, range: app.getRange(3, 6, 1, 1) });
  run('finishing the assessment appends its own line under OA', () => {
    assert.strictEqual(app.grid[2][11], 'OA: ' + today() + '\nCompleted OA: ' + today());
  });

  app.grid[2][5] = 'Interview';
  s.onEdit({ source: ss, range: app.getRange(3, 6, 1, 1) });
  run('a new stage is appended below and the old ones are left as they were', () => {
    assert.strictEqual(
      app.grid[2][11],
      'OA: ' + today() + '\nCompleted OA: ' + today() + '\nInterview: ' + today());
  });

  app.grid[2][5] = 'OA';
  s.onEdit({ source: ss, range: app.getRange(3, 6, 1, 1) });
  run('going back to a stage already passed does not write it twice', () => {
    assert.strictEqual(app.grid[2][11].split('\n').length, 3);
  });

  const kept = app.grid[2][11];
  s.onEdit({ source: ss, range: app.getRange(3, 8, 1, 1) });   // the Note column
  run('an edit to another column leaves the Update column alone', () => {
    assert.strictEqual(app.grid[2][11], kept);
  });

  app.grid[2][5] = 'Offer';
  app.grid[3][5] = 'Phone screen';
  s.onEdit({ source: ss, range: app.getRange(3, 6, 2, 1) });
  run('inside one block a valid stage is written and an unrecognised value is not', () => {
    assert.match(app.grid[2][11], /Offer: /);
    assert.ok(!app.grid[3][11]);
  });
}

console.log('setupAppColumns');
{
  jobs = freshJobs();
  app = freshApp();
  const s = load();
  s.setupAppColumns();
  run('it builds the header in column L', () => {
    assert.strictEqual(app.grid[0][11], 'Update');
  });
  run('a row sitting at Applied takes its date from Date Applied', () => {
    assert.strictEqual(app.grid[1][11], 'Applied: July 21, 2026');
  });
  run('a row that has gone further marks the later stage ? rather than inventing a date', () => {
    assert.strictEqual(app.grid[2][11], 'Applied: July 26, 2026\nOA: ?');
  });
  run('a row with only a link and no Process is not an entry', () => {
    assert.ok(!app.grid[3][11]);
  });
  run('the toast counts the rows still needing to be filled in by hand separately', () => {
    assert.match(toasts[toasts.length - 1], /Filled in 2 rows.*1 at a stage past Applied/s);
  });
  run('it builds the header for Official and for the two checkbox columns', () => {
    assert.strictEqual(app.grid[0][8], 'Official');
    assert.strictEqual(app.grid[0][9], 'Alumni');
    assert.strictEqual(app.grid[0][10], 'Recruiter');
  });
  run('Official is wide enough to read, the checkboxes are narrow, Update is wide', () => {
    assert.deepStrictEqual(widths, [[9, 230], [10, 70], [11, 90], [12, 300]]);
  });
  run('the checkboxes cover only as far as the real last row, not to LAST_ROW', () => {
    // Covering to 500 would make the validation physically write FALSE all the way
    // down, getLastRow() would return 500, and onEdit would append new rows at 501.
    const boxes = validated.filter((call) => call[1] === 10);
    assert.strictEqual(boxes.length, 1);
    assert.deepStrictEqual(boxes[0], [2, 10, 3, 2]);  // J2:K4, exactly the 3 rows there are
  });
  run('the checkbox validation does not spill onto Official, which is free text', () => {
    // The trap: leave the range starting at column 9 and every pasted link comes
    // back as an invalid entry against a checkbox rule.
    assert.strictEqual(validated.filter((call) => call[1] === 9).length, 0);
  });

  const kept = app.grid[1][11];
  app.grid[2][11] = 'Applied: July 26, 2026\nOA: Aug 1, 2026';
  s.setupAppColumns();
  run('running again does not overwrite a cell that already has text', () => {
    assert.strictEqual(app.grid[1][11], kept);
    assert.strictEqual(app.grid[2][11], 'Applied: July 26, 2026\nOA: Aug 1, 2026');
  });
  run('the second run has nothing left to fill in', () => {
    assert.match(toasts[toasts.length - 1], /All four columns are already right/);
  });
}

console.log('setupAppColumns — a tab still on the layout before Official');
{
  jobs = freshJobs();
  app = freshApp();
  app.grid[0][8] = 'Alumni';
  app.grid[0][9] = 'Recruiter';
  app.grid[0][10] = 'Update';
  const s = load();
  run('it refuses rather than writing Official over the Alumni header', () => {
    // Writing the four headers blind here would leave every row's ticks and
    // history one column left of the name describing them — an alumnus recorded
    // at every company that merely has a recruiter.
    assert.throws(() => s.setupAppColumns(), /App column 9 is "Alumni"/);
  });
  run('and it says which function opens the gap', () => {
    assert.throws(() => s.setupAppColumns(), /migrateAppOfficialColumn/);
  });
  run('the refusal writes nothing', () => {
    assert.strictEqual(app.grid[0][8], 'Alumni');
    assert.deepStrictEqual(widths, []);
  });
}

console.log('setupAppColumns — moving the Update column from J to Update');
{
  jobs = freshJobs();
  app = freshApp();
  const s = load();
  // The sheet of someone who ran yesterday's version: the history is in column J.
  app.grid[0][9] = 'Update';
  app.grid[1][9] = 'Applied: Jul 21, 2026';
  app.grid[2][9] = 'Applied: Jul 26, 2026\nOA: Aug 1, 2026';
  s.setupAppColumns();

  run('the history lands under the Update header rather than one column short', () => {
    // The destination follows UPDATE_COL, which Official pushed from K to L.
    // Pinned to K, as it was written, this would drop a year of history into
    // Recruiter's column and leave Update empty beside it.
    assert.strictEqual(app.grid[0][11], 'Update');
    assert.strictEqual(app.grid[1][11], 'Applied: Jul 21, 2026');
    assert.strictEqual(app.grid[2][11], 'Applied: Jul 26, 2026\nOA: Aug 1, 2026');
  });
  run('the source stays column J, which is where these old sheets really keep it', () => {
    // Read through the constants the source would now be K, and every one of
    // these sheets would be told it had nothing to move.
    assert.strictEqual(app.grid[0][9], 'Alumni');
    assert.strictEqual(app.grid[1][9], '');
    assert.strictEqual(app.grid[2][9], '');
  });
  run('the toast says how many rows it moved', () => {
    assert.match(toasts[toasts.length - 1], /Moved 2 rows of history from column J to L/);
  });

  const kept = app.grid[2][11];
  s.setupAppColumns();
  run('running again does not move a second time — text in Update means stand still', () => {
    assert.strictEqual(app.grid[2][11], kept);
    assert.strictEqual(app.grid[0][9], 'Alumni');
  });
}

console.log('onEdit — a new row picks up the validation of both checkboxes');
{
  jobs = freshJobs();
  app = freshApp();
  const s = load();
  jobs.grid[3][APPLIED] = true;
  s.onEdit({ source: ss, range: jobs.getRange(4, APPLIED + 1, 1, 1) });
  run('validation is copied out to the end of Recruiter, not stopping at APP_WIDTH', () => {
    // APP_WIDTH is the eight columns the sync writes; the two checkboxes are
    // validation too, and Official pushed them a column right. Copying to 10
    // would now stop on Alumni and leave Recruiter printing a bare FALSE.
    assert.strictEqual(copied.length, 1);
    assert.strictEqual(copied[0][1], 'PASTE_DATA_VALIDATION');
    assert.strictEqual(copiedWidth, 11);
  });
}

console.log('setupReferralQueue');
{
  jobs = freshJobs();
  app = freshApp();
  referral = null;
  const s = load();
  s.setupReferralQueue();
  run('it creates the tab with the header only', () => {
    assert.ok(referral);
    assert.deepStrictEqual(referral.grid[0], Array.from(s.REFERRAL_HEADERS));
    assert.strictEqual(referral.getLastRow(), 1);
  });
  run('eighteen columns, with Status at 11 and Mode at 12', () => {
    const header = Array.from(s.REFERRAL_HEADERS);
    assert.strictEqual(header.length, 18);
    assert.strictEqual(header[10], 'Status');
    assert.strictEqual(header[11], 'Mode');
    assert.strictEqual(header[header.length - 1], 'Version');
  });
  run('the tab keeps the person, which the Email tab deliberately does not', () => {
    const header = Array.from(s.REFERRAL_HEADERS);
    assert.strictEqual(header[3], 'Person');
    assert.strictEqual(header[4], 'Email');
    assert.strictEqual(header[5], 'Title');
    assert.strictEqual(Array.from(s.OUTREACH_HEADERS).indexOf('Person'), -1);
  });
  run('the three timestamps are the pair plus the one that says it went', () => {
    const header = Array.from(s.REFERRAL_HEADERS);
    assert.strictEqual(header[8], 'Drafted At');
    assert.strictEqual(header[9], 'Scheduled At');
    assert.strictEqual(header[13], 'Sent At');
  });
  // Between Mode and Sent At, because that is where it happens: the draft exists
  // under this id for an hour, and deleting it in Gmail is what calls the message
  // off. Result is left to hold one kind of thing.
  run('the draft has a column of its own rather than borrowing Result', () => {
    const header = Array.from(s.REFERRAL_HEADERS);
    assert.strictEqual(header[12], 'Gmail Draft ID');
    assert.strictEqual(header[14], 'Result');
  });
  run('it freezes the header and validates Tier, Status and Mode without adding rows', () => {
    assert.deepStrictEqual(frozen, [['Referral', 1]]);
    assert.deepStrictEqual(validated, [[2, 7, 499, 1], [2, 11, 499, 1], [2, 12, 499, 1]]);
    assert.strictEqual(referral.getLastRow(), 1);
  });
  run('every column gets a width', () => {
    assert.strictEqual(widths.length, 18);
    assert.deepStrictEqual(widths.map((w) => w[0]),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
  });
  run('Status wears the Email tab colours, and Queued is left plain there too', () => {
    const rules = (formatRules['Referral'] || [])
      .filter((r) => r.getRanges()[0].getColumn() === 11);
    assert.strictEqual(rules.length, 6);
    assert.ok(!rules.some((r) => r.text === 'Queued'));
    rules.forEach((r) => assert.ok(Array.from(s.OUTREACH_STATUS).indexOf(r.text) !== -1, r.text));
    assert.strictEqual(rules.filter((r) => r.text === 'Replied')[0].background, '#D9EAD3');
  });
  run('the tier list is the four rungs, in order', () => {
    assert.deepStrictEqual(Array.from(s.REFERRAL_TIER), ['peer', 'mid', 'senior', 'staff']);
  });
  run('running it again is idempotent and does not stack a second set of rules', () => {
    const before = (formatRules['Referral'] || []).length;
    s.setupReferralQueue();
    assert.strictEqual(referral.getLastRow(), 1);
    assert.strictEqual((formatRules['Referral'] || []).length, before);
    assert.match(toasts[toasts.length - 1], /No rows changed/);
  });
}

console.log('setupReferralQueue — a header that means a different table');
{
  jobs = freshJobs();
  app = freshApp();
  referral = makeSheet('Referral', [
    ['Company', 'Role', 'Referrer Notes', 'Person', 'Email', 'Title', 'Tier']
  ]);
  const s = load();
  run('it refuses rather than writing its own header over somebody else\'s', () => {
    assert.throws(() => s.setupReferralQueue(), /Referral column 3 is "Referrer Notes"/);
  });
  run('and the foreign header is still there afterwards', () => {
    assert.strictEqual(referral.grid[0][2], 'Referrer Notes');
  });
}


// The App tab exactly as it stood before Official existed: Alumni at I, and a
// column of the operator's own past Update, because a migration that only ever
// meets the columns this tool knows about has not met the real tab.
const PRE_OFFICIAL_HEADER = [
  'Property', 'Company', 'Application Link', 'Date Applied', 'Location (State)',
  'Process', 'Role', 'Note', 'Alumni', 'Recruiter', 'Update', 'Follow up'
];
const preOfficialRow = (property, company, link) => [
  property, company, link, 'July 21, 2026', 'NY', 'Applied', 'SWE Intern',
  'via the careers page', true, false, 'Applied: July 21, 2026', 'ping Dana'
];
// App column F, ahead of the gap, so a rule there is the control: it proves the
// insert moved what sits behind it and left what sits in front alone.
const PROCESS_COLUMN = 6;
// A conditional-format rule shaped the way the sheet hands them back, so that the
// insert can be asked whether the rules travelled with the columns they colour.
const ruleAt = (column, name) => ({ name, getRanges: () => [{ getColumn: () => column }] });

console.log('migrateAppOfficialColumn — opening a gap on a tab that is already live');
{
  jobs = freshJobs();
  app = makeSheet('App', [
    PRE_OFFICIAL_HEADER,
    preOfficialRow(1, 'IBM', 'https://job-boards.greenhouse.io/ibm/jobs/9'),
    preOfficialRow(2, 'Notion', 'https://jobs.ashbyhq.com/notion/1/'),
  ]);
  const s = load();
  formatRules['App'] = [ruleAt(PROCESS_COLUMN, 'Process'), ruleAt(11, 'Update')];
  s.migrateAppOfficialColumn();

  run('the header ends up as the new layout, Official between Note and Alumni', () => {
    assert.deepStrictEqual(app.grid[0].slice(7, 12),
      ['Note', 'Official', 'Alumni', 'Recruiter', 'Update']);
  });
  run('every value to the right of the gap moved with it', () => {
    // This is the half a header rewrite over live data would have got wrong: the
    // tick would stay at I under the name Official, and the row would read as an
    // application with a pasted link and no alumnus.
    assert.strictEqual(app.grid[1][8], '');          // Official, opened empty
    assert.strictEqual(app.grid[1][9], true);        // Alumni, the tick that was at I
    assert.strictEqual(app.grid[1][10], false);      // Recruiter
    assert.strictEqual(app.grid[1][11], 'Applied: July 21, 2026');
    assert.strictEqual(app.grid[2][9], true);
  });
  run("a column of the operator's own past Update moved too", () => {
    assert.strictEqual(app.grid[0][12], 'Follow up');
    assert.strictEqual(app.grid[1][12], 'ping Dana');
  });
  run('the rows themselves are left alone — a migration adds a column, not data', () => {
    assert.strictEqual(app.getLastRow(), 3);
    assert.strictEqual(app.grid[1][1], 'IBM');
    assert.strictEqual(app.grid[2][1], 'Notion');
    assert.strictEqual(app.grid[1][7], 'via the careers page');
  });
  run('the colour rules follow the columns they colour rather than staying put', () => {
    const rules = formatRules['App'] || [];
    const columnOf = (name) =>
      rules.filter((r) => r.name === name)[0].getRanges()[0].getColumn();
    assert.strictEqual(columnOf('Process'), PROCESS_COLUMN);  // ahead of the gap
    assert.strictEqual(columnOf('Update'), 12);               // behind it, moved one right
  });
  run('the checkbox validation is rebuilt where the ticks now are, not where they were', () => {
    // Left at I it would put a checkbox rule under every pasted link, and every
    // link would read back as an invalid entry.
    const boxes = validated.filter((call) => call[1] === 10);
    assert.strictEqual(boxes.length, 1);
    assert.deepStrictEqual(boxes[0], [2, 10, 2, 2]);
    assert.strictEqual(validated.filter((call) => call[1] === 9).length, 0);
  });
  run('Official gets its width at the column it was opened at', () => {
    assert.deepStrictEqual(widths, [[9, 230], [10, 70], [11, 90], [12, 300]]);
  });
  run('the toast says to deploy the Python half before the next sync', () => {
    assert.match(toasts[toasts.length - 1], /deploy the Python half/);
  });
  run('running it again does not open a second gap', () => {
    const width = app.grid[0].length;
    s.migrateAppOfficialColumn();
    assert.strictEqual(app.grid[0].length, width);
    assert.deepStrictEqual(app.grid[0].slice(7, 13),
      ['Note', 'Official', 'Alumni', 'Recruiter', 'Update', 'Follow up']);
    assert.strictEqual(app.grid[1][9], true);
    assert.strictEqual(app.grid[1][11], 'Applied: July 21, 2026');
    assert.match(toasts[toasts.length - 1], /already on the current layout/);
  });
}

console.log('migrateAppOfficialColumn — a layout it does not recognise');
{
  jobs = freshJobs();
  app = makeSheet('App', [PRE_OFFICIAL_HEADER.slice()]);
  app.grid[0][8] = 'Referral Link';
  const s = load();
  run('a tab somebody has already put a column of their own at I is refused', () => {
    assert.throws(() => s.migrateAppOfficialColumn(), /App column 9 is "Referral Link"/);
  });
  run('the error says what it expected there, so the fix does not need the source', () => {
    assert.throws(() => s.migrateAppOfficialColumn(), /"Alumni" or "Official"/);
  });
  run('the refusal moves nothing', () => {
    assert.strictEqual(app.grid[0].length, PRE_OFFICIAL_HEADER.length);
    assert.strictEqual(app.grid[0][8], 'Referral Link');
    assert.deepStrictEqual(widths, []);
  });
}

console.log('migrateAppOfficialColumn — a half-built layout is not the layout either');
{
  jobs = freshJobs();
  // Alumni is where it should be, but the two behind it are not: the shape a run
  // that died partway leaves. Inserting on the strength of column I alone would
  // shift this into something no version of the tab has ever been.
  app = makeSheet('App', [PRE_OFFICIAL_HEADER.slice()]);
  app.grid[0][9] = 'Update';
  app.grid[0][10] = '';
  const s = load();
  run('it reads the columns behind the gap before it opens one', () => {
    assert.throws(() => s.migrateAppOfficialColumn(), /App column 10 is "Update"/);
  });
  run('and nothing is inserted', () => {
    assert.strictEqual(app.grid[0].length, PRE_OFFICIAL_HEADER.length);
  });
}

console.log('migrateAppOfficialColumn — a tab that has never been set up');
{
  jobs = freshJobs();
  app = freshApp();     // A..H and nothing else
  const s = load();
  run('a blank column I is not an error: there is nothing to shift', () => {
    assert.doesNotThrow(() => s.migrateAppOfficialColumn());
    assert.deepStrictEqual(app.grid[0].slice(8, 12),
      ['Official', 'Alumni', 'Recruiter', 'Update']);
  });
  run('and no gap was opened, so column H still holds Note', () => {
    assert.strictEqual(app.grid[0][7], 'Note');
    assert.match(toasts[toasts.length - 1], /already on the current layout/);
  });
}

console.log('appOfficialNeedsLink_');
{
  jobs = freshJobs();
  app = freshApp();
  const s = load();
  const needs = s.appOfficialNeedsLink_;
  run('an application with neither link is the whole point of the colour', () => {
    assert.strictEqual(needs('Stripe', '', ''), true);
  });
  run('a link in Application Link is already something to send, so the row stays plain', () => {
    assert.strictEqual(needs('Stripe', 'https://boards.example/j', ''), false);
  });
  run('a link in Official answers it just as well', () => {
    assert.strictEqual(needs('Stripe', '', 'https://stripe.example/careers/1'), false);
  });
  run('a row with no company is not an application, so it is never painted', () => {
    // App really does carry rows holding nothing but a link. There is nobody to
    // ask about one, so putting it at the top of the tab is work that cannot be done.
    assert.strictEqual(needs('', 'https://bambusdev.example/job/1', ''), false);
    assert.strictEqual(needs('', '', ''), false);
    assert.strictEqual(needs(null, '', ''), false);
    assert.strictEqual(needs('   ', '', ''), false);
  });
  run('a cell holding something that is not a link does not count as one', () => {
    assert.strictEqual(needs('Stripe', 'ask Dan', ''), true);
    assert.strictEqual(needs('Stripe', '   ', '  '), true);
    assert.strictEqual(needs('Stripe', 'greenhouse.io/stripe', ''), true);
  });
  run('https counts, and so does a link with the case written oddly', () => {
    assert.strictEqual(needs('Stripe', 'https://boards.example/j', ''), false);
    assert.strictEqual(needs('Stripe', '  HTTP://boards.example/j ', ''), false);
  });
  run('the rule stops at "starts with http" — the ATS judgement is not made here', () => {
    // An aggregator link is a link as far as this file is concerned. Telling one
    // from an employer's own board is the sender project's judgement, and a second
    // copy of it here is two copies that drift with nothing to catch it.
    assert.strictEqual(needs('Stripe', 'https://jobright.ai/jobs/info/abc', ''), false);
  });
}

// The App tab on the current layout. Named row shapes rather than twelve cells
// written out each time, because what matters about each row is only whether it
// needs an official link, and spelling that out in full buries the case tested.
const APP_FULL_HEADER = [
  'Property', 'Company', 'Application Link', 'Date Applied', 'Location (State)',
  'Process', 'Role', 'Note', 'Official', 'Alumni', 'Recruiter', 'Update'
];
const appNeedsLink = (company) =>
  [1, company, '', 'July 21, 2026', 'NY', 'Applied', 'SWE Intern', '', '',
   false, false, 'Applied: July 21, 2026'];
const appHasLink = (company) =>
  [1, company, 'https://boards.example/' + company, 'July 21, 2026', 'NY', 'Applied',
   'SWE Intern', '', '', false, false, 'Applied: July 21, 2026'];
const appHasOfficial = (company) =>
  [1, company, 'https://jobright.ai/jobs/info/' + company, 'July 21, 2026', 'NY',
   'Applied', 'SWE Intern', '', 'https://' + company + '.example/careers/1',
   false, false, 'Applied: July 21, 2026'];
// What an untouched row on a set-up App tab actually reads back as: no text
// anywhere, and two unticked checkboxes that come back false rather than blank.
const blankAppRow = () => ['', '', '', '', '', '', '', '', '', false, false, ''];
const YELLOW = '#FFF2CC';
// vm.runInContext gives the .gs file a realm of its own, so an array it built
// carries that realm's Array prototype, and deepStrictEqual compares prototypes
// before it compares contents — an answer that is exactly right still fails
// against a literal written out here. These copy the answer back into this realm
// so the assertion is about the order and nothing else. Company is column B on
// App, so it is index 1 rather than the 0 the Jobs tab had.
const names = (rows) => Array.from(rows, (r) => r[1]);
const rowsOf = (rows) => Array.from(rows);

console.log('paintAppOfficialRows');
{
  jobs = freshJobs();
  app = makeSheet('App', [
    APP_FULL_HEADER,
    // No link either side: this is the row the colour exists for. Already at the
    // top, so the sort that follows the paint has nothing to do and the write
    // count is the paint's alone.
    appNeedsLink('Stripe'),
    // Application Link already goes somewhere.
    appHasLink('IBM'),
    // An aggregator link, but the employer's own has been found by hand.
    appHasOfficial('Notion'),
    // The stray row App really carries: a link and no company.
    ['', '', 'https://bambusdev.example/job/1', '', '', '', '', '', '', false, false, ''],
  ]);
  const s = load();
  s.paintAppOfficialRows();

  run('the whole block is painted in one write, not one call per row', () => {
    assert.strictEqual(painted.length, 1);
    assert.deepStrictEqual(painted[0], [2, 1, 4, 12]);
  });
  run('the application with no employer link goes yellow across A..L', () => {
    assert.deepStrictEqual(app.colours[1], new Array(12).fill(YELLOW));
  });
  run('the three rows that do not need one are cleared, not painted white', () => {
    // White is a colour, and it would paint over whatever banding or manual
    // highlight the row already had.
    [2, 3, 4].forEach((i) => assert.deepStrictEqual(app.colours[i], new Array(12).fill(null)));
  });
  run('the header row is never touched', () => {
    assert.deepStrictEqual(app.colours[0], []);
  });
  run('the paint stops at Update, where the tool stops owning the row', () => {
    assert.strictEqual(app.colours[1].length, 12);
  });
  run('a tab with no rows yet says so instead of throwing', () => {
    app = makeSheet('App', [APP_FULL_HEADER]);
    const s2 = load();
    assert.doesNotThrow(() => s2.paintAppOfficialRows());
    assert.match(toasts[toasts.length - 1], /has no rows yet/);
  });
}

console.log('orderAppOfficialRows_ — the ordering on its own, no sheet');
{
  const s = load();
  const rows = [appNeedsLink('A'), appHasLink('X'), appNeedsLink('B'),
                appHasOfficial('Y'), appNeedsLink('C')];
  const out = s.orderAppOfficialRows_(rows);

  run('the rows needing a link come first and the rest follow', () => {
    assert.deepStrictEqual(names(out), ['A', 'B', 'C', 'X', 'Y']);
  });
  run('the yellow group keeps the order it was already in', () => {
    // Identity, not equality: the point is that these are the same row objects in
    // the same sequence, so a sort that rebuilt the group from a comparator would
    // fail here even if it happened to produce equal-looking rows.
    assert.strictEqual(out[0], rows[0]);
    assert.strictEqual(out[1], rows[2]);
    assert.strictEqual(out[2], rows[4]);
  });
  run('the rest keeps the order it was already in', () => {
    assert.strictEqual(out[3], rows[1]);
    assert.strictEqual(out[4], rows[3]);
  });
  run('nothing is dropped and nothing is duplicated', () => {
    assert.strictEqual(out.length, rows.length);
    assert.deepStrictEqual(names(out).sort(), ['A', 'B', 'C', 'X', 'Y']);
  });
}

console.log('orderAppOfficialRows_ — yellow rows scattered through the middle');
{
  const s = load();
  const rows = [
    appHasLink('P'), appHasLink('Q'), appNeedsLink('A'), appHasLink('R'),
    appNeedsLink('B'), appHasLink('S'), appHasLink('T'), appNeedsLink('C'), appHasLink('U'),
  ];
  const out = s.orderAppOfficialRows_(rows);
  run('three rows pulled out of the middle arrive at the top in their old order', () => {
    assert.deepStrictEqual(names(out), ['A', 'B', 'C', 'P', 'Q', 'R', 'S', 'T', 'U']);
  });
  run('and the six left behind close up without changing places', () => {
    assert.deepStrictEqual(names(out).slice(3), ['P', 'Q', 'R', 'S', 'T', 'U']);
  });
}

console.log('orderAppOfficialRows_ — the empty tail');
{
  const s = load();
  const rows = [
    appHasLink('P'), appNeedsLink('A'), appHasLink('Q'), appNeedsLink('B'),
    blankAppRow(), blankAppRow(), blankAppRow(),
  ];
  const out = s.orderAppOfficialRows_(rows);

  run('the blank rows stay at the bottom instead of sorting in with the rest', () => {
    assert.deepStrictEqual(names(out), ['A', 'B', 'P', 'Q', '', '', '']);
  });
  run('a row that is only two unticked checkboxes still counts as blank', () => {
    // The trap this guards: false is a value, and the Python half writes FALSE
    // down both columns across every row it covers. Reading that as content would
    // make an empty row look occupied, so it would never be pinned to the bottom
    // and would sort in among the applications as though it were one.
    assert.strictEqual(s.appRowIsEmpty_(blankAppRow()), true);
    assert.strictEqual(s.appRowIsEmpty_(appHasLink('P')), false);
  });
  run('a blank row with real rows still under it keeps its place', () => {
    // Only the trailing blanks are pinned. A gap in the middle is something
    // somebody left there, and sinking it would be exactly the reshuffle the
    // stability rule exists to prevent.
    const gapped = [appHasLink('P'), blankAppRow(), appHasLink('Q'), appNeedsLink('A')];
    assert.deepStrictEqual(names(s.orderAppOfficialRows_(gapped)), ['A', 'P', '', 'Q']);
  });
  run('a tab that is nothing but blank rows is left completely alone', () => {
    const empty = [blankAppRow(), blankAppRow(), blankAppRow()];
    assert.deepStrictEqual(rowsOf(s.orderAppOfficialRows_(empty)), empty);
  });
  run('running the ordering on its own output changes nothing', () => {
    assert.deepStrictEqual(rowsOf(s.orderAppOfficialRows_(out)), rowsOf(out));
  });
}

console.log('sortAppOfficialRowsToTop');
{
  jobs = freshJobs();
  app = makeSheet('App', [
    APP_FULL_HEADER,
    appHasLink('IBM'),
    // Two applications needing a link, sitting where they are easiest to miss:
    // buried in the middle with ordinary rows above and below them.
    appNeedsLink('Stripe'),
    appHasOfficial('Neuralink'),
    appNeedsLink('Ramp'),
    appHasLink('Notion'),
    blankAppRow(),
    blankAppRow(),
  ]);
  const s = load();
  s.sortAppOfficialRowsToTop();

  run('the two rows needing a link are now the first two rows of the tab', () => {
    assert.deepStrictEqual(app.grid.slice(1, 3).map((r) => r[1]), ['Stripe', 'Ramp']);
  });
  run('the three that do not need one keep their order underneath', () => {
    assert.deepStrictEqual(app.grid.slice(3, 6).map((r) => r[1]),
      ['IBM', 'Neuralink', 'Notion']);
  });
  run('the header row is not part of the sort', () => {
    assert.deepStrictEqual(app.grid[0], APP_FULL_HEADER);
  });
  run('the whole block moves in one write, not one move per row', () => {
    // A sort that dies halfway leaves applications duplicated above and missing
    // below, and App is the source of truth for what has been applied to.
    assert.strictEqual(wrote.length, 1);
    assert.deepStrictEqual(wrote[0], [2, 1, 7, 12]);
  });
  run('the block stops at the last row, so nothing is written below the data', () => {
    // Out to LAST_ROW the way the Jobs sweep went, this would leave hundreds of
    // written-and-emptied rows and onEdit would append the next application
    // underneath all of them.
    assert.strictEqual(app.grid.length, 8);
  });
  run('the yellow lands on the rows that moved, not on the lines they left', () => {
    // The failure this catches is the one worth having the test for: sort the
    // values and leave the colours behind and the tab paints IBM and Neuralink
    // yellow while Stripe and Ramp sit at the top looking finished.
    assert.deepStrictEqual(app.colours[1], new Array(12).fill(YELLOW));
    assert.deepStrictEqual(app.colours[2], new Array(12).fill(YELLOW));
    [3, 4, 5].forEach((i) =>
      assert.deepStrictEqual(app.colours[i], new Array(12).fill(null)));
  });
  run('the blank rows are still blank and still at the bottom', () => {
    assert.strictEqual(s.appRowIsEmpty_(app.grid[6]), true);
    assert.strictEqual(s.appRowIsEmpty_(app.grid[7]), true);
  });
  run('a second run writes nothing and paints nothing', () => {
    const wroteBefore = wrote.length;
    const paintedBefore = painted.length;
    const before = app.grid.map((r) => r.slice());
    s.sortAppOfficialRowsToTop();
    assert.strictEqual(wrote.length, wroteBefore);
    assert.strictEqual(painted.length, paintedBefore);
    assert.deepStrictEqual(app.grid, before);
  });
}

console.log('sortAppOfficialRowsToTop — a column the tool does not own');
{
  jobs = freshJobs();
  app = makeSheet('App', [
    APP_FULL_HEADER.concat(['Follow up']),
    appHasLink('IBM').concat(['asked Dana in July']),
    appNeedsLink('Stripe').concat(['nobody found yet']),
  ]);
  const s = load();
  s.sortAppOfficialRowsToTop();

  run('the block widens to the real last column rather than stopping at Update', () => {
    assert.deepStrictEqual(wrote[0], [2, 1, 2, 13]);
  });
  run("an operator's note in column M travels with its own row", () => {
    // Left behind, Stripe would arrive at the top wearing IBM's note — one
    // application's notes silently reattached to another, which is worse than
    // losing them, because nothing about the tab looks wrong afterwards.
    assert.deepStrictEqual(app.grid.slice(1, 3).map((r) => [r[1], r[12]]),
      [['Stripe', 'nobody found yet'], ['IBM', 'asked Dana in July']]);
  });
  run('the history in Update travels with its row too', () => {
    assert.strictEqual(app.grid[1][11], 'Applied: July 21, 2026');
  });
  run('the paint still stops at Update, where the tool stops owning the row', () => {
    assert.strictEqual(app.colours[1].length, 12);
    assert.deepStrictEqual(app.colours[1], new Array(12).fill(YELLOW));
  });
}

console.log('onEdit — pasting an official link into column I clears the colour');
{
  jobs = freshJobs();
  app = makeSheet('App', [
    APP_FULL_HEADER,
    appNeedsLink('Stripe'),
    appNeedsLink('Ramp'),
  ]);
  const s = load();
  s.paintAppOfficialRows();
  app.grid[1][8] = 'https://stripe.example/careers/1';
  s.onEdit({ source: ss, range: app.getRange(2, 9, 1, 1) });

  run('only the edited row is repainted, and it loses its yellow', () => {
    assert.strictEqual(painted.length, 2);
    assert.deepStrictEqual(painted[1], [2, 1, 1, 12]);
    assert.deepStrictEqual(app.colours[1], new Array(12).fill(null));
  });
  run('the row nobody touched keeps its colour', () => {
    assert.deepStrictEqual(app.colours[2], new Array(12).fill(YELLOW));
  });
  run('clearing the cell again brings the colour back', () => {
    app.grid[1][8] = '';
    s.onEdit({ source: ss, range: app.getRange(2, 9, 1, 1) });
    assert.deepStrictEqual(app.colours[1], new Array(12).fill(YELLOW));
  });
  run('an edit landing in the Update column repaints nothing', () => {
    const before = painted.length;
    s.onEdit({ source: ss, range: app.getRange(3, 12, 1, 1) });
    assert.strictEqual(painted.length, before);
  });
  run('an edit in the Process column still writes its history and paints nothing', () => {
    const before = painted.length;
    app.grid[2][5] = 'OA';
    s.onEdit({ source: ss, range: app.getRange(3, 6, 1, 1) });
    assert.strictEqual(painted.length, before);
    assert.match(app.grid[2][11], /OA: /);
  });
  run('a fill-down across Official repaints those rows in one write', () => {
    const before = painted.length;
    s.onEdit({ source: ss, range: app.getRange(2, 9, 2, 1) });
    assert.strictEqual(painted.length, before + 1);
    assert.deepStrictEqual(painted[painted.length - 1], [2, 1, 2, 12]);
  });
  run('a paste across the whole row reaches Official and repaints it', () => {
    const before = painted.length;
    s.onEdit({ source: ss, range: app.getRange(2, 1, 1, 12) });
    assert.strictEqual(painted.length, before + 1);
  });
  run('an edit on the header row alone never paints row 1', () => {
    const before = painted.length;
    s.onEdit({ source: ss, range: app.getRange(1, 9, 1, 1) });
    assert.strictEqual(painted.length, before);
  });
}

console.log('paintAppOfficialRows sorts, onEdit does not');
{
  jobs = freshJobs();
  app = makeSheet('App', [
    APP_FULL_HEADER,
    appHasLink('IBM'),
    appNeedsLink('Stripe'),
  ]);
  const s = load();
  s.paintAppOfficialRows();

  run('the full repaint brings the row needing a link to the top', () => {
    assert.deepStrictEqual(app.grid.slice(1, 3).map((r) => r[1]), ['Stripe', 'IBM']);
  });
  run('and repaints once the rows have moved, so the colour follows them', () => {
    assert.strictEqual(painted.length, 2);
    assert.deepStrictEqual(app.colours[1], new Array(12).fill(YELLOW));
    assert.deepStrictEqual(app.colours[2], new Array(12).fill(null));
  });
  run('pasting a link into Official repaints the row but does not move it', () => {
    // Sorting inside onEdit would pull the row out from under the cursor while
    // the person is still typing in it, and the next paste would land on whatever
    // row slid into its place. The colour has to be immediate; the position waits
    // for the next full repaint.
    const wroteBefore = wrote.length;
    app.grid[1][8] = 'https://stripe.example/careers/1';
    s.onEdit({ source: ss, range: app.getRange(2, 9, 1, 1) });
    assert.strictEqual(wrote.length, wroteBefore);
    assert.deepStrictEqual(app.grid.slice(1, 3).map((r) => r[1]), ['Stripe', 'IBM']);
    assert.deepStrictEqual(app.colours[1], new Array(12).fill(null));
  });
  run('a row that stops needing a link keeps its place rather than being demoted', () => {
    // Stability cuts both ways. Nothing on the tab needs a link now, so the whole
    // block is one group and the order somebody was working in survives the
    // repaint — a sort asked only to bring yellow to the top has no business
    // moving a row that has merely stopped being yellow.
    s.paintAppOfficialRows();
    assert.deepStrictEqual(app.grid.slice(1, 3).map((r) => r[1]), ['Stripe', 'IBM']);
    assert.deepStrictEqual(app.colours[1], new Array(12).fill(null));
    assert.deepStrictEqual(app.colours[2], new Array(12).fill(null));
  });
  run('a new application lands at the bottom and onEdit leaves it there', () => {
    // The whole reason the repaint is on a clock: App only ever grows, so every
    // application sent puts a fresh row under the block somebody is working down.
    app.grid.push(appNeedsLink('Ramp'));
    const wroteBefore = wrote.length;
    s.onEdit({ source: ss, range: app.getRange(4, 9, 1, 1) });
    assert.strictEqual(wrote.length, wroteBefore);
    assert.deepStrictEqual(app.colours[3], new Array(12).fill(YELLOW));
    assert.deepStrictEqual(names(app.grid.slice(1, 4)), ['Stripe', 'IBM', 'Ramp']);
  });
  run('and the next full repaint is what brings it to the top', () => {
    s.paintAppOfficialRows();
    assert.deepStrictEqual(names(app.grid.slice(1, 4)), ['Ramp', 'Stripe', 'IBM']);
    assert.deepStrictEqual(app.colours[1], new Array(12).fill(YELLOW));
    assert.deepStrictEqual(app.colours[2], new Array(12).fill(null));
    assert.deepStrictEqual(app.colours[3], new Array(12).fill(null));
  });
}

console.log('migrateAppOfficialColumn — the checkbox the insert brings with it');
{
  jobs = freshJobs();
  app = makeSheet('App', [
    ['Property', 'Company', 'Application Link', 'Date Applied', 'Location (State)',
     'Process', 'Role', 'Note', 'Alumni', 'Recruiter', 'Update'],
    ['1', 'Uber', 'https://x', 'July 21, 2026', 'CA', 'Rejected', 'SWE Intern', '',
     false, true, 'Applied: Jul 21, 2026'],
    ['2', 'Figma', 'https://y', 'Aug 10, 2026', 'CA', 'Applied', 'SWE Intern', '',
     true, false, 'Applied: Aug 10, 2026']
  ]);
  const s = load();
  s.migrateAppOfficialColumn();

  // A column inserted beside a checkbox column inherits that column's data
  // validation, so every row of Official comes up holding an unticked box: three
  // hundred cells reading FALSE in the column whose whole purpose is to hold a
  // pasted URL. It looks like data, it is not, and the sender reads it as a link
  // that fails every rule, for a reason nothing on the sheet explains.
  run('the inherited checkbox is stripped from the new column', () => {
    const onOfficial = cleared.filter((c) => c[1] === s.APP_OFFICIAL);
    assert.ok(onOfficial.length >= 1, 'nothing was cleared on column ' + s.APP_OFFICIAL);
    // The whole column, not only the rows holding data today: the validation
    // covers the column, so a row added tomorrow would arrive wearing the box.
    assert.strictEqual(onOfficial[0][0], 1);
    assert.ok(onOfficial[0][2] >= app.grid.length);
  });

  run('and Official is left genuinely empty below its header', () => {
    for (let r = 1; r < app.grid.length; r++) {
      const cell = app.grid[r][s.APP_OFFICIAL - 1];
      assert.ok(cell === '' || cell === undefined || cell === null,
                'row ' + (r + 1) + ' holds ' + JSON.stringify(cell));
    }
  });

  run('the three columns behind it keep their own values', () => {
    assert.strictEqual(app.grid[1][s.ALUMNI_COL - 1], false);
    assert.strictEqual(app.grid[1][s.RECRUITER_COL - 1], true);
    assert.strictEqual(app.grid[1][s.UPDATE_COL - 1], 'Applied: Jul 21, 2026');
    assert.strictEqual(app.grid[2][s.ALUMNI_COL - 1], true);
    assert.strictEqual(app.grid[2][s.RECRUITER_COL - 1], false);
  });
}
