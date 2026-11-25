import { NextResponse } from "next/server";
import { LINE_BOT_SECRET_KEYS, type BotId } from "@/lib/line-bots";
import { setAppSecret, setLineBotEnabled } from "@/lib/server/app-secrets";
import { bad } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    bot?: string;
    enabled?: unknown;
    accessToken?: unknown;
    channelSecret?: unknown;
  } | null;

  if (!body || (body.bot !== "1" && body.bot !== "2")) {
    return bad("ระบุบอทที่ต้องการแก้ไข (1 หรือ 2)");
  }

  const bot: BotId = body.bot;
  const hasEnabled = typeof body.enabled === "boolean";
  const accessToken = typeof body.accessToken === "string" ? body.accessToken.trim() : "";
  const channelSecret = typeof body.channelSecret === "string" ? body.channelSecret.trim() : "";

  if (!hasEnabled && !accessToken && !channelSecret) {
    return bad("ไม่มีข้อมูลที่ต้องการบันทึก");
  }

  try {
    if (hasEnabled) {
      await setLineBotEnabled(bot, body.enabled as boolean);
    }
    if (accessToken) {
      await setAppSecret(LINE_BOT_SECRET_KEYS[bot].token, accessToken);
    }
    if (channelSecret) {
      await setAppSecret(LINE_BOT_SECRET_KEYS[bot].secret, channelSecret);
    }
    return NextResponse.json({ ok: true, bot });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "บันทึกการตั้งค่า LINE ไม่สำเร็จ" },
      { status: 500 },
    );
  }
}
