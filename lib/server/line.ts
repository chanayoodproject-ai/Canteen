import crypto from "crypto";
import { buildFlexMessage } from "@/lib/flex";
import type { MealKey } from "@/lib/meals";
import { resolveLineAccessToken, resolveLineChannelSecret } from "@/lib/server/app-secrets";
import { resolveLineTarget } from "@/lib/server/line-targets";
import { isGoneFromTarget } from "@/lib/line-target-plan";
import { lineConfigured, maskTarget } from "@/lib/server/supabase";

export async function pushFlex(input: { date: string; meal: MealKey; dishText: string; to?: string }) {
  const token = await resolveLineAccessToken();
  const target = input.to ?? (await resolveLineTarget());
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const message = buildFlexMessage({
    ...input,
    logoUrl: base ? `${base}/brand/logo-mark.png` : undefined,
  });
  if (!(await lineConfigured())) {
    return { ok: false as const, simulated: true, error: "ยังไม่ได้ตั้งค่า LINE", target: maskTarget(target), gone: false };
  }
  if (!target) {
    return { ok: false as const, simulated: false, error: "ยังไม่มีกลุ่ม LINE ที่บอทอยู่", target: "", gone: false };
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
    return { ok: false as const, simulated: false, error: "เชื่อมต่อ LINE ไม่สำเร็จ", target: maskTarget(target), gone: false };
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    return {
      ok: false as const,
      simulated: false,
      error: detail || "LINE ตอบกลับไม่สำเร็จ",
      target: maskTarget(target),
      gone: !broadcast && isGoneFromTarget(response.status, detail),
    };
  }
  return { ok: true as const, simulated: false, error: null, target: maskTarget(target), gone: false };
}

export async function replyLineMessages(replyToken: string, messages: unknown[]) {
  const token = await resolveLineAccessToken();
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

export async function replyLine(replyToken: string, text: string) {
  await replyLineMessages(replyToken, [{ type: "text", text }]);
}

export async function lineBotInfo() {
  const token = await resolveLineAccessToken();
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

export async function verifyLineSignature(body: string, signature: string | null) {
  const secret = await resolveLineChannelSecret();
  if (!secret || !signature) return false;
  const digest = crypto.createHmac("sha256", secret).update(body).digest("base64");
  const a = Buffer.from(digest);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
