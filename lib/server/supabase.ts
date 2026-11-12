import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function isSupabaseConfigured() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return false;
  if (url.includes("YOUR_PROJECT") || key.includes("YOUR_")) return false;
  return true;
}

let client: SupabaseClient | null = null;

export function supabaseAdmin() {
  if (!isSupabaseConfigured()) {
    throw new Error("ยังไม่ได้ตั้งค่า Supabase");
  }
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
        },
      },
    );
  }
  return client;
}

export function lineConfigured() {
  return Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.LINE_TARGET_ID);
}

export function maskTarget(target = process.env.LINE_TARGET_ID || "") {
  if (!target) return "";
  if (target === "broadcast") return "broadcast";
  if (target.length <= 6) return `${target.slice(0, 2)}…`;
  return `${target.slice(0, 3)}…${target.slice(-3)}`;
}
