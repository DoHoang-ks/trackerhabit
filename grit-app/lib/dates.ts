import { DateTime } from "luxon";

// Toàn bộ khái niệm "ngày" trong hệ thống tính theo timezone + cut-off của user (Mục VI.1).

// Ngày "hiện tại" của user, có tính cut-off. Nếu bây giờ < cut-off thì vẫn thuộc ngày hôm trước.
export function userToday(timezone: string, dayCutoff: string): DateTime {
  const now = DateTime.now().setZone(timezone);
  const [h, m] = dayCutoff.split(":").map((x) => parseInt(x, 10));
  const cutoff = now.set({ hour: h || 0, minute: m || 0, second: 0, millisecond: 0 });
  const logicalDay = now < cutoff ? now.minus({ days: 1 }) : now;
  return logicalDay.startOf("day");
}

// Parse "YYYY-MM-DD" thành DateTime (đầu ngày) trong timezone user.
export function parseUserDate(dateStr: string, timezone: string): DateTime | null {
  const dt = DateTime.fromISO(dateStr, { zone: timezone });
  if (!dt.isValid) return null;
  return dt.startOf("day");
}

// Chuyển DateTime (đầu ngày, tz user) → Date UTC để lưu cột @db.Date của Prisma.
// Dùng UTC midnight của chính ngày đó để cột Date lưu đúng Y-M-D, không lệch.
export function toDbDate(day: DateTime): Date {
  return new Date(Date.UTC(day.year, day.month - 1, day.day));
}

// Đọc cột @db.Date từ DB → DateTime đầu ngày (UTC-based, dùng để so sánh Y-M-D).
export function fromDbDate(d: Date): DateTime {
  return DateTime.fromObject(
    { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() },
    { zone: "utc" }
  ).startOf("day");
}

// Bit của thứ trong tuần: bit0=Mon ... bit6=Sun. Luxon weekday: 1=Mon..7=Sun.
export function weekdayBit(day: DateTime): number {
  return 1 << (day.weekday - 1);
}

export function isScheduledDay(day: DateTime, weekdaysMask: number): boolean {
  return (weekdaysMask & weekdayBit(day)) !== 0;
}

// Số ngày lệch giữa 2 ngày (bỏ qua giờ). a - b, tính theo lịch.
export function diffDays(a: DateTime, b: DateTime): number {
  return Math.round(a.startOf("day").diff(b.startOf("day"), "days").days);
}
