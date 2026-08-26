import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handler, created, fail } from "@/lib/http";
import { hashPassword, signAccessToken, signRefreshToken } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/ratelimit";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Mật khẩu tối thiểu 8 ký tự"),
  display_name: z.string().min(1).max(80).optional(),
  timezone: z.string().optional(),
});

export const POST = handler(async (req) => {
  if (!rateLimit(`register:${clientIp(req)}`, 10, 60 * 60_000)) {
    return fail("RATE_LIMITED", "Quá nhiều tài khoản tạo từ IP này. Vui lòng đợi.");
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "Dữ liệu không hợp lệ.", {
      fields: parsed.error.flatten().fieldErrors,
    });
  }
  const { email, password, display_name, timezone } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return fail("CONFLICT", "Email đã được đăng ký.");

  let user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      displayName: display_name,
      ...(timezone ? { timezone } : {}),
    },
    select: { id: true, email: true, displayName: true, timezone: true, dayCutoff: true },
  });
  // handle mặc định duy nhất theo id (user đổi được trong Cài đặt)
  await prisma.user.update({ where: { id: user.id }, data: { handle: `u${user.id}` } });

  return created({
    user,
    access_token: signAccessToken(user.id),
    refresh_token: signRefreshToken(user.id),
  });
});
