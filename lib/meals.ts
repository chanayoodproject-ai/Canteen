export const MEAL_KEYS = ["breakfast", "lunch", "dinner", "late"] as const;
export type MealKey = (typeof MEAL_KEYS)[number];

export type MealMeta = {
  key: MealKey;
  label: string;
  full: string;
  defaultTime: string;
  hint: string;
  tint: string;
  ink: string;
  accent: string;
};

export const MEALS: MealMeta[] = [
  {
    key: "breakfast",
    label: "เช้า",
    full: "มื้อเช้า",
    defaultTime: "06:30",
    hint: "ก่อนเริ่มงาน",
    tint: "#FFF4D6",
    ink: "#8A5A00",
    accent: "#E0A106",
  },
  {
    key: "lunch",
    label: "เที่ยง",
    full: "มื้อเที่ยง",
    defaultTime: "10:30",
    hint: "ก่อนพักกลางวัน",
    tint: "#E6F6EC",
    ink: "#1C6B42",
    accent: "#2F6B4F",
  },
  {
    key: "dinner",
    label: "เย็น",
    full: "มื้อเย็น",
    defaultTime: "15:30",
    hint: "ช่วงบ่ายแก่",
    tint: "#FDE8E0",
    ink: "#A33B24",
    accent: "#C4452D",
  },
  {
    key: "late",
    label: "ดึก",
    full: "มื้อดึก",
    defaultTime: "19:30",
    hint: "ก่อนปิดครัว",
    tint: "#EFE7F8",
    ink: "#5B3D86",
    accent: "#6E4C96",
  },
];

export const MEAL_MAP = Object.fromEntries(MEALS.map((meal) => [meal.key, meal])) as Record<
  MealKey,
  MealMeta
>;

export function isMealKey(value: string): value is MealKey {
  return (MEAL_KEYS as readonly string[]).includes(value);
}

export function mealFromLabel(value: string): MealKey | null {
  const text = value.trim().toLowerCase();
  if (["เช้า", "breakfast", "morning"].includes(text)) return "breakfast";
  if (["เที่ยง", "lunch", "noon"].includes(text)) return "lunch";
  if (["เย็น", "dinner", "evening"].includes(text)) return "dinner";
  if (["ดึก", "late", "night", "supper"].includes(text)) return "late";
  return null;
}
