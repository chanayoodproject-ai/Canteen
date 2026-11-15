import { NextResponse, after } from "next/server";
import type { BotId } from "@/lib/line-bots";
import { LINE_BOT_SECRET_KEYS } from "@/lib/line-bots";
import { resolveLineChannelSecret } from "@/lib/server/app-secrets";
import { handleMenuQuestion } from "@/lib/server/ask-menu";
import { verifyLineSignature } from "@/lib/server/line";
import { markLineBotLeft, upsertLineTarget } from "@/lib/server/line-targets";

type LineSource = {
  type?: string;
  userId?: string;
  groupId?: string;
  roomId?: string;
};

type LineEvent = {
  type?: string;
  replyToken?: string;
  message?: { type?: string; text?: string };
  source?: LineSource;
};

async function captureLineTarget(eventType: string | undefined, source: LineSource | undefined, bot: BotId) {
  const id = source?.type === "group" ? source.groupId : source?.type === "room" ? source.roomId : "";
  if (eventType === "leave") {
    if (id) await markLineBotLeft(id, bot);
    return;
  }
  if (source?.type === "group" && source.groupId) {
    await upsertLineTarget(source.groupId, "group", bot);
  } else if (source?.type === "room" && source.roomId) {
    await upsertLineTarget(source.roomId, "room", bot);
  }
}

async function handleEvents(events: LineEvent[], bot: BotId) {
  for (const event of events) {
    try {
      await captureLineTarget(event.type, event.source, bot);
    } catch {
      // Keep processing remaining events even if target storage fails.
    }
    if (event.type === "leave") continue;
    try {
      await handleMenuQuestion(event, bot);
    } catch {
      // Keep processing remaining events even if a menu reply fails.
    }
    // Ignore leftover rating postbacks from older Flex messages.
  }
}

export async function handleLineWebhook(request: Request, bot: BotId) {
  const raw = await request.text();
  const signature = request.headers.get("x-line-signature");
  if (!(await resolveLineChannelSecret(bot))) {
    const name = LINE_BOT_SECRET_KEYS[bot].secret;
    return NextResponse.json({ ok: false, error: `ยังไม่ได้ตั้ง ${name}` }, { status: 401 });
  }
  if (!(await verifyLineSignature(raw, signature, bot))) {
    return NextResponse.json({ ok: false, error: "ลายเซ็นไม่ถูกต้อง" }, { status: 401 });
  }
  const payload = JSON.parse(raw) as { events?: LineEvent[] };
  const events = payload.events ?? [];
  // LINE's webhook test sends an empty events array and requires a fast 200.
  if (events.length > 0) {
    after(async () => {
      try {
        await handleEvents(events, bot);
      } catch {
        // Already accepted the webhook; avoid failing the invocation after the response.
      }
    });
  }
  return NextResponse.json({ ok: true });
}
