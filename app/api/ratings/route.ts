import { NextResponse } from "next/server";
import { bad } from "@/lib/server/http";
import { isMealKey, MEALS, type MealKey } from "@/lib/meals";
import { daysInMonth, isoFromParts } from "@/lib/time";
import { store } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const year = Number(url.searchParams.get("year"));
  const month = Number(url.searchParams.get("month"));
  if (!year || month < 1 || month > 12) return bad("ระบุปีและเดือน");
  try {
    const rows = await store.listRatings(year, month);
    const totalDays = daysInMonth(year, month);
    const groups = new Map<string, { menu: number[]; taste: number[] }>();
    for (let day = 1; day <= totalDays; day += 1) {
      for (const meal of MEALS) groups.set(`${isoFromParts(year, month, day)}:${meal.key}`, { menu: [], taste: [] });
    }
    let menuSum = 0;
    let menuCount = 0;
    let tasteSum = 0;
    let tasteCount = 0;
    for (const row of rows) {
      const bucket = groups.get(`${row.menuDate}:${row.meal}`);
      if (!bucket) continue;
      if (row.menuScore) {
        bucket.menu.push(row.menuScore);
        menuSum += row.menuScore;
        menuCount += 1;
      }
      if (row.tasteScore) {
        bucket.taste.push(row.tasteScore);
        tasteSum += row.tasteScore;
        tasteCount += 1;
      }
    }
    const days = [...groups.entries()].map(([key, value]) => {
      const [menuDate, meal] = key.split(":");
      return {
        menuDate,
        meal: meal as MealKey,
        menuAvg: average(value.menu),
        menuCount: value.menu.length,
        tasteAvg: average(value.taste),
        tasteCount: value.taste.length,
      };
    });
    const byMeal = MEALS.map((meal) => {
      const related = days.filter((day) => day.meal === meal.key);
      const menuCount = related.reduce((sum, day) => sum + day.menuCount, 0);
      const tasteCount = related.reduce((sum, day) => sum + day.tasteCount, 0);
      const menuTotal = related.reduce((sum, day) => sum + (day.menuAvg ?? 0) * day.menuCount, 0);
      const tasteTotal = related.reduce((sum, day) => sum + (day.tasteAvg ?? 0) * day.tasteCount, 0);
      return {
        meal: meal.key,
        menuAvg: menuCount ? round(menuTotal / menuCount) : null,
        tasteAvg: tasteCount ? round(tasteTotal / tasteCount) : null,
        menuCount,
        tasteCount,
      };
    });
    return NextResponse.json({
      ok: true,
      summary: {
        menuAvg: menuCount ? round(menuSum / menuCount) : null,
        tasteAvg: tasteCount ? round(tasteSum / tasteCount) : null,
        menuCount,
        tasteCount,
        people: rows.length,
      },
      byMeal,
      days: days.filter((day) => day.menuCount || day.tasteCount),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "อ่านคะแนนไม่สำเร็จ" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    menuDate?: string;
    meal?: string;
    lineUserId?: string;
    kind?: string;
    score?: number;
  } | null;
  if (!body?.menuDate || !body.meal || !isMealKey(body.meal)) return bad("ข้อมูลคะแนนไม่ครบ");
  if (body.kind !== "menu" && body.kind !== "taste") return bad("ระบุว่าให้คะแนนเมนูหรือรสชาติ");
  const score = Number(body.score);
  if (!Number.isInteger(score) || score < 1 || score > 5) return bad("คะแนนต้องเป็น 1 ถึง 5");
  try {
    const saved = await store.upsertRating({
      menuDate: body.menuDate,
      meal: body.meal,
      lineUserId: body.lineUserId || "preview-admin",
      menuScore: body.kind === "menu" ? score : undefined,
      tasteScore: body.kind === "taste" ? score : undefined,
    });
    return NextResponse.json({ ok: true, updated: saved.updated, rating: saved.row });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "บันทึกคะแนนไม่สำเร็จ" }, { status: 500 });
  }
}

function average(values: number[]) {
  if (!values.length) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}
