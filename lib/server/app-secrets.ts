import { db, isDatabaseUrlConfigured } from "@/lib/server/db";

// Cache DB-stored secrets briefly so a rotated LINE token is picked up without a redeploy.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { value: string; at: number }>();

export async function getAppSecret(key: string) {
  const fromEnv = process.env[key] || "";
  if (fromEnv) return fromEnv;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  if (!isDatabaseUrlConfigured()) return "";
  const sql = db();
  try {
    const rows = await sql<{ value: string }[]>`
      SELECT value FROM public.app_secrets WHERE key = ${key} LIMIT 1
    `;
    const value = rows[0]?.value ?? "";
    if (value) cache.set(key, { value, at: Date.now() });
    return value;
  } catch {
    // Fall back to the last known value if the DB is briefly unreachable.
    return cached?.value ?? "";
  }
}

export function resolveLineAccessToken() {
  return getAppSecret("LINE_CHANNEL_ACCESS_TOKEN");
}

export function resolveLineChannelSecret() {
  return getAppSecret("LINE_CHANNEL_SECRET");
}
