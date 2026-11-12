import type { MealKey } from "@/lib/meals";
import { MEALS } from "@/lib/meals";

export const THAI_MONTHS = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];

export const THAI_MONTHS_SHORT = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
];

export const THAI_WEEKDAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];

export type BangkokNow = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  iso: string;
};

export function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

export function bangkokNow(date = new Date()): BangkokNow {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((part) => [part.type, part.value]));
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  return {
    year,
    month,
    day,
    hour,
    minute: Number(parts.minute),
    iso: `${year}-${pad(month)}-${pad(day)}`,
  };
}

export function weekdayIndex(iso: string) {
  const date = new Date(`${iso}T12:00:00+07:00`);
  return date.getUTCDay();
}

export function formatThaiDate(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return `วัน${THAI_WEEKDAYS[weekdayIndex(iso)]}ที่ ${day} ${THAI_MONTHS[month - 1]} ${year + 543}`;
}

export function formatThaiDateShort(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${THAI_MONTHS_SHORT[month - 1]} ${year + 543}`;
}

export function formatMonthTitle(year: number, month: number) {
  return `${THAI_MONTHS[month - 1]} ${year + 543}`;
}

export function timeToMinutes(hhmm: string) {
  const [hour, minute] = hhmm.slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
}

export function hasTimeArrived(now: BangkokNow, sendTime: string) {
  return now.hour * 60 + now.minute >= timeToMinutes(sendTime);
}

export function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00+07:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return bangkokNow(date).iso;
}

export function isoFromParts(year: number, month: number, day: number) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function greeting(now: BangkokNow) {
  const minutes = now.hour * 60 + now.minute;
  if (minutes < 10 * 60) return "อรุณสวัสดิ์";
  if (minutes < 14 * 60) return "สวัสดีตอนกลางวัน";
  if (minutes < 18 * 60) return "สวัสดีตอนเย็น";
  return "สวัสดีตอนดึก";
}

export type SendState = "sent" | "due" | "upcoming" | "empty" | "off" | "simulated";

export function describeSend(input: {
  enabled: boolean;
  sendTime: string;
  dishText: string;
  status?: string | null;
  date: string;
  now?: BangkokNow;
}): { state: SendState; label: string } {
  const now = input.now ?? bangkokNow();
  if (!input.enabled) return { state: "off", label: "ปิดการส่ง" };
  if (!input.dishText.trim()) return { state: "empty", label: "ยังไม่มีเมนู" };
  if (input.status === "sent") return { state: "sent", label: "ส่งแล้ว" };
  if (input.date > now.iso) return { state: "upcoming", label: `รอส่ง ${input.sendTime}` };
  if (input.date < now.iso) {
    if (input.status === "simulated") return { state: "simulated", label: "จำลองการส่งแล้ว" };
    return { state: "due", label: "เลยเวลาแล้วยังไม่ได้ส่ง" };
  }
  if (input.status === "simulated") return { state: "simulated", label: "จำลองแล้ว รอ LINE" };
  if (hasTimeArrived(now, input.sendTime)) return { state: "due", label: `ถึงเวลา ${input.sendTime}` };
  return { state: "upcoming", label: `รอส่ง ${input.sendTime}` };
}

export function nextSend(input: {
  now: BangkokNow;
  settings: { meal: MealKey; sendTime: string; enabled: boolean }[];
  sentMeals: MealKey[];
  todayHasMenu: Record<MealKey, boolean>;
}) {
  const order = MEALS.map((meal) => meal.key);
  for (const key of order) {
    const setting = input.settings.find((item) => item.meal === key);
    if (!setting?.enabled) continue;
    if (!input.todayHasMenu[key]) continue;
    if (input.sentMeals.includes(key)) continue;
    return {
      date: input.now.iso,
      meal: key,
      sendTime: setting.sendTime,
      due: hasTimeArrived(input.now, setting.sendTime),
    };
  }
  const tomorrow = addDays(input.now.iso, 1);
  for (const key of order) {
    const setting = input.settings.find((item) => item.meal === key);
    if (!setting?.enabled) continue;
    return { date: tomorrow, meal: key, sendTime: setting.sendTime, due: false };
  }
  return null;
}
