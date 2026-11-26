import { NextResponse } from "next/server";
import { preferredBotForDate, type BotId } from "@/lib/line-bots";
import {
  configuredLineBots,
  isLineBotEnabled,
  lineBotConfigured,
  resolveLineAccessToken,
  resolveLineChannelSecret,
} from "@/lib/server/app-secrets";
import { lineBotInfo, lineBotQuota, type LineQuota } from "@/lib/server/line";
import { countActiveTargets, listActiveTargetDetails, resolveLineTarget } from "@/lib/server/line-targets";
import { maskTarget } from "@/lib/server/supabase";
import { bangkokNow } from "@/lib/time";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1";
export const maxDuration = 30;

function maskTokenHint(token: string) {
  if (!token) return "";
  if (token.length <= 6) return "••••";
  return `••••${token.slice(-4)}`;
}

async function botStatus(id: BotId) {
  const [token, secret, enabled, configured] = await Promise.all([
    resolveLineAccessToken(id),
    resolveLineChannelSecret(id),
    isLineBotEnabled(id),
    lineBotConfigured(id),
  ]);
  const hasToken = Boolean(token);
  const hasSecret = Boolean(secret);
  const info = hasToken ? await lineBotInfo(id) : { ok: false as const, displayName: null, error: null };
  const quota: LineQuota = hasToken
    ? await lineBotQuota(id)
    : { ok: false, type: null, limit: null, used: null, error: null };
  return {
    id,
    enabled,
    hasToken,
    hasSecret,
    tokenHint: maskTokenHint(token),
    configured,
    ok: info.ok,
    displayName: info.displayName,
    error: info.error,
    quota,
  };
}

export async function GET() {
  const today = bangkokNow().iso;
  const [token, secret, target, activeGroups, groups, configured, bot1, bot2] = await Promise.all([
    resolveLineAccessToken("1"),
    resolveLineChannelSecret("1"),
    resolveLineTarget(),
    countActiveTargets(),
    listActiveTargetDetails(),
    configuredLineBots(),
    botStatus("1"),
    botStatus("2"),
  ]);
  const todayBot = configured.bot1 || configured.bot2 ? preferredBotForDate(today) : null;
  const sender =
    todayBot && ((todayBot === "1" && configured.bot1) || (todayBot === "2" && configured.bot2))
      ? todayBot
      : configured.bot1
        ? "1"
        : configured.bot2
          ? "2"
          : null;
  return NextResponse.json({
    ok: true,
    hasToken: Boolean(token),
    hasSecret: Boolean(secret),
    hasTarget: Boolean(target),
    targetMasked: maskTarget(target),
    activeGroups,
    groups,
    targetOverride: Boolean(process.env.LINE_TARGET_ID),
    configured: Boolean((configured.bot1 || configured.bot2) && target),
    bot: { ok: bot1.ok, displayName: bot1.displayName, error: bot1.error },
    today: today,
    todayBot: sender,
    bots: [bot1, bot2],
  });
}
