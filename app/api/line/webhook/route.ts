import { NextResponse, after } from "next/server";
import { resolveLineChannelSecret } from "@/lib/server/app-secrets";
import { verifyLineSignature } from "@/lib/server/line";
import { handleMenuQuestion } from "@/lib/server/ask-menu";
import { markLineTargetInactive, upsertLineTarget } from "@/lib/server/line-targets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const preferredRegion = "bom1";
export const maxDuration = 15;

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

async function captureLineTarget(eventType: string | undefined, source: LineSource | undefined) {
  const id = source?.type === "group" ? source.groupId : source?.type === "room" ? source.roomId : "";
  // Removed from a group/room: stop automatic sends there. Any other event (join, message, …) keeps it active.
  if (eventType === "leave") {
    if (id) await markLineTargetInactive(id);
    return;
  }
  if (source?.type === "group" && source.groupId) {
    await upsertLineTarget(source.groupId, "group");
  } else if (source?.type === "room" && source.roomId) {
    await upsertLineTarget(source.roomId, "room");
  }
}

async function handleEvents(events: LineEvent[]) {
  for (const event of events) {
    try {
      await captureLineTarget(event.type, event.source);
    } catch {
      // Keep processing remaining events even if target storage fails.
    }
    if (event.type === "leave") continue;
    try {
      await handleMenuQuestion(event);
    } catch {
      // Keep processing remaining events even if a menu reply fails.
    }
    // Ignore leftover rating postbacks from older Flex messages.
  }
}

export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("x-line-signature");
  if (!(await resolveLineChannelSecret())) {
    return NextResponse.json({ ok: false, error: "ยังไม่ได้ตั้ง LINE_CHANNEL_SECRET" }, { status: 401 });
  }
  if (!(await verifyLineSignature(raw, signature))) {
    return NextResponse.json({ ok: false, error: "ลายเซ็นไม่ถูกต้อง" }, { status: 401 });
  }
  const payload = JSON.parse(raw) as { events?: LineEvent[] };
  const events = payload.events ?? [];
  // LINE's webhook test sends an empty events array and requires a fast 200.
  if (events.length > 0) {
    after(async () => {
      try {
        await handleEvents(events);
      } catch {
        // Already accepted the webhook; avoid failing the invocation after the response.
      }
    });
  }
  return NextResponse.json({ ok: true });
}
