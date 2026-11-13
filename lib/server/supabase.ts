import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isDatabaseUrlConfigured } from "@/lib/server/db";
import { resolveLineAccessToken, resolveLineChannelSecret } from "@/lib/server/app-secrets";
import { resolveLineTarget } from "@/lib/server/line-targets";

export function isSupabaseConfigured() {
  if (isDatabaseUrlConfigured()) return true;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return false;
  if (url.includes("YOUR_PROJECT") || key.includes("YOUR_")) return false;
  return true;
}

export function isSupabaseJsConfigured() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return false;
  if (url.includes("YOUR_PROJECT") || key.includes("YOUR_")) return false;
  return true;
}

let client: SupabaseClient | null = null;

export function supabaseAdmin() {
  if (!isSupabaseJsConfigured()) {
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

export async function lineConfigured() {
  const [token, secret, target] = await Promise.all([
    resolveLineAccessToken(),
    resolveLineChannelSecret(),
    resolveLineTarget(),
  ]);
  return Boolean(token && secret && target);
}

export function maskTarget(target = process.env.LINE_TARGET_ID || "") {
  if (!target) return "";
  if (target === "broadcast") return "broadcast";
  if (target.length <= 6) return `${target.slice(0, 2)}…`;
  return `${target.slice(0, 3)}…${target.slice(-3)}`;
}
