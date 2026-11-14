import november from "@/data/november-2026.json";
import { MEALS, MEAL_KEYS, type MealKey } from "@/lib/meals";
import { daysInMonth } from "@/lib/time";
import { isDatabaseUrlConfigured, db, asIsoDate, asIsoTime, asIso, withDbRetry } from "@/lib/server/db";
import { isSupabaseConfigured, isSupabaseJsConfigured, supabaseAdmin } from "@/lib/server/supabase";

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
  /** Raw LINE group/room id this log belongs to ('' = account-wide / legacy). Server-only, never shown. */
  targetId?: string;
  detail: string | null;
  createdAt: string;
};

type MemoryDB = {
  menus: MenuCell[];
  settings: SendSetting[];
  logs: SendLog[];
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
  target_id?: string;
}): SendLog {
  return {
    id: row.id,
    menuDate: row.menu_date,
    meal: asMeal(row.meal),
    status: row.status,
    target: row.target,
    targetId: row.target_id,
    detail: row.detail,
    createdAt: row.created_at,
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

async function sbLatest(menuDate: string, meal: MealKey, statuses: SendStatus[], targetId?: string) {
  let query = supabaseAdmin()
    .from("send_logs")
    .select("id,menu_date,meal,status,target,target_id,detail,created_at")
    .eq("menu_date", menuDate)
    .eq("meal", meal)
    .in("status", statuses);
  if (targetId !== undefined) query = query.eq("target_id", targetId);
  const { data, error } = await query
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
      target_id: input.targetId ?? "",
      detail: input.detail,
    })
    .select("id,menu_date,meal,status,target,target_id,detail,created_at")
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

async function pgGetMonth(year: number, month: number) {
  const rows = await db()`
    select year, month, day, meal, dish_text, needs_review
    from public.menus
    where year = ${year} and month = ${month}
  `;
  return mergeMonth(
    year,
    month,
    rows.map((row) =>
      mapMenu({
        year: Number(row.year),
        month: Number(row.month),
        day: Number(row.day),
        meal: String(row.meal),
        dish_text: String(row.dish_text ?? ""),
        needs_review: Boolean(row.needs_review),
      }),
    ),
  );
}

async function pgSaveMonth(year: number, month: number, cells: MenuCell[], confirmOverwrite: boolean) {
  const existing = await pgGetMonth(year, month);
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
  const sql = db();
  await sql`
    insert into public.menus ${sql(rows, "year", "month", "day", "meal", "dish_text", "needs_review")}
    on conflict (year, month, day, meal) do update set
      dish_text = excluded.dish_text,
      needs_review = excluded.needs_review,
      updated_at = now()
  `;
  return { ok: true as const };
}

async function pgSaveCell(cell: MenuCell) {
  await db()`
    insert into public.menus (year, month, day, meal, dish_text, needs_review)
    values (${cell.year}, ${cell.month}, ${cell.day}, ${cell.meal}, ${cell.dishText}, ${cell.needsReview})
    on conflict (year, month, day, meal) do update set
      dish_text = excluded.dish_text,
      needs_review = excluded.needs_review,
      updated_at = now()
  `;
}

async function pgSettings(): Promise<SendSetting[]> {
  const data = await db()`select meal, send_time, enabled from public.send_settings`;
  const map = new Map(data.map((row) => [String(row.meal), row]));
  return MEALS.map((meal) => {
    const row = map.get(meal.key);
    return {
      meal: meal.key,
      sendTime: row ? asIsoTime(row.send_time) : meal.defaultTime,
      enabled: row ? Boolean(row.enabled) : true,
    };
  });
}

async function pgSaveSettings(settings: SendSetting[]) {
  const sql = db();
  const rows = settings.map((setting) => ({
    meal: setting.meal,
    send_time: setting.sendTime,
    enabled: setting.enabled,
  }));
  await sql`
    insert into public.send_settings ${sql(rows, "meal", "send_time", "enabled")}
    on conflict (meal) do update set
      send_time = excluded.send_time,
      enabled = excluded.enabled,
      updated_at = now()
  `;
}

function mapPgLog(row: Record<string, unknown>): SendLog {
  return mapLog({
    id: String(row.id),
    menu_date: asIsoDate(row.menu_date),
    meal: String(row.meal),
    status: row.status as SendStatus,
    target: row.target == null ? null : String(row.target),
    detail: row.detail == null ? null : String(row.detail),
    created_at: asIso(row.created_at),
    target_id: row.target_id == null ? undefined : String(row.target_id),
  });
}

async function pgLogs(limit: number) {
  const data = await db()`
    select id, menu_date, meal, status, target, detail, created_at
    from public.send_logs
    order by created_at desc
    limit ${limit}
  `;
  return data.map(mapPgLog);
}

async function pgLatest(menuDate: string, meal: MealKey, statuses: SendStatus[], targetId?: string) {
  const sql = db();
  const data = await sql`
    select id, menu_date, meal, status, target, target_id, detail, created_at
    from public.send_logs
    where menu_date = ${menuDate}::date and meal = ${meal} and status = any(${statuses}::text[])
      ${targetId === undefined ? sql`` : sql`and target_id = ${targetId}`}
    order by created_at desc
    limit 1
  `;
  return data[0] ? mapPgLog(data[0]) : null;
}

async function pgInsertLog(input: Omit<SendLog, "id" | "createdAt">) {
  try {
    const data = await db()`
      insert into public.send_logs (menu_date, meal, status, target, target_id, detail)
      values (${input.menuDate}::date, ${input.meal}, ${input.status}, ${input.target}, ${input.targetId ?? ""}, ${input.detail})
      returning id, menu_date, meal, status, target, detail, created_at
    `;
    return mapPgLog(data[0]);
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && (error as { code: string }).code === "23505") {
      return null;
    }
    throw error;
  }
}

async function pgUpdateLog(id: string, patch: { status: SendStatus; detail: string | null }) {
  await db()`
    update public.send_logs
    set status = ${patch.status}, detail = ${patch.detail}
    where id = ${id}::uuid
  `;
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

/** Every saved dish text (all months), used as the spelling dictionary for photo reading. */
async function pgKnownDishTexts() {
  const rows = await db()`
    select distinct dish_text from public.menus where dish_text <> '' limit 20000
  `;
  return rows.map((row) => String(row.dish_text ?? ""));
}

async function sbKnownDishTexts() {
  const { data, error } = await supabaseAdmin().from("menus").select("dish_text").neq("dish_text", "").limit(20000);
  if (error) throw new Error(error.message);
  return [...new Set((data ?? []).map((row) => String(row.dish_text ?? "")))];
}

export const store = {
  usingSupabase: isSupabaseConfigured,
  async knownDishTexts(): Promise<string[]> {
    if (isDatabaseUrlConfigured()) return withDbRetry(() => pgKnownDishTexts());
    if (isSupabaseJsConfigured()) return sbKnownDishTexts();
    return [...new Set(memory().menus.map((cell) => cell.dishText).filter(Boolean))];
  },
  async getMonth(year: number, month: number) {
    if (isDatabaseUrlConfigured()) return withDbRetry(() => pgGetMonth(year, month));
    return isSupabaseJsConfigured() ? sbGetMonth(year, month) : memGetMonth(year, month);
  },
  async saveMonth(year: number, month: number, cells: MenuCell[], confirmOverwrite: boolean) {
    if (isDatabaseUrlConfigured()) return withDbRetry(() => pgSaveMonth(year, month, cells, confirmOverwrite));
    return isSupabaseJsConfigured()
      ? sbSaveMonth(year, month, cells, confirmOverwrite)
      : memSaveMonth(year, month, cells, confirmOverwrite);
  },
  async saveCell(cell: MenuCell) {
    if (isDatabaseUrlConfigured()) return withDbRetry(() => pgSaveCell(cell));
    if (isSupabaseJsConfigured()) return sbSaveCell(cell);
    const dbMem = memory();
    const index = dbMem.menus.findIndex(
      (item) => item.year === cell.year && item.month === cell.month && item.day === cell.day && item.meal === cell.meal,
    );
    if (index >= 0) dbMem.menus[index] = cell;
    else dbMem.menus.push(cell);
  },
  async getSettings() {
    if (isDatabaseUrlConfigured()) return withDbRetry(() => pgSettings());
    return isSupabaseJsConfigured() ? sbSettings() : memory().settings.map((item) => ({ ...item }));
  },
  async saveSettings(settings: SendSetting[]) {
    if (isDatabaseUrlConfigured()) return withDbRetry(() => pgSaveSettings(settings));
    if (isSupabaseJsConfigured()) return sbSaveSettings(settings);
    memory().settings = settings.map((item) => ({ ...item, sendTime: hhmm(item.sendTime) }));
  },
  async listLogs(limit = 40) {
    if (isDatabaseUrlConfigured()) return withDbRetry(() => pgLogs(limit));
    if (isSupabaseJsConfigured()) return sbLogs(limit);
    return [...memory().logs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  },
  /** Latest log for a meal; pass targetId to look at one LINE group only. */
  async latestLog(menuDate: string, meal: MealKey, statuses: SendStatus[], targetId?: string) {
    if (isDatabaseUrlConfigured()) return withDbRetry(() => pgLatest(menuDate, meal, statuses, targetId));
    if (isSupabaseJsConfigured()) return sbLatest(menuDate, meal, statuses, targetId);
    return (
      memory().logs
        .filter(
          (log) =>
            log.menuDate === menuDate &&
            log.meal === meal &&
            statuses.includes(log.status) &&
            (targetId === undefined || (log.targetId ?? "") === targetId),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
    );
  },
  async insertLog(input: Omit<SendLog, "id" | "createdAt">) {
    if (isDatabaseUrlConfigured()) return pgInsertLog(input);
    if (isSupabaseJsConfigured()) return sbInsertLog(input);
    const dbMem = memory();
    if (input.status === "sent" || input.status === "claimed") {
      const open = dbMem.logs.find(
        (log) =>
          log.menuDate === input.menuDate &&
          log.meal === input.meal &&
          (log.targetId ?? "") === (input.targetId ?? "") &&
          (log.status === "sent" || log.status === "claimed"),
      );
      if (open) return null;
    }
    const row: SendLog = { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    dbMem.logs.push(row);
    return row;
  },
  async updateLog(id: string, patch: { status: SendStatus; detail: string | null }) {
    if (isDatabaseUrlConfigured()) return pgUpdateLog(id, patch);
    if (isSupabaseJsConfigured()) return sbUpdateLog(id, patch);
    const row = memory().logs.find((log) => log.id === id);
    if (row) {
      row.status = patch.status;
      row.detail = patch.detail;
    }
  },
};

export function dishOn(cells: MenuCell[], date: string, meal: MealKey) {
  const [year, month, day] = date.split("-").map(Number);
  return cells.find((cell) => cell.year === year && cell.month === month && cell.day === day && cell.meal === meal)?.dishText ?? "";
}
