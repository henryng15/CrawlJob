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

## Workflow thứ hai: dựng lại shortlist ATS board

[`.github/workflows/boards.yml`](../.github/workflows/boards.yml) chạy **06:00 UTC chủ
nhật**, hoặc bấm tay bằng **Run workflow**. Nó hỏi cả ~15.900 board một lượt, giữ lại
những board đang đăng internship, rồi commit `job_sync/data/ats_boards.json` ngược vào
repo — chỉ commit khi file thật sự đổi.

Tách khỏi workflow sync vì đây là loại việc khác hẳn: ~20.000 request và khoảng nửa tiếng,
so với 902 request và **36 giây** đo được ở lượt hàng ngày. Nhét nó vào sync là bắt cả 5 lượt mỗi ngày trả
cái giá đó để biết một thứ mỗi tuần mới đổi.

Giờ chạy 06:00 UTC là 01:00–02:00 ET, cách xa cửa sổ 08:00–16:00 ET của sync, nên hai bên
không bao giờ tranh nhau cùng một API.

`timeout-minutes: 90` không phải con số cho vui: một slug vừa không resolve vừa không bị từ
chối sẽ giữ một worker đến hết timeout, mà loại đó có hàng nghìn. 90 phút là dư so với ~35
phút thật, và ngắn hơn hẳn mức mặc định 6 tiếng vốn đủ đốt cả ngày quota.

### Đọc log của nó

Lần quét đầu, 19/08/2026:

```
  probed                       19899
  answered with a job           9062   board còn sống
  advertising any internship     902   <- ghi vào daily
  with a matching SWE intern     177
  matching roles right now       312
```

Con số hàng thứ ba là thứ đáng theo dõi. Nó tụt mạnh nghĩa là danh sách slug thượng nguồn
có vấn đề, chứ không phải thị trường tuyển dụng đột nhiên đóng cửa.

### Khi nào phải chạy tay

- Vừa clone repo về mà `job_sync/data/ats_boards.json` chưa có.
- Vừa sửa `roles.py` — tiêu chí lọc đổi thì shortlist phải dựng lại.
- Đầu mùa tuyển (tháng 8–9), khi hàng loạt công ty mở chương trình intern cùng lúc và bạn
  không muốn đợi tới chủ nhật.

```bash
uv run python scripts/discover_boards.py
```

## Ngân sách GitHub Actions

Free tier của private repo là **2.000 phút/tháng**. Actions tính tiền theo **phút, làm tròn
lên**, cho từng job — nên một run 131 giây và một run 238 giây đều tốn nguyên phút như nhau
ở phần dư.

Đo từ 14 scheduled run thật:

| | mỗi ngày | phút/run | phút/tháng |
|---|---|---|---|
| sync, trong khung giờ ET | 5 | 3,4 | 510 |
| sync, ngoài khung giờ (thoát sau ~20s) | 5 | 1 | 150 |
| `boards.yml` dựng lại shortlist | tuần | ~40 | 172 |
| | | **tổng** | **~830** |

Còn dư khoảng **1.170 phút**. Crawl board 2 lần/ngày gần như không thêm gì: nó dài 36 giây
và bị nuốt vào phần làm tròn của một run đã 3,4 phút — xấu nhất là +1 phút/ngày, tức +30
phút/tháng.

Kể cả hỏi board ở **cả 5 lượt** cũng vẫn trong ngân sách (~900 phút/tháng). Thứ chặn không
phải quota mà là lịch sự với ba API kia: 902 request × 5 lượt = 4.510 request/ngày.

Cron chạy 10 lần (`0 12-21 * * *`) nhưng chỉ 5 lần làm việc — 5 lần kia thoát ngay bằng bộ
lọc khung giờ ET và tốn 1 phút mỗi lần. Đó là 150 phút/tháng trả cho việc GitHub chỉ nhận
cron theo UTC còn khung giờ thì theo ET, vốn xê dịch theo DST.

> API `/actions/runs/{id}/timing` báo `billable.UBUNTU.total_ms = 0` kể cả cho run 237
> giây, nên **đừng tin nó**. Các con số trên suy từ `run_duration_ms` cộng quy tắc làm tròn.
> Số chính thức xem ở **Settings → Billing and plans → Usage this month**.
