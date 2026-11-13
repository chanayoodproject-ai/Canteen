import { MEAL_KEYS, mealFromLabel, type MealKey } from "@/lib/meals";
import { daysInMonth } from "@/lib/time";

export type DraftCell = {
  day: number;
  meal: MealKey;
  dishText: string;
  needsReview: boolean;
  /** Photo reading only: text before the automatic spelling fix (shown so it can be undone). */
  originalText?: string;
  /** Photo reading only: what the second reading saw when the two readings disagreed. */
  altText?: string;
};

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "," || char === "\t" || char === ";") {
      row.push(cell.trim());
      cell = "";
    } else if (char === "\n") {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") cell += char;
  }
  if (cell.length || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.filter((item) => item.some((value) => value));
}

export function tableToDrafts(table: string[][], year: number, month: number): DraftCell[] {
  if (!table.length) return [];
  const limit = daysInMonth(year, month);
  const header = table[0].map((value) => value.trim());
  const headerMeals = header.map((value) => mealFromLabel(value));
  const hasHeader = headerMeals.some(Boolean) || header.some((value) => /วัน|day/i.test(value));
  const body = hasHeader ? table.slice(1) : table;
  const dayIndex = hasHeader
    ? Math.max(
        0,
        header.findIndex((value) => /วัน|date|day/i.test(value)),
      )
    : 0;
  const mealIndex: Partial<Record<MealKey, number>> = {};
  if (hasHeader) {
    header.forEach((value, index) => {
      const meal = mealFromLabel(value);
      if (meal) mealIndex[meal] = index;
    });
  } else {
    MEAL_KEYS.forEach((meal, index) => {
      mealIndex[meal] = index + 1;
    });
  }
  const drafts: DraftCell[] = [];
  body.forEach((columns, rowIndex) => {
    const rawDay = columns[dayIndex] ?? "";
    const parsedDay = Number(String(rawDay).replace(/[^\d]/g, ""));
    const day = Number.isInteger(parsedDay) && parsedDay >= 1 ? parsedDay : rowIndex + 1;
    if (day < 1 || day > limit) return;
    for (const meal of MEAL_KEYS) {
      const index = mealIndex[meal];
      if (index === undefined) continue;
      const dishText = (columns[index] ?? "").trim();
      if (!dishText) continue;
      drafts.push({ day, meal, dishText, needsReview: false });
    }
  });
  return drafts;
}

export function blankDrafts(year: number, month: number): DraftCell[] {
  const total = daysInMonth(year, month);
  const cells: DraftCell[] = [];
  for (let day = 1; day <= total; day += 1) {
    for (const meal of MEAL_KEYS) cells.push({ day, meal, dishText: "", needsReview: false });
  }
  return cells;
}

export function applyDrafts(base: DraftCell[], drafts: DraftCell[]) {
  const map = new Map(base.map((cell) => [`${cell.day}:${cell.meal}`, { ...cell }]));
  for (const draft of drafts) {
    map.set(`${draft.day}:${draft.meal}`, { ...draft });
  }
  return [...map.values()].sort((a, b) => a.day - b.day || MEAL_KEYS.indexOf(a.meal) - MEAL_KEYS.indexOf(b.meal));
}

export type OcrDay = {
  day: number;
  breakfast?: string;
  lunch?: string;
  dinner?: string;
  late?: string;
  review?: string[];
};

export type OcrResult = {
  detectedMonth?: number;
  detectedYear?: number;
  days?: OcrDay[];
};

const MEAL_PREFIX = /^\s*(มื้อ)?(เช้า|เที่ยง|กลางวัน|เย็น|ดึก)\s*[:：]\s*/;

export function cleanDishText(value: unknown) {
  return String(value ?? "")
    .replace(MEAL_PREFIX, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

/** Convert model output to draft cells, dropping days outside the month and merging duplicate days. */
export function ocrToDrafts(parsed: OcrResult | null | undefined, year: number, month: number): DraftCell[] {
  const limit = daysInMonth(year, month);
  const map = new Map<string, DraftCell>();
  for (const day of parsed?.days ?? []) {
    const dayNumber = Number(day?.day);
    if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > limit) continue;
    const review = new Set(Array.isArray(day.review) ? day.review : []);
    for (const meal of MEAL_KEYS) {
      const dishText = cleanDishText(day[meal]);
      const key = `${dayNumber}:${meal}`;
      const previous = map.get(key);
      if (!dishText && !review.has(meal)) continue;
      if (previous?.dishText && !dishText) continue;
      map.set(key, { day: dayNumber, meal, dishText, needsReview: review.has(meal) || !dishText });
    }
  }
  return [...map.values()].sort((a, b) => a.day - b.day || MEAL_KEYS.indexOf(a.meal) - MEAL_KEYS.indexOf(b.meal));
}
