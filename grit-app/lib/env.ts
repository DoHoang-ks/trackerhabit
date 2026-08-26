// Kiểm tra & cấp phát biến môi trường. Ở production, THIẾU secret sẽ ném lỗi ngay
// (không cho chạy với secret dev mặc định — token sẽ bị giả mạo được).
const isProd = process.env.NODE_ENV === "production";

function need(name: string, devFallback: string): string {
  const v = process.env[name];
  if (v && v.length > 0) return v;
  if (isProd) {
    throw new Error(`[env] Thiếu biến bắt buộc ${name} ở production. Đặt nó trước khi khởi động.`);
  }
  return devFallback; // chỉ dùng khi dev/test
}

export const ENV = {
  isProd,
  ACCESS_SECRET: need("JWT_ACCESS_SECRET", "dev-access-secret-change-me"),
  REFRESH_SECRET: need("JWT_REFRESH_SECRET", "dev-refresh-secret-change-me"),
  ACCESS_TTL: process.env.JWT_ACCESS_TTL || "15m",
  REFRESH_TTL: process.env.JWT_REFRESH_TTL || "30d",
  CRON_SECRET: process.env.INTERNAL_CRON_SECRET || (isProd ? "" : "dev-cron-secret"),
  VAPID_PUBLIC: process.env.VAPID_PUBLIC_KEY || "",
  VAPID_PRIVATE: process.env.VAPID_PRIVATE_KEY || "",
  VAPID_SUBJECT: process.env.VAPID_SUBJECT || "mailto:admin@grit.local",
  PUSH_ENABLED: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
  // Rate-limit: bật mặc định ở production; dev/test tắt để không cản e2e.
  RATELIMIT_ENABLED: process.env.RATELIMIT_ENABLED
    ? process.env.RATELIMIT_ENABLED === "true"
    : isProd,
};

if (isProd && !ENV.CRON_SECRET) {
  throw new Error("[env] Thiếu INTERNAL_CRON_SECRET ở production.");
}
