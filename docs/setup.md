# Dựng lại từ đầu

Ba phần, làm theo thứ tự: quyền truy cập Google Sheet, chạy local, rồi để GitHub Actions
chạy thay.

## 1. Google Cloud và service account

Tool không đăng nhập bằng tài khoản Gmail của bạn. Nó dùng **service account** — một tài
khoản máy có email riêng, và bạn phải **share spreadsheet cho email đó** y như share cho
một người thật. Đây là bước hay bị bỏ sót nhất, và triệu chứng của nó là lỗi `403`.

### 1.1 Tạo project

1. Vào [console.cloud.google.com](https://console.cloud.google.com).
2. Menu chọn project ở thanh trên → **New Project**. Đặt tên gì cũng được, ví dụ
   `internship-sheet-sync`. **Create**.
3. Đợi tạo xong rồi **chọn đúng project đó** ở thanh trên. Mọi bước sau đều nằm trong
   project đang được chọn.

Không cần bật billing. Google Sheets API nằm trong hạn mức miễn phí.

### 1.2 Bật Google Sheets API

1. **APIs & Services → Library**.
2. Tìm `Google Sheets API` → mở ra → **Enable**.

Bỏ qua bước này thì tool sẽ báo lỗi kiểu *"Google Sheets API has not been used in project
… before or it is disabled"*.

### 1.3 Tạo service account

1. **APIs & Services → Credentials → Create credentials → Service account**.
2. Đặt tên, ví dụ `sheet-sync`. **Create and continue**.
3. Phần "Grant this service account access to project" — **để trống, bấm Continue**.
   Đây là quyền trên Google Cloud project, không liên quan gì tới quyền trên spreadsheet.
4. **Done**.

### 1.4 Tải JSON key

1. Bấm vào service account vừa tạo → tab **Keys**.
2. **Add key → Create new key → JSON → Create**.
3. Trình duyệt tải file `.json` về. **File này chỉ tải được một lần**, mất là phải tạo key
   mới.

Bên trong nó trông như thế này:

```json
{
  "type": "service_account",
  "project_id": "internship-sheet-sync",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...",
  "client_email": "sheet-sync@internship-sheet-sync.iam.gserviceaccount.com",
  ...
}
```

`client_email` là thứ cần cho bước tiếp theo. **Đừng commit file này.**

### 1.5 Share spreadsheet cho service account

Đây là bước làm cho tool ghi được.

1. Mở Google Sheet của bạn.
2. Bấm **Share** góc trên bên phải.
3. Dán nguyên `client_email` ở trên — dạng
   `tên@project-id.iam.gserviceaccount.com`.
4. Đổi quyền thành **Editor**, không phải Viewer. Tool cần ghi vào tab `Jobs`.
5. **Tắt "Notify people"** — đây không phải người, gửi mail sẽ bounce.
6. **Share**.

Nếu tổ chức của bạn chặn share ra ngoài domain thì bước này sẽ báo lỗi. Khi đó dùng
spreadsheet thuộc tài khoản cá nhân, hoặc nhờ admin cho phép.

### 1.6 Kiểm tra

Lấy `GOOGLE_SHEET_ID` từ URL — phần giữa `/d/` và `/edit`:

```
https://docs.google.com/spreadsheets/d/1AbC...XyZ/edit#gid=0
                                       └──────────┘
```

Sau khi đặt biến môi trường ở bước 2, chạy `internship-sync --audit-app`. Nó chỉ đọc, nên
là cách thử quyền an toàn nhất.

| Lỗi | Nghĩa là |
|---|---|
| `403 … caller does not have permission` | chưa làm bước 1.5, hoặc share nhầm email |
| `403 … Google Sheets API has not been used` | chưa làm bước 1.2 |
| `404 … Requested entity was not found` | `GOOGLE_SHEET_ID` sai |
| `No tab named 'Jobs'` | quyền thì ổn, chỉ là tên tab khác |
| `invalid_grant` / `Invalid JWT` | JSON bị cắt xén, thường do xuống dòng trong `private_key` bị hỏng |

## 2. Biến môi trường

Chép `.env.example` thành `.env`:

| Biến | Bắt buộc | Mặc định | |
|---|---|---|---|
| `GOOGLE_SHEET_ID` | có | | phần giữa `/d/` và `/edit` trong URL |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | có | | **toàn bộ** nội dung file JSON ở bước 1.4 |
| `GOOGLE_SHEET_TAB` | không | `Jobs` | tab tool ghi vào |
| `GOOGLE_SHEET_APP_TAB` | không | `App` | tab tool đọc để biết đã nộp gì |

Hai biến tab dùng `os.getenv(...) or "..."` chứ không phải giá trị default của `getenv`.
Lý do: một GitHub Actions secret chưa từng được tạo sẽ đến dưới dạng **chuỗi rỗng**, chứ
không phải "không tồn tại" — với default thường thì tool sẽ đi tìm một tab tên `""`.

Đặt `GOOGLE_SERVICE_ACCOUNT_JSON` trong `.env` thì dán nguyên JSON vào trong dấu nháy
đơn, giữ nguyên các `\n` bên trong `private_key`:

```
GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...","client_email":"..."}'
```

Trên GitHub thì dán thẳng nội dung file vào ô secret, không cần nháy.

`.env` và `.env.*` đều đã nằm trong `.gitignore`. Đừng commit JSON credentials.

## 3. Chạy local

```bash
uv venv && uv pip install -e .
set -a; source .env; set +a
internship-sync
```

Chạy lại nhiều lần không sinh duplicate: sheet luôn được đọc trước mỗi lần ghi.

Kiểm tra trước khi tin:

```bash
uv run pytest -q                  # 96 tests
uv run ruff check .
node apps_script/harness.js       # 27 assertion cho phần Apps Script
```

## 4. GitHub Actions

Thêm secrets tại **Settings → Secrets and variables → Actions**:

- `GOOGLE_SHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `GOOGLE_SHEET_TAB` — chỉ khi tab không tên `Jobs`
- `GOOGLE_SHEET_APP_TAB` — chỉ khi tab không tên `App`

Workflow ở [`.github/workflows/sync.yml`](../.github/workflows/sync.yml) chạy lúc 08:00,
10:00, 12:00, 14:00 và 16:00 giờ `America/New_York`.

GitHub cron chỉ nhận UTC, mà New York đổi giữa EST và EDT hai lần một năm. Nên workflow
được đánh thức **mỗi giờ** trong cửa sổ 12–21 UTC, còn `--scheduled` khiến command tự
thoát ngay nếu giờ New York lúc đó không nằm trong danh sách trên. Lượt thoát sớm mất
khoảng 20 giây, lượt crawl thật mất khoảng 1 phút 30.

Chạy tay thì dùng **Run workflow**, khi đó không có `--scheduled` nên nó bỏ qua cửa sổ
giờ và crawl luôn.

## 5. Apps Script

Hai file trong [`apps_script/`](../apps_script/) chạy phía Google, không phải phía Python.
Mở spreadsheet → **Extensions → Apps Script**, dán từng file vào, Save.

| File | Chạy hàm | Làm gì |
|---|---|---|
| `sync_applied_to_app.gs` | `setupJobsCheckboxes` | dựng checkbox `Applied` (E) và `Expired` (F) ở tab Jobs |
| | `setupUpdateColumn` | dựng cột `Update` (J) ở tab App và điền lịch sử cho các dòng đã có |
| `setup_process_dropdown.gs` | `setupProcessDropdown` | dựng dropdown `Process` có màu ở tab App |

Chạy hàm setup một lần là đủ; `onEdit` là simple trigger nên Google tự gọi, không cần cài
trigger thủ công. Lần đầu Google sẽ hỏi quyền: Review permissions → chọn account →
Advanced → Go to (project) → Allow.

> **Cẩn thận với `setupProcessDropdown`.** Nó ghi đè data validation của cả `F2:F500` ở
> tab App. Nếu dropdown hiện tại của bạn được tạo từ giao diện Sheets (dạng chip bo tròn)
> thì chạy lại hàm này sẽ đổi kiểu hiển thị của **toàn bộ** các dòng đang có.

## Chi phí

Miễn phí toàn bộ.

- **GitHub Actions** — repo public thì không giới hạn phút. Repo private thì free tier
  2000 phút/tháng, lịch chạy hiện tại tiêu khoảng 300–500.
- **Apps Script** — quota 90 phút runtime/ngày cho tài khoản thường; mỗi lần tick tốn
  khoảng 1 giây.
- **Google Sheets API** — giới hạn 60 request/phút/user, mỗi lượt sync dùng 4.
