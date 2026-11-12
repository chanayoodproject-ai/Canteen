import november from "@/data/november-2026.json";
import { MEALS, MEAL_KEYS, type MealKey } from "@/lib/meals";
import { daysInMonth, isoFromParts } from "@/lib/time";
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/server/supabase";

export type MenuCell = {
  year: number;
  month: number;
  day: number;
  meal: MealKey;
  dishText: string;
  needsReview: boolean;
};

export type SendSetting = {
  meal: MealKey;
  sendTime: string;
  enabled: boolean;
};

export type SendStatus = "claimed" | "sent" | "simulated" | "failed" | "test";

export type SendLog = {
  id: string;
  menuDate: string;
  meal: MealKey;
  status: SendStatus;
  target: string | null;
  detail: string | null;
  createdAt: string;
};

export type RatingRow = {
  id: string;
  menuDate: string;
  meal: MealKey;
  lineUserId: string;
  menuScore: number | null;
  tasteScore: number | null;
  updatedAt: string;
};

type MemoryDB = {
  menus: MenuCell[];
  settings: SendSetting[];
  logs: SendLog[];
  ratings: RatingRow[];
};

function seedMemory(): MemoryDB {
  const menus: MenuCell[] = [];
  for (const day of november.days) {
    const source = day as {
      day: number;
      breakfast: string;
      lunch: string;
      dinner: string;
      late: string;
      review?: string[];
    };
    const review = new Set(source.review ?? []);
    for (const meal of MEAL_KEYS) {
      menus.push({
        year: november.year,
        month: november.month,
        day: source.day,
        meal,
        dishText: source[meal],
        needsReview: review.has(meal),
      });
    }
  }
  return {
    menus,
    settings: MEALS.map((meal) => ({ meal: meal.key, sendTime: meal.defaultTime, enabled: true })),
    logs: [],
    ratings: [],
  };
}

const globalStore = globalThis as unknown as { __canteenMemory?: MemoryDB };

function memory() {
  if (!globalStore.__canteenMemory) globalStore.__canteenMemory = seedMemory();
  return globalStore.__canteenMemory;
}

function emptyMonth(year: number, month: number): MenuCell[] {
  const cells: MenuCell[] = [];
  const total = daysInMonth(year, month);
  for (let day = 1; day <= total; day += 1) {
    for (const meal of MEAL_KEYS) {
      cells.push({ year, month, day, meal, dishText: "", needsReview: false });
    }
  }
  return cells;
}

function mergeMonth(year: number, month: number, rows: MenuCell[]) {
  const map = new Map(rows.map((row) => [`${row.day}:${row.meal}`, row]));
  return emptyMonth(year, month).map((cell) => map.get(`${cell.day}:${cell.meal}`) ?? cell);
}

function asMeal(value: string): MealKey {
  if (value === "breakfast" || value === "lunch" || value === "dinner" || value === "late") return value;
  throw new Error("มื้ออาหารไม่ถูกต้อง");
}

function hhmm(value: string) {
  return value.slice(0, 5);
}

function mapMenu(row: {
  year: number;
  month: number;
  day: number;
  meal: string;
  dish_text: string;
  needs_review: boolean;
}): MenuCell {
  return {
    year: row.year,
    month: row.month,
    day: row.day,
    meal: asMeal(row.meal),
    dishText: row.dish_text ?? "",
    needsReview: Boolean(row.needs_review),
  };
}

function mapLog(row: {
  id: string;
  menu_date: string;
  meal: string;
  status: SendStatus;
  target: string | null;
  detail: string | null;
  created_at: string;
}): SendLog {
  return {
    id: row.id,
    menuDate: row.menu_date,
    meal: asMeal(row.meal),
    status: row.status,
    target: row.target,
    detail: row.detail,
    createdAt: row.created_at,
  };
}

function mapRating(row: {
  id: string;
  menu_date: string;
  meal: string;
  line_user_id: string;
  menu_score: number | null;
  taste_score: number | null;
  updated_at: string;
}): RatingRow {
  return {
    id: row.id,
    menuDate: row.menu_date,
    meal: asMeal(row.meal),
    lineUserId: row.line_user_id,
    menuScore: row.menu_score,
    tasteScore: row.taste_score,
    updatedAt: row.updated_at,
  };
}

async function sbGetMonth(year: number, month: number) {
  const { data, error } = await supabaseAdmin()
    .from("menus")
    .select("year,month,day,meal,dish_text,needs_review")
    .eq("year", year)
    .eq("month", month);
  if (error) throw new Error(error.message);
  return mergeMonth(year, month, (data ?? []).map(mapMenu));
}

async function sbSaveMonth(year: number, month: number, cells: MenuCell[], confirmOverwrite: boolean) {
  const existing = await sbGetMonth(year, month);
  const filled = existing.filter((cell) => cell.dishText.trim()).length;
  if (filled > 0 && !confirmOverwrite) return { ok: false as const, conflict: true as const, filled };
  const rows = cells.map((cell) => ({
    year,
    month,
    day: cell.day,
    meal: cell.meal,
    dish_text: cell.dishText,
    needs_review: cell.needsReview,
  }));
  const { error } = await supabaseAdmin().from("menus").upsert(rows, { onConflict: "year,month,day,meal" });
  if (error) throw new Error(error.message);
  return { ok: true as const };
}

async function sbSaveCell(cell: MenuCell) {
  const { error } = await supabaseAdmin().from("menus").upsert(
    {
      year: cell.year,
      month: cell.month,
      day: cell.day,
      meal: cell.meal,
      dish_text: cell.dishText,
      needs_review: cell.needsReview,
    },
    { onConflict: "year,month,day,meal" },
  );
  if (error) throw new Error(error.message);
}

async function sbSettings(): Promise<SendSetting[]> {
  const { data, error } = await supabaseAdmin().from("send_settings").select("meal,send_time,enabled");
  if (error) throw new Error(error.message);
  const map = new Map((data ?? []).map((row) => [row.meal, row]));
  return MEALS.map((meal) => {
    const row = map.get(meal.key);
    return {
      meal: meal.key,
      sendTime: row ? hhmm(String(row.send_time)) : meal.defaultTime,
      enabled: row ? Boolean(row.enabled) : true,
    };
  });
}

async function sbSaveSettings(settings: SendSetting[]) {
  const rows = settings.map((setting) => ({
    meal: setting.meal,
    send_time: setting.sendTime,
    enabled: setting.enabled,
  }));
  const { error } = await supabaseAdmin().from("send_settings").upsert(rows, { onConflict: "meal" });
  if (error) throw new Error(error.message);
}

async function sbLogs(limit: number) {
  const { data, error } = await supabaseAdmin()
    .from("send_logs")
    .select("id,menu_date,meal,status,target,detail,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapLog);
}

async function sbLatest(menuDate: string, meal: MealKey, statuses: SendStatus[]) {
  const { data, error } = await supabaseAdmin()
    .from("send_logs")
    .select("id,menu_date,meal,status,target,detail,created_at")
    .eq("menu_date", menuDate)
    .eq("meal", meal)
    .in("status", statuses)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapLog(data) : null;
}

async function sbInsertLog(input: Omit<SendLog, "id" | "createdAt">) {
  const { data, error } = await supabaseAdmin()
    .from("send_logs")
    .insert({
      menu_date: input.menuDate,
      meal: input.meal,
      status: input.status,
      target: input.target,
      detail: input.detail,
    })
    .select("id,menu_date,meal,status,target,detail,created_at")
    .single();
  if (error) {
    if (error.code === "23505") return null;
    throw new Error(error.message);
  }
  return mapLog(data);
}

async function sbUpdateLog(id: string, patch: { status: SendStatus; detail: string | null }) {
  const { error } = await supabaseAdmin().from("send_logs").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

async function sbRatings(from: string, to: string) {
  const { data, error } = await supabaseAdmin()
    .from("ratings")
    .select("id,menu_date,meal,line_user_id,menu_score,taste_score,updated_at")
    .gte("menu_date", from)
    .lte("menu_date", to);
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapRating);
}

async function sbUpsertRating(input: {
  menuDate: string;
  meal: MealKey;
  lineUserId: string;
  menuScore?: number;
  tasteScore?: number;
}) {
  const existing = await supabaseAdmin()
    .from("ratings")
    .select("id,menu_date,meal,line_user_id,menu_score,taste_score,updated_at")
    .eq("menu_date", input.menuDate)
    .eq("meal", input.meal)
    .eq("line_user_id", input.lineUserId)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  const previous = existing.data ? mapRating(existing.data) : null;
  const menuScore = input.menuScore ?? previous?.menuScore ?? null;
  const tasteScore = input.tasteScore ?? previous?.tasteScore ?? null;
  const { data, error } = await supabaseAdmin()
    .from("ratings")
    .upsert(
      {
        menu_date: input.menuDate,
        meal: input.meal,
        line_user_id: input.lineUserId,
        menu_score: menuScore,
        taste_score: tasteScore,
      },
      { onConflict: "menu_date,meal,line_user_id" },
    )
    .select("id,menu_date,meal,line_user_id,menu_score,taste_score,updated_at")
    .single();
  if (error) throw new Error(error.message);
  return { updated: Boolean(previous), row: mapRating(data) };
}

function memGetMonth(year: number, month: number) {
  return mergeMonth(
    year,
    month,
    memory().menus.filter((cell) => cell.year === year && cell.month === month),
  );
}

function memSaveMonth(year: number, month: number, cells: MenuCell[], confirmOverwrite: boolean) {
  const db = memory();
  const filled = db.menus.filter((cell) => cell.year === year && cell.month === month && cell.dishText.trim()).length;
  if (filled > 0 && !confirmOverwrite) return { ok: false as const, conflict: true as const, filled };
  db.menus = db.menus.filter((cell) => !(cell.year === year && cell.month === month));
  db.menus.push(...cells.map((cell) => ({ ...cell, year, month })));
  return { ok: true as const };
}

export const store = {
  usingSupabase: isSupabaseConfigured,
  async getMonth(year: number, month: number) {
    return isSupabaseConfigured() ? sbGetMonth(year, month) : memGetMonth(year, month);
  },
  async saveMonth(year: number, month: number, cells: MenuCell[], confirmOverwrite: boolean) {
    return isSupabaseConfigured()
      ? sbSaveMonth(year, month, cells, confirmOverwrite)
      : memSaveMonth(year, month, cells, confirmOverwrite);
  },
  async saveCell(cell: MenuCell) {
    if (isSupabaseConfigured()) return sbSaveCell(cell);
    const db = memory();
    const index = db.menus.findIndex(
      (item) => item.year === cell.year && item.month === cell.month && item.day === cell.day && item.meal === cell.meal,
    );
    if (index >= 0) db.menus[index] = cell;
    else db.menus.push(cell);
  },
  async getSettings() {
    return isSupabaseConfigured() ? sbSettings() : memory().settings.map((item) => ({ ...item }));
  },
  async saveSettings(settings: SendSetting[]) {
    if (isSupabaseConfigured()) return sbSaveSettings(settings);
    memory().settings = settings.map((item) => ({ ...item, sendTime: hhmm(item.sendTime) }));
  },
  async listLogs(limit = 40) {
    if (isSupabaseConfigured()) return sbLogs(limit);
    return [...memory().logs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  },
  async latestLog(menuDate: string, meal: MealKey, statuses: SendStatus[]) {
    if (isSupabaseConfigured()) return sbLatest(menuDate, meal, statuses);
    return (
      memory().logs
        .filter((log) => log.menuDate === menuDate && log.meal === meal && statuses.includes(log.status))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
    );
  },
  async insertLog(input: Omit<SendLog, "id" | "createdAt">) {
    if (isSupabaseConfigured()) return sbInsertLog(input);
    const db = memory();
    if (input.status === "sent" || input.status === "claimed") {
      const open = db.logs.find(
        (log) => log.menuDate === input.menuDate && log.meal === input.meal && (log.status === "sent" || log.status === "claimed"),
      );
      if (open) return null;
    }
    const row: SendLog = { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    db.logs.push(row);
    return row;
  },
  async updateLog(id: string, patch: { status: SendStatus; detail: string | null }) {
    if (isSupabaseConfigured()) return sbUpdateLog(id, patch);
    const row = memory().logs.find((log) => log.id === id);
    if (row) {
      row.status = patch.status;
      row.detail = patch.detail;
    }
  },
  async listRatings(year: number, month: number) {
    const from = isoFromParts(year, month, 1);
    const to = isoFromParts(year, month, daysInMonth(year, month));
    return isSupabaseConfigured()
      ? sbRatings(from, to)
      : memory().ratings.filter((row) => row.menuDate >= from && row.menuDate <= to);
  },
  async upsertRating(input: {
    menuDate: string;
    meal: MealKey;
    lineUserId: string;
    menuScore?: number;
    tasteScore?: number;
  }) {
    if (isSupabaseConfigured()) return sbUpsertRating(input);
    const db = memory();
    const index = db.ratings.findIndex(
      (row) => row.menuDate === input.menuDate && row.meal === input.meal && row.lineUserId === input.lineUserId,
    );
    const previous = index >= 0 ? db.ratings[index] : null;
    const row: RatingRow = {
      id: previous?.id ?? crypto.randomUUID(),
      menuDate: input.menuDate,
      meal: input.meal,
      lineUserId: input.lineUserId,
      menuScore: input.menuScore ?? previous?.menuScore ?? null,
      tasteScore: input.tasteScore ?? previous?.tasteScore ?? null,
      updatedAt: new Date().toISOString(),
    };
    if (index >= 0) db.ratings[index] = row;
    else db.ratings.push(row);
    return { updated: Boolean(previous), row };
  },
};

export function dishOn(cells: MenuCell[], date: string, meal: MealKey) {
  const [year, month, day] = date.split("-").map(Number);
  return cells.find((cell) => cell.year === year && cell.month === month && cell.day === day && cell.meal === meal)?.dishText ?? "";
}
