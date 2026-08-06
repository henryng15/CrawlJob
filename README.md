# Internship Sheet Sync

Một tool nhỏ, chỉ làm một việc: đọc các public GitHub internship trackers, giữ các
role SWE liên quan, xoá duplicate theo `Link Apply`, và append job mới vào một Google
Sheet với đúng bốn cột:

`Company | Role | Link Apply | Date Posted`

Không có browser automation, database, AI, queue, email hay web dashboard.

## Role được lấy

Mỗi role phải có `intern`, `internship`, `co-op`, `placement` hoặc `student`, và khớp
một trong các nhóm sau: software engineering/engineer/developer/dev/SWE/SDE;
frontend, backend, full-stack, web, mobile, iOS, Android; platform, infrastructure,
production infrastructure, developer experience; cloud/cloud operations, DevOps, SRE,
build/release, MLOps; embedded, firmware, systems, application; FDE/forward deployed;
ML/data platform engineer; quantitative developer. Danh sách regex nằm tại
`job_sync/roles.py`, nên có thể thêm/bớt dễ dàng mà không đổi pipeline.

## Nguồn và ngày đăng

`sources.toml` chứa các tracker public được kiểm tra còn hoạt động: Simplify/Pitt CSC,
sndsh404, speedyapply và zshah101. Đây là danh sách baseline có thể cấu hình, không có
cách đáng tin cậy để khẳng định đã bao phủ “tất cả” repo trên GitHub. Parser dùng cột
`Added`/`Posted` của nguồn khi có; nếu nguồn chỉ có age thì quy đổi sang ngày; nếu không
có cả hai, `Date Posted` là ngày tool lần đầu quan sát job đó. Sheet được đọc trước mỗi
lần ghi nên chạy lại không tạo duplicate.

## Chạy local

```bash
uv venv && uv pip install -e .
set -a; source .env; set +a
internship-sync
```

Tạo Google service account, bật Google Sheets API, chia sẻ spreadsheet cho email của
service account, rồi đặt ba biến trong `.env` theo `.env.example`. Không commit JSON
credentials. `GOOGLE_SHEET_TAB` mặc định là `Jobs`.

## Tự chạy cloud

Workflow GitHub Actions tại `.github/workflows/sync.yml` chạy lúc 08:00, 10:00, 12:00,
14:00 và 16:00 `America/New_York`. GitHub cron dùng UTC, vì vậy workflow được đánh thức
mỗi giờ trong cửa sổ 12–21 UTC và command tự bỏ qua giờ không đúng, nên vẫn đúng qua
chuyển đổi EST/EDT.

Thêm GitHub Actions secrets: `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_TAB`,
`GOOGLE_SERVICE_ACCOUNT_JSON`, sau đó bật Actions schedule hoặc chạy `workflow_dispatch`
lần đầu. Đây là giải pháp cloud gọn nhất: không cần VM, Terraform, database, hay cron
server.
