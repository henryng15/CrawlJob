# Ai có thể nói giúp bạn một câu

Danh bạ alumni của trường được dán vào một tab riêng. Mỗi lượt sync, tool tô vàng **cả hai
phía** của phần giao nhau:

- Tab **`Alumni`** — dòng của người đang làm ở công ty bạn đã nộp. Đây là người đáng hỏi
  xin referral.
- Tab **`App`** — đơn ứng tuyển mà bạn *có người quen bên trong*. Nhìn tab App là biết ngay
  đơn nào còn đường đẩy thêm.

Và một dấu thứ hai, màu đỏ ở **cột I của tab `App`**: công ty đó có sẵn recruiter trong
danh sách liên hệ. Hai dấu độc lập — vàng cả dòng là "có alumni", đỏ ô I là "có recruiter";
một đơn có thể mang cả hai.

Tool **chỉ ghi màu**, không đụng vào một chữ nào trong hai tab đó.

## Vì sao phải nằm trong spreadsheet

GitHub Actions chạy trên runner của GitHub, Apps Script chạy trên server Google. Không cái
nào thấy được file `.xlsx` trong thư mục Downloads trên máy bạn. Muốn tự động thì dữ liệu
phải nằm ở chỗ mà chúng đọc được — và spreadsheet là chỗ đã có sẵn.

## Cài một lần

1. Mở spreadsheet → **File → Import → Upload**, chọn file alumni `.xlsx` vừa tải.
2. Chọn **Insert new sheet(s)**, bấm Import.
3. Đổi tên tab vừa tạo thành **`Alumni`**. Muốn tên khác thì đặt biến
   `GOOGLE_SHEET_ALUMNI_TAB`.

Cột A phải là tên công ty. Bản export hiện tại đúng như vậy:

```
Job Organization | Job Title | Industry | State | Degrees Aggregated | LinkedIn
```

Dòng 1 là header và không bao giờ bị tô.

Lần sau có bản export mới thì import đè lên tab đó. Không cần làm gì thêm — lượt sync kế
tiếp tự tô lại từ đầu.

## Khớp tên công ty thế nào

Danh bạ ghi tên đăng ký, đơn ứng tuyển ghi tên trên trang careers, hai bên hiếm khi giống
hệt. `company_tokens` bỏ hoa thường, dấu câu, và các từ chỉ loại hình doanh nghiệp
(`Inc`, `LLC`, `Ltd`, `Corp`, `Company`, `Group`, `Technologies`…). Sau đó khớp khi **tập
từ của bên này nằm trong bên kia**:

| Danh bạ alumni | Đơn đã nộp | |
|---|---|---|
| `Chicago Trading Company (CTC)` | `Chicago Trading Company` | ✅ |
| `Hakkōda, an IBM Company` | `IBM` | ✅ |
| `Google Cloud` | `Google` | ✅ |
| `Altamira Technologies` | `Altamira` | ✅ |
| `Dicerna Pharmaceuticals` | `Dice` | ❌ |
| `Champion Sports` | `HP` | ❌ |

Chứa nhau tính theo **từ nguyên vẹn**, không phải chuỗi con. Nếu tính theo chuỗi con thì
`Dice` sẽ khớp `Dicerna` và `HP` khớp `Champion`, và cả danh bạ sẽ vàng khè.

Đây là luật lỏng theo đúng lựa chọn khi thiết kế: bỏ sót một alumni thì bạn không bao giờ
biết, còn tô vàng thừa một dòng thì nhìn phát ra ngay. Mọi cặp được khớp đều in ra log của
Actions để soát:

```
Alumni row 41: Google Cloud — applied to Google
```

Một cái tên rút gọn xong chẳng còn từ nào (`The Company Ltd`) sẽ **không khớp gì cả** —
tập rỗng nằm trong mọi tập, và nếu không chặn thì nó sẽ tô vàng toàn bộ danh bạ. Có test
ghim lại chuyện này.

## Tool chỉ xoá đúng màu vàng của chính nó

Trước khi tô, tool đọc màu nền đang có và so với đúng màu của nó — vàng `#FFE599` ở cột A,
đỏ `#F4CCCC` ở cột I. Chỉ ô mang đúng màu đó mới bị xoá, và mỗi dấu chỉ dò ở cột của riêng
nó nên không cái nào nhầm việc của cái kia là của mình.

- Ô bạn tự tô tay — mấy ô xanh lá trong tab `App` chẳng hạn — **được giữ nguyên**.
- Công ty bị gỡ khỏi `App` thì dòng alumni tương ứng tự hết vàng.
- Dòng đã đúng màu rồi thì không bị ghi lại. Một lượt không có gì đổi sẽ **không gửi
  request nào**, dù chạy 5 lần mỗi ngày.

Một ngoại lệ cần biết: dòng **được** tô vàng thì cả dải A–H của nó thành vàng, nên nếu dòng
đó đang có ô bạn tô tay thì màu cũ bị phủ. Chỉ xảy ra với dòng khớp, và bỏ tick sẽ trả về
nền trắng chứ không trả về màu cũ.

## Recruiter (ô đỏ cột I)

Nguồn là project `ColdEmail`, file `web/db/seed_recruiters.csv` — 2269 liên hệ đã verify.
Nhưng repo này **không mang theo tên hay email của ai**: chỉ danh sách công ty được chép
sang, vào `job_sync/data/recruiter_companies.txt` (720 dòng). Cần biết "có liên hệ", không cần biết
"liên hệ là ai".

Cập nhật lại khi ColdEmail có dữ liệu mới:

```bash
python scripts/recruiter_companies.py ../ColdEmail/web/db/seed_recruiters.csv
```

File nằm **trong package** `job_sync/data/`, không phải ở gốc repo: `pip install .` chỉ
chép `job_sync/` nên một file ở gốc sẽ có mặt khi chạy local và biến mất trên runner —
lỗi im lặng, tô ra 0 dòng mà workflow vẫn xanh. `pyproject.toml` khai báo
`[tool.setuptools.package-data]` để wheel mang theo nó.

File nằm trong repo nên không tốn API call nào, và thiếu file thì chỉ là tính năng tắt.

Khớp bằng đúng luật lỏng ở trên. Thử với các công ty đọc được từ tab App: trúng **32/54**,
cao hơn hẳn alumni — danh sách recruiter phủ rộng hơn danh bạ trường nhiều.

## Chi phí

Thêm 6 API call mỗi lượt sync: đọc `Alumni`, đọc `App`, đọc màu nền ở ba chỗ (cột A của
`Alumni`, cột A và cột I của `App`), rồi một `batchUpdate` — và `batchUpdate` bị bỏ hẳn khi
không có gì đổi. Danh sách recruiter đọc từ đĩa, không tốn call nào. Các dòng liền nhau
được gộp thành một request, nên 100 dòng khớp rải rác vẫn chỉ tốn vài request chứ không
phải 100.

Chưa tạo tab `Alumni` thì tool in một dòng thông báo rồi bỏ qua, sync vẫn chạy bình thường.
