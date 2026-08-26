import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handler, ok, fail } from "@/lib/http";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const Body = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});

// POST /push/subscribe — lưu PushSubscription của trình duyệt.
export const POST = handler(async (req) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("VALIDATION_ERROR", "Subscription không hợp lệ.");
  const { endpoint, keys } = parsed.data;

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { userId: auth.user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth },
    update: { userId: auth.user.id, p256dh: keys.p256dh, auth: keys.auth },
  });
  return ok({ ok: true });
});

// DELETE /push/subscribe?endpoint=... — hủy đăng ký.
export const DELETE = handler(async (req) => {
  const auth = await requireUser(req);
  if ("response" in auth) return auth.response;
  const endpoint = new URL(req.url).searchParams.get("endpoint");
  if (endpoint) await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: auth.user.id } });
  return ok({ ok: true });
});
