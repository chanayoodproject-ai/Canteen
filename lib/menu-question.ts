import { MEAL_KEYS, MEALS, type MealKey } from "@/lib/meals";
import {
  THAI_MONTHS,
  THAI_MONTHS_SHORT,
  THAI_WEEKDAYS,
  addDays,
  daysInMonth,
  isoFromParts,
  timeToMinutes,
  weekdayIndex,
  type BangkokNow,
} from "@/lib/time";

const QUESTION_CUES = [
  "มีอะไรกิน",
  "มีอารายกิน",
  "อะไรกิน",
  "กินอะไร",
  "เมนูอะไร",
  "ขอเมนู",
  "ดูเมนู",
  "ส่งเมนู",
  "เมนู",
];

const MEAL_NEEDLES: { meal: MealKey; needles: string[] }[] = [
  { meal: "breakfast", needles: ["มื้อเช้า", "อาหารเช้า", "เช้า"] },
  { meal: "lunch", needles: ["มื้อเที่ยง", "กลางวัน", "เที่ยง"] },
  { meal: "dinner", needles: ["มื้อเย็น", "เย็น"] },
  { meal: "late", needles: ["มื้อดึก", "ดึก"] },
];

const WEEKDAY_NEEDLES: { weekday: number; needles: string[] }[] = [
  { weekday: 0, needles: ["วันอาทิตย์", "อาทิตย์"] },
  { weekday: 1, needles: ["วันจันทร์", "จันทร์"] },
  { weekday: 2, needles: ["วันอังคาร", "อังคาร"] },
  { weekday: 3, needles: ["วันพุธ", "พุธ"] },
  { weekday: 4, needles: ["วันพฤหัสบดี", "พฤหัสบดี", "วันพฤหัส", "พฤหัส"] },
  { weekday: 5, needles: ["วันศุกร์", "ศุกร์"] },
  { weekday: 6, needles: ["วันเสาร์", "เสาร์"] },
];

export type MenuQuestionSetting = { meal: MealKey; sendTime: string };

export type MenuQuestionDecision =
  | { kind: "ignore" }
  | { kind: "ask"; date: string; meals: MealKey[]; day: "today" | "future" }
  | { kind: "past"; date: string; meals: MealKey[] };

export function normalizeMenuQuestionText(text: string) {
  return text.replace(/\s+/g, "").trim();
}

export function isMenuQuestion(text: string) {
  const value = normalizeMenuQuestionText(text);
  if (QUESTION_CUES.some((cue) => value.includes(cue))) return true;
  const date = parseMenuQuestionDate(text, { year: 2026, month: 1, day: 1, hour: 0, minute: 0, iso: "2026-01-01" });
  return Boolean(date.explicit && mealMentionedIn(text));
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

/** True when this meal's scheduled send time has already arrived today. */
export function isMealPast(meal: MealKey, now: BangkokNow, settings: MenuQuestionSetting[]) {
  const ordered = orderedMeals(settings);
  const found = ordered.find((item) => item.meal === meal);
  if (!found) return true;
  return now.hour * 60 + now.minute >= found.minutes;
}

/** Next meal whose send time has not arrived yet; null if every meal today is past. */
export function nextUpcomingMeal(now: BangkokNow, settings: MenuQuestionSetting[]): MealKey | null {
  const nowMin = now.hour * 60 + now.minute;
  for (const item of orderedMeals(settings)) {
    if (nowMin < item.minutes) return item.meal;
  }
  return null;
}

function monthFromThai(value: string): number | null {
  const compact = value.replace(/\./g, "");
  const long = THAI_MONTHS.findIndex((name) => name === value);
  if (long >= 0) return long + 1;
  const short = THAI_MONTHS_SHORT.findIndex((name) => name.replace(/\./g, "") === compact);
  if (short >= 0) return short + 1;
  return null;
}

function yearFromToken(raw: string): number {
  const n = Number(raw);
  if (n >= 2400) return n - 543;
  if (n >= 100) return n;
  // 2-digit: 50–99 is BE 25xx, otherwise CE 20xx (69 → 2569 → 2026, 26 → 2026).
  if (n >= 50) return 2500 + n - 543;
  return 2000 + n;
}

function isoIfValid(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return isoFromParts(year, month, day);
}

function resolveYearMonth(now: BangkokNow, month: number, day: number): string | null {
  if (month > now.month) return isoIfValid(now.year, month, day);
  if (month < now.month) return isoIfValid(now.year + 1, month, day);
  return isoIfValid(now.year, month, day);
}

function thisWeekDate(now: BangkokNow, weekday: number) {
  const today = weekdayIndex(now.iso);
  const fromMon = (today + 6) % 7;
  const targetFromMon = (weekday + 6) % 7;
  return addDays(now.iso, targetFromMon - fromMon);
}

function nextWeekdayAfterToday(now: BangkokNow, weekday: number, includeToday: boolean) {
  const today = weekdayIndex(now.iso);
  if (includeToday && today === weekday) return now.iso;
  const delta = (weekday - today + 7) % 7;
  return addDays(now.iso, delta === 0 ? 7 : delta);
}

function previousWeekday(now: BangkokNow, weekday: number) {
  const today = weekdayIndex(now.iso);
  const delta = (today - weekday + 7) % 7;
  return addDays(now.iso, delta === 0 ? -7 : -delta);
}

/**
 * Best-effort Thai date for a menu question. If no date is mentioned, this is today.
 * `explicit` is true when the text actually named a day (พรุ่งนี้, วันที่ 20, วันจันทร์, …).
 */
export function parseMenuQuestionDate(text: string, now: BangkokNow): { date: string; explicit: boolean } {
  const value = normalizeMenuQuestionText(text);

  const numeric = value.match(/(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    const date = numeric[3] ? isoIfValid(yearFromToken(numeric[3]), month, day) : resolveYearMonth(now, month, day);
    if (date) return { date, explicit: true };
  }

  const monthNames = [...THAI_MONTHS, ...THAI_MONTHS_SHORT.map((name) => name.replace(/\./g, "")), ...THAI_MONTHS_SHORT];
  monthNames.sort((a, b) => b.length - a.length);
  for (const name of monthNames) {
    const compactName = name.replace(/\./g, "");
    const escaped = compactName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?:วันที่)?(\\d{1,2})(?:วัน)?(?:เดือน)?${escaped}(?:(?:พ\\.?ศ\\.?|ค\\.?ศ\\.?|ปี)?(\\d{2,4}))?`);
    const match = value.replace(/\./g, "").match(pattern);
    if (!match) continue;
    const month = monthFromThai(name);
    if (!month) continue;
    const day = Number(match[1]);
    const date = match[2] ? isoIfValid(yearFromToken(match[2]), month, day) : resolveYearMonth(now, month, day);
    if (date) return { date, explicit: true };
  }

  const dayOnly = value.match(/วันที่(\d{1,2})/);
  if (dayOnly) {
    const date = isoIfValid(now.year, now.month, Number(dayOnly[1]));
    if (date) return { date, explicit: true };
  }

  if (/มะรืนนี้|มะรืน/.test(value)) return { date: addDays(now.iso, 2), explicit: true };
  if (/เมื่อวานซืน|วานซืน/.test(value)) return { date: addDays(now.iso, -2), explicit: true };
  if (/เมื่อวานนี้|เมื่อวาน|วานนี้/.test(value)) return { date: addDays(now.iso, -1), explicit: true };
  if (value.includes("พรุ่งนี้")) return { date: addDays(now.iso, 1), explicit: true };
  if (value.includes("วันนี้")) return { date: now.iso, explicit: true };

  let best: { weekday: number; index: number; length: number } | null = null;
  for (const { weekday, needles } of WEEKDAY_NEEDLES) {
    for (const needle of needles) {
      const index = value.indexOf(needle);
      if (index < 0) continue;
      if (!best || index < best.index || (index === best.index && needle.length > best.length)) {
        best = { weekday, index, length: needle.length };
      }
    }
  }
  if (best) {
    const after = value.slice(best.index + best.length);
    if (after.startsWith("ที่แล้ว") || value.includes(`${THAI_WEEKDAYS[best.weekday]}ที่แล้ว`)) {
      return { date: previousWeekday(now, best.weekday), explicit: true };
    }
    if (after.startsWith("นี้") || value.includes(`${THAI_WEEKDAYS[best.weekday]}นี้`)) {
      return { date: thisWeekDate(now, best.weekday), explicit: true };
    }
    if (after.startsWith("หน้า") || value.includes(`${THAI_WEEKDAYS[best.weekday]}หน้า`)) {
      return { date: nextWeekdayAfterToday(now, best.weekday, false), explicit: true };
    }
    return { date: nextWeekdayAfterToday(now, best.weekday, true), explicit: true };
  }

  return { date: now.iso, explicit: false };
}

export function decideMenuQuestion(
  text: string,
  now: BangkokNow,
  settings: MenuQuestionSetting[],
): MenuQuestionDecision {
  if (!isMenuQuestion(text)) return { kind: "ignore" };
  const { date } = parseMenuQuestionDate(text, now);
  const mentioned = mealMentionedIn(text);

  if (date < now.iso) {
    return { kind: "past", date, meals: mentioned ? [mentioned] : [] };
  }

  if (date > now.iso) {
    return { kind: "ask", date, meals: mentioned ? [mentioned] : [...MEAL_KEYS], day: "future" };
  }

  if (mentioned) {
    if (isMealPast(mentioned, now, settings)) return { kind: "past", date, meals: [mentioned] };
    return { kind: "ask", date, meals: [mentioned], day: "today" };
  }

  const upcoming = nextUpcomingMeal(now, settings);
  if (!upcoming) return { kind: "past", date, meals: [] };
  return { kind: "ask", date, meals: [upcoming], day: "today" };
}
