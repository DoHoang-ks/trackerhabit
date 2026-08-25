import { prisma } from "@/lib/prisma";
import { handler, ok } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { userToday, parseUserDate, toDbDate } from "@/lib/dates";
import { resolveSchedule, isScheduledDayForSchedule } from "@/lib/streak";

export const dynamic = "force-dynamic";

// GET /dashboard/focus?date= — card ưu tiên hôm nay (Focus Dashboard 1 card/ngày).
export const GET = handler(async (req) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;

  const tz = auth.user.timezone;
  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date");
  const day =
    (dateParam ? parseUserDate(dateParam, tz) : null) ?? userToday(tz, auth.user.dayCutoff);

  const habits = await prisma.habit.findMany({
    where: { userId: auth.user.id, archivedAt: null },
    orderBy: [{ isFocus: "desc" }, { createdAt: "asc" }],
    include: { schedules: { orderBy: { effectiveFrom: "desc" } } },
  });

  // Chọn habit đến hạn hôm nay, ưu tiên is_focus.
  const dueToday = habits.filter((h) => {
    const s = resolveSchedule(h.schedules, day);
    return s && isScheduledDayForSchedule(s, day);
  });

  const focusHabit = dueToday[0] ?? null;
  let focus: any = null;

  if (focusHabit) {
    const log = await prisma.log.findUnique({
      where: { habitId_loggedDate: { habitId: focusHabit.id, loggedDate: toDbDate(day) } },
      select: { status: true },
    });
    const sch = resolveSchedule(focusHabit.schedules, day);
    focus = {
      habit_id: focusHabit.id,
      name: focusHabit.name,
      type: focusHabit.type,
      color: focusHabit.color,
      icon: focusHabit.icon,
      target_value: sch?.targetValue ?? null,
      target_unit: sch?.targetUnit ?? null,
      today_status: log?.status ?? "pending",
      current_streak: focusHabit.currentStreak,
      freeze_balance: focusHabit.freezeBalance,
    };
  }

  return ok({
    date: day.toISODate(),
    focus,
    has_more: dueToday.length > 1,
  });
});
