import { NextResponse } from "next/server";
import { bad } from "@/lib/server/http";
import { isMealKey } from "@/lib/meals";
import { daysInMonth } from "@/lib/time";
import { store, type MenuCell } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const year = Number(url.searchParams.get("year"));
  const month = Number(url.searchParams.get("month"));
  if (!year || month < 1 || month > 12) return bad("ระบุปีและเดือนให้ครบ");
  try {
    const cells = await store.getMonth(year, month);
    return NextResponse.json({ ok: true, year, month, days: daysInMonth(year, month), cells });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "อ่านเมนูไม่สำเร็จ" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as Partial<MenuCell> | null;
  if (!body?.year || !body.month || !body.day || !body.meal || !isMealKey(body.meal)) return bad("ข้อมูลมื้ออาหารไม่ครบ");
  if (body.day < 1 || body.day > daysInMonth(body.year, body.month)) return bad("วันที่ไม่อยู่ในเดือนนี้");
  try {
    await store.saveCell({
      year: body.year,
      month: body.month,
      day: body.day,
      meal: body.meal,
      dishText: String(body.dishText ?? "").trim(),
      needsReview: Boolean(body.needsReview),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "บันทึกไม่สำเร็จ" }, { status: 500 });
  }
}
