const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const SRC = require('path').join(__dirname, 'sync_applied_to_app.gs');

function makeSheet(name, data) {
  const grid = data.map((r) => r.slice());
  const sheet = {
    grid,
    getName: () => name,
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
        setNumberFormat() { return this; },
        setDataValidation() { return this; },
        copyTo(dest, type) { copied.push([row, type]); return this; },
      };
    },
  };
  return sheet;
}

let copied = [];
let toasts = [];
let jobs, app, ss;

function load() {
  copied = [];
  toasts = [];
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
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox);
  return sandbox;
}

const JOBS_HEADER = ['Company', 'Role', 'Link Apply', 'Date Posted', 'Applied', 'Expired'];
const APP_HEADER = ['Property', 'Company', 'Application Link', 'Date Applied',
                    'Location (State)', 'Process', 'Role', 'Note'];

function freshJobs() {
  return makeSheet('Jobs', [
    JOBS_HEADER,
    // App có job này nhưng dưới link greenhouse, còn Jobs đang giữ link jobright.
    ['IBM', 'Software Engineering Intern', 'https://jobright.ai/jobs/info/abc', '2026-08-14', false, false],
    // Cùng link với App, chỉ khác dấu / cuối và utm.
    ['Notion', 'Software Engineer Intern',
     'https://jobs.ashbyhq.com/notion/1?utm_source=Simplify', '2026-08-15', false, false],
    // Chưa nộp bao giờ.
    ['Neuralink', 'Firmware Engineer Intern', 'https://jobright.ai/jobs/info/xyz', '2026-08-16', false, false],
  ]);
}

function freshApp() {
  return makeSheet('App', [
    APP_HEADER,
    [1, 'IBM', 'https://job-boards.greenhouse.io/ibm/jobs/9', 'July 21, 2026', '', 'Applied',
     'Software Engineering  Intern', ''],
    [2, 'Notion', 'https://jobs.ashbyhq.com/notion/1/', 'July 26, 2026', '', 'OA',
     'Software Engineer Intern', ''],
    // Dòng rác chỉ có link, giống mấy dòng đang có thật trong App.
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
  run('utm và dấu / cuối không làm hai link thành hai job', () => {
    assert.strictEqual(
      s.normalizeLink('https://jobs.ashbyhq.com/notion/1?utm_source=Simplify&ref=Simplify'),
      s.normalizeLink('https://JOBS.ashbyhq.com/notion/1/')
    );
  });
  run('param định danh chính bài tuyển thì phải giữ', () => {
    assert.notStrictEqual(
      s.normalizeLink('https://boards.example/j?gh_jid=1'),
      s.normalizeLink('https://boards.example/j?gh_jid=2')
    );
  });
  run('dấu câu và khoảng trắng thừa không tách một job thành hai', () => {
    assert.strictEqual(
      s.identity('IBM', 'Software Engineering  Intern'),
      s.identity('ibm.', 'Software-Engineering Intern')
    );
  });
  run('thiếu company hoặc role thì không có identity để khớp', () => {
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
  run('Notion được tick qua link, IBM qua company + role', () => {
    assert.strictEqual(jobs.grid[1][4], true, 'IBM');
    assert.strictEqual(jobs.grid[2][4], true, 'Notion');
  });
  run('job chưa nộp thì để nguyên', () => {
    assert.strictEqual(jobs.grid[3][4], false, 'Neuralink');
  });
  run('toast tách riêng hai kiểu khớp', () => {
    assert.match(toasts[0], /2 dòng: 1 khớp link, 1 khớp company \+ role/);
  });
  run('backfill không đụng gì vào App', () => {
    assert.strictEqual(app.getLastRow(), 4);
  });
}

console.log('backfill chạy lại lần hai');
{
  const s = load();
  s.backfillTicksFromApp();
  run('không có gì để tick thêm', () => {
    assert.match(toasts[0], /Không có dòng nào cần tick thêm/);
  });
}

console.log('onEdit');
{
  jobs = freshJobs();
  app = freshApp();
  const s = load();
  // onEdit chạy sau khi ô đã đổi giá trị, nên ô phải là true trước khi bắn.
  jobs.grid[3][4] = true;
  s.onEdit({ source: ss, range: jobs.getRange(4, 5, 1, 1) });
  run('tick job chưa có ở App thì thêm một dòng', () => {
    assert.strictEqual(app.getLastRow(), 5);
  });
  run('Property nối tiếp số lớn nhất, không phải số dòng', () => {
    assert.strictEqual(app.grid[4][0], 3);
  });
  run('Company, link, Process và Role vào đúng cột', () => {
    const row = app.grid[4];
    assert.strictEqual(row[1], 'Neuralink');
    assert.strictEqual(row[2], 'https://jobright.ai/jobs/info/xyz');
    assert.strictEqual(row[5], 'Applied');
    assert.strictEqual(row[6], 'Firmware Engineer Intern');
  });
  run('Date Applied là ngày hôm nay', () => {
    // instanceof không dùng được: Date tạo trong vm thuộc realm khác.
    const written = app.grid[4][3];
    assert.strictEqual(Object.prototype.toString.call(written), '[object Date]');
    assert.strictEqual(written.toDateString(), new Date().toDateString());
  });
  run('Location để trống vì Jobs không mang dữ liệu đó', () => {
    assert.strictEqual(app.grid[4][4], '');
  });
  run('validation copy từ dòng entry cuối, không phải dòng rác chỉ có link', () => {
    assert.deepStrictEqual(copied, [[3, 'PASTE_DATA_VALIDATION']]);
  });
}

console.log('onEdit — các trường hợp phải không làm gì');
{
  jobs = freshJobs();
  app = freshApp();
  const s = load();

  s.onEdit({ source: ss, range: jobs.getRange(2, 3, 1, 1) });
  run('sửa cột khác thì bỏ qua', () => assert.strictEqual(app.getLastRow(), 4));

  jobs.grid[3][4] = false;
  s.onEdit({ source: ss, range: jobs.getRange(4, 5, 1, 1) });
  run('untick không làm gì', () => assert.strictEqual(app.getLastRow(), 4));

  jobs.grid[2][4] = true;
  s.onEdit({ source: ss, range: jobs.getRange(3, 5, 1, 1) });
  run('tick job đã có ở App qua link thì bỏ qua', () => {
    assert.strictEqual(app.getLastRow(), 4);
    assert.match(toasts[toasts.length - 1], /Không thêm dòng nào/);
  });

  jobs.grid[1][4] = true;
  s.onEdit({ source: ss, range: jobs.getRange(2, 5, 1, 1) });
  run('onEdit KHÔNG khớp theo tên: link khác thì vẫn ghi nhận', () => {
    assert.strictEqual(app.getLastRow(), 5);
  });
}

console.log('onEdit — fill-down nhiều dòng');
{
  jobs = freshJobs();
  app = freshApp();
  const s = load();
  jobs.grid[1][4] = true;
  jobs.grid[2][4] = true;
  jobs.grid[3][4] = true;
  s.onEdit({ source: ss, range: jobs.getRange(2, 5, 3, 1) });
  run('cả khối được xử lý, Property không trùng nhau', () => {
    assert.strictEqual(app.getLastRow(), 6);
    assert.strictEqual(app.grid[4][0], 3);
    assert.strictEqual(app.grid[5][0], 4);
  });
  run('dòng đã có ở App trong khối vẫn bị bỏ qua', () => {
    assert.match(toasts[toasts.length - 1], /Đã thêm 2 dòng.*Bỏ qua 1/);
  });
}

console.log('onEdit — Expired chặn dòng sang App');
{
  jobs = freshJobs();
  app = freshApp();
  const s = load();
  jobs.grid[3][4] = true;   // Applied
  jobs.grid[3][5] = true;   // Expired
  s.onEdit({ source: ss, range: jobs.getRange(4, 5, 1, 1) });
  run('tick Applied trên dòng đã Expired thì không thêm gì', () => {
    assert.strictEqual(app.getLastRow(), 4);
  });
  run('toast nói rõ vì sao bị bỏ qua', () => {
    assert.match(toasts[toasts.length - 1], /Bỏ qua 1 dòng đã tick Expired/);
  });

  jobs.grid[1][4] = true;   // IBM: Applied, không Expired
  s.onEdit({ source: ss, range: jobs.getRange(2, 5, 3, 1) });
  run('trong cùng một khối, dòng không Expired vẫn sang bình thường', () => {
    assert.strictEqual(app.getLastRow(), 5);
    assert.strictEqual(app.grid[4][1], 'IBM');
  });
  run('khối lẫn lộn đếm riêng hai lý do bỏ qua', () => {
    assert.match(toasts[toasts.length - 1], /Đã thêm 1 dòng.*Bỏ qua 1 dòng đã tick Expired/s);
  });

  jobs.grid[3][5] = false;  // gỡ Expired
  s.onEdit({ source: ss, range: jobs.getRange(4, 5, 1, 1) });
  run('gỡ Expired rồi thì dòng đó sang được', () => {
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
  run('dựng header cho cả hai cột', () => {
    assert.strictEqual(jobs.grid[0][4], 'Applied');
    assert.strictEqual(jobs.grid[0][5], 'Expired');
  });
}
