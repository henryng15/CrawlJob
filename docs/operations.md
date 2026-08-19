# Vận hành

## Đọc log của một lượt sync

```
Simplify / Pitt CSC — Summer 2027: 80 matching roles
...
294 of 365 deduped roles posted on or after 2026-07-01
Appended 0 new jobs; 294 already in the sheet.
Dropped 8 rows whose posting the board reports as gone.
Dropped 0 rows from employers this tracker no longer follows.
Merged 78 rows repeating a company and role already listed.
Ticked by company and role: Virtu Financial — Software Engineer Intern - Software Engineer
Ticked Applied on 3 rows matching a tracked link and 9 matching a tracked company and role.
52 rows ticked Applied and 0 ticked Expired; 440 postings still to apply to.
```

| Dòng | Đáng chú ý khi |
|---|---|
| `N of M deduped roles` | `M` tụt mạnh → một tracker đổi format, xem `WARNING` |
| `Appended` | 0 là bình thường; job mới không xuất hiện mỗi hai tiếng |
| `Dropped … reports as gone` | tăng vọt → có thể một board đang trả 404 hàng loạt |
| `Merged` | tăng vọt sau khi sửa luật khớp → kiểm tra xem có gộp oan không |
| `Ticked by company and role: …` | **soát từng dòng** — đây là lớp lỏng nhất |
| `still to apply to` | con số đáng đọc hàng ngày |

Lượt chạy theo lịch vào giờ lẻ chỉ in `Outside scheduled 2-hour ET window; nothing to do.`
và thoát sau khoảng 20 giây. Đó là bình thường, không phải lỗi.

## Soát tab App

```bash
internship-sync --audit-app
```

Trên Actions: **Run workflow** → bật input `audit_app`. Nó không sync gì cả.

Đọc từng dòng của tab `App` và báo bốn loại vấn đề:

```
App: 82 rows
  row 14   MISSING    Role
  row 18   SAME JOB   as row 6 (Chicago Trading Company (CTC) — Software Engineering …)
  row 65   DEAD LINK  the board reports it as gone
  row 70   SAME JOB   as row 69 (Notion — Software Engineer Intern (Summer 2027))
18 findings across 82 rows.
```

- `MISSING` — thiếu field bắt buộc. `Role` là cái đáng sửa nhất: thiếu nó thì dòng đó
  không bao giờ khớp được theo tên, xem [matching.md](matching.md).
- `SAME LINK` / `SAME JOB` — hai dòng cùng một đơn.
- `NOT A LINK` — ô Application Link không phải URL.
- `STAGE?` — giá trị `Process` nằm ngoài pipeline.
- `UNLOGGED` — `Process` và dòng cuối của cột `Update` nói hai chặng khác nhau. Apps Script
  ghi dòng đó ngay lúc `Process` đổi, nên lệch nghĩa là thay đổi đã vào sheet bằng đường
  mà simple trigger không thấy: một lượt ghi qua API, hoặc một lần sửa lúc script đang hỏng.
  Sửa bằng cách điền tay dòng còn thiếu vào ô `Update`.
- `DEAD LINK` — board báo posting đã gỡ.

Audit **chỉ báo, không sửa gì** trong tab App. Nó cũng không làm workflow đỏ khi có
finding, vì phần lớn finding là việc bạn chủ động chọn không sửa.

Tách riêng khỏi lượt sync vì phải hỏi từng board, mất khoảng một phút.

## Rebuild

```bash
internship-sync --rebuild
```

Trên Actions: **Run workflow** → bật input `rebuild`.

Bỏ hết dòng đang có và viết lại sheet chỉ từ nguồn. Dùng khi các dòng cũ được ghi bởi một
parser sai và không sửa tại chỗ được.

> **Rebuild xoá luôn cột E–G.** Mọi ô tick `Applied`, `Expired` và ghi chú đều mất. Tab
> `App` không bị đụng tới, nên lượt sync sau sẽ tick lại được những job đã nộp — nhưng
> `Expired` và ghi chú thì phải làm lại bằng tay.

## Cờ khác

| Cờ | |
|---|---|
| `--skip-link-check` | không hỏi board nào cả; chạy nhanh, và không xoá dòng nào vì link chết |
| `--since 2026-09-01` | đổi mốc chặn ngày đăng |
| `--sources path.toml` | dùng danh sách tracker khác |
| `--scheduled` | thoát ngay nếu không phải giờ chạy; workflow tự thêm khi chạy theo lịch |

## Hỏng thì xem gì

| Triệu chứng | Nguyên nhân thường gặp |
|---|---|
| `Missing required environment variable(s)` | secret chưa tạo, hoặc tên viết sai |
| `No tab named 'Jobs'` | tab bị đổi tên → đặt `GOOGLE_SHEET_TAB` |
| `WARNING: no tab named 'App'` | sync vẫn chạy, chỉ là không tick được gì |
| `Expected [...] in Jobs!A1:D1` | header A–D bị sửa; trả lại đúng bốn tên cột |
| `403` / `does not have permission` | quên share spreadsheet cho service account, xem [setup.md](setup.md) |
| Ô Applied hiện ra chữ `TRUE` thay vì dấu tick | cột E đang bị ghi bằng `RAW` |
| Tool tick 0 dòng suốt | cột G có ghi chú ở mọi dòng, hoặc cột E–F lệch chỗ |
| `Multiple top-level packages discovered` | thêm thư mục mới ở gốc repo → khai báo trong `[tool.setuptools] packages` |

## Kiểm tra trước khi push

```bash
uv run pytest -q          # 96 tests
uv run ruff check .
uv run ruff format --check job_sync tests
```

Phần Apps Script không chạy được trong pytest. Cách kiểm là stub `SpreadsheetApp` rồi chạy
`onEdit` và `backfillTicksFromApp` trên sheet giả bằng `node` — xem
[`apps_script/README.md`](../apps_script/README.md).
