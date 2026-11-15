import { handleLineWebhook } from "@/lib/server/line-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const preferredRegion = "bom1";
export const maxDuration = 15;

export async function POST(request: Request) {
  return handleLineWebhook(request, "2");
}
