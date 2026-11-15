import { buildFlexMessage } from "@/lib/flex";
import type { BotId } from "@/lib/line-bots";
import { shouldAnswerQuestion } from "@/lib/line-bots";
import { MEAL_MAP, type MealKey } from "@/lib/meals";
import { decideMenuQuestion } from "@/lib/menu-question";
import { configuredLineBots } from "@/lib/server/app-secrets";
import { replyLine, replyLineMessages } from "@/lib/server/line";
import { getTargetBots } from "@/lib/server/line-targets";
import { dishOn, store } from "@/lib/server/store";
import { formatThaiDateShort, bangkokNow } from "@/lib/time";

type TextEvent = {
  type?: string;
  replyToken?: string;
  message?: { type?: string; text?: string };
  source?: { type?: string; groupId?: string; roomId?: string; userId?: string };
};

/**
 * The group/room the question came from, or the user id for a 1:1 chat.
 * Auto-send only goes to groups/rooms; a 1:1 id is used only to answer once per meal today.
 */
export function questionTargetId(source: TextEvent["source"]) {
  if (source?.type === "group") return source.groupId || "";
  if (source?.type === "room") return source.roomId || "";
  if (source?.type === "user") return source.userId || "";
  return "";
}

export async function alreadyDelivered(menuDate: string, meal: MealKey, targetId: string) {
  if (await store.hasMenuAsk(menuDate, meal, targetId)) return true;
  return Boolean(await store.latestLog(menuDate, meal, ["sent", "claimed"], targetId));
}

export async function handleMenuQuestion(event: TextEvent, bot: BotId = "1") {
  if (event.type !== "message" || event.message?.type !== "text" || !event.replyToken) {
    return { handled: false, replied: false, markedSent: false };
  }
  const text = event.message.text || "";
  const now = bangkokNow();
  const settings = await store.getSettings();
  const decision = decideMenuQuestion(text, now, settings);
  if (decision.kind === "ignore") {
    return { handled: false, replied: false, markedSent: false };
  }
  if (decision.kind === "past") {
    return { handled: true, replied: false, markedSent: false };
  }

  const isGroup = event.source?.type === "group" || event.source?.type === "room";
  const targetId = questionTargetId(event.source);
  if (isGroup) {
    const [configured, botsInGroup] = await Promise.all([configuredLineBots(), getTargetBots(targetId)]);
    if (
      !shouldAnswerQuestion({
        date: now.iso,
        bot1Configured: configured.bot1,
        bot2Configured: configured.bot2,
        botsInGroup,
        receivingBot: bot,
        isGroup: true,
      })
    ) {
      // The other bot is today's sender and will answer this same group message.
      return { handled: true, replied: false, markedSent: false, skipped: true };
    }
  }

  const meals: MealKey[] = [];
  for (const meal of decision.meals) {
    if (decision.day === "today" && targetId && (await alreadyDelivered(decision.date, meal, targetId))) {
      continue;
    }
    meals.push(meal);
  }
  if (meals.length === 0) {
    return { handled: true, replied: false, markedSent: false };
  }

  const [year, month] = decision.date.split("-").map(Number);
  const cells = await store.getMonth(year, month);
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const logoUrl = base ? `${base}/brand/logo-mark.png` : undefined;
  const messages: unknown[] = [];
  const delivered: MealKey[] = [];
  for (const meal of meals) {
    const dishText = dishOn(cells, decision.date, meal);
    if (!dishText.trim()) continue;
    messages.push(buildFlexMessage({ date: decision.date, meal, dishText, logoUrl }));
    delivered.push(meal);
  }

  if (messages.length === 0) {
    const when = decision.day === "today" ? "วันนี้" : formatThaiDateShort(decision.date);
    const label = meals.length === 1 ? MEAL_MAP[meals[0]].full : "";
    await replyLine(event.replyToken, `${when}ยังไม่มีเมนู${label}ครับ`, bot);
    return { handled: true, replied: true, markedSent: false, meals };
  }

  const sent = await replyLineMessages(event.replyToken, messages, bot);
  if (!sent.ok) {
    return { handled: true, replied: false, markedSent: false, meals: delivered };
  }

  let markedSent = false;
  // Only today's reply suppresses that group's later auto-send. Future days still get the scheduled push.
  if (decision.day === "today" && targetId) {
    for (const meal of delivered) {
      if (await store.recordMenuAsk({ menuDate: decision.date, meal, targetId })) markedSent = true;
    }
  }
  return { handled: true, replied: true, markedSent, meals: delivered };
}
