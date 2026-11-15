import { NextResponse } from "next/server";
import { MEALS } from "@/lib/meals";
import { nextSlot, planInEffect, slotsFromPlan } from "@/lib/send-plan";
import { bangkokNow, describeSend, formatThaiDate, greeting } from "@/lib/time";
import { lineConfigured } from "@/lib/server/supabase";
import { store } from "@/lib/server/store";
import { countActiveTargets } from "@/lib/server/line-targets";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1";
export const maxDuration = 15;

export async function GET() {
  try {
    const now = bangkokNow();
    const [cells, settings, logs, activeGroups, plan] = await Promise.all([
      store.getMonth(now.year, now.month),
      store.getSettings(),
      store.listLogs(8),
      countActiveTargets(),
      store.getPlan(),
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
    const effective = planInEffect(plan, now.iso);
    const slots = slotsFromPlan(effective, settings);
    const sentIds = slots
      .filter((slot) => slot.meals.some((meal) => sentMeals.includes(meal)))
      .map((slot) => slot.id);
    const upcoming = nextSlot({ now, slots, sentIds });
    const next = upcoming
      ? {
          date: upcoming.date,
          meal: upcoming.slot.meals[0],
          meals: upcoming.slot.meals,
          label: upcoming.slot.label,
          sendTime: upcoming.slot.time,
          due: upcoming.due,
        }
      : null;
    return NextResponse.json({
      ok: true,
      today: now.iso,
      todayLabel: formatThaiDate(now.iso),
      greeting: greeting(now),
      meals,
      next,
      plan: effective,
      logs,
      lineConfigured: await lineConfigured(),
      activeGroups,
      supabase: store.usingSupabase(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "โหลดข้อมูลไม่สำเร็จ";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
