import { NextResponse } from "next/server";

// Mã lỗi nghiệp vụ — khớp bảng trong grit-tracker-api.md §0.
export const ErrorCode = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  BACKFILL_WINDOW_EXCEEDED: 422,
  NOT_SCHEDULED_DAY: 422,
  LOG_LOCKED: 409,
  DUPLICATE_REFLECTION: 409,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
} as const;

export type ErrorCodeName = keyof typeof ErrorCode;

// BigInt/Decimal không serialize được bằng JSON.stringify mặc định → chuẩn hóa.
function normalize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    // Prisma Decimal có toFixed/toString; nhận diện qua toJSON hoặc s/d/e của Decimal.js
    const anyVal = value as { toFixed?: unknown; toJSON?: () => unknown };
    if (typeof anyVal.toFixed === "function" && "s" in (value as object)) {
      return Number((value as { toString(): string }).toString());
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = normalize(v);
    }
    return out;
  }
  return value;
}

export function ok(data: unknown, status = 200) {
  return NextResponse.json(normalize(data) as object, { status });
}

export function created(data: unknown) {
  return ok(data, 201);
}

export function noContent() {
  return new NextResponse(null, { status: 204 });
}

export function fail(code: ErrorCodeName, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { error: { code, message, ...(extra ?? {}) } },
    { status: ErrorCode[code] }
  );
}

// Bọc handler để bắt lỗi chưa lường và trả JSON thống nhất.
export function handler(fn: (req: Request, ctx: any) => Promise<Response>) {
  return async (req: Request, ctx: any): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (err: any) {
      if (err?.code === "P2002") {
        return fail("CONFLICT", "Bản ghi trùng ràng buộc duy nhất.");
      }
      console.error("[api] unhandled:", err);
      return fail("INTERNAL", "Lỗi hệ thống, thử lại sau.");
    }
  };
}
