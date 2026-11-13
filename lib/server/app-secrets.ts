import { db, isDatabaseUrlConfigured } from "@/lib/server/db";

const cache = new Map<string, string>();

export async function getAppSecret(key: string) {
  const fromEnv = process.env[key] || "";
  if (fromEnv) return fromEnv;
  const cached = cache.get(key);
  if (cached) return cached;
  if (!isDatabaseUrlConfigured()) return "";
  const sql = db();
  try {
    const rows = await sql<{ value: string }[]>`
      SELECT value FROM public.app_secrets WHERE key = ${key} LIMIT 1
    `;
    const value = rows[0]?.value ?? "";
    if (value) cache.set(key, value);
    return value;
  } catch {
    return "";
  }
}

export function resolveLineAccessToken() {
  return getAppSecret("LINE_CHANNEL_ACCESS_TOKEN");
}

export function resolveLineChannelSecret() {
  return getAppSecret("LINE_CHANNEL_SECRET");
}
