/** Pure helpers for multi-group sending (kept free of server imports so they are easy to test). */

export type TargetRow = { id: string; active: boolean };

/** Who gets the automatic menu card: the LINE_TARGET_ID override alone, otherwise every active group/room. */
export function planTargets(override: string | undefined, rows: TargetRow[]) {
  const forced = (override || "").trim();
  if (forced) return [forced];
  return [...new Set(rows.filter((row) => row.active && row.id).map((row) => row.id))];
}

/**
 * True when LINE says the bot can no longer post to this group/room (it was removed or the id is wrong).
 * Only these errors stop future sends to that group; anything else (bad message, quota, outage) does not.
 */
export function isGoneFromTarget(status: number, body: string) {
  if (status !== 400 && status !== 403 && status !== 404) return false;
  // Plan/permission errors ("not allowed to use this API") and bad messages are about the account, not one group.
  return /not a member|isn'?t a member|not (in|joined)( to)? (the |this )?(group|room)|left the (group|room)|the property, 'to'|invalid .*\bto\b/i.test(
    body,
  );
}

export type TargetOutcome = { target: string; status: string; detail: string };

/** One line per meal for the dashboard and cron output, summarising every group. */
export function summarizeTargets(outcomes: TargetOutcome[]) {
  if (!outcomes.length) return { status: "skipped", detail: "ยังไม่มีกลุ่ม LINE ที่บอทอยู่" };
  const count = (status: string) => outcomes.filter((item) => item.status === status).length;
  const sent = count("sent");
  const failed = count("failed");
  const would = count("would_send");
  if (would) return { status: "would_send", detail: `จะส่งเข้า ${would} กลุ่ม` };
  if (sent && failed) return { status: "partial", detail: `ส่งแล้ว ${sent} กลุ่ม ไม่สำเร็จ ${failed} กลุ่ม` };
  if (sent) return { status: "sent", detail: sent === 1 ? "ส่งเข้า LINE แล้ว" : `ส่งเข้า LINE แล้ว ${sent} กลุ่ม` };
  if (failed) return { status: "failed", detail: outcomes.find((item) => item.status === "failed")?.detail || "ส่งไม่สำเร็จ" };
  return { status: outcomes[0].status, detail: outcomes[0].detail };
}
