import { NextResponse } from "next/server";
import { bad } from "@/lib/server/http";
import { isMealKey, MEAL_KEYS } from "@/lib/meals";
import { daysInMonth } from "@/lib/time";
import { store, type MenuCell } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    year?: number;
    month?: number;
    confirmOverwrite?: boolean;
    cells?: { day: number; meal: string; dishText: string; needsReview?: boolean }[];
  } | null;
  if (!body?.year || !body.month || body.month < 1 || body.month > 12) return bad("ระบุเดือนและปี");
  const limit = daysInMonth(body.year, body.month);
  const incoming = new Map<string, MenuCell>();
  for (const cell of body.cells ?? []) {
    if (!isMealKey(cell.meal) || cell.day < 1 || cell.day > limit) continue;
    incoming.set(`${cell.day}:${cell.meal}`, {
      year: body.year,
      month: body.month,
      day: cell.day,
      meal: cell.meal,
      dishText: String(cell.dishText ?? "").trim(),
      needsReview: Boolean(cell.needsReview),
    });
  }
  const cells: MenuCell[] = [];
  for (let day = 1; day <= limit; day += 1) {
    for (const meal of MEAL_KEYS) {
      cells.push(
        incoming.get(`${day}:${meal}`) ?? {
          year: body.year,
          month: body.month,
          day,
          meal,
          dishText: "",
          needsReview: false,
        },
      );
    }
  }
  try {
    const result = await store.saveMonth(body.year, body.month, cells, Boolean(body.confirmOverwrite));
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, conflict: true, filled: result.filled, error: `เดือนนี้มีเมนูอยู่แล้ว ${result.filled} รายการ` },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "บันทึกเดือนไม่สำเร็จ" }, { status: 500 });
  }
}
