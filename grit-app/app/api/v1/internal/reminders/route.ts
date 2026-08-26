import { DateTime } from "luxon";
import { prisma } from "@/lib/prisma";
import { handler, ok, fail } from "@/lib/http";
import { userToday, toDbDate, fromDbDate } from "@/lib/dates";
import { isDue } from "@/lib/streak";
import { sendPushToUser } from "@/lib/push";
import { ENV } from "@/lib/env";

export const dynamic = "force-dynamic";

// POST /internal/reminders — gửi nhắc nhở hằng ngày. Cron gọi ~mỗi 15 phút. Bảo vệ bằng cron secret.
export const POST = handler(async (req) => {
  const secret = req.headers.get("x-cron-secret");
  if (!ENV.CRON_SECRET || secret !== ENV.CRON_SECRET) return fail("FORBIDDEN", "Sai cron secret.");
  if (!ENV.PUSH_ENABLED) return ok({ ok: true, push: "disabled" });

  const users = await prisma.user.findMany({
    where: { reminderEnabled: true },
    select: { id: true, timezone: true, dayCutoff: true, reminderTime: true, reminderSentOn: true, _count: { select: { pushSubs: true } } },
  });

  let sentUsers = 0;
  for (const u of users) {
    if (u._count.pushSubs === 0) continue;

    const today = userToday(u.timezone, u.dayCutoff);
    const now = DateTime.now().setZone(u.timezone);
    const [rh, rm] = u.reminderTime.split(":").map((x) => parseInt(x, 10));
    if (now.hour * 60 + now.minute < rh * 60 + rm) continue; // chưa tới giờ nhắc

    const sentOn = u.reminderSentOn ? fromDbDate(u.reminderSentOn).toISODate() : null;
    if (sentOn === today.toISODate()) continue; // đã gửi hôm nay

    // đánh dấu đã xử lý hôm nay (kể cả khi 0 việc — tránh gửi lặp)
    await prisma.user.update({ where: { id: u.id }, data: { reminderSentOn: toDbDate(today) } });

    const habits = await prisma.habit.findMany({
      where: { userId: u.id, archivedAt: null },
      include: { schedules: { orderBy: { effectiveFrom: "desc" } } },
    });
    const logs = await prisma.log.findMany({
      where: { userId: u.id, loggedDate: toDbDate(today) },
      select: { habitId: true, status: true },
    });
    const statusBy = new Map<string, string>();
    for (const l of logs) statusBy.set(l.habitId.toString(), l.status);

    let remaining = 0;
    for (const h of habits) {
      if (!isDue(h.schedules, today)) continue;
      const st = statusBy.get(h.id.toString());
      if (st !== "completed" && st !== "partial" && st !== "frozen") remaining++;
    }

    if (remaining > 0) {
      await sendPushToUser(u.id, {
        title: "Grit Tracker 🔥",
        body: `Bạn còn ${remaining} việc hôm nay. Giữ ngọn lửa cháy!`,
        url: "/?tab=today",
      });
      sentUsers++;
    }
  }

  return ok({ ok: true, users: users.length, sent: sentUsers });
});
