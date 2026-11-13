"use client";

import { fetchJson } from "@/lib/fetch-json";
import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MEALS, type MealKey } from "@/lib/meals";

type Status = {
  hasToken: boolean;
  hasSecret: boolean;
  hasTarget: boolean;
  targetMasked: string;
  configured: boolean;
  bot: { ok: boolean; displayName: string | null; error: string | null };
};

export default function LinePage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [origin, setOrigin] = useState("");
  const [meal, setMeal] = useState<MealKey>("lunch");
  const [error, setError] = useState("");

  async function load() {
    const { response, body } = await fetchJson("/api/line/status", { cache: "no-store" });
    if (!response.ok) {
      setError(body.error || "ตรวจสถานะ LINE ไม่สำเร็จ");
      return;
    }
    setStatus(body);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOrigin(window.location.origin);
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function testSend() {
    const { response, body } = await fetchJson("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meal, mode: "test" }),
    });
    if (!response.ok) {
      toast.error(body.error || "ส่งทดสอบไม่สำเร็จ");
      return;
    }
    toast.success(body.results?.[0]?.detail || "ส่งทดสอบแล้ว");
  }

  const webhook = `${origin}/api/line/webhook`;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-[#2F6B4F]">Messaging API</p>
        <h1 className="text-3xl font-bold">ตั้งค่า LINE</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-[#6B5348]">
          โทเค็นและความลับอยู่ที่ตัวแปรแวดล้อมของเซิร์ฟเวอร์เท่านั้น ไม่ถูกเขียนลงตารางที่เบราว์เซอร์อ่านได้ ถ้ายังไม่ใส่ค่า หน้าตัวอย่างข้อความและปุ่มคะแนนยังใช้ได้
        </p>
      </div>
      {error && <p className="rounded-2xl bg-white p-4">{error}</p>}
      {!status ? (
        <div className="h-40 animate-pulse rounded-[1.6rem] bg-white/70" />
      ) : (
        <section className="grid gap-3 md:grid-cols-3">
          <StatusCard title="Channel access token" ok={status.hasToken} detail={status.bot.displayName ? `บอท ${status.bot.displayName}` : status.bot.error || "ยังไม่ตรวจชื่อบอท"} />
          <StatusCard title="Channel secret" ok={status.hasSecret} detail={status.hasSecret ? "ใช้ตรวจลายเซ็น webhook" : "ยังไม่ได้ตั้ง"} />
          <StatusCard title="ปลายทาง" ok={status.hasTarget} detail={status.targetMasked || "ใส่ user, group, room หรือคำว่า broadcast"} />
        </section>
      )}
      <section className="rounded-[1.6rem] bg-white p-5">
        <h2 className="font-bold">Webhook URL</h2>
        <p className="mt-2 break-all rounded-2xl bg-[#FFF4D6] px-3 py-3 text-sm">{webhook || "/api/line/webhook"}</p>
        <p className="mt-2 text-sm leading-6 text-[#6B5348]">
          ใน LINE Developers เปิด Messaging API แล้ววาง URL นี้ เปิด Use webhook และปิดการตอบอัตโนมัติถ้าไม่ต้องการให้ทับข้อความขอบคุณ
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label className="text-sm" htmlFor="test-meal">มื้อทดสอบ</label>
          <select id="test-meal" value={meal} onChange={(event) => setMeal(event.target.value as MealKey)} className="h-11 rounded-2xl border border-[#E4D3C4] px-3">
            {MEALS.map((item) => <option key={item.key} value={item.key}>{item.full}</option>)}
          </select>
          <Button onClick={() => void testSend()}>ส่งทดสอบ</Button>
          <Button variant="secondary" asChild>
            <Link href="/preview">เปิดตัวอย่างข้อความ</Link>
          </Button>
        </div>
      </section>
      <section className="grid gap-4 md:grid-cols-2">
        <article className="rounded-[1.6rem] bg-white p-5 text-sm leading-6">
          <h2 className="text-base font-bold">ตัวแปรที่ต้องใส่</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[#5C4033]">
            <li>LINE_CHANNEL_ACCESS_TOKEN</li>
            <li>LINE_CHANNEL_SECRET</li>
            <li>LINE_TARGET_ID เป็นรหัสผู้ใช้ กลุ่ม ห้อง หรือ broadcast</li>
          </ul>
        </article>
        <article className="rounded-[1.6rem] bg-[#2C1810] p-5 text-sm leading-6 text-[#FFF6EC]">
          <h2 className="text-base font-bold text-white">สิ่งที่ข้อความส่งไป</h2>
          <p className="mt-2">วันที่ มื้อ และเมนูเต็ม แล้วตามด้วยปุ่ม 1–5 สองแถว สำหรับเมนูอาหารและรสชาติ เมื่อมีคนกด webhook จะบันทึกหรืออัปเดตคะแนน แล้วตอบขอบคุณสั้น ๆ</p>
        </article>
      </section>
    </div>
  );
}

function StatusCard({ title, ok, detail }: { title: string; ok: boolean; detail: string }) {
  return (
    <article className="rounded-[1.6rem] bg-white p-4">
      <p className="text-sm text-[#6B5348]">{title}</p>
      <p className={`mt-1 text-xl font-bold ${ok ? "text-[#2F6B4F]" : "text-[#A33B24]"}`}>{ok ? "พร้อม" : "ยังไม่ตั้ง"}</p>
      <p className="mt-1 text-sm text-[#6B5348]">{detail}</p>
    </article>
  );
}
