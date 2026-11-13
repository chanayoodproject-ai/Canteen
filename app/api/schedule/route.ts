import { NextResponse } from "next/server";
import { bad } from "@/lib/server/http";
import { isMealKey, MEAL_KEYS } from "@/lib/meals";
import { store, type SendSetting } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [settings, logs] = await Promise.all([store.getSettings(), store.listLogs(40)]);
    return NextResponse.json({ ok: true, settings, logs });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "อ่านเวลาส่งไม่สำเร็จ" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as { settings?: SendSetting[] } | null;
  const settings = body?.settings ?? [];
  if (settings.length !== 4 || !MEAL_KEYS.every((meal) => settings.some((item) => item.meal === meal))) {
    return bad("ต้องมีเวลาส่งครบ 4 มื้อ");
  }
  for (const setting of settings) {
    if (!isMealKey(setting.meal) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(setting.sendTime))) return bad("เวลาต้องเป็นรูปแบบ 06:30");
    setting.enabled = setting.enabled !== false;
  }
  try {
    await store.saveSettings(settings);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "บันทึกเวลาไม่สำเร็จ" }, { status: 500 });
  }
}
