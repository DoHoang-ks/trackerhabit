import { prisma } from "@/lib/prisma";
import { handler, ok } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { userToday, parseUserDate, toDbDate } from "@/lib/dates";
import { resolveSchedule, isScheduledDayForSchedule } from "@/lib/streak";

export const dynamic = "force-dynamic";

// GET /dashboard/today?date= — tất cả habit đến hạn hôm nay + trạng thái (màn "All Habits").
export const GET = handler(async (req) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;

  const tz = auth.user.timezone;
  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date");
  const day = (dateParam ? parseUserDate(dateParam, tz) : null) ?? userToday(tz, auth.user.dayCutoff);

  const habits = await prisma.habit.findMany({
    where: { userId: auth.user.id, archivedAt: null },
    orderBy: [{ isFocus: "desc" }, { createdAt: "asc" }],
    include: { schedules: { orderBy: { effectiveFrom: "desc" } }, goal: { select: { title: true } } },
  });

  const logs = await prisma.log.findMany({
    where: { userId: auth.user.id, loggedDate: toDbDate(day) },
    select: { habitId: true, status: true },
  });
  const statusByHabit = new Map<string, string>();
  for (const l of logs) statusByHabit.set(l.habitId.toString(), l.status);

  const items = habits.map((h) => {
    const sch = resolveSchedule(h.schedules, day);
    const due = !!sch && isScheduledDayForSchedule(sch, day);
    return {
      habit_id: h.id,
      name: h.name,
      type: h.type,
      is_focus: h.isFocus,
      color: h.color,
      icon: h.icon,
      goal_title: h.goal?.title ?? null,
      current_streak: h.currentStreak,
      freeze_balance: h.freezeBalance,
      target_value: sch?.targetValue ?? null,
      target_unit: sch?.targetUnit ?? null,
      due,
      today_status: due ? statusByHabit.get(h.id.toString()) ?? "pending" : "not_due",
    };
  });

  return ok({ date: day.toISODate(), items });
});
