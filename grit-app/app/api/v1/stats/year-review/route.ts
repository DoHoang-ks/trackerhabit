import { prisma } from "@/lib/prisma";
import { handler, ok } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { userToday, toDbDate, fromDbDate } from "@/lib/dates";
import { isDue } from "@/lib/streak";

export const dynamic = "force-dynamic";

// GET /stats/year-review — tổng kết năm (kiểu "Wrapped").
export const GET = handler(async (req) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;

  const today = userToday(auth.user.timezone, auth.user.dayCutoff);
  const from = today.minus({ days: 364 });

  const habits = await prisma.habit.findMany({
    where: { userId: auth.user.id, archivedAt: null },
    include: { schedules: { orderBy: { effectiveFrom: "desc" } } },
  });
  const logs = await prisma.log.findMany({
    where: { userId: auth.user.id, loggedDate: { gte: toDbDate(from), lte: toDbDate(today) } },
    select: { habitId: true, loggedDate: true, status: true },
  });

  const good = (s: string) => s === "completed" || s === "partial";
  const habitById = new Map(habits.map((h) => [h.id.toString(), h]));

  const perHabit = new Map<string, number>();
  const perMonth = new Map<string, number>();
  const activeDates = new Set<string>();
  const goodByDate = new Map<string, Set<string>>(); // date -> set habitId hoàn thành
  let totalCompletions = 0;

  for (const l of logs) {
    if (!good(l.status)) continue;
    totalCompletions++;
    const iso = fromDbDate(l.loggedDate).toISODate()!;
    const hid = l.habitId.toString();
    perHabit.set(hid, (perHabit.get(hid) ?? 0) + 1);
    perMonth.set(iso.slice(0, 7), (perMonth.get(iso.slice(0, 7)) ?? 0) + 1);
    activeDates.add(iso);
    if (!goodByDate.has(iso)) goodByDate.set(iso, new Set());
    goodByDate.get(iso)!.add(hid);
  }

  // ngày hoàn hảo: mọi habit đến hạn đều hoàn thành (và có ≥1 đến hạn)
  let perfectDays = 0;
  let cursor = from;
  for (let i = 0; i < 365; i++) {
    const iso = cursor.toISODate()!;
    let due = 0, done = 0;
    for (const h of habits) { if (!isDue(h.schedules, cursor)) continue; due++; if (goodByDate.get(iso)?.has(h.id.toString())) done++; }
    if (due > 0 && done === due) perfectDays++;
    cursor = cursor.plus({ days: 1 });
  }

  const topHabitId = [...perHabit.entries()].sort((a, b) => b[1] - a[1])[0];
  const topMonth = [...perMonth.entries()].sort((a, b) => b[1] - a[1])[0];
  const th = topHabitId ? habitById.get(topHabitId[0]) : null;

  return ok({
    total_completions: totalCompletions,
    active_days: activeDates.size,
    perfect_days: perfectDays,
    longest_streak: habits.reduce((m, h) => Math.max(m, h.longestStreak), 0),
    habits_count: habits.length,
    best_habit: th ? { name: th.name, icon: th.icon, color: th.color, count: topHabitId![1] } : null,
    best_month: topMonth ? { month: topMonth[0], count: topMonth[1] } : null,
  });
});
