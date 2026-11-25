import { NextRequest, NextResponse } from "next/server";
import type { BotId } from "@/lib/line-bots";
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
import { isLineBotEnabled, lineBotConfigured } from "@/lib/server/app-secrets";
import { getBotSchedule, saveBotSchedule } from "@/lib/server/bot-schedule";
import { cachedActiveMemberCountForBot, lineBotQuota } from "@/lib/server/line";
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

export async function GET(request: NextRequest) {
  try {
    const botParam = request.nextUrl.searchParams.get("bot");
    const bot: BotId = botParam === "2" ? "2" : "1";
    const now = bangkokNow();
    const [{ settings, plan }, allLogs, targets, quota, bot1Ready, bot2Ready, bot1Enabled, bot2Enabled] = await Promise.all([
      getBotSchedule(bot),
      store.listLogs(80),
      listSendTargetStates(),
      lineBotQuota(bot),
      lineBotConfigured("1"),
      lineBotConfigured("2"),
      isLineBotEnabled("1"),
      isLineBotEnabled("2"),
    ]);
    const logs = allLogs.filter((log) => (log.bot ?? "1") === bot).slice(0, 40);
    const members = await cachedActiveMemberCountForBot(targets, bot);
    const groupCount = targets.filter((t) => t.bots.includes(bot)).length;
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
      quotaBase: quota.limit ?? plan.quotaBase,
      remainingSlotsToday: upcomingSlots,
    });
    return NextResponse.json({
      ok: true,
      bot,
      bots: [
        { id: "1" as const, configured: bot1Ready, enabled: bot1Enabled },
        { id: "2" as const, configured: bot2Ready, enabled: bot2Enabled },
      ],
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
        groupCount,
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
  const body = (await request.json().catch(() => null)) as {
    bot?: string;
    settings?: SendSetting[];
    plan?: Partial<SendPlan>;
  } | null;
  const bot: BotId = body?.bot === "2" ? "2" : "1";
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
    await saveBotSchedule(bot, settings, plan);
    return NextResponse.json({ ok: true, bot, plan, settings });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "บันทึกเวลาไม่สำเร็จ" }, { status: 500 });
  }
}
