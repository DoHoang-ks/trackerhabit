import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

// GET /api/v1/health — kiểm tra sống + kết nối DB (dùng cho uptime/load balancer).
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", db: "up" });
  } catch {
    return NextResponse.json({ status: "degraded", db: "down" }, { status: 503 });
  }
}
