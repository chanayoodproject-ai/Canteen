import { buildFlexMessage } from "@/lib/flex";
import { MEAL_MAP, type MealKey } from "@/lib/meals";
import { decideMenuQuestion } from "@/lib/menu-question";
import { replyLine, replyLineMessages } from "@/lib/server/line";
import { resolveLineTarget } from "@/lib/server/line-targets";
import { dishOn, store } from "@/lib/server/store";
import { maskTarget } from "@/lib/server/supabase";
import { bangkokNow } from "@/lib/time";

type TextEvent = {
  type?: string;
  replyToken?: string;
  message?: { type?: string; text?: string };
};

export async function handleMenuQuestion(event: TextEvent) {
  if (event.type !== "message" || event.message?.type !== "text" || !event.replyToken) {
    return { handled: false, replied: false, markedSent: false };
  }
  const text = event.message.text || "";
  const now = bangkokNow();
  const settings = await store.getSettings();
  const decision = decideMenuQuestion(text, now, settings);
  if (decision.kind !== "ask") {
    return { handled: false, replied: false, markedSent: false };
  }
  const date = now.iso;
  const dishText = dishOn(await store.getMonth(now.year, now.month), date, decision.meal);
  if (!dishText.trim()) {
    await replyLine(event.replyToken, `วันนี้ยังไม่มีเมนู${MEAL_MAP[decision.meal].full}ครับ`);
    return { handled: true, replied: true, markedSent: false, meal: decision.meal };
  }
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const sent = await replyLineMessages(event.replyToken, [
    buildFlexMessage({
      date,
      meal: decision.meal,
      dishText,
      logoUrl: base ? `${base}/brand/logo-mark.png` : undefined,
    }),
  ]);
  if (!sent.ok) {
    return { handled: true, replied: false, markedSent: false, meal: decision.meal };
  }
  const markedSent = await markMealSent(date, decision.meal);
  return { handled: true, replied: true, markedSent, meal: decision.meal };
}

async function markMealSent(menuDate: string, meal: MealKey) {
  const existing = await store.latestLog(menuDate, meal, ["sent", "claimed"]);
  if (existing) return false;
  const inserted = await store.insertLog({
    menuDate,
    meal,
    status: "sent",
    target: maskTarget(await resolveLineTarget()),
    detail: "ตอบคำถามในแชทแล้ว",
  });
  return Boolean(inserted);
}
