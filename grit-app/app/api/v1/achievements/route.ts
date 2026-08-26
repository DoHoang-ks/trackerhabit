import { prisma } from "@/lib/prisma";
import { handler, ok } from "@/lib/http";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Level từ XP (mỗi lần hoàn thành = 1 XP). Lên level L cần thêm 25*L XP so với level trước.
function levelFromXp(xp: number) {
  let level = 1;
  let spent = 0;
  let need = 25 * level;
  while (xp >= spent + need) {
    spent += need;
    level += 1;
    need = 25 * level;
  }
  return { level, xp_in_level: xp - spent, xp_to_next: need };
}

// GET /achievements — huy hiệu + level, tính từ dữ liệu hiện có (không lưu bảng riêng).
export const GET = handler(async (req) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;

  const habits = await prisma.habit.findMany({
    where: { userId: auth.user.id, archivedAt: null },
    select: { currentStreak: true, longestStreak: true, freezeBalance: true },
  });
  const totalCompletions = await prisma.log.count({
    where: { userId: auth.user.id, status: { in: ["completed", "partial"] } },
  });

  const longestEver = habits.reduce((m, h) => Math.max(m, h.longestStreak), 0);
  const bestCurrent = habits.reduce((m, h) => Math.max(m, h.currentStreak), 0);
  const activeCount = habits.length;
  const maxFreeze = habits.reduce((m, h) => Math.max(m, h.freezeBalance), 0);

  const lvl = levelFromXp(totalCompletions);

  const def = (key: string, icon: string, title: string, desc: string, value: number, target: number) => ({
    key, icon, title, desc, value: Math.min(value, target), target, unlocked: value >= target,
  });

  const badges = [
    def("first_step", "🌱", "Bước đầu tiên", "Hoàn thành lần đầu", totalCompletions, 1),
    def("streak_7", "🔥", "Chuỗi 7 ngày", "Đạt chuỗi 7 ngày", longestEver, 7),
    def("streak_30", "⚡", "Chuỗi 30 ngày", "Đạt chuỗi 30 ngày", longestEver, 30),
    def("streak_100", "💯", "Chuỗi 100 ngày", "Đạt chuỗi 100 ngày", longestEver, 100),
    def("streak_365", "👑", "Chuỗi 1 năm", "Đạt chuỗi 365 ngày", longestEver, 365),
    def("done_10", "✅", "10 lượt", "Hoàn thành 10 lượt", totalCompletions, 10),
    def("done_100", "🎯", "100 lượt", "Hoàn thành 100 lượt", totalCompletions, 100),
    def("done_500", "🏆", "500 lượt", "Hoàn thành 500 lượt", totalCompletions, 500),
    def("multi_habit", "🌈", "Đa nhiệm", "Có 3 thói quen cùng lúc", activeCount, 3),
    def("freeze_keeper", "❄️", "Người giữ lửa", "Tích được 1 Freeze", maxFreeze, 1),
  ];

  return ok({
    level: lvl.level,
    xp: totalCompletions,
    xp_in_level: lvl.xp_in_level,
    xp_to_next: lvl.xp_to_next,
    total_completions: totalCompletions,
    best_current_streak: bestCurrent,
    longest_ever: longestEver,
    unlocked_count: badges.filter((b) => b.unlocked).length,
    total_badges: badges.length,
    badges,
  });
});
