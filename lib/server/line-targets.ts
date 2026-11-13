import { db, isDatabaseUrlConfigured, withDbRetry } from "@/lib/server/db";
import { planTargets, type TargetRow } from "@/lib/line-target-plan";

/** Remember a group/room the bot is in (any event from it, including join). */
export async function upsertLineTarget(id: string, type: "group" | "room") {
  if (!isDatabaseUrlConfigured() || !id) return;
  try {
    await db()`
      INSERT INTO public.line_targets (id, type, last_seen, active, joined_at, left_at)
      VALUES (${id}, ${type}, now(), true, now(), null)
      ON CONFLICT (id) DO UPDATE SET
        type = EXCLUDED.type,
        last_seen = now(),
        active = true,
        left_at = null,
        joined_at = CASE WHEN public.line_targets.active THEN public.line_targets.joined_at ELSE now() END
    `;
  } catch {
    // Keep the webhook fast even if storage hiccups; the next event will try again.
  }
}

/** Stop auto-sending to a group/room (bot was removed, or LINE says it is not a member). */
export async function markLineTargetInactive(id: string) {
  if (!isDatabaseUrlConfigured() || !id) return;
  try {
    await db()`
      UPDATE public.line_targets SET active = false, left_at = now() WHERE id = ${id} AND active
    `;
  } catch {
    // Ignore; a later failed push will mark it again.
  }
}

async function targetRows(): Promise<TargetRow[]> {
  if (!isDatabaseUrlConfigured()) return [];
  try {
    const rows = await withDbRetry(
      () => db()<{ id: string; active: boolean }[]>`
        SELECT id, active FROM public.line_targets ORDER BY last_seen DESC NULLS LAST
      `,
    );
    return rows.map((row) => ({ id: String(row.id), active: Boolean(row.active) }));
  } catch {
    return [];
  }
}

/** Every target that should get the automatic menu card. */
export async function listSendTargets() {
  return planTargets(process.env.LINE_TARGET_ID, await targetRows());
}

export async function countActiveTargets() {
  if (process.env.LINE_TARGET_ID) return 1;
  return (await targetRows()).filter((row) => row.active).length;
}

/** The single most recent active target (used for the manual test send). */
export async function resolveLineTarget() {
  return (await listSendTargets())[0] ?? "";
}
