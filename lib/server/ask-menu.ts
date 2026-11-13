import { buildFlexMessage } from "@/lib/flex";
import { MEAL_MAP, type MealKey } from "@/lib/meals";
import { decideMenuQuestion } from "@/lib/menu-question";
import { replyLine, replyLineMessages } from "@/lib/server/line";
import { dishOn, store } from "@/lib/server/store";
import { maskTarget } from "@/lib/server/supabase";
import { bangkokNow } from "@/lib/time";

type TextEvent = {
  type?: string;
  replyToken?: string;
  message?: { type?: string; text?: string };
  source?: { type?: string; groupId?: string; roomId?: string; userId?: string };
};

/** The group/room the question came from ('' for a 1:1 chat, which never gets automatic sends). */
export function questionTargetId(source: TextEvent["source"]) {
  if (source?.type === "group") return source.groupId || "";
  if (source?.type === "room") return source.roomId || "";
  return "";
}

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
  const targetId = questionTargetId(event.source);
  const markedSent = targetId ? await markMealSent(date, decision.meal, targetId) : false;
  return { handled: true, replied: true, markedSent, meal: decision.meal };
}

/** Only this group skips the automatic send for the meal; other groups still get it. */
async function markMealSent(menuDate: string, meal: MealKey, targetId: string) {
  const existing = await store.latestLog(menuDate, meal, ["sent", "claimed"], targetId);
  if (existing) return false;
  const inserted = await store.insertLog({
    menuDate,
    meal,
    status: "sent",
    target: maskTarget(targetId),
    targetId,
    detail: "ตอบคำถามในแชทแล้ว",
  });
  return Boolean(inserted);
}
