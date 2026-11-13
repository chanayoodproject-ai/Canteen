import { MEAL_KEYS, MEALS, type MealKey } from "@/lib/meals";
import { timeToMinutes, type BangkokNow } from "@/lib/time";

const QUESTION_CUES = ["มีอะไรกิน", "มีอารายกิน", "อะไรกิน", "กินอะไร", "เมนูอะไร"];

const MEAL_NEEDLES: { meal: MealKey; needles: string[] }[] = [
  { meal: "breakfast", needles: ["มื้อเช้า", "อาหารเช้า", "เช้า"] },
  { meal: "lunch", needles: ["มื้อเที่ยง", "กลางวัน", "เที่ยง"] },
  { meal: "dinner", needles: ["มื้อเย็น", "เย็น"] },
  { meal: "late", needles: ["มื้อดึก", "ดึก"] },
];

export type MenuQuestionSetting = { meal: MealKey; sendTime: string };

export type MenuQuestionDecision =
  | { kind: "ignore" }
  | { kind: "ask"; meal: MealKey }
  | { kind: "over"; meal: MealKey };

export function normalizeMenuQuestionText(text: string) {
  return text.replace(/\s+/g, "").trim();
}

export function isMenuQuestion(text: string) {
  const value = normalizeMenuQuestionText(text);
  return QUESTION_CUES.some((cue) => value.includes(cue));
}

export function mealMentionedIn(text: string): MealKey | null {
  const value = normalizeMenuQuestionText(text);
  let best: { meal: MealKey; index: number; length: number } | null = null;
  for (const { meal, needles } of MEAL_NEEDLES) {
    for (const needle of needles) {
      const index = value.indexOf(needle);
      if (index < 0) continue;
      if (!best || index < best.index || (index === best.index && needle.length > best.length)) {
        best = { meal, index, length: needle.length };
      }
    }
  }
  return best?.meal ?? null;
}

function defaultSendTime(meal: MealKey) {
  return MEALS.find((item) => item.key === meal)?.defaultTime ?? "00:00";
}

function orderedMeals(settings: MenuQuestionSetting[]) {
  return MEAL_KEYS.map((meal) => {
    const setting = settings.find((item) => item.meal === meal);
    return { meal, minutes: timeToMinutes(setting?.sendTime || defaultSendTime(meal)) };
  }).sort((a, b) => a.minutes - b.minutes);
}

const LATE_END_MINUTES = 23 * 60 + 59;

export function currentOrNextMeal(now: BangkokNow, settings: MenuQuestionSetting[]): MealKey | null {
  const ordered = orderedMeals(settings);
  const nowMin = now.hour * 60 + now.minute;
  if (nowMin < ordered[0].minutes) return ordered[0].meal;
  for (let i = 0; i < ordered.length; i += 1) {
    const start = ordered[i].minutes;
    const end = i + 1 < ordered.length ? ordered[i + 1].minutes : LATE_END_MINUTES + 1;
    if (nowMin >= start && nowMin < end) return ordered[i].meal;
  }
  return null;
}

export function isMealAskable(meal: MealKey, now: BangkokNow, settings: MenuQuestionSetting[]) {
  const ordered = orderedMeals(settings);
  const index = ordered.findIndex((item) => item.meal === meal);
  if (index < 0) return false;
  const nowMin = now.hour * 60 + now.minute;
  if (index === ordered.length - 1) return nowMin <= LATE_END_MINUTES;
  return nowMin < ordered[index + 1].minutes;
}

export function decideMenuQuestion(
  text: string,
  now: BangkokNow,
  settings: MenuQuestionSetting[],
): MenuQuestionDecision {
  if (!isMenuQuestion(text)) return { kind: "ignore" };
  const meal = mealMentionedIn(text) ?? currentOrNextMeal(now, settings);
  if (!meal) return { kind: "ignore" };
  if (!isMealAskable(meal, now, settings)) return { kind: "over", meal };
  return { kind: "ask", meal };
}
