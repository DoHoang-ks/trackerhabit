# Grit Tracker — Đóng gói & Phát hành v1

## Trạng thái v1
**Sẵn sàng (đã làm & kiểm thử):**
- Backend đầy đủ: auth (JWT), goals, habits (icon/màu/loại/lịch/hạn-mức-bỏ-lỡ-tuần), check-in streak/Freeze (server-authoritative), dashboard, reflections, cron end-of-day.
- Frontend PWA: Hôm nay (tap-to-complete) / Thói quen (thêm/sửa/xóa) / Thống kê (heatmap năm, tỉ lệ đạt, ngày mạnh nhất, reflection + lịch sử).
- Kiểm thử: unit 24/24, integration e2e 35/35, tsc sạch.
- **Hardening v1:** fail-fast khi thiếu secret ở prod, rate-limit `/auth/*`, security headers, `/api/v1/health`, Docker standalone, Caddy HTTPS, cron scheduler.

## Triển khai production (VPS + domain)
Yêu cầu: VPS có Docker + Docker Compose, một domain đã trỏ **A record** về IP VPS.

```bash
cd grit-app/deploy
cp .env.prod.example .env
# Sinh secret mạnh:
#   openssl rand -base64 48   (cho 2 JWT secret)
#   openssl rand -hex 32      (cho INTERNAL_CRON_SECRET)
# Điền DOMAIN, mật khẩu DB, các secret vào .env
docker compose -f docker-compose.prod.yml up -d --build
```
Caddy tự lấy chứng chỉ HTTPS (Let's Encrypt) cho `DOMAIN`. Truy cập `https://<DOMAIN>`.

**Kiểm tra sau khi lên:**
```bash
curl -s https://<DOMAIN>/api/v1/health   # {"status":"ok","db":"up"}
```

## iOS / Android
- **iOS:** Safari → mở domain → Share → **Add to Home Screen** (đã có apple-touch-icon, manifest, service worker).
- **Android:** cài trực tiếp hoặc bọc TWA (Bubblewrap) + `assetlinks.json` (xem design v2 mục VII).

## Vận hành
- **Cron:** container `cron` gọi `/api/v1/internal/evaluate` mỗi giờ (đúng cho mọi múi giờ vì endpoint idempotent theo tz+cut-off từng user).
- **Backup DB:** đặt lịch `pg_dump` volume `db-data` (khuyến nghị hằng ngày).
- **Log:** `docker compose logs -f app`.

## Còn thiếu — cần quyết định trước khi mở public rộng
Các mục này KHÔNG chặn chạy nội bộ/beta, nhưng nên cân nhắc cho public:
1. **Quên/đổi mật khẩu** — cần hạ tầng email (SMTP). Chưa có.
2. **Đăng xuất thu hồi refresh token** — hiện logout chỉ xóa token phía client (JWT stateless). Muốn thu hồi thật cần lưu jti/denylist.
3. **Xóa tài khoản & xuất dữ liệu** (quyền riêng tư dữ liệu cá nhân).
4. **Migration chuẩn**: hiện dùng `prisma db push`. Cho prod dài hạn nên tạo migration: `npx prisma migrate dev --name init` rồi đổi bước deploy sang `prisma migrate deploy`.
5. **Rate-limit đa-instance**: bộ đếm hiện in-memory (đúng cho 1 instance). Scale nhiều instance → chuyển Redis.
6. **Chính sách quyền riêng tư / điều khoản** (nếu công khai).

## Biến môi trường (app)
| Biến | Bắt buộc (prod) | Ghi chú |
|---|---|---|
| `DATABASE_URL` | ✅ | Chuỗi kết nối Postgres |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | ✅ | App **không khởi động** nếu thiếu ở prod |
| `INTERNAL_CRON_SECRET` | ✅ | Bảo vệ endpoint cron |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | — | Mặc định 15m / 30d |
| `RATELIMIT_ENABLED` | — | Mặc định bật ở prod |
