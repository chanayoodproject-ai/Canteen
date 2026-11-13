import dns from "node:dns";
import postgres from "postgres";

// Prefer IPv4 so serverless functions don't hang on IPv6 to the Supabase pooler.
dns.setDefaultResultOrder("ipv4first");

let sql: ReturnType<typeof postgres> | null = null;

export function isDatabaseUrlConfigured() {
  const url = process.env.DATABASE_URL || "";
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

export function db() {
  if (!isDatabaseUrlConfigured()) {
    throw new Error("ยังไม่ได้ตั้งค่าฐานข้อมูล");
  }
  if (!sql) {
    sql = postgres(process.env.DATABASE_URL!, {
      prepare: false,
      ssl: "require",
      max: 5,
      idle_timeout: 5,
      connect_timeout: 10,
      max_lifetime: 60,
      connection: {
        application_name: "canteen",
        statement_timeout: 8000,
      },
    });
  }
  return sql;
}

const TRANSIENT_CODES = new Set([
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
  "CONNECT_TIMEOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "57P01", // admin_shutdown (pooler restart)
  "08006", // connection_failure
  "08001",
  "08003",
]);

export function isTransientDbError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "");
  return TRANSIENT_CODES.has(code) || /connection (terminated|closed|reset)|timeout exceeded when trying to connect/i.test(message);
}

/** Retry an idempotent DB operation once after a short pause when the pooler drops the connection. */
export async function withDbRetry<T>(operation: () => Promise<T>, attempts = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientDbError(error) || attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  throw lastError;
}

export function asIsoDate(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? "").slice(0, 10);
}

export function asIsoTime(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(11, 16);
  return String(value ?? "").slice(0, 5);
}

export function asIso(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? "");
}
