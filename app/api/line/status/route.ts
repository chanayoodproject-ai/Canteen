import { NextResponse } from "next/server";
import { lineBotInfo } from "@/lib/server/line";
import { lineConfigured, maskTarget } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const bot = process.env.LINE_CHANNEL_ACCESS_TOKEN ? await lineBotInfo() : { ok: false, displayName: null, error: null };
  return NextResponse.json({
    ok: true,
    hasToken: Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN),
    hasSecret: Boolean(process.env.LINE_CHANNEL_SECRET),
    hasTarget: Boolean(process.env.LINE_TARGET_ID),
    targetMasked: maskTarget(),
    configured: lineConfigured(),
    bot,
  });
}
