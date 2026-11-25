import type { BotId } from "@/lib/line-bots";
import { isMealKey, MEALS, MEAL_KEYS } from "@/lib/meals";
import { defaultSendPlan, normalizeSendPlan, type SendPlan } from "@/lib/send-plan";
import { getAppSecret, setAppSecret } from "@/lib/server/app-secrets";
import { store, type SendSetting } from "@/lib/server/store";

const BOT2_PLAN_KEY = "LINE_BOT_2_SEND_PLAN";
const BOT2_SETTINGS_KEY = "LINE_BOT_2_SEND_SETTINGS";

function defaultSettings(): SendSetting[] {
  return MEALS.map((meal) => ({ meal: meal.key, sendTime: meal.defaultTime, enabled: true }));
}

function normalizeSettings(raw: unknown): SendSetting[] {
  if (!Array.isArray(raw)) return defaultSettings();
  const byMeal = new Map<string, SendSetting>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<SendSetting>;
    if (!row.meal || !isMealKey(row.meal)) continue;
    const time = typeof row.sendTime === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(row.sendTime)
      ? row.sendTime
      : MEALS.find((m) => m.key === row.meal)?.defaultTime ?? "07:00";
    byMeal.set(row.meal, {
      meal: row.meal,
      sendTime: time,
      enabled: row.enabled !== false,
    });
  }
  if (byMeal.size !== MEAL_KEYS.length) {
    const fallback = defaultSettings();
    return fallback.map((d) => byMeal.get(d.meal) ?? d);
  }
  return MEAL_KEYS.map((meal) => byMeal.get(meal)!);
}

export async function getBotSchedule(bot: BotId): Promise<{ settings: SendSetting[]; plan: SendPlan }> {
  if (bot === "1") {
    const [settings, plan] = await Promise.all([store.getSettings(), store.getPlan()]);
    return { settings, plan };
  }
  const [rawSettings, rawPlan] = await Promise.all([
    getAppSecret(BOT2_SETTINGS_KEY),
    getAppSecret(BOT2_PLAN_KEY),
  ]);
  let settings = defaultSettings();
  let plan = defaultSendPlan();
  if (rawSettings) {
    try {
      settings = normalizeSettings(JSON.parse(rawSettings));
    } catch {
      settings = defaultSettings();
    }
  }
  if (rawPlan) {
    try {
      plan = normalizeSendPlan(JSON.parse(rawPlan) as Partial<SendPlan>);
    } catch {
      plan = defaultSendPlan();
    }
  }
  return { settings, plan };
}

export async function saveBotSchedule(bot: BotId, settings: SendSetting[], plan: SendPlan) {
  const normalizedPlan = normalizeSendPlan(plan);
  if (bot === "1") {
    await Promise.all([store.saveSettings(settings), store.savePlan(normalizedPlan)]);
    return;
  }
  await Promise.all([
    setAppSecret(BOT2_SETTINGS_KEY, JSON.stringify(normalizeSettings(settings))),
    setAppSecret(BOT2_PLAN_KEY, JSON.stringify(normalizedPlan)),
  ]);
}
