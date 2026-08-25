import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Seed dữ liệu demo: 1 user, 1 goal, 1 habit + schedule + vài log.
async function main() {
  const email = "demo@grit.app";
  const passwordHash = await bcrypt.hash("demo1234", 12);

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, passwordHash, displayName: "Demo", timezone: "Asia/Ho_Chi_Minh" },
  });

  const goal = await prisma.goal.create({
    data: {
      userId: user.id,
      title: "Chạy 5km",
      description: "Mục tiêu 90 ngày",
      progressBaseline: 5,
      progressPercent: 22.5,
    },
  });

  const today = new Date();
  const dayOnly = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

  const habit = await prisma.habit.create({
    data: {
      goalId: goal.id,
      userId: user.id,
      name: "Đi bộ 5 phút",
      type: "timer",
      isFocus: true,
      schedules: {
        create: {
          scheduleType: "daily",
          weekdaysMask: 127,
          targetValue: 300, // 5 phút = 300 giây
          targetUnit: "giây",
          minPercent: 100,
          effectiveFrom: dayOnly(new Date(today.getTime() - 30 * 864e5)),
        },
      },
    },
  });

  // 3 ngày gần nhất completed để có streak demo.
  for (let i = 1; i <= 3; i++) {
    const d = dayOnly(new Date(today.getTime() - i * 864e5));
    await prisma.log.create({
      data: {
        habitId: habit.id,
        userId: user.id,
        loggedDate: d,
        status: "completed",
        durationSecs: 300,
        completedAt: new Date(),
        source: "manual",
      },
    });
  }
  await prisma.habit.update({
    where: { id: habit.id },
    data: { currentStreak: 3, longestStreak: 3, lastCompletedDate: dayOnly(new Date(today.getTime() - 864e5)) },
  });

  console.log("Seed xong:", { user: email, password: "demo1234", habitId: habit.id.toString() });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
