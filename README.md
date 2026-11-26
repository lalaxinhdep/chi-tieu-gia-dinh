# Chi tiêu gia đình

Web app (PWA) quản lý chi tiêu từ file sao kê ngân hàng/ví. File được đọc ngay trên thiết bị và không gửi lên server nào.

## Trạng thái

- [x] **Đọc file sao kê**
  - PDF Techcombank: sao kê thẻ tín dụng, sổ phụ tài khoản thanh toán. App tự đối chiếu tổng ghi nợ/ghi có với số in trên sao kê.
  - PDF VIB: sao kê thẻ tín dụng (cả bản khổ dọc bị cắt đôi cột số tiền sang trang sau). Phân loại thêm theo mã MCC.
  - Trả góp ghi rõ kỳ thứ mấy, món gì, tổng khoản (Techcombank lấy từ mục "B. Thông tin trả góp"). Nhập lại file cũ để cập nhật.
  - Excel/CSV bất kỳ: tự tìm dòng tiêu đề và đoán các cột Ngày, Ghi nợ, Ghi có, Số tiền, Diễn giải.
  - Ảnh chụp màn hình (`js/ocr.js`, `js/parsers/image.js`): đọc chữ ngay trên máy bằng Tesseract (WebAssembly). Mô hình tiếng Việt đọc chữ, mô hình tiếng Anh đọc số vì mô hình tiếng Việt hay nhầm 3 thành 5.
    - Ảnh lịch sử giao dịch: hiện bảng để soát ngày, nội dung, số tiền, chiều tiền rồi mới lưu. Dòng trùng ngày và số tiền với giao dịch đã có thì tự bỏ chọn.
    - Ảnh thông tin khoản vay: mở form khoản vay đã điền sẵn.
  - PDF có mật khẩu: app hỏi mật khẩu để mở và không lưu lại. Nhập lại file cũ thì giao dịch trùng tự bỏ qua.
- [x] **Lưu mã hóa trên máy**: IndexedDB, AES-GCM 256, khóa sinh từ mật khẩu bằng PBKDF2-SHA256 (600.000 vòng). Tự khóa khi rời app quá 5 phút.
- [x] **Phân loại bằng quy tắc** (`js/classify.js`). Thứ tự ưu tiên: sửa tay từng dòng > quy tắc đã học > quy tắc cấu trúc > từ khóa > mặc định.
  - Không tính: trả nợ thẻ tín dụng (cả hai phía), chuyển giữa tài khoản của thành viên gia đình, gửi/rút tiết kiệm, món mua đã chuyển sang trả góp (tính theo từng kỳ trả góp).
  - Hoàn tiền / trả hàng làm giảm chi của danh mục.
- [x] **Báo cáo**: tiền vào, tiền ra, chênh lệch; chi theo danh mục; thu theo nguồn; biểu đồ và bảng theo tháng.
  - Theo đối tác: chuyển cho ai, nhận từ ai, mua ở đâu, bao nhiêu lần, bao nhiêu tiền. Tên người gửi được tách từ nội dung chuyển khoản.
  - Theo tài khoản của tôi: chi và thu trên từng tài khoản, thẻ.
  - Tiết kiệm: nhập số dư đầu kỳ, app cộng tiền gửi, trừ tiền rút để ra số dư từng tháng.
- [x] **Khoản vay** (`js/loans.js`, `js/loans-ui.js`): nhiều khoản, mọi trường đều sửa tay được, để trống nếu chưa biết.
  - Lịch trả nợ dự kiến: gốc đều hoặc trả đều, tự đổi sang lãi thả nổi từ ngày hết cố định.
  - Thử trả trước: tính tiền lãi tiết kiệm được, có trừ phí trả trước nếu đã nhập phí.
  - Nhắc kỳ trả trong 7 ngày tới và ngày hết lãi cố định trong 90 ngày tới (hiện cả ở Tổng quan).
  - Ghi nhận các lần trả nợ, gợi ý giao dịch trong sao kê có số tài khoản vay. Danh mục chi "Trả nợ vay"; tiền giải ngân không tính là thu nhập.
- [x] **Danh mục tự thêm** (Cài đặt, hoặc ngay khi sửa giao dịch).
- [x] **Loại khỏi báo cáo** từng giao dịch, kèm ghi chú (ví dụ chuyển nhầm). App gợi ý loại luôn khoản ngược chiều cùng số tiền.
- [x] **Backup**: xuất file `.ctgd` đã mã hóa, nhập để gộp dữ liệu hoặc khôi phục trên máy mới.
- [x] **Đã đưa lên GitHub Pages:** https://lalaxinhdep.github.io/chi-tieu-gia-dinh/

## Cài lên điện thoại

- **Android (Chrome):** mở địa chỉ trên → menu ⋮ → **Cài đặt ứng dụng** (hoặc **Thêm vào màn hình chính**).
- **iPhone (Safari):** mở địa chỉ trên → nút Chia sẻ → **Thêm vào MH chính**.

Mỗi thiết bị có kho dữ liệu riêng. Muốn chuyển dữ liệu sang máy khác: xuất backup ở máy cũ, rồi chọn "Khôi phục từ backup" ở màn hình đầu của máy mới.

## Cập nhật app

Sửa code rồi chạy `git add -A`, `git commit -m "..."`, `git push`. GitHub Pages tự cập nhật sau khoảng 1 phút. Nhớ tăng `VERSION` trong `sw.js` để điện thoại tải bản mới.

## Chạy thử trên máy tính

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1
```

Sau đó mở http://localhost:8080 bằng Chrome hoặc Edge.

## Bảo mật

- Content-Security-Policy chỉ cho phép tải mã thư viện từ `cdn.jsdelivr.net` (pdf.js, Tesseract và dữ liệu mô hình chữ) và `cdn.sheetjs.com` (SheetJS). Không có địa chỉ nào để gửi dữ liệu đi.
  - Có thêm `'wasm-unsafe-eval'` để Tesseract chạy WebAssembly.
- `.gitignore` chặn `samples/`, mọi file `*.pdf`, `*.xlsx`, `*.xls`, `*.csv` và file backup.

## Thêm ngân hàng mới

Viết module trong `js/parsers/` có hai hàm `detect(text)` và `parse(pages)` theo mẫu `techcombank-credit.js`, rồi khai báo trong `js/parsers/index.js`.
