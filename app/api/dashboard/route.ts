import { NextResponse } from "next/server";
import { MEALS, type MealKey } from "@/lib/meals";
import { bangkokNow, describeSend, formatThaiDate, greeting, nextSend } from "@/lib/time";
import { lineConfigured } from "@/lib/server/supabase";
import { store } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const now = bangkokNow();
    const [cells, settings, logs] = await Promise.all([
      store.getMonth(now.year, now.month),
      store.getSettings(),
      store.listLogs(8),
    ]);
    const todayCells = cells.filter((cell) => cell.day === now.day);
    const meals = MEALS.map((meta) => {
      const cell = todayCells.find((item) => item.meal === meta.key);
      const setting = settings.find((item) => item.meal === meta.key)!;
      const log = logs.find((item) => item.menuDate === now.iso && item.meal === meta.key && item.status !== "failed" && item.status !== "test");
      const described = describeSend({
        enabled: setting.enabled,
        sendTime: setting.sendTime,
        dishText: cell?.dishText || "",
        status: log?.status,
        date: now.iso,
        now,
      });
      return {
        meal: meta.key,
        dishText: cell?.dishText || "",
        needsReview: Boolean(cell?.needsReview),
        sendTime: setting.sendTime,
        enabled: setting.enabled,
        state: described.state,
        stateLabel: described.label,
      };
    });
    const sentMeals = meals.filter((meal) => meal.state === "sent").map((meal) => meal.meal);
    const todayHasMenu = Object.fromEntries(
      MEALS.map((meta) => [meta.key, Boolean(todayCells.find((cell) => cell.meal === meta.key)?.dishText.trim())]),
    ) as Record<MealKey, boolean>;
    const next = nextSend({ now, settings, sentMeals, todayHasMenu });
    return NextResponse.json({
      ok: true,
      today: now.iso,
      todayLabel: formatThaiDate(now.iso),
      greeting: greeting(now),
      meals,
      next,
      logs,
      lineConfigured: lineConfigured(),
      supabase: store.usingSupabase(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "โหลดข้อมูลไม่สำเร็จ";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
