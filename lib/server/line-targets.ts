import { db, isDatabaseUrlConfigured } from "@/lib/server/db";

export async function upsertLineTarget(id: string, type: "group" | "room") {
  if (!isDatabaseUrlConfigured() || !id) return;
  const sql = db();
  try {
    await sql`
      INSERT INTO public.line_targets (id, type, last_seen)
      VALUES (${id}, ${type}, now())
      ON CONFLICT (id) DO UPDATE SET type = EXCLUDED.type, last_seen = now()
    `;
  } catch {
    // Table is created during setup; ignore so webhook can still return quickly.
  }
}

export async function getLatestLineTargetId() {
  if (!isDatabaseUrlConfigured()) return "";
  const sql = db();
  try {
    const rows = await sql<{ id: string }[]>`
      SELECT id
      FROM public.line_targets
      ORDER BY last_seen DESC NULLS LAST
      LIMIT 1
    `;
    return rows[0]?.id ?? "";
  } catch {
    return "";
  }
}

export async function resolveLineTarget() {
  return process.env.LINE_TARGET_ID || (await getLatestLineTargetId()) || "";
}
