// Nạp lịch sử ~1 năm cho habit demo (id 1) để minh hoạ màn Thống kê.
// Chạy: DATABASE_URL=... npx tsx scripts/seed-history.ts   (server/db đang chạy)
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const HABIT = 1n;
const USER = 1n;

function rnd(i: number) { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x); }
const dUTC = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

async function main() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const rows: Array<{ date: Date; status: string }> = [];

  for (let i = 364; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const p = weekend ? 0.62 : 0.84; // cuối tuần đạt thấp hơn
    const r = rnd(i);
    let status: string;
    if (r < p) status = "completed";
    else if (r < p + 0.05) status = "frozen";
    else status = "missed";
    rows.push({ date: dUTC(d), status });
  }

  for (const row of rows) {
    await prisma.log.upsert({
      where: { habitId_loggedDate: { habitId: HABIT, loggedDate: row.date } },
      create: {
        habitId: HABIT, userId: USER, loggedDate: row.date, status: row.status as any,
        durationSecs: row.status === "completed" ? 300 : null, source: "manual",
        completedAt: row.status === "completed" ? new Date() : null,
      },
      update: { status: row.status as any },
    });
  }

  // tính lại current/longest streak từ chuỗi vừa nạp
  let cur = 0, longest = 0, run = 0;
  for (const row of rows) {
    if (row.status === "completed" || row.status === "partial") { run++; longest = Math.max(longest, run); }
    else if (row.status === "frozen") { /* giữ */ }
    else { run = 0; }
  }
  // chuỗi hiện tại: đi ngược từ cuối
  for (let i = rows.length - 1; i >= 0; i--) {
    const s = rows[i].status;
    if (s === "completed" || s === "partial") cur++;
    else if (s === "frozen") continue;
    else break;
  }
  await prisma.habit.update({
    where: { id: HABIT },
    data: { currentStreak: cur, longestStreak: Math.max(longest, cur), freezeBalance: 2 },
  });

  const done = rows.filter((r) => r.status === "completed").length;
  console.log(`Nạp ${rows.length} ngày cho habit ${HABIT}: ${done} completed, streak hiện tại ${cur}, dài nhất ${Math.max(longest, cur)}`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
