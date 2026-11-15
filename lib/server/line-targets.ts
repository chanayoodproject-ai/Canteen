import type { BotId } from "@/lib/line-bots";
import { applyBotPresence, botsFromFlags, type BotPresence } from "@/lib/line-bots";
import { planTargets, type TargetRow } from "@/lib/line-target-plan";
import { db, isDatabaseUrlConfigured, withDbRetry } from "@/lib/server/db";

export type TargetState = { id: string; active: boolean; bots: BotId[] };

function presenceFromRow(row: { bot_1?: unknown; bot_2?: unknown; active?: unknown }): BotPresence {
  // Legacy rows (or a missing column during rollout) are treated as bot 1 only.
  const bot1 = row.bot_1 == null ? true : Boolean(row.bot_1);
  const bot2 = Boolean(row.bot_2);
  const flags = { bot1, bot2, active: bot1 || bot2 };
  return { ...flags, active: row.active == null ? flags.active : Boolean(row.active) && flags.active };
}

/** Remember a group/room a given bot is in (join, message, or any other non-leave event). */
export async function upsertLineTarget(id: string, type: "group" | "room", bot: BotId = "1") {
  if (!isDatabaseUrlConfigured() || !id) return;
  try {
    const bot1 = bot === "1";
    const bot2 = bot === "2";
    await db()`
      INSERT INTO public.line_targets (id, type, last_seen, active, joined_at, left_at, bot_1, bot_2)
      VALUES (${id}, ${type}, now(), true, now(), null, ${bot1}, ${bot2})
      ON CONFLICT (id) DO UPDATE SET
        type = EXCLUDED.type,
        last_seen = now(),
        bot_1 = public.line_targets.bot_1 OR EXCLUDED.bot_1,
        bot_2 = public.line_targets.bot_2 OR EXCLUDED.bot_2,
        active = true,
        left_at = null,
        joined_at = CASE WHEN public.line_targets.active THEN public.line_targets.joined_at ELSE now() END
    `;
  } catch {
    // Keep the webhook fast even if storage hiccups; the next event will try again.
  }
}

/** One bot left or can no longer push; the group stays active if the other bot is still a member. */
export async function markLineBotLeft(id: string, bot: BotId) {
  if (!isDatabaseUrlConfigured() || !id) return;
  try {
    const rows = await db()`
      SELECT bot_1, bot_2, active FROM public.line_targets WHERE id = ${id} LIMIT 1
    `;
    if (!rows[0]) return;
    const next = applyBotPresence(presenceFromRow(rows[0]), bot, "leave");
    await db()`
      UPDATE public.line_targets
      SET bot_1 = ${next.bot1},
          bot_2 = ${next.bot2},
          active = ${next.active},
          left_at = CASE WHEN ${next.active} THEN left_at ELSE now() END
      WHERE id = ${id}
    `;
  } catch {
    // Ignore; a later failed push will mark it again.
  }
}

/** Stop auto-sending to a group/room entirely (used when the only bot, or both, are gone). */
export async function markLineTargetInactive(id: string) {
  if (!isDatabaseUrlConfigured() || !id) return;
  try {
    await db()`
      UPDATE public.line_targets
      SET active = false, bot_1 = false, bot_2 = false, left_at = now()
      WHERE id = ${id} AND active
    `;
  } catch {
    // Ignore; a later failed push will mark it again.
  }
}

async function targetRows(): Promise<(TargetRow & { bots: BotId[] })[]> {
  if (!isDatabaseUrlConfigured()) return [];
  try {
    const rows = await withDbRetry(
      () => db()`
        SELECT id, active, bot_1, bot_2 FROM public.line_targets ORDER BY last_seen DESC NULLS LAST
      `,
    );
    return rows.map((row) => {
      const presence = presenceFromRow(row);
      return { id: String(row.id), active: Boolean(row.active) && presence.active, bots: botsFromFlags(presence.bot1, presence.bot2) };
    });
  } catch {
    return [];
  }
}

/** Every target that should get the automatic menu card. */
export async function listSendTargets() {
  return planTargets(process.env.LINE_TARGET_ID, await targetRows());
}

export async function listSendTargetStates(): Promise<TargetState[]> {
  const rows = await targetRows();
  const ids = planTargets(process.env.LINE_TARGET_ID, rows);
  const map = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => {
    const row = map.get(id);
    return { id, active: row?.active ?? true, bots: row?.bots?.length ? row.bots : (["1"] as BotId[]) };
  });
}

export async function getTargetBots(id: string): Promise<BotId[]> {
  if (!isDatabaseUrlConfigured() || !id) return ["1"];
  try {
    const rows = await db()`
      SELECT bot_1, bot_2, active FROM public.line_targets WHERE id = ${id} LIMIT 1
    `;
    if (!rows[0]) return ["1"];
    const presence = presenceFromRow(rows[0]);
    const bots = botsFromFlags(presence.bot1, presence.bot2);
    return bots.length ? bots : ["1"];
  } catch {
    return ["1"];
  }
}

export async function countActiveTargets() {
  if (process.env.LINE_TARGET_ID) return 1;
  return (await targetRows()).filter((row) => row.active).length;
}

/** The single most recent active target (used for the manual test send). */
export async function resolveLineTarget() {
  return (await listSendTargets())[0] ?? "";
}
