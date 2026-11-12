import { NextResponse } from "next/server";
import { bad } from "@/lib/server/http";
import { isMealKey } from "@/lib/meals";
import { runSend } from "@/lib/server/send";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { meal?: string; date?: string; mode?: string } | null;
  if (!body?.meal || !isMealKey(body.meal)) return bad("ระบุมื้ออาหาร");
  try {
    const result = await runSend({
      onlyMeal: body.meal,
      date: body.date,
      force: body.mode === "now",
      test: body.mode === "test",
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "ส่งไม่สำเร็จ" }, { status: 500 });
  }
}
