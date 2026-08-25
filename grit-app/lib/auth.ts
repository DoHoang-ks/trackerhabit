import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "./prisma";
import { fail } from "./http";
import { ENV } from "./env";

const ACCESS_SECRET = ENV.ACCESS_SECRET;
const REFRESH_SECRET = ENV.REFRESH_SECRET;
const ACCESS_TTL = ENV.ACCESS_TTL;
const REFRESH_TTL = ENV.REFRESH_TTL;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signAccessToken(userId: bigint): string {
  return jwt.sign({ sub: userId.toString() }, ACCESS_SECRET, {
    expiresIn: ACCESS_TTL,
  } as jwt.SignOptions);
}

export function signRefreshToken(userId: bigint): string {
  return jwt.sign({ sub: userId.toString(), typ: "refresh" }, REFRESH_SECRET, {
    expiresIn: REFRESH_TTL,
  } as jwt.SignOptions);
}

export function verifyRefreshToken(token: string): bigint | null {
  try {
    const payload = jwt.verify(token, REFRESH_SECRET) as { sub: string; typ?: string };
    if (payload.typ !== "refresh") return null;
    return BigInt(payload.sub);
  } catch {
    return null;
  }
}

export type AuthUser = {
  id: bigint;
  email: string;
  timezone: string;
  dayCutoff: string;
};

// Lấy user từ Bearer token. Trả null nếu không hợp lệ.
export async function authenticate(req: Request): Promise<AuthUser | null> {
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  try {
    const payload = jwt.verify(match[1], ACCESS_SECRET) as { sub: string };
    const user = await prisma.user.findUnique({
      where: { id: BigInt(payload.sub) },
      select: { id: true, email: true, timezone: true, dayCutoff: true },
    });
    return user;
  } catch {
    return null;
  }
}

// Helper cho route: yêu cầu auth, ném response 401 nếu thiếu.
export async function requireUser(
  req: Request
): Promise<{ user: AuthUser } | { response: Response }> {
  const user = await authenticate(req);
  if (!user) return { response: fail("UNAUTHENTICATED", "Cần đăng nhập.") };
  return { user };
}
