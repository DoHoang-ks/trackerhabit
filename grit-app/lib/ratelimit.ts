import { ENV } from "./env";

// Rate limiter in-memory đơn giản (đủ cho 1 instance ở v1). Nếu scale nhiều instance,
// thay bằng Redis. Tự tắt ở dev/test qua ENV.RATELIMIT_ENABLED.
type Hit = { count: number; reset: number };
const store = new Map<string, Hit>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  if (!ENV.RATELIMIT_ENABLED) return true;
  const now = Date.now();
  const h = store.get(key);
  if (!h || now > h.reset) {
    store.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  if (h.count >= limit) return false;
  h.count += 1;
  return true;
}

// IP client — tin X-Forwarded-For chỉ khi ở sau reverse proxy tin cậy (Caddy/Nginx).
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

// Dọn định kỳ để store không phình (best-effort).
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of store) if (now > v.reset) store.delete(k);
}, 60_000).unref?.();
