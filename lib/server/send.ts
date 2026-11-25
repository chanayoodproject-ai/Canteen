import { fallbackSendBot, pickSendBot, type BotId } from "@/lib/line-bots";
import { MEAL_MAP, type MealKey } from "@/lib/meals";
import {
  planInEffect,
  skipReasonForSlot,
  slotsFromPlan,
  type SendSlot,
} from "@/lib/send-plan";
import { bangkokNow, hasTimeArrived, timeToMinutes, type BangkokNow } from "@/lib/time";
import { anyLineBotHasCredentials, configuredLineBots } from "@/lib/server/app-secrets";
import { getBotSchedule } from "@/lib/server/bot-schedule";
import { pushFlex } from "@/lib/server/line";
import { listSendTargetStates, markLineBotLeft, resolveLineTarget } from "@/lib/server/line-targets";
import { summarizeTargets, type TargetOutcome } from "@/lib/line-target-plan";
import { lineConfigured, maskTarget } from "@/lib/server/supabase";
import { dishOn, store } from "@/lib/server/store";

const STALE_CLAIM_MS = 5 * 60 * 1000;
const AUTO_SEND_WINDOW_MINUTES = 10;

/** Why cron should skip this group for a meal, or null if it should send. */
export function skipReasonForTarget(input: {
  asked: boolean;
  log: { status: string; detail: string | null } | null;
}): string | null {
  return skipReasonForSlot({
    combined: false,
    askedMeals: input.asked ? ["breakfast"] : [],
    logs: input.log ? [{ meal: "breakfast", status: input.log.status, detail: input.log.detail }] : [],
  });
}

export function isWithinAutoSendWindow(now: BangkokNow, sendTime: string) {
  const start = timeToMinutes(sendTime);
  const nowMin = now.hour * 60 + now.minute;
  const end = Math.min(start + AUTO_SEND_WINDOW_MINUTES, 24 * 60);
  return nowMin >= start && nowMin < end;
}

export async function runSend(options: {
  onlyMeal?: MealKey;
  onlyBot?: BotId;
  date?: string;
  force?: boolean;
  test?: boolean;
  dryRun?: boolean;
}) {
  const now = bangkokNow();
  const date = options.date ?? now.iso;
  const [year, month] = date.split("-").map(Number);
  const [monthCells, configured, allTargets] = await Promise.all([
    store.getMonth(year, month),
    configuredLineBots(),
    listSendTargetStates(),
  ]);

  const botsToRun: BotId[] = options.onlyBot ? [options.onlyBot] : ["1", "2"];
  const results: {
    bot: BotId;
    meal: MealKey;
    meals: MealKey[];
    slotId: string;
    status: string;
    detail: string;
    targets?: TargetOutcome[];
  }[] = [];

  for (const botId of botsToRun) {
    const botTargets = allTargets.filter((target) => {
      if (options.onlyBot) return target.bots.includes(botId);
      const picked = pickSendBot({
        date,
        bot1Configured: configured.bot1,
        bot2Configured: configured.bot2,
        botsInGroup: target.bots,
      });
      return picked === botId;
    });

    // When running cron for both bots, skip Bot 2 cleanly if it has no assigned groups yet.
    if (!options.onlyBot && botId === "2" && botTargets.length === 0) {
      continue;
    }

    const { settings, plan } = await getBotSchedule(botId);
    const slots: SendSlot[] = options.onlyMeal
      ? [
          {
            id: options.onlyMeal,
            time: settings.find((item) => item.meal === options.onlyMeal)?.sendTime ?? "00:00",
            meals: [options.onlyMeal],
            label: MEAL_MAP[options.onlyMeal].full,
            combined: false,
          },
        ]
      : slotsFromPlan(planInEffect(plan, date), settings);

    for (const slot of slots) {
      const dishes = slot.meals
        .map((meal) => ({ meal, dishText: dishOn(monthCells, date, meal) }))
        .filter((item) => item.dishText.trim());
      const firstMeal = slot.meals[0] ?? "lunch";
      if (!options.force && !options.test && !options.onlyMeal && date !== now.iso) {
        results.push({ bot: botId, meal: firstMeal, meals: slot.meals, slotId: slot.id, status: "skipped", detail: "ตัวตั้งเวลาส่งเฉพาะเมนูของวันนี้" });
        continue;
      }
      if (!options.force && !options.test && !hasTimeArrived(now, slot.time)) {
        results.push({ bot: botId, meal: firstMeal, meals: slot.meals, slotId: slot.id, status: "skipped", detail: `ยังไม่ถึง ${slot.time}` });
        continue;
      }
      if (!options.force && !options.test && !isWithinAutoSendWindow(now, slot.time)) {
        results.push({ bot: botId, meal: firstMeal, meals: slot.meals, slotId: slot.id, status: "skipped", detail: `เลยช่วงส่ง ${slot.time} แล้ว` });
        continue;
      }
      if (!dishes.length) {
        results.push({ bot: botId, meal: firstMeal, meals: slot.meals, slotId: slot.id, status: "skipped", detail: "วันนี้ยังไม่มีข้อความเมนู" });
        continue;
      }

      if (options.test) {
        const chosenTarget = botTargets[0] ?? allTargets[0];
        const testTarget = chosenTarget?.id ?? (await resolveLineTarget());
        const testBot: BotId = options.onlyBot ?? botId;
        const pushed = await pushFlex({ date, meals: dishes, to: testTarget, bot: testBot });
        for (const item of dishes) {
          await store.insertLog({
            menuDate: date,
            meal: item.meal,
            status: "test",
            target: maskTarget(testTarget),
            targetId: testTarget,
            bot: testBot,
            detail: pushed.ok
              ? `ส่งทดสอบแล้วด้วยบอท ${testBot}`
              : pushed.simulated
                ? "จำลองข้อความทดสอบ เพราะยังไม่มี LINE หรือปิดบอทไว้"
                : pushed.error,
          });
        }
        results.push({
          bot: testBot,
          meal: firstMeal,
          meals: slot.meals,
          slotId: slot.id,
          status: pushed.ok ? "test" : pushed.simulated ? "simulated" : "failed",
          detail: pushed.ok ? `ส่งทดสอบแล้วด้วยบอท ${testBot}` : pushed.error || "จำลองการส่ง",
        });
        continue;
      }

      if (!(await lineConfigured())) {
        const [hasCreds, fallbackTarget] = await Promise.all([anyLineBotHasCredentials(), resolveLineTarget()]);
        if (hasCreds && fallbackTarget) {
          results.push({
            bot: botId,
            meal: firstMeal,
            meals: slot.meals,
            slotId: slot.id,
            status: "skipped",
            detail: "ปิดการใช้งาน LINE Bot ไว้",
          });
          continue;
        }
        if (options.dryRun) {
          results.push({
            bot: botId,
            meal: firstMeal,
            meals: slot.meals,
            slotId: slot.id,
            status: "would_simulate",
            detail: "ยังไม่ได้ตั้งค่า LINE จึงจะบันทึกเป็นการจำลอง",
          });
          continue;
        }
        const simulated = await store.latestLog(date, firstMeal, ["simulated"]);
        if (simulated && !options.force) {
          results.push({
            bot: botId,
            meal: firstMeal,
            meals: slot.meals,
            slotId: slot.id,
            status: "skipped",
            detail: "จำลองการส่งไปแล้ว ตั้งค่า LINE แล้วกดส่งทดสอบ",
          });
          continue;
        }
        for (const item of dishes) {
          await store.insertLog({
            menuDate: date,
            meal: item.meal,
            status: "simulated",
            target: null,
            bot: botId,
            detail: "ยังไม่ได้ตั้งค่า LINE จึงบันทึกเป็นการจำลอง ไม่ได้ส่งจริง",
          });
        }
        results.push({ bot: botId, meal: firstMeal, meals: slot.meals, slotId: slot.id, status: "simulated", detail: "จำลองการส่งแล้ว" });
        continue;
      }

      const targetsForSlot = botTargets;
      if (targetsForSlot.length === 0) {
        results.push({
          bot: botId,
          meal: firstMeal,
          meals: slot.meals,
          slotId: slot.id,
          status: "skipped",
          detail: `ยังไม่มีกลุ่มที่บอท ${botId} ใช้งานได้`,
        });
        continue;
      }

      const outcomes: TargetOutcome[] = [];
      for (const target of targetsForSlot) {
        outcomes.push(
          await sendSlotToTarget({
            date,
            slot,
            dishes,
            targetId: target.id,
            botsInGroup: target.bots,
            bot1Configured: configured.bot1,
            bot2Configured: configured.bot2,
            preferredBot: botId,
            dryRun: options.dryRun,
          }),
        );
      }
      const summary = summarizeTargets(outcomes);
      results.push({ bot: botId, meal: firstMeal, meals: slot.meals, slotId: slot.id, ...summary, targets: outcomes });
    }
  }

  return { date, bangkok: now, results };
}

async function sendSlotToTarget(input: {
  date: string;
  slot: SendSlot;
  dishes: { meal: MealKey; dishText: string }[];
  targetId: string;
  botsInGroup: BotId[];
  bot1Configured: boolean;
  bot2Configured: boolean;
  preferredBot: BotId;
  dryRun?: boolean;
}): Promise<TargetOutcome> {
  const { date, slot, dishes, targetId } = input;
  const masked = maskTarget(targetId);
  const askedMeals: MealKey[] = [];
  const logs: { meal: MealKey; status: string; detail: string | null }[] = [];
  for (const meal of slot.meals) {
    if (await store.hasMenuAsk(date, meal, targetId)) askedMeals.push(meal);
    const already = await store.latestLog(date, meal, ["sent", "claimed"], targetId);
    if (already) logs.push({ meal, status: already.status, detail: already.detail });
  }
  const skip = skipReasonForSlot({ combined: slot.combined, askedMeals, logs });
  if (skip) {
    return { target: masked, status: "skipped", detail: skip };
  }
  const pickInput = {
    date,
    bot1Configured: input.bot1Configured,
    bot2Configured: input.bot2Configured,
    botsInGroup: input.botsInGroup,
  };
  const bot = input.preferredBot;
  const isConfigured = bot === "1" ? input.bot1Configured : input.bot2Configured;
  if (!isConfigured) {
    return { target: masked, status: "skipped", detail: `บอท ${bot} ยังไม่ได้ตั้งค่าหรือปิดใช้งานอยู่` };
  }
  if (input.dryRun) {
    return { target: masked, status: "would_send", detail: `จะส่ง${slot.label}เข้ากลุ่ม ${masked} ด้วยบอท ${bot}` };
  }

  const claims = [];
  for (const item of dishes) {
    let claim = await store.insertLog({
      menuDate: date,
      meal: item.meal,
      status: "claimed",
      target: masked,
      targetId,
      bot,
      detail: "กำลังส่ง",
    });
    if (!claim) {
      const open = await store.latestLog(date, item.meal, ["claimed", "sent"], targetId);
      if (open?.status === "claimed" && Date.now() - new Date(open.createdAt).getTime() > STALE_CLAIM_MS) {
        await store.updateLog(open.id, { status: "failed", detail: "ค้างระหว่างส่ง จึงลองใหม่" });
        claim = await store.insertLog({
          menuDate: date,
          meal: item.meal,
          status: "claimed",
          target: masked,
          targetId,
          bot,
          detail: "กำลังส่ง",
        });
      }
    }
    if (claim) claims.push(claim);
  }
  if (!claims.length) return { target: masked, status: "skipped", detail: "มีงานส่งรอบนี้อยู่แล้ว" };

  const first = await pushFlex({ date, meals: dishes, to: targetId, bot });
  const sentDetail = slot.combined
    ? `ส่งรวม${slot.label}แล้วด้วยบอท ${bot}`
    : `ส่งเข้า LINE แล้วด้วยบอท ${bot}`;
  if (first.ok) {
    for (const claim of claims) await store.updateLog(claim.id, { status: "sent", detail: sentDetail, bot });
    return { target: masked, status: "sent", detail: sentDetail };
  }

  if (first.gone) await markLineBotLeft(targetId, bot);
  const fallback = fallbackSendBot(pickInput, bot);
  if (fallback) {
    const second = await pushFlex({ date, meals: dishes, to: targetId, bot: fallback });
    if (second.ok) {
      const detail = `บอท ${bot} ส่งไม่สำเร็จ จึงส่งด้วยบอท ${fallback}`;
      for (const claim of claims) await store.updateLog(claim.id, { status: "sent", detail, bot: fallback });
      return { target: masked, status: "sent", detail: `ส่งเข้า LINE แล้วด้วยบอท ${fallback}` };
    }
    if (second.gone) await markLineBotLeft(targetId, fallback);
    const detail = second.gone ? "บอทไม่ได้อยู่ในกลุ่มนี้แล้ว หยุดส่งให้กลุ่มนี้" : second.error || first.error || "ส่งไม่สำเร็จ";
    for (const claim of claims) await store.updateLog(claim.id, { status: "failed", detail });
    return { target: masked, status: "failed", detail };
  }

  const detail = first.gone ? "บอทไม่ได้อยู่ในกลุ่มนี้แล้ว หยุดส่งให้กลุ่มนี้" : first.error || "ส่งไม่สำเร็จ";
  for (const claim of claims) await store.updateLog(claim.id, { status: "failed", detail });
  return { target: masked, status: "failed", detail };
}
