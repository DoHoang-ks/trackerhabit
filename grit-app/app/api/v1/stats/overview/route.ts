import { prisma } from "@/lib/prisma";
import { handler, ok } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { userToday, toDbDate, fromDbDate } from "@/lib/dates";
import { isDue } from "@/lib/streak";

export const dynamic = "force-dynamic";

// GET /stats/overview?days=365 — thống kê GỘP tất cả thói quen của user.
export const GET = handler(async (req) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;

  const url = new URL(req.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "365", 10) || 365, 7), 366);

  const today = userToday(auth.user.timezone, auth.user.dayCutoff);
  const from = today.minus({ days: days - 1 });

  const habits = await prisma.habit.findMany({
    where: { userId: auth.user.id, archivedAt: null },
    include: { schedules: { orderBy: { effectiveFrom: "desc" } } },
  });

  const logs = await prisma.log.findMany({
    where: { userId: auth.user.id, loggedDate: { gte: toDbDate(from), lte: toDbDate(today) } },
    select: { habitId: true, loggedDate: true, status: true },
  });
  const logMap = new Map<string, string>(); // `${habitId}|${iso}` -> status
  for (const l of logs) logMap.set(`${l.habitId}|${fromDbDate(l.loggedDate).toISODate()}`, l.status);

  const good = (s?: string) => s === "completed" || s === "partial";

  // Tổng hợp theo ngày: số habit đến hạn (due) và số đã hoàn thành (done).
  const daysArr: Array<{ date: string; due: number; done: number }> = [];
  const wd = Array.from({ length: 7 }, () => ({ due: 0, done: 0 }));
  let cursor = from;
  for (let i = 0; i < days; i++) {
    const iso = cursor.toISODate()!;
    let due = 0, done = 0;
    for (const h of habits) {
      if (!isDue(h.schedules, cursor)) continue;
      due++;
      if (good(logMap.get(`${h.id}|${iso}`))) done++;
    }
    daysArr.push({ date: iso, due, done });
    const w = (cursor.weekday + 6) % 7; // Mon=0
    wd[w].due += due; wd[w].done += done;
    cursor = cursor.plus({ days: 1 });
  }

  const sumRange = (arr: typeof daysArr) => arr.reduce((a, x) => ({ due: a.due + x.due, done: a.done + x.done }), { due: 0, done: 0 });
  const last30 = sumRange(daysArr.slice(-30));
  const thisWeek = sumRange(daysArr.slice(-7));
  const lastWeek = sumRange(daysArr.slice(-14, -7));
  const totalDone = daysArr.reduce((a, x) => a + x.done, 0);

  const weekdayRate = wd.map((w) => (w.due ? Math.round((w.done / w.due) * 100) : 0));

  return ok({
    from: from.toISODate(),
    to: today.toISODate(),
    active_habits: habits.length,
    best_current_streak: habits.reduce((m, h) => Math.max(m, h.currentStreak), 0),
    best_longest_streak: habits.reduce((m, h) => Math.max(m, h.longestStreak), 0),
    total_completions: totalDone,
    rate_30d: last30.due ? Math.round((last30.done / last30.due) * 100) : 0,
    weekday: weekdayRate,
    this_week_done: thisWeek.done,
    last_week_done: lastWeek.done,
    days: daysArr,
  });
});
