import { MEAL_KEYS, MEAL_MAP, type MealKey } from "@/lib/meals";
import { daysInMonth, isoFromParts, timeToMinutes, type BangkokNow } from "@/lib/time";

const AUTO_SEND_WINDOW_MINUTES = 10;

function slotStillOpen(slotTime: string, nowMin: number) {
  const start = timeToMinutes(slotTime);
  return nowMin < start + AUTO_SEND_WINDOW_MINUTES;
}

export const SEND_PLAN_MODES = ["daily", "twice", "per_meal"] as const;
export type SendPlanMode = (typeof SEND_PLAN_MODES)[number];

export const DEFAULT_EFFECTIVE_FROM = "2026-11-16";
export const DEFAULT_DAILY_TIME = "07:00";
export const DEFAULT_QUOTA_BASE = 300;
export const DEFAULT_MEMBER_COUNT = 6;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export type SendSettingLike = { meal: MealKey; sendTime: string; enabled: boolean };

export type SendPlan = {
  mode: SendPlanMode;
  dailyTime: string;
  firstMeals: MealKey[];
  firstTime: string;
  secondMeals: MealKey[];
  secondTime: string;
  quotaBase: number;
  effectiveFrom: string;
};

export type SendSlot = {
  id: string;
  time: string;
  meals: MealKey[];
  label: string;
  combined: boolean;
};

export function defaultSendPlan(): SendPlan {
  return {
    mode: "daily",
    dailyTime: DEFAULT_DAILY_TIME,
    firstMeals: ["breakfast", "lunch"],
    firstTime: DEFAULT_DAILY_TIME,
    secondMeals: ["dinner", "late"],
    secondTime: "16:30",
    quotaBase: DEFAULT_QUOTA_BASE,
    effectiveFrom: DEFAULT_EFFECTIVE_FROM,
  };
}

export function isSendPlanMode(value: string): value is SendPlanMode {
  return (SEND_PLAN_MODES as readonly string[]).includes(value);
}

function uniqueMeals(meals: MealKey[]): MealKey[] {
  const seen = new Set<MealKey>();
  const out: MealKey[] = [];
  for (const meal of MEAL_KEYS) {
    if (meals.includes(meal) && !seen.has(meal)) {
      seen.add(meal);
      out.push(meal);
    }
  }
  return out;
}

export function normalizeSendPlan(input: Partial<SendPlan> | null | undefined): SendPlan {
  const fallback = defaultSendPlan();
  const mode = input?.mode && isSendPlanMode(input.mode) ? input.mode : fallback.mode;
  const quotaBase = Number(input?.quotaBase);
  return {
    mode,
    dailyTime: TIME_RE.test(input?.dailyTime || "") ? input!.dailyTime! : fallback.dailyTime,
    firstMeals: uniqueMeals(Array.isArray(input?.firstMeals) ? input!.firstMeals : fallback.firstMeals),
    firstTime: TIME_RE.test(input?.firstTime || "") ? input!.firstTime! : fallback.firstTime,
    secondMeals: uniqueMeals(Array.isArray(input?.secondMeals) ? input!.secondMeals : fallback.secondMeals),
    secondTime: TIME_RE.test(input?.secondTime || "") ? input!.secondTime! : fallback.secondTime,
    quotaBase: Number.isFinite(quotaBase) && quotaBase >= 1 ? Math.floor(quotaBase) : fallback.quotaBase,
    effectiveFrom: /^\d{4}-\d{2}-\d{2}$/.test(input?.effectiveFrom || "")
      ? input!.effectiveFrom!
      : fallback.effectiveFrom,
  };
}

export function validateSendPlan(plan: SendPlan): string | null {
  if (!isSendPlanMode(plan.mode)) return "เลือกรูปแบบการส่งไม่ถูกต้อง";
  if (!TIME_RE.test(plan.dailyTime) || !TIME_RE.test(plan.firstTime) || !TIME_RE.test(plan.secondTime)) {
    return "เวลาต้องเป็นรูปแบบ 07:00";
  }
  if (plan.quotaBase < 1) return "โควต้าตั้งต้นต้องมากกว่า 0";
  if (plan.mode === "twice") {
    if (plan.firstMeals.length === 0 || plan.secondMeals.length === 0) {
      return "การส่งวันละ 2 ครั้ง ต้องระบุมื้อในทั้งสองรอบ";
    }
    if (plan.firstMeals.some((meal) => plan.secondMeals.includes(meal))) {
      return "มื้ออาหารในสองรอบต้องไม่ซ้ำกัน";
    }
  }
  return null;
}

/** Before effectiveFrom, cron keeps the previous per-meal schedule. */
export function planInEffect(plan: SendPlan, date: string): SendPlan {
  const normalized = normalizeSendPlan(plan);
  if (date < normalized.effectiveFrom) {
    return { ...normalized, mode: "per_meal" };
  }
  return normalized;
}

function mealListLabel(meals: MealKey[]) {
  return meals.map((meal) => MEAL_MAP[meal].full).join("กับ");
}

export function slotsFromPlan(plan: SendPlan, settings: SendSettingLike[] = []): SendSlot[] {
  const active = normalizeSendPlan(plan);
  if (active.mode === "daily") {
    return [
      {
        id: "daily",
        time: active.dailyTime,
        meals: [...MEAL_KEYS],
        label: mealListLabel([...MEAL_KEYS]),
        combined: true,
      },
    ];
  }
  if (active.mode === "twice") {
    const slots: SendSlot[] = [];
    if (active.firstMeals.length) {
      slots.push({
        id: "first",
        time: active.firstTime,
        meals: active.firstMeals,
        label: mealListLabel(active.firstMeals),
        combined: active.firstMeals.length > 1,
      });
    }
    if (active.secondMeals.length) {
      slots.push({
        id: "second",
        time: active.secondTime,
        meals: active.secondMeals,
        label: mealListLabel(active.secondMeals),
        combined: active.secondMeals.length > 1,
      });
    }
    return slots;
  }
  return settings
    .filter((item) => item.enabled)
    .map((item) => ({
      id: item.meal,
      time: item.sendTime,
      meals: [item.meal],
      label: MEAL_MAP[item.meal].full,
      combined: false,
    }));
}

export function pushesPerDay(plan: SendPlan, settings: SendSettingLike[] = []): number {
  return slotsFromPlan(plan, settings).length;
}

/**
 * Skip rules for one auto-send slot and one group.
 * Combined slots (daily / a twice-round with several meals) are not skipped
 * just because someone already asked about one of the meals — the card still
 * covers the rest. They are skipped only if this slot was already pushed.
 * Per-meal slots keep the existing "asked today → skip that meal" rule.
 */
export function skipReasonForSlot(input: {
  combined: boolean;
  askedMeals: MealKey[];
  logs: { meal: MealKey; status: string; detail: string | null }[];
}): string | null {
  const open = input.logs.find((log) => log.status === "claimed" || log.status === "sent");
  if (input.combined) {
    if (!open) return null;
    if (open.status === "claimed") return "มีงานส่งรอบนี้อยู่แล้ว";
    return "ส่งรอบนี้ไปแล้ววันนี้";
  }
  if (input.askedMeals.length > 0) return "กลุ่มนี้ถามเมนูไปแล้ว";
  if (!open) return null;
  if (open.status === "claimed") return "มีงานส่งมื้อนี้อยู่แล้ว";
  if (open.detail === "ตอบคำถามในแชทแล้ว") return "กลุ่มนี้ถามเมนูไปแล้ว";
  return "ส่งมื้อนี้ไปแล้ววันนี้";
}

export type QuotaProjection = {
  pushesPerDay: number;
  memberCount: number;
  daysInMonth: number;
  dailyUse: number;
  monthIfChosen: number;
  used: number;
  remaining: number;
  upcoming: number;
  projectedEnd: number;
  overMonth: boolean;
  overProjected: boolean;
  runOutDate: string | null;
  quotaBase: number;
};

export function projectQuota(input: {
  pushesPerDay: number;
  memberCount: number;
  year: number;
  month: number;
  todayDay: number;
  used: number;
  quotaBase: number;
  remainingSlotsToday: number;
}): QuotaProjection {
  const days = daysInMonth(input.year, input.month);
  const members = Math.max(0, Math.floor(input.memberCount));
  const pushes = Math.max(0, Math.floor(input.pushesPerDay));
  const dailyUse = pushes * members;
  const monthIfChosen = dailyUse * days;
  const remainingDaysAfterToday = Math.max(0, days - input.todayDay);
  const upcoming = Math.max(0, input.remainingSlotsToday) * members + remainingDaysAfterToday * dailyUse;
  const used = Math.max(0, Math.floor(input.used));
  const projectedEnd = used + upcoming;
  const remaining = input.quotaBase - used;
  let runOutDate: string | null = null;
  if (projectedEnd > input.quotaBase) {
    let acc = used;
    acc += Math.max(0, input.remainingSlotsToday) * members;
    if (acc > input.quotaBase) {
      runOutDate = isoFromParts(input.year, input.month, input.todayDay);
    } else {
      for (let day = input.todayDay + 1; day <= days; day++) {
        acc += dailyUse;
        if (acc > input.quotaBase) {
          runOutDate = isoFromParts(input.year, input.month, day);
          break;
        }
      }
    }
  }
  return {
    pushesPerDay: pushes,
    memberCount: members,
    daysInMonth: days,
    dailyUse,
    monthIfChosen,
    used,
    remaining,
    upcoming,
    projectedEnd,
    overMonth: monthIfChosen > input.quotaBase,
    overProjected: projectedEnd > input.quotaBase,
    runOutDate,
    quotaBase: input.quotaBase,
  };
}

export function remainingSlotsToday(input: {
  slots: SendSlot[];
  now: BangkokNow;
  alreadySentIds?: string[];
}): number {
  const nowMin = input.now.hour * 60 + input.now.minute;
  const sent = new Set(input.alreadySentIds ?? []);
  return input.slots.filter((slot) => {
    if (sent.has(slot.id)) return false;
    return slotStillOpen(slot.time, nowMin);
  }).length;
}

export function nextSlot(input: {
  now: BangkokNow;
  slots: SendSlot[];
  sentIds: string[];
}): { date: string; slot: SendSlot; due: boolean } | null {
  const sent = new Set(input.sentIds);
  const nowMin = input.now.hour * 60 + input.now.minute;
  const today = input.slots.find((slot) => !sent.has(slot.id) && slotStillOpen(slot.time, nowMin));
  if (today) {
    return { date: input.now.iso, slot: today, due: nowMin >= timeToMinutes(today.time) };
  }
  const tomorrow = input.slots[0];
  if (!tomorrow) return null;
  const [year, month, day] = input.now.iso.split("-").map(Number);
  const last = daysInMonth(year, month);
  const nextDate =
    day < last ? isoFromParts(year, month, day + 1) : isoFromParts(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1);
  return { date: nextDate, slot: tomorrow, due: false };
}
