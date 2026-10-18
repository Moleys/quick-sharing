# ⚡ Quick Share

Công cụ chia sẻ file siêu nhanh: chạy 1 lệnh là có ngay trang web hiển thị mọi file trong thư mục `data/`, kèm **link online qua Cloudflare Tunnel** để gửi cho người khác tải từ bất kỳ đâu.

**Không cần cài thêm package nào** — chỉ cần Node.js.

## ✨ Tính năng

- 📂 Hiển thị toàn bộ file/thư mục trong `data/` (có tìm theo phân cấp, breadcrumb, icon theo loại file)
- ⬇ Tải file trực tiếp, hoặc 🔗 copy link chia sẻ cho từng file
- 📱 Nút QR — quét bằng điện thoại để mở trang (tiện khi đang cùng Wi‑Fi)
- ⬆ Upload bằng kéo & thả hoặc nút Upload (có thanh tiến trình) — gửi file từ điện thoại về máy cũng được
- 🌐 Link online miễn phí qua `cloudflared` quick tunnel (không cần tài khoản Cloudflare)
- 🗑 Xóa file/folder ngay trên web
- 🔒 Chế độ chỉ đọc (SHARE_READONLY=1), chặn path traversal

## 🚀 Chạy nhanh

1. Cài [Node.js](https://nodejs.org) (nếu chưa có).
2. Có cloudflared — chọn 1 trong 2 cách (chỉ cần làm 1 lần):

   - Đã có sẵn `cloudflared.exe` trong thư mục project (script tự nhận diện), **hoặc**
   - Cài vào hệ thống:

     ```powershell
     winget install --id Cloudflare.cloudflared
     ```

     (Tải tay: [cloudflared-windows-amd64.exe](https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe))

3. Chạy:

   ```powershell
   .\start.ps1
   ```

   hoặc nháy đúp `start.bat`.

Script sẽ:
- mở server tại `http://localhost:3000` (tự mở trình duyệt),
- tạo tunnel và in ra **link online** dạng `https://xxxx.trycloudflare.com` (tự copy vào clipboard).

Gửi link đó cho ai đó — họ thấy ngay danh sách file để tải. Link tồn tại đến khi bạn tắt script (mỗi lần chạy sẽ có link mới).

### Tuỳ chọn

```powershell
.\start.ps1 -Port 8080    # đổi port
.\start.ps1 -NoTunnel     # chỉ chạy trong mạng LAN, không tạo tunnel
```

## 🛠 Chạy thủ công (không qua script)

```powershell
node server.js 3000
# tab khác:
cloudflared tunnel --url http://localhost:3000
```

## 📁 Cấu trúc

```
quick-sharing/
├── server.js          # server Node thuần, không dependency
├── public/index.html  # giao diện web
├── data/              # 👈 bỏ file cần chia sẻ vào đây (hoặc upload qua web)
├── start.ps1 / .bat   # chạy 1 phát: server + tunnel
└── README.md
```

## 🔒 Bảo mật & lưu ý

- **Ai có link đều tải được file** — link tunnel hãy chỉ gửi cho người tin tưởng. Quick tunnel không có mật khẩu.
- Muốn chỉ cho xem/tải, không cho upload/xóa:

  ```powershell
  $env:SHARE_READONLY = "1"; node server.js
  ```

- Link `*.trycloudflare.com` là **tạm thời**, đổi sau mỗi lần chạy và chỉ dùng cho mục đích cá nhân. Nếu muốn link cố định + tên miền riêng, dùng *named tunnel* (cần tài khoản Cloudflare miễn phí):

  ```powershell
  cloudflared tunnel login
  cloudflared tunnel create quick-share
  cloudflared tunnel route dns quick-share share.tenmiencuaban.com
  cloudflared tunnel run --url http://localhost:3000 quick-share
  ```
