"use client";

import { fetchJson } from "@/lib/fetch-json";
import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MEALS, type MealKey } from "@/lib/meals";

type BotQuota = { ok: boolean; type: string | null; limit: number | null; used: number | null; error: string | null };

type BotStatus = {
  id: "1" | "2";
  hasToken: boolean;
  hasSecret: boolean;
  configured: boolean;
  ok: boolean;
  displayName: string | null;
  error: string | null;
  quota: BotQuota;
};

type Status = {
  hasToken: boolean;
  hasSecret: boolean;
  hasTarget: boolean;
  targetMasked: string;
  activeGroups?: number;
  targetOverride?: boolean;
  configured: boolean;
  todayBot?: "1" | "2" | null;
  bot: { ok: boolean; displayName: string | null; error: string | null };
  bots?: BotStatus[];
};

function quotaLabel(quota: BotQuota) {
  if (!quota.ok) return quota.error || "ยังไม่อ่านโควต้า";
  if (quota.limit == null) return quota.used == null ? "ไม่จำกัด" : `ใช้ไป ${quota.used} (ไม่จำกัด)`;
  return `ใช้ไป ${quota.used ?? "—"} จาก ${quota.limit}`;
}

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

  const webhook1 = `${origin}/api/line/webhook`;
  const webhook2 = `${origin}/api/line/webhook/2`;
  const bots = status?.bots ?? [];

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-[#2F6B4F]">Messaging API</p>
        <h1 className="text-3xl font-bold">ตั้งค่า LINE</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-[#6B5348]">
          โทเค็นและความลับอยู่ที่ตัวแปรแวดล้อมของเซิร์ฟเวอร์หรือตาราง app_secrets เท่านั้น ไม่โชว์ในหน้านี้
          ถ้ามีบอทสองตัว ระบบจะสลับกันส่งอัตโนมัติคนละวัน ตามวันคี่/คู่ของปีในเวลาไทย
        </p>
      </div>
      {error && <p className="rounded-2xl bg-white p-4">{error}</p>}
      {!status ? (
        <div className="h-40 animate-pulse rounded-[1.6rem] bg-white/70" />
      ) : (
        <>
          <section className="grid gap-3 md:grid-cols-2">
            {(bots.length ? bots : [
              { id: "1" as const, hasToken: status.hasToken, hasSecret: status.hasSecret, configured: status.hasToken && status.hasSecret, ok: status.bot.ok, displayName: status.bot.displayName, error: status.bot.error, quota: { ok: false, type: null, limit: null, used: null, error: null } },
            ]).map((bot) => (
              <article key={bot.id} className="rounded-[1.6rem] bg-white p-4">
                <p className="text-sm text-[#6B5348]">
                  บอท {bot.id}
                  {status.todayBot === bot.id ? " · ส่งวันนี้" : ""}
                </p>
                <p className={`mt-1 text-xl font-bold ${bot.configured ? "text-[#2F6B4F]" : "text-[#A33B24]"}`}>
                  {bot.configured ? "พร้อม" : "ยังไม่ตั้ง"}
                </p>
                <p className="mt-1 text-sm text-[#6B5348]">{bot.displayName || bot.error || "ยังไม่ตรวจชื่อบอท"}</p>
                <p className="mt-2 text-sm font-medium text-[#2C1810]">{quotaLabel(bot.quota)}</p>
                <p className="mt-1 text-xs text-[#6B5348]">
                  โทเค็น {bot.hasToken ? "มี" : "ยังไม่มี"} · ลายเซ็น {bot.hasSecret ? "มี" : "ยังไม่มี"}
                </p>
              </article>
            ))}
          </section>
          <StatusCard
            title="ปลายทาง"
            ok={status.hasTarget}
            detail={
              status.targetOverride
                ? `ส่งเฉพาะ ${status.targetMasked} (ตั้งไว้ใน LINE_TARGET_ID)`
                : status.activeGroups
                  ? `ส่งอัตโนมัติเข้า ${status.activeGroups} กลุ่มที่บอทอยู่ · เชิญบอทเข้ากลุ่มใหม่แล้วจะส่งให้เอง`
                  : "เชิญบอทเข้ากลุ่ม LINE แล้วพิมพ์อะไรก็ได้ในกลุ่มหนึ่งครั้ง"
            }
          />
        </>
      )}
      <section className="rounded-[1.6rem] bg-white p-5">
        <h2 className="font-bold">Webhook URL</h2>
        <p className="mt-3 text-sm font-medium">บอท 1 (บัญชีเดิม)</p>
        <p className="mt-1 break-all rounded-2xl bg-[#FFF4D6] px-3 py-3 text-sm">{webhook1 || "/api/line/webhook"}</p>
        <p className="mt-3 text-sm font-medium">บอท 2 (บัญชีใหม่)</p>
        <p className="mt-1 break-all rounded-2xl bg-[#FFF4D6] px-3 py-3 text-sm">{webhook2 || "/api/line/webhook/2"}</p>
        <p className="mt-2 text-sm leading-6 text-[#6B5348]">
          ใน LINE Developers ของแต่ละบัญชี เปิด Messaging API แล้ววาง URL ของบอทนั้น เปิด Use webhook
          ปิดการตอบอัตโนมัติและ greeting และอนุญาตให้บอทเข้ากลุ่มได้ ถ้ายังไม่มีโทเค็นบอท 2 ระบบจะใช้บอท 1 อย่างเดียวเหมือนเดิม
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
        <p className="mt-2 text-sm text-[#A33B24]">การส่งทดสอบกินโควต้าเท่าสมาชิกในกลุ่ม ควรเลี่ยงถ้าไม่จำเป็น</p>
      </section>
      <section className="grid gap-4 md:grid-cols-2">
        <article className="rounded-[1.6rem] bg-white p-5 text-sm leading-6">
          <h2 className="text-base font-bold">ตัวแปรที่ต้องใส่</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[#5C4033]">
            <li>LINE_CHANNEL_ACCESS_TOKEN และ LINE_CHANNEL_SECRET (บอท 1)</li>
            <li>LINE_CHANNEL_ACCESS_TOKEN_2 และ LINE_CHANNEL_SECRET_2 (บอท 2)</li>
            <li>ใส่ใน env ของ Vercel หรือตาราง app_secrets ด้วยชื่อเดียวกัน</li>
            <li>LINE_TARGET_ID ใช้เมื่อต้องการส่งเฉพาะกลุ่มเดียว</li>
          </ul>
        </article>
        <article className="rounded-[1.6rem] bg-[#2C1810] p-5 text-sm leading-6 text-[#FFF6EC]">
          <h2 className="text-base font-bold text-white">สิ่งที่ข้อความส่งไป</h2>
          <p className="mt-2">วันที่ มื้อ และเมนูอาหารตัวใหญ่ อ่านง่ายบนมือถือ ไม่มีปุ่มให้คะแนน</p>
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
