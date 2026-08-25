import { handler, ok, fail } from "@/lib/http";
import { runEndOfDayEvaluation } from "@/lib/cron";

// POST /api/v1/internal/evaluate — cron end-of-day. Bảo vệ bằng secret header, KHÔNG dùng JWT user.
// Gọi bởi scheduler (vd cron của VPS) sau mốc cut-off mỗi ngày.
export const POST = handler(async (req) => {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.INTERNAL_CRON_SECRET || secret !== process.env.INTERNAL_CRON_SECRET) {
    return fail("FORBIDDEN", "Sai cron secret.");
  }
  const result = await runEndOfDayEvaluation();
  return ok({ ok: true, ...result });
});
