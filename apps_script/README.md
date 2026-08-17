# Apps Script

Hai file này chạy phía Google, không phải phía Python. Chúng sống trong Apps Script editor
gắn với spreadsheet; bản trong repo là bản gốc để version control, vì Apps Script editor
không có lịch sử nào đáng để dựa vào.

| File | Hàm chạy tay | |
|---|---|---|
| `sync_applied_to_app.gs` | `setupJobsCheckboxes` | dựng checkbox `Applied` (E) và `Expired` (F) ở tab Jobs |
| | `backfillTicksFromApp` | quét tab App, tick sẵn ở Jobs những job đã nộp |
| `setup_process_dropdown.gs` | `setupProcessDropdown` | dựng dropdown `Process` có màu ở tab App |

`onEdit` trong `sync_applied_to_app.gs` là **simple trigger** — Google tự gọi mỗi khi có ô
bị sửa, không cần cài trigger. Nó thoát ngay bằng vài phép so sánh rẻ nếu ô vừa sửa không
phải cột E của tab Jobs.

Cách cài: [../docs/setup.md](../docs/setup.md#5-apps-script).
Ý nghĩa từng cột: [../docs/spreadsheet.md](../docs/spreadsheet.md).

## Chạy test

```bash
node apps_script/harness.js
```

Không cần cài gì và không đụng tới spreadsheet thật. `harness.js` stub `SpreadsheetApp`
bằng một sheet giả trong bộ nhớ, nạp file `.gs` qua `vm`, rồi gọi thẳng `onEdit`,
`backfillTicksFromApp` và `setupJobsCheckboxes`. 27 assertion, in `ok` / `FAIL` từng dòng
và trả exit code khác 0 nếu có cái nào hỏng.

Sheet giả dựng theo đúng hình dạng dữ liệu thật, gồm cả những dòng rác chỉ có mỗi link mà
tab App đang có — chính chúng là lý do `lastEntry()` phải tìm dòng cuối *có số Property*
thay vì dùng `getLastRow()`.

Vài chỗ cần biết khi sửa harness:

- `onEdit` chạy **sau** khi ô đã đổi giá trị, nên test phải gán `grid[r][4] = true` trước
  khi bắn event.
- `Date` tạo trong `vm` thuộc realm khác, `instanceof Date` ở ngoài luôn false. Dùng
  `Object.prototype.toString.call(...)`.
