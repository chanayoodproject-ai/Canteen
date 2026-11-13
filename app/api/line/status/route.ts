import { NextResponse } from "next/server";
import { resolveLineAccessToken, resolveLineChannelSecret } from "@/lib/server/app-secrets";
import { lineBotInfo } from "@/lib/server/line";
import { countActiveTargets, resolveLineTarget } from "@/lib/server/line-targets";
import { maskTarget } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1";
export const maxDuration = 15;

export async function GET() {
  const [token, secret, target, activeGroups] = await Promise.all([
    resolveLineAccessToken(),
    resolveLineChannelSecret(),
    resolveLineTarget(),
    countActiveTargets(),
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
    activeGroups,
    targetOverride: Boolean(process.env.LINE_TARGET_ID),
    configured: Boolean(token && secret && target),
    bot,
  });
}
