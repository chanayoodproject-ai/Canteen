import { NextResponse } from "next/server";
import { resolveLineAccessToken, resolveLineChannelSecret } from "@/lib/server/app-secrets";
import { lineBotInfo } from "@/lib/server/line";
import { resolveLineTarget } from "@/lib/server/line-targets";
import { maskTarget } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1";
export const maxDuration = 15;

export async function GET() {
  const [token, secret, target] = await Promise.all([
    resolveLineAccessToken(),
    resolveLineChannelSecret(),
    resolveLineTarget(),
  ]);
  const bot = token
    ? await lineBotInfo()
    : { ok: false as const, displayName: null, error: null };
  return NextResponse.json({
    ok: true,
    hasToken: Boolean(token),
    hasSecret: Boolean(secret),
    hasTarget: Boolean(target),
    targetMasked: maskTarget(target),
    configured: Boolean(token && secret && target),
    bot,
  });
}
