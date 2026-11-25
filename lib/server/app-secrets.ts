import type { BotId } from "@/lib/line-bots";
import { LINE_BOT_ENABLED_KEYS, LINE_BOT_SECRET_KEYS } from "@/lib/line-bots";
import { db, isDatabaseUrlConfigured } from "@/lib/server/db";

// Cache DB-stored secrets briefly so a rotated LINE token is picked up without a redeploy.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { value: string; at: number }>();
const memoryOverrides = new Map<string, string>();

const DB_FIRST_KEYS = new Set<string>([
  LINE_BOT_SECRET_KEYS["1"].token,
  LINE_BOT_SECRET_KEYS["1"].secret,
  LINE_BOT_SECRET_KEYS["2"].token,
  LINE_BOT_SECRET_KEYS["2"].secret,
  LINE_BOT_ENABLED_KEYS["1"],
  LINE_BOT_ENABLED_KEYS["2"],
]);

export async function getAppSecret(key: string) {
  if (!DB_FIRST_KEYS.has(key)) {
    const fromEnv = process.env[key] || "";
    if (fromEnv) return fromEnv;
  }

  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    if (cached.value) return cached.value;
  }

  if (isDatabaseUrlConfigured()) {
    const sql = db();
    try {
      const rows = await sql<{ value: string }[]>`
        SELECT value FROM public.app_secrets WHERE key = ${key} LIMIT 1
      `;
      const value = rows[0]?.value ?? "";
      if (value) {
        cache.set(key, { value, at: Date.now() });
        return value;
      }
    } catch {
      if (cached?.value) return cached.value;
    }
  } else if (memoryOverrides.has(key)) {
    return memoryOverrides.get(key) ?? "";
  }

  return process.env[key] || "";
}

export async function setAppSecret(key: string, value: string) {
  const trimmed = value.trim();
  if (!isDatabaseUrlConfigured()) {
    memoryOverrides.set(key, trimmed);
    if (trimmed) cache.set(key, { value: trimmed, at: Date.now() });
    else cache.delete(key);
    return;
  }
  const sql = db();
  await sql`
    INSERT INTO public.app_secrets (key, value, updated_at)
    VALUES (${key}, ${trimmed}, now())
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      updated_at = now()
  `;
  if (trimmed) cache.set(key, { value: trimmed, at: Date.now() });
  else cache.delete(key);
}

export function resolveLineAccessToken(bot: BotId = "1") {
  return getAppSecret(LINE_BOT_SECRET_KEYS[bot].token);
}

export function resolveLineChannelSecret(bot: BotId = "1") {
  return getAppSecret(LINE_BOT_SECRET_KEYS[bot].secret);
}

export async function isLineBotEnabled(bot: BotId = "1") {
  const value = (await getAppSecret(LINE_BOT_ENABLED_KEYS[bot])).trim().toLowerCase();
  if (value === "false" || value === "0" || value === "off") return false;
  return true;
}

export async function setLineBotEnabled(bot: BotId, enabled: boolean) {
  await setAppSecret(LINE_BOT_ENABLED_KEYS[bot], enabled ? "true" : "false");
}

export async function lineBotHasCredentials(bot: BotId = "1") {
  const [token, secret] = await Promise.all([resolveLineAccessToken(bot), resolveLineChannelSecret(bot)]);
  return Boolean(token && secret);
}

export async function lineBotConfigured(bot: BotId = "1") {
  const [hasCreds, enabled] = await Promise.all([lineBotHasCredentials(bot), isLineBotEnabled(bot)]);
  return hasCreds && enabled;
}

export async function configuredLineBots() {
  const [bot1, bot2] = await Promise.all([lineBotConfigured("1"), lineBotConfigured("2")]);
  return { bot1, bot2 };
}

export async function anyLineBotHasCredentials() {
  const [bot1, bot2] = await Promise.all([lineBotHasCredentials("1"), lineBotHasCredentials("2")]);
  return bot1 || bot2;
}
