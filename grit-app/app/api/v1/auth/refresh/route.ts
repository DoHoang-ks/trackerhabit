import { z } from "zod";
import { handler, ok, fail } from "@/lib/http";
import { verifyRefreshToken, signAccessToken } from "@/lib/auth";

const Body = z.object({ refresh_token: z.string().min(1) });

export const POST = handler(async (req) => {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("VALIDATION_ERROR", "Thiếu refresh_token.");

  const userId = verifyRefreshToken(parsed.data.refresh_token);
  if (!userId) return fail("UNAUTHENTICATED", "Refresh token không hợp lệ hoặc đã hết hạn.");

  return ok({ access_token: signAccessToken(userId) });
});
