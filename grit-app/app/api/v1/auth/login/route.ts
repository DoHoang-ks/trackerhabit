import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handler, ok, fail } from "@/lib/http";
import { verifyPassword, signAccessToken, signRefreshToken } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/ratelimit";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const POST = handler(async (req) => {
  if (!rateLimit(`login:${clientIp(req)}`, 20, 15 * 60_000)) {
    return fail("RATE_LIMITED", "Quá nhiều lần thử. Vui lòng đợi ít phút.");
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("VALIDATION_ERROR", "Thiếu email hoặc mật khẩu.");

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  // Cùng thông báo cho sai email/sai mật khẩu → tránh user enumeration.
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return fail("UNAUTHENTICATED", "Email hoặc mật khẩu không đúng.");
  }

  return ok({
    access_token: signAccessToken(user.id),
    refresh_token: signRefreshToken(user.id),
  });
});
