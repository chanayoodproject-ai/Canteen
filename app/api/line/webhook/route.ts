import { NextResponse } from "next/server";
import { parsePostback, thankYouText } from "@/lib/flex";
import { replyLine, verifyLineSignature } from "@/lib/server/line";
import { store } from "@/lib/server/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("x-line-signature");
  if (!process.env.LINE_CHANNEL_SECRET) {
    return NextResponse.json({ ok: false, error: "ยังไม่ได้ตั้ง LINE_CHANNEL_SECRET" }, { status: 401 });
  }
  if (!verifyLineSignature(raw, signature)) {
    return NextResponse.json({ ok: false, error: "ลายเซ็นไม่ถูกต้อง" }, { status: 401 });
  }
  const payload = JSON.parse(raw) as {
    events?: {
      type?: string;
      replyToken?: string;
      postback?: { data?: string };
      source?: { userId?: string };
    }[];
  };
  for (const event of payload.events ?? []) {
    if (event.type !== "postback" || !event.postback?.data) continue;
    const parsed = parsePostback(event.postback.data);
    if (!parsed.ok) continue;
    const userId = event.source?.userId || "unknown";
    const saved = await store.upsertRating({
      menuDate: parsed.date,
      meal: parsed.meal,
      lineUserId: userId,
      menuScore: parsed.kind === "menu" ? parsed.score : undefined,
      tasteScore: parsed.kind === "taste" ? parsed.score : undefined,
    });
    if (event.replyToken) {
      await replyLine(event.replyToken, thankYouText({ kind: parsed.kind, score: parsed.score, updated: saved.updated }));
    }
  }
  return NextResponse.json({ ok: true });
}
