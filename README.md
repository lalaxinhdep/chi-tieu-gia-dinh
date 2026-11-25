# Chi tiêu gia đình

Web app (PWA) quản lý chi tiêu từ file sao kê ngân hàng/ví. File được đọc ngay trên thiết bị và không gửi lên server nào.

## Trạng thái

- [x] **Đọc file sao kê**
  - PDF Techcombank: sao kê thẻ tín dụng, sổ phụ tài khoản thanh toán. App tự đối chiếu tổng ghi nợ/ghi có với số in trên sao kê.
  - Excel/CSV bất kỳ: tự tìm dòng tiêu đề và đoán các cột Ngày, Ghi nợ, Ghi có, Số tiền, Diễn giải.
  - PDF có mật khẩu: app hỏi mật khẩu để mở và không lưu lại. Nhập lại file cũ thì giao dịch trùng tự bỏ qua.
- [x] **Lưu mã hóa trên máy**: IndexedDB, AES-GCM 256, khóa sinh từ mật khẩu bằng PBKDF2-SHA256 (600.000 vòng). Tự khóa khi rời app quá 5 phút.
- [x] **Phân loại bằng quy tắc** (`js/classify.js`). Thứ tự ưu tiên: sửa tay từng dòng > quy tắc đã học > quy tắc cấu trúc > từ khóa > mặc định.
  - Không tính: trả nợ thẻ tín dụng (cả hai phía), chuyển giữa tài khoản của thành viên gia đình, gửi/rút tiết kiệm, món mua đã chuyển sang trả góp (tính theo từng kỳ trả góp).
  - Hoàn tiền / trả hàng làm giảm chi của danh mục.
- [x] **Báo cáo**: tiền vào, tiền ra, chênh lệch; chi theo danh mục; thu theo nguồn; biểu đồ và bảng theo tháng.
- [x] **Backup**: xuất file `.ctgd` đã mã hóa, nhập để gộp dữ liệu hoặc khôi phục trên máy mới.
- [ ] Đưa lên HTTPS (ví dụ GitHub Pages) để cài lên điện thoại

## Chạy thử trên máy tính

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1
```

Sau đó mở http://localhost:8080 bằng Chrome hoặc Edge.

## Bảo mật

- Content-Security-Policy chỉ cho phép tải mã thư viện từ `cdn.jsdelivr.net` (pdf.js) và `cdn.sheetjs.com` (SheetJS). Không có địa chỉ nào để gửi dữ liệu đi.
- `.gitignore` chặn `samples/`, mọi file `*.pdf`, `*.xlsx`, `*.xls`, `*.csv` và file backup.

## Thêm ngân hàng mới

Viết module trong `js/parsers/` có hai hàm `detect(text)` và `parse(pages)` theo mẫu `techcombank-credit.js`, rồi khai báo trong `js/parsers/index.js`.
