import { MEAL_MAP, type MealKey } from "@/lib/meals";
import { bangkokNow, hasTimeArrived, timeToMinutes, type BangkokNow } from "@/lib/time";
import { pushFlex } from "@/lib/server/line";
import { listSendTargets, markLineTargetInactive, resolveLineTarget } from "@/lib/server/line-targets";
import { summarizeTargets, type TargetOutcome } from "@/lib/line-target-plan";
import { lineConfigured, maskTarget } from "@/lib/server/supabase";
import { dishOn, store } from "@/lib/server/store";

const STALE_CLAIM_MS = 5 * 60 * 1000;
const AUTO_SEND_WINDOW_MINUTES = 10;

export function isWithinAutoSendWindow(now: BangkokNow, sendTime: string) {
  const start = timeToMinutes(sendTime);
  const nowMin = now.hour * 60 + now.minute;
  const end = Math.min(start + AUTO_SEND_WINDOW_MINUTES, 24 * 60);
  return nowMin >= start && nowMin < end;
}


export async function runSend(options: {
  onlyMeal?: MealKey;
  date?: string;
  force?: boolean;
  test?: boolean;
  dryRun?: boolean;
}) {
  const now = bangkokNow();
  const date = options.date ?? now.iso;
  const [year, month] = date.split("-").map(Number);
  const [settings, monthCells] = await Promise.all([store.getSettings(), store.getMonth(year, month)]);
  const meals = options.onlyMeal ? settings.filter((item) => item.meal === options.onlyMeal) : settings;
  const results: { meal: MealKey; status: string; detail: string; targets?: TargetOutcome[] }[] = [];
  let targetsCache: string[] | null = null;
  const sendTargets = async () => (targetsCache ??= await listSendTargets());

  for (const setting of meals) {
    const dishText = dishOn(monthCells, date, setting.meal);
    const label = MEAL_MAP[setting.meal].full;
    if (!setting.enabled && !options.force && !options.test) {
      results.push({ meal: setting.meal, status: "skipped", detail: `${label}ถูกปิดไว้` });
      continue;
    }
    if (!options.force && !options.test && date !== now.iso) {
      results.push({ meal: setting.meal, status: "skipped", detail: "ตัวตั้งเวลาส่งเฉพาะเมนูของวันนี้" });
      continue;
    }
    if (!options.force && !options.test && !hasTimeArrived(now, setting.sendTime)) {
      results.push({ meal: setting.meal, status: "skipped", detail: `ยังไม่ถึง ${setting.sendTime}` });
      continue;
    }
    if (!options.force && !options.test && !isWithinAutoSendWindow(now, setting.sendTime)) {
      results.push({ meal: setting.meal, status: "skipped", detail: `เลยช่วงส่ง ${setting.sendTime} แล้ว` });
      continue;
    }
    if (!dishText.trim()) {
      results.push({ meal: setting.meal, status: "skipped", detail: "วันนี้ยังไม่มีข้อความเมนู" });
      continue;
    }

    if (options.test) {
      const testTarget = await resolveLineTarget();
      const pushed = await pushFlex({ date, meal: setting.meal, dishText, to: testTarget });
      await store.insertLog({
        menuDate: date,
        meal: setting.meal,
        status: "test",
        target: maskTarget(testTarget),
        targetId: testTarget,
        detail: pushed.ok ? "ส่งทดสอบแล้ว" : pushed.simulated ? "จำลองข้อความทดสอบ เพราะยังไม่มี LINE" : pushed.error,
      });
      results.push({
        meal: setting.meal,
        status: pushed.ok ? "test" : pushed.simulated ? "simulated" : "failed",
        detail: pushed.ok ? "ส่งทดสอบแล้ว" : pushed.error || "จำลองการส่ง",
      });
      continue;
    }

    if (!(await lineConfigured())) {
      if (options.dryRun) {
        results.push({ meal: setting.meal, status: "would_simulate", detail: "ยังไม่ได้ตั้งค่า LINE จึงจะบันทึกเป็นการจำลอง" });
        continue;
      }
      const simulated = await store.latestLog(date, setting.meal, ["simulated"]);
      if (simulated && !options.force) {
        results.push({ meal: setting.meal, status: "skipped", detail: "จำลองการส่งไปแล้ว ตั้งค่า LINE แล้วกดส่งทดสอบ" });
        continue;
      }
      await store.insertLog({
        menuDate: date,
        meal: setting.meal,
        status: "simulated",
        target: null,
        detail: "ยังไม่ได้ตั้งค่า LINE จึงบันทึกเป็นการจำลอง ไม่ได้ส่งจริง",
      });
      results.push({ meal: setting.meal, status: "simulated", detail: "จำลองการส่งแล้ว" });
      continue;
    }

    // Every active LINE group/room gets its own card; dedupe and claims are per group.
    const outcomes: TargetOutcome[] = [];
    for (const targetId of await sendTargets()) {
      outcomes.push(await sendToTarget({ date, meal: setting.meal, label, dishText, targetId, dryRun: options.dryRun }));
    }
    const summary = summarizeTargets(outcomes);
    results.push({ meal: setting.meal, ...summary, targets: outcomes });
  }

  return { date, bangkok: now, results };
}

async function sendToTarget(input: {
  date: string;
  meal: MealKey;
  label: string;
  dishText: string;
  targetId: string;
  dryRun?: boolean;
}): Promise<TargetOutcome> {
  const { date, meal, label, dishText, targetId } = input;
  const masked = maskTarget(targetId);
  const already = await store.latestLog(date, meal, ["sent", "claimed"], targetId);
  if (already) {
    return {
      target: masked,
      status: "skipped",
      detail:
        already.status === "claimed"
          ? "มีงานส่งมื้อนี้อยู่แล้ว"
          : already.detail === "ตอบคำถามในแชทแล้ว"
            ? "กลุ่มนี้ถามเมนูไปแล้ว"
            : "ส่งมื้อนี้ไปแล้ววันนี้",
    };
  }
  if (input.dryRun) return { target: masked, status: "would_send", detail: `จะส่ง${label}เข้ากลุ่ม ${masked}` };

  let claim = await store.insertLog({ menuDate: date, meal, status: "claimed", target: masked, targetId, detail: "กำลังส่ง" });
  if (!claim) {
    const open = await store.latestLog(date, meal, ["claimed", "sent"], targetId);
    if (open?.status === "claimed" && Date.now() - new Date(open.createdAt).getTime() > STALE_CLAIM_MS) {
      await store.updateLog(open.id, { status: "failed", detail: "ค้างระหว่างส่ง จึงลองใหม่" });
      claim = await store.insertLog({ menuDate: date, meal, status: "claimed", target: masked, targetId, detail: "กำลังส่ง" });
    }
    if (!claim) return { target: masked, status: "skipped", detail: "มีงานส่งมื้อนี้อยู่แล้ว" };
  }
  const pushed = await pushFlex({ date, meal, dishText, to: targetId });
  if (!pushed.ok) {
    if (pushed.gone) await markLineTargetInactive(targetId);
    const detail = pushed.gone ? "บอทไม่ได้อยู่ในกลุ่มนี้แล้ว หยุดส่งให้กลุ่มนี้" : pushed.error || "ส่งไม่สำเร็จ";
    await store.updateLog(claim.id, { status: "failed", detail });
    return { target: masked, status: "failed", detail };
  }
  await store.updateLog(claim.id, { status: "sent", detail: "ส่งเข้า LINE แล้ว" });
  return { target: masked, status: "sent", detail: "ส่งเข้า LINE แล้ว" };
}
