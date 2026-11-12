import { NextResponse } from "next/server";
import { cronSecret, safeEqual } from "@/lib/secret";
import { runSend } from "@/lib/server/send";

export const dynamic = "force-dynamic";

async function handle(request: Request) {
  const expected = cronSecret();
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!expected || !safeEqual(token, expected)) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET ไม่ถูกต้อง" }, { status: 401 });
  }
  try {
    const result = await runSend({});
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "ส่งตามเวลาไม่สำเร็จ" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
