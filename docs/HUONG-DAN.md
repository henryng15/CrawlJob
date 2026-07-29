# Hướng dẫn — bạn cần tự tay làm gì

Tổng cộng khoảng **1 tiếng rưỡi**, phần lớn là ngồi chờ.

Có 7 việc. Làm đúng thứ tự. Việc nào cũng ghi rõ: bạn bấm gì, copy gì, dán vào đâu.

---

## Việc 1 — Tạo tài khoản Oracle Cloud (20 phút)

Đây là chỗ máy chủ sẽ chạy. Miễn phí vĩnh viễn, nhưng **Oracle vẫn bắt nhập thẻ tín dụng** để xác minh bạn là người thật. Họ không trừ tiền.

1. Vào https://signup.cloud.oracle.com
2. Điền thông tin.
3. **Đến bước chọn "Home Region" — ĐỌC KỸ CHỖ NÀY.**

   Chọn **Germany Central (Frankfurt)** hoặc **Singapore**.

   Đừng chọn US East. Lý do: máy chủ loại này (chip ARM miễn phí) rất hiếm chỗ trống. Ở Frankfurt và Singapore thường có ngay trong vài phút. Ở US East có thể chờ nhiều ngày.

   **Chọn xong là không đổi được nữa.** Vĩnh viễn. Đây là quyết định quan trọng nhất trong cả quá trình.

4. Nhập thẻ, xác minh email, xong.

> **Nếu bạn ĐÃ có tài khoản Oracle rồi:** kiểm tra region hiện tại ở góc trên bên phải màn hình. Nếu là US East thì vẫn chạy được, chỉ là lúc dựng máy có thể phải chờ lâu hoặc thử lại nhiều lần. Không sao, script tự thử lại.

---

## Việc 2 — Lấy "chìa khoá" để máy tính bạn điều khiển Oracle (5 phút)

Bạn cần 4 mẩu thông tin. Chúng chỉ là những chuỗi ký tự dài, copy rồi dán.

Đăng nhập vào Oracle Cloud, rồi:

**a) Lấy 2 mã định danh**

- Bấm vào **hình người ở góc trên bên phải** → chọn **Tenancy: (tên gì đó)**
  → Tìm dòng **OCID**, bấm **Copy**. Dán tạm vào Notepad, ghi chú "tenancy".

- Lại bấm **hình người góc trên bên phải** → chọn **My profile**
  → Tìm dòng **OCID**, bấm **Copy**. Dán vào Notepad, ghi chú "user".

**b) Tạo khoá bảo mật**

- Vẫn ở trang **My profile**, kéo xuống, cột trái có mục **API keys** → bấm vào
- Bấm nút **Add API key**
- Chọn **Generate API key pair** (tuỳ chọn đầu tiên)
- Bấm **Download private key** — nó tải về một file đuôi `.pem`
- Bấm **Add**
- Màn hình hiện ra một khung chữ. Trong đó có dòng `fingerprint=` — copy đoạn sau dấu `=`, nó trông như `aa:bb:cc:dd:...`. Dán vào Notepad.

**c) Cất file khoá vào đúng chỗ**

Mở terminal, chạy:

```bash
mkdir -p ~/.oci
mv ~/Downloads/*.pem ~/.oci/oci_api_key.pem
chmod 600 ~/.oci/oci_api_key.pem
```

**d) Ghi lại region**

Nhìn thanh trên cùng của Oracle Cloud, chỗ hiện tên vùng. Ghi lại mã của nó:
- Frankfurt → `eu-frankfurt-1`
- Singapore → `ap-singapore-1`
- US East → `us-ashburn-1`

---

## Việc 3 — Tạo mạng riêng Tailscale (10 phút)

**Tailscale là gì:** một mạng riêng giữa các máy của bạn. Nhờ nó, chỉ máy tính của bạn mở được trang web này — không ai trên Internet vào được, kể cả khi họ biết địa chỉ.

1. Vào https://login.tailscale.com — đăng nhập bằng Google
2. Cài Tailscale lên **máy tính của bạn**:
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up
   ```
   Nó sẽ mở trình duyệt, bạn bấm đồng ý.

3. Tạo một "chìa khoá" cho máy chủ:
   - Vào https://login.tailscale.com/admin/settings/keys
   - Bấm **Generate auth key**
   - **Bật 3 công tắc này** (quan trọng):
     - ✅ **Reusable**
     - ✅ **Pre-approved**
     - ✅ **Tags** — rồi gõ `tag:server`
   - Bấm **Generate key**
   - Copy chuỗi bắt đầu bằng `tskey-auth-...` vào Notepad

> **Vì sao phải bật Tags:** không bật thì sau 90 ngày chìa khoá hết hạn, máy chủ tự rơi khỏi mạng, bạn mở trang web không được và sẽ không hiểu vì sao. Bật Tags thì nó không bao giờ hết hạn.

---

## Việc 4 — Điền thông tin vào một file (5 phút)

```bash
cd ~/VSCode/projects/AutoApply
cp infra/terraform/terraform.tfvars.example infra/terraform/terraform.tfvars
code infra/terraform/terraform.tfvars
```

File mở ra. Thay các giá trị mẫu bằng thứ bạn đã copy vào Notepad:

| Dòng trong file | Dán cái gì vào |
|---|---|
| `tenancy_ocid` | mã "tenancy" |
| `user_ocid` | mã "user" |
| `compartment_ocid` | **mã "tenancy" lần nữa** (giống hệt dòng trên) |
| `api_key_fingerprint` | chuỗi `aa:bb:cc:...` |
| `region` | `eu-frankfurt-1` (hoặc region của bạn) |
| `admin_cidr` | chạy `curl -s https://api.ipify.org` rồi dán kết quả **và thêm `/32`** vào cuối |
| `tailscale_auth_key` | chuỗi `tskey-auth-...` — **nhớ xoá dấu `#` ở đầu dòng** |

Ví dụ dòng `admin_cidr`: nếu lệnh trả về `14.161.20.5` thì bạn viết `admin_cidr = "14.161.20.5/32"`

Lưu file.

---

## Việc 5 — Chạy một lệnh, rồi đi pha cà phê (20–30 phút)

```bash
./deploy/deploy.sh
```

Xong. Không cần làm gì thêm. Nó tự làm hết: dựng máy chủ, cài mọi thứ, chuyển code lên, khởi động, và tự kiểm tra.

**Bạn sẽ thấy trên màn hình:**
```
==> Preflight
==> Secrets
==> Provisioning the machine
==> Waiting for the instance to join the tailnet
==> Copying the source
==> Building and starting          ← chỗ này lâu nhất, 5–10 phút
==> Verifying

Done.
  URL       https://internshipops.xxx.ts.net
  Username  admin
  Password  (một chuỗi ngẫu nhiên)
```

**Copy cái Password đó ra chỗ an toàn.**

### Nếu nó báo "No Ampere capacity"

Nghĩa là Oracle đang hết máy trống. Bình thường, không phải lỗi của bạn. Làm 1 trong 2:

**Cách nhanh nhất** — nâng tài khoản lên trả-theo-dùng (vẫn $0 với gói miễn phí, nhưng Oracle ưu tiên tài khoản này):
- Oracle Cloud → menu ☰ → **Billing & Cost Management** → **Upgrade and Payment** → bấm **Upgrade to Pay As You Go**

**Cách kiên nhẫn** — để máy tự thử lại 5 phút một lần:
```bash
while ! ./deploy/deploy.sh; do sleep 300; done
```
Cứ để chạy, đi làm việc khác. Khi nào có chỗ trống nó tự chạy tiếp.

### ⚠️ Việc quan trọng nhất sau khi xong

```bash
cat deploy/secrets.env
```

File này chứa chìa khoá mã hoá toàn bộ dữ liệu sao lưu của bạn. **Copy nội dung nó vào password manager, hoặc gửi vào email riêng của bạn.**

Mất file này = mất toàn bộ bản sao lưu, không cứu được. Không phải tôi doạ, đó là cách mã hoá hoạt động.

---

## Việc 6 — Đưa resume của bạn lên (10 phút)

```bash
./deploy/push-resume.sh ~/Documents/resume.pdf
```

Nó đọc resume, tách thành từng ý, rồi **hỏi bạn từng ý một**:

```
[exp.todd.1] Xây dựng dịch vụ FastAPI tại Todd Labs, giảm thời gian tạo báo cáo từ 40 phút xuống 6.
    organisation: Todd Labs    technologies: fastapi, python
    correct? [y/N]
```

Gõ `y` nếu đúng, Enter nếu sai.

**Tại sao phải ngồi xác nhận:** máy đọc PDF hay nhầm số liệu và ngày tháng. Mỗi CV nó viết sau này đều trích dẫn những ý này. Một ý bạn không đọc là một câu bạn phải tự bào chữa khi phỏng vấn.

Xong rồi mở trang web (cái URL ở Việc 5), đăng nhập, vào mục **Setup** để xem còn thiếu gì.

---

## Việc 7 — Kết nối Gmail (15 phút)

Bước này để hệ thống soạn sẵn email vào hộp thư của bạn. **Nó không gửi được** — không có quyền gửi, đó là thiết kế.

**Trên Google Cloud Console** (https://console.cloud.google.com):

1. Tạo project mới (đặt tên gì cũng được)
2. Menu ☰ → **APIs & Services** → **Library** → gõ `Gmail API` → bấm **Enable**
3. **APIs & Services** → **OAuth consent screen**
   - User type: chọn **External** → **Create**
   - Điền tên app và email của bạn
   - Đến mục **Test users** → **Add users** → nhập email của chính bạn
4. **⚠️ BƯỚC AI CŨNG QUÊN:** quay lại **OAuth consent screen**, tìm mục **Publishing status**, bấm **PUBLISH APP** → xác nhận

   > Không làm bước này thì **đúng 7 ngày sau** Google tự huỷ quyền, email ngừng hoạt động, và thông báo lỗi trông như bug của hệ thống. Mỗi tuần một lần. Rất khó chịu.

5. **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**
   - Application type: **Desktop app**
   - Bấm **Create** → bấm **Download JSON**

**Trên máy tính bạn:**

```bash
./deploy/push-gmail.sh ~/Downloads/client_secret_*.json
```

Trình duyệt tự mở, bạn đăng nhập Gmail và bấm **Allow**.

Sẽ có màn hình đỏ cảnh báo *"Google hasn't verified this app"* — bình thường, vì đây là app riêng của bạn. Bấm **Advanced** → **Go to (tên app) (unsafe)**.

---

## Xong rồi thì làm gì

Mở trang web, đăng nhập, vào **Settings** → mục **Job boards to watch** → thêm công ty bạn muốn theo dõi.

Ví dụ: gõ `stripe`, chọn loại `greenhouse`. Nghĩa là theo dõi trang tuyển dụng của Stripe.

Mỗi sáng 7 giờ (giờ Mỹ) hệ thống tự quét, tự chấm điểm, và hiện lên bảng điều khiển. **Bạn chọn job nào muốn nộp** — nó không tự chọn.

---

## Tóm tắt: bạn phải tự tay làm

| # | Việc | Thời gian | Có tự động được không |
|---|---|---|---|
| 1 | Đăng ký Oracle, chọn region | 20 phút | Không — cần thẻ + xác minh người thật |
| 2 | Lấy 4 mẩu thông tin | 5 phút | Không — phải bấm trong console |
| 3 | Tạo Tailscale key | 10 phút | Không — cần đăng nhập Google |
| 4 | Dán vào 1 file | 5 phút | Không — đây là thông tin của bạn |
| 5 | **Chạy `./deploy/deploy.sh`** | 30 phút chờ | ✅ **Tự động hết** |
| 6 | Xác nhận từng ý trong resume | 10 phút | Cố ý không tự động |
| 7 | Bật Gmail API + bấm Allow | 15 phút | Không — Google bắt buộc có người bấm |

Mọi thứ khác — dựng máy, cài đặt, cấu hình, khởi động, kiểm tra — đã nằm trong một lệnh ở Việc 5.

---

## Khi có gì đó hỏng

Đọc [RUNBOOK.md](RUNBOOK.md). Trong đó có bảng **"Trông như hỏng nhưng không phải"**.

Ví dụ hay gặp: một job được 88 điểm mà hệ thống không tự nộp đơn. **Đó là đúng.** Chọn job là việc của bạn, điểm số chỉ là gợi ý.
