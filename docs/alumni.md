# Alumni: ai có thể refer bạn

Danh bạ alumni của trường được dán vào một tab riêng. Mỗi lượt sync, tool tô vàng những
dòng có công ty trùng với công ty bạn đã nộp ở tab `App` — người được tô vàng chính là
người đáng hỏi xin referral.

Tool **chỉ ghi màu**, không đụng vào một chữ nào trong tab đó.

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

## Màu là của tool

Mỗi lượt chạy, tool **xoá sạch nền của cả vùng dữ liệu** rồi mới tô lại. Nghĩa là:

- Công ty bị gỡ khỏi tab `App` thì dòng alumni tương ứng tự hết vàng.
- Màu nền bạn tự tô tay trong tab `Alumni` sẽ bị mất.

Muốn đánh dấu riêng thì dùng cột khác (chữ, hoặc một cột phụ), đừng dùng màu nền.

## Chi phí

Thêm 2 API call mỗi lượt sync: một lần đọc tab `Alumni`, một lần `batchUpdate` để tô. Các
dòng liền nhau được gộp thành một request, nên 100 dòng khớp rải rác vẫn chỉ tốn vài
request chứ không phải 100.

Chưa tạo tab `Alumni` thì tool in một dòng thông báo rồi bỏ qua, sync vẫn chạy bình thường.
