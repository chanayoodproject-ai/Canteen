import { NextResponse } from "next/server";
import { bad } from "@/lib/server/http";
import { isMealKey, MEAL_KEYS } from "@/lib/meals";
import {
  normalizeSendPlan,
  planInEffect,
  projectQuota,
  remainingSlotsToday,
  slotsFromPlan,
  validateSendPlan,
  type SendPlan,
} from "@/lib/send-plan";
import { bangkokNow } from "@/lib/time";
import { cachedActiveMemberCount, lineBotQuota } from "@/lib/server/line";
import { listSendTargetStates } from "@/lib/server/line-targets";
import { store, type SendSetting } from "@/lib/server/store";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1";
export const maxDuration = 15;

function sentSlotIds(date: string, slots: ReturnType<typeof slotsFromPlan>, logs: { menuDate: string; meal: string; status: string }[]) {
  return slots
    .filter((slot) =>
      slot.meals.some((meal) =>
        logs.some((log) => log.menuDate === date && log.meal === meal && (log.status === "sent" || log.status === "claimed")),
      ),
    )
    .map((slot) => slot.id);
}

export async function GET() {
  try {
    const now = bangkokNow();
    const [settings, plan, logs, targets, quota] = await Promise.all([
      store.getSettings(),
      store.getPlan(),
      store.listLogs(40),
      listSendTargetStates(),
      lineBotQuota("1"),
    ]);
    const members = await cachedActiveMemberCount(targets);
    const effective = planInEffect(plan, now.iso);
    const slots = slotsFromPlan(effective, settings);
    const upcomingSlots = remainingSlotsToday({
      slots,
      now,
      alreadySentIds: sentSlotIds(now.iso, slots, logs),
    });
    const used = quota.used ?? 0;
    const projection = projectQuota({
      pushesPerDay: slots.length,
      memberCount: members.count,
      year: now.year,
      month: now.month,
      todayDay: now.day,
      used,
      quotaBase: plan.quotaBase,
      remainingSlotsToday: upcomingSlots,
    });
    return NextResponse.json({
      ok: true,
      settings,
      plan,
      effectivePlan: effective,
      slots,
      logs,
      today: now.iso,
      clock: { year: now.year, month: now.month, day: now.day, hour: now.hour, minute: now.minute, iso: now.iso },
      quota: {
        used: quota.used,
        limit: quota.limit,
        type: quota.type,
        error: quota.error,
        memberCount: members.count,
        memberSource: members.source,
        remainingSlotsToday: upcomingSlots,
        projection,
      },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "อ่านเวลาส่งไม่สำเร็จ" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as { settings?: SendSetting[]; plan?: Partial<SendPlan> } | null;
  const settings = body?.settings ?? [];
  if (settings.length !== 4 || !MEAL_KEYS.every((meal) => settings.some((item) => item.meal === meal))) {
    return bad("ต้องมีเวลาส่งครบ 4 มื้อ");
  }
  for (const setting of settings) {
    if (!isMealKey(setting.meal) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(setting.sendTime))) return bad("เวลาต้องเป็นรูปแบบ 06:30");
    setting.enabled = setting.enabled !== false;
  }
  const plan = normalizeSendPlan(body?.plan);
  const invalid = validateSendPlan(plan);
  if (invalid) return bad(invalid);
  try {
    await Promise.all([store.saveSettings(settings), store.savePlan(plan)]);
    return NextResponse.json({ ok: true, plan, settings });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "บันทึกเวลาไม่สำเร็จ" }, { status: 500 });
  }
}
