import { prisma } from "@/lib/prisma";
import { handler, ok } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { userToday, toDbDate, fromDbDate } from "@/lib/dates";
import { isDue } from "@/lib/streak";

export const dynamic = "force-dynamic";

// GET /stats/mood — tương quan giữa tâm trạng và tỉ lệ hoàn thành thói quen.
export const GET = handler(async (req) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;

  const today = userToday(auth.user.timezone, auth.user.dayCutoff);
  const days = 180;
  const from = today.minus({ days: days - 1 });

  const [habits, logs, moods] = await Promise.all([
    prisma.habit.findMany({ where: { userId: auth.user.id, archivedAt: null }, include: { schedules: { orderBy: { effectiveFrom: "desc" } } } }),
    prisma.log.findMany({ where: { userId: auth.user.id, loggedDate: { gte: toDbDate(from), lte: toDbDate(today) } }, select: { habitId: true, loggedDate: true, status: true } }),
    prisma.moodLog.findMany({ where: { userId: auth.user.id, loggedDate: { gte: toDbDate(from), lte: toDbDate(today) } }, select: { loggedDate: true, mood: true } }),
  ]);

  const good = (s?: string) => s === "completed" || s === "partial";
  const logMap = new Map<string, string>();
  for (const l of logs) logMap.set(`${l.habitId}|${fromDbDate(l.loggedDate).toISODate()}`, l.status);
  const moodByDate = new Map<string, number>();
  for (const m of moods) moodByDate.set(fromDbDate(m.loggedDate).toISODate()!, m.mood);

  // tỉ lệ hoàn thành mỗi ngày có ghi mood
  const perMood = new Map<number, { rateSum: number; n: number }>();
  let goodDays = { sum: 0, n: 0 }; // mood >= 4
  let lowDays = { sum: 0, n: 0 };  // mood <= 2
  let cursor = from;
  for (let i = 0; i < days; i++) {
    const iso = cursor.toISODate()!;
    const mood = moodByDate.get(iso);
    if (mood) {
      let due = 0, done = 0;
      for (const h of habits) { if (!isDue(h.schedules, cursor)) continue; due++; if (good(logMap.get(`${h.id}|${iso}`))) done++; }
      const rate = due ? done / due : 0;
      const pm = perMood.get(mood) || { rateSum: 0, n: 0 };
      pm.rateSum += rate; pm.n += 1; perMood.set(mood, pm);
      if (mood >= 4) { goodDays.sum += rate; goodDays.n += 1; }
      if (mood <= 2) { lowDays.sum += rate; lowDays.n += 1; }
    }
    cursor = cursor.plus({ days: 1 });
  }

  const by_mood = Array.from(perMood.entries())
    .map(([mood, v]) => ({ mood, avg_rate: Math.round((v.rateSum / v.n) * 100), count: v.n }))
    .sort((a, b) => a.mood - b.mood);

  return ok({
    entries: moods.length,
    by_mood,
    good_mood_rate: goodDays.n ? Math.round((goodDays.sum / goodDays.n) * 100) : null,
    low_mood_rate: lowDays.n ? Math.round((lowDays.sum / lowDays.n) * 100) : null,
  });
});
