import { NextResponse } from "next/server";
import { cronSecret, safeEqual } from "@/lib/secret";
import { runSend } from "@/lib/server/send";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const preferredRegion = "bom1";
export const maxDuration = 30;

// 20s is well under a 1-minute pg_cron cadence and only applies to unauthenticated calls.
const RATE_WINDOW_MS = 20_000;
let lastUnauthedAt = 0;

function bearerToken(request: Request) {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function isDryRun(request: Request) {
  return new URL(request.url).searchParams.get("dryRun") === "1";
}

function authorize(request: Request) {
  const token = bearerToken(request);
  const expected = cronSecret();
  if (!token) return { ok: true as const, authed: false };
  if (!expected || !safeEqual(token, expected)) {
    return { ok: false as const, authed: false };
  }
  return { ok: true as const, authed: true };
}

async function handle(request: Request) {
  const dryRun = isDryRun(request);
  const auth = authorize(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET ไม่ถูกต้อง" }, { status: 401 });
  }
  if (!auth.authed && !dryRun) {
    const now = Date.now();
    if (now - lastUnauthedAt < RATE_WINDOW_MS) {
      return NextResponse.json({ ok: false, error: "เรียกถี่เกินไป" }, { status: 429 });
    }
    lastUnauthedAt = now;
  }
  try {
    const result = await runSend({ dryRun });
    return NextResponse.json({
      ok: true,
      dryRun,
      date: result.date,
      results: result.results.map((item) => ({
        meal: item.meal,
        status: item.status,
        detail: item.detail,
        // Masked group ids only (e.g. "Cb6…a1f"), so dryRun shows who would receive the card.
        targets: item.targets,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "ส่งตามเวลาไม่สำเร็จ" },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;
