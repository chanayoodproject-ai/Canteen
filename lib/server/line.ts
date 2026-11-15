import { buildFlexMessage } from "@/lib/flex";
import type { BotId } from "@/lib/line-bots";
import { signatureMatches } from "@/lib/line-bots";
import type { MealKey } from "@/lib/meals";
import { isGoneFromTarget } from "@/lib/line-target-plan";
import { resolveLineAccessToken, resolveLineChannelSecret } from "@/lib/server/app-secrets";
import { resolveLineTarget } from "@/lib/server/line-targets";
import { lineConfigured, maskTarget } from "@/lib/server/supabase";

export async function pushFlex(input: { date: string; meal: MealKey; dishText: string; to?: string; bot?: BotId }) {
  const bot: BotId = input.bot ?? "1";
  const token = await resolveLineAccessToken(bot);
  const target = input.to ?? (await resolveLineTarget());
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const message = buildFlexMessage({
    ...input,
    logoUrl: base ? `${base}/brand/logo-mark.png` : undefined,
  });
  if (!(await lineConfigured())) {
    return { ok: false as const, simulated: true, error: "ยังไม่ได้ตั้งค่า LINE", target: maskTarget(target), gone: false, bot };
  }
  if (!token) {
    return { ok: false as const, simulated: false, error: `ยังไม่มีโทเค็นของบอท ${bot}`, target: maskTarget(target), gone: false, bot };
  }
  if (!target) {
    return { ok: false as const, simulated: false, error: "ยังไม่มีกลุ่ม LINE ที่บอทอยู่", target: "", gone: false, bot };
  }
  const broadcast = target === "broadcast";
  const response = await fetch(
    broadcast ? "https://api.line.me/v2/bot/message/broadcast" : "https://api.line.me/v2/bot/message/push",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(broadcast ? { messages: [message] } : { to: target, messages: [message] }),
      signal: AbortSignal.timeout(10_000),
    },
  ).catch(() => null);
  if (!response) {
    return { ok: false as const, simulated: false, error: "เชื่อมต่อ LINE ไม่สำเร็จ", target: maskTarget(target), gone: false, bot };
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    return {
      ok: false as const,
      simulated: false,
      error: detail || "LINE ตอบกลับไม่สำเร็จ",
      target: maskTarget(target),
      gone: !broadcast && isGoneFromTarget(response.status, detail),
      bot,
    };
  }
  return { ok: true as const, simulated: false, error: null, target: maskTarget(target), gone: false, bot };
}

export async function replyLineMessages(replyToken: string, messages: unknown[], bot: BotId = "1") {
  const token = await resolveLineAccessToken(bot);
  if (!token || !replyToken || messages.length === 0) return { ok: false as const };
  const response = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ replyToken, messages }),
  });
  return { ok: response.ok };
}

export async function replyLine(replyToken: string, text: string, bot: BotId = "1") {
  await replyLineMessages(replyToken, [{ type: "text", text }], bot);
}

export async function lineBotInfo(bot: BotId = "1") {
  const token = await resolveLineAccessToken(bot);
  if (!token) return { ok: false as const, displayName: null, error: "ยังไม่มี Channel access token" };
  const response = await fetch("https://api.line.me/v2/bot/info", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    return { ok: false as const, displayName: null, error: "เชื่อมต่อ LINE ไม่สำเร็จ ตรวจ token อีกครั้ง" };
  }
  const body = (await response.json()) as { displayName?: string };
  return { ok: true as const, displayName: body.displayName || "LINE OA", error: null };
}

export type LineQuota = {
  ok: boolean;
  type: string | null;
  limit: number | null;
  used: number | null;
  error: string | null;
};

export async function lineBotQuota(bot: BotId = "1"): Promise<LineQuota> {
  const token = await resolveLineAccessToken(bot);
  if (!token) return { ok: false, type: null, limit: null, used: null, error: "ยังไม่มี Channel access token" };
  const headers = { Authorization: `Bearer ${token}` };
  const [quotaRes, usedRes] = await Promise.all([
    fetch("https://api.line.me/v2/bot/message/quota", { headers, signal: AbortSignal.timeout(8_000) }).catch(() => null),
    fetch("https://api.line.me/v2/bot/message/quota/consumption", { headers, signal: AbortSignal.timeout(8_000) }).catch(
      () => null,
    ),
  ]);
  if (!quotaRes?.ok || !usedRes?.ok) {
    return { ok: false, type: null, limit: null, used: null, error: "อ่านโควต้าไม่สำเร็จ" };
  }
  const quota = (await quotaRes.json()) as { type?: string; value?: number };
  const used = (await usedRes.json()) as { totalUsage?: number };
  return {
    ok: true,
    type: quota.type ?? null,
    limit: quota.type === "none" ? null : (quota.value ?? null),
    used: used.totalUsage ?? null,
    error: null,
  };
}

export async function verifyLineSignature(body: string, signature: string | null, bot: BotId = "1") {
  const secret = await resolveLineChannelSecret(bot);
  return signatureMatches(body, signature, secret);
}
