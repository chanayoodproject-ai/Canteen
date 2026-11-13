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
