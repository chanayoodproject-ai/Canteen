import { MEAL_MAP, type MealKey } from "@/lib/meals";
import { bangkokNow, hasTimeArrived, timeToMinutes, type BangkokNow } from "@/lib/time";
import { pushFlex } from "@/lib/server/line";
import { resolveLineTarget } from "@/lib/server/line-targets";
import { lineConfigured, maskTarget } from "@/lib/server/supabase";
import { dishOn, store } from "@/lib/server/store";

const STALE_CLAIM_MS = 5 * 60 * 1000;
const AUTO_SEND_WINDOW_MINUTES = 10;

function isWithinAutoSendWindow(now: BangkokNow, sendTime: string) {
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
  const results: { meal: MealKey; status: string; detail: string }[] = [];

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
      const pushed = await pushFlex({ date, meal: setting.meal, dishText });
      await store.insertLog({
        menuDate: date,
        meal: setting.meal,
        status: pushed.ok ? "test" : "test",
        target: maskTarget(await resolveLineTarget()),
        detail: pushed.ok ? "ส่งทดสอบแล้ว" : pushed.simulated ? "จำลองข้อความทดสอบ เพราะยังไม่มี LINE" : pushed.error,
      });
      results.push({
        meal: setting.meal,
        status: pushed.ok ? "test" : pushed.simulated ? "simulated" : "failed",
        detail: pushed.ok ? "ส่งทดสอบแล้ว" : pushed.error || "จำลองการส่ง",
      });
      continue;
    }

    const already = await store.latestLog(date, setting.meal, ["sent", "claimed"]);
    if (already) {
      results.push({
        meal: setting.meal,
        status: "skipped",
        detail: already.status === "claimed" ? "มีงานส่งมื้อนี้อยู่แล้ว" : "ส่งมื้อนี้ไปแล้ววันนี้",
      });
      continue;
    }

    if (options.dryRun) {
      const ready = await lineConfigured();
      results.push({
        meal: setting.meal,
        status: ready ? "would_send" : "would_simulate",
        detail: ready ? `จะส่ง${label}เข้ากลุ่ม` : "ยังไม่ได้ตั้งค่า LINE จึงจะบันทึกเป็นการจำลอง",
      });
      continue;
    }

    if (!(await lineConfigured())) {
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

    const claim = await store.insertLog({
      menuDate: date,
      meal: setting.meal,
      status: "claimed",
      target: maskTarget(await resolveLineTarget()),
      detail: "กำลังส่ง",
    });
    if (!claim) {
      const open = await store.latestLog(date, setting.meal, ["claimed", "sent"]);
      if (open?.status === "claimed" && Date.now() - new Date(open.createdAt).getTime() > STALE_CLAIM_MS) {
        await store.updateLog(open.id, { status: "failed", detail: "ค้างระหว่างส่ง จึงลองใหม่" });
      } else {
        results.push({ meal: setting.meal, status: "skipped", detail: "มีงานส่งมื้อนี้อยู่แล้ว" });
        continue;
      }
    }
    const claimId = claim?.id ?? (await store.latestLog(date, setting.meal, ["failed"]))?.id;
    const pushed = await pushFlex({ date, meal: setting.meal, dishText });
    if (!pushed.ok) {
      if (claimId) await store.updateLog(claimId, { status: "failed", detail: pushed.error || "ส่งไม่สำเร็จ" });
      else {
        await store.insertLog({
          menuDate: date,
          meal: setting.meal,
          status: "failed",
          target: maskTarget(await resolveLineTarget()),
          detail: pushed.error,
        });
      }
      results.push({ meal: setting.meal, status: "failed", detail: pushed.error || "ส่งไม่สำเร็จ" });
      continue;
    }
    if (claim) await store.updateLog(claim.id, { status: "sent", detail: "ส่งเข้า LINE แล้ว" });
    else {
      await store.insertLog({
        menuDate: date,
        meal: setting.meal,
        status: "sent",
        target: maskTarget(await resolveLineTarget()),
        detail: "ส่งเข้า LINE แล้ว",
      });
    }
    results.push({ meal: setting.meal, status: "sent", detail: "ส่งเข้า LINE แล้ว" });
  }

  return { date, bangkok: now, results };
}
