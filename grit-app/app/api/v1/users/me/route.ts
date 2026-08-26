import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handler, ok, fail } from "@/lib/http";
import { requireUser } from "@/lib/auth";

export const GET = handler(async (req) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;

  const user = await prisma.user.findUnique({
    where: { id: auth.user.id },
    select: { id: true, email: true, displayName: true, timezone: true, dayCutoff: true, reminderEnabled: true, reminderTime: true, handle: true },
  });
  return ok(user);
});

const Patch = z.object({
  display_name: z.string().min(1).max(80).optional(),
  timezone: z.string().optional(),
  day_cutoff: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Định dạng HH:mm").optional(),
  reminder_enabled: z.boolean().optional(),
  reminder_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Định dạng HH:mm").optional(),
  handle: z.string().regex(/^[a-z0-9_]{3,20}$/, "3-20 ký tự: a-z, 0-9, _").optional(),
});

export const PATCH = handler(async (req) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;

  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "Dữ liệu không hợp lệ.", {
      fields: parsed.error.flatten().fieldErrors,
    });
  }
  const { display_name, timezone, day_cutoff, reminder_enabled, reminder_time, handle } = parsed.data;

  if (handle !== undefined) {
    const taken = await prisma.user.findFirst({ where: { handle, id: { not: auth.user.id } }, select: { id: true } });
    if (taken) return fail("CONFLICT", "@" + handle + " đã có người dùng.");
  }

  const user = await prisma.user.update({
    where: { id: auth.user.id },
    data: {
      ...(display_name !== undefined ? { displayName: display_name } : {}),
      ...(timezone !== undefined ? { timezone } : {}),
      ...(day_cutoff !== undefined ? { dayCutoff: day_cutoff } : {}),
      ...(reminder_enabled !== undefined ? { reminderEnabled: reminder_enabled } : {}),
      ...(reminder_time !== undefined ? { reminderTime: reminder_time } : {}),
      ...(handle !== undefined ? { handle } : {}),
    },
    select: { id: true, email: true, displayName: true, timezone: true, dayCutoff: true, reminderEnabled: true, reminderTime: true, handle: true },
  });
  // Lưu ý: đổi tz/cut-off không hồi tố streak quá khứ (chỉ áp cho cron kế tiếp).
  return ok(user);
});
