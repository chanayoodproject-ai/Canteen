"use client";

import { fetchJson } from "@/lib/fetch-json";
import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { MEALS, type MealKey } from "@/lib/meals";

type BotQuota = { ok: boolean; type: string | null; limit: number | null; used: number | null; error: string | null };

type BotStatus = {
  id: "1" | "2";
  enabled: boolean;
  hasToken: boolean;
  hasSecret: boolean;
  tokenHint?: string;
  configured: boolean;
  ok: boolean;
  displayName: string | null;
  error: string | null;
  quota: BotQuota;
};

type GroupDetail = {
  idMasked: string;
  type: string;
  bots: ("1" | "2")[];
  lastSeen: string | null;
};

type Status = {
  hasToken: boolean;
  hasSecret: boolean;
  hasTarget: boolean;
  targetMasked: string;
  activeGroups?: number;
  groups?: GroupDetail[];
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
  const [testBot, setTestBot] = useState<"auto" | "1" | "2">("auto");
  const [error, setError] = useState("");
  const [editingBot, setEditingBot] = useState<"1" | "2" | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [secretInput, setSecretInput] = useState("");
  const [savingBot, setSavingBot] = useState<"1" | "2" | null>(null);

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

  async function toggleBot(botId: "1" | "2", enabled: boolean) {
    setSavingBot(botId);
    const { response, body } = await fetchJson("/api/line/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bot: botId, enabled }),
    });
    setSavingBot(null);
    if (!response.ok) {
      toast.error(body.error || "เปลี่ยนสถานะบอทไม่สำเร็จ");
      return;
    }
    toast.success(enabled ? `เปิดใช้งานบอท ${botId} แล้ว` : `ปิดใช้งานบอท ${botId} ชั่วคราวแล้ว`);
    await load();
  }

  async function saveCredentials(botId: "1" | "2") {
    const accessToken = tokenInput.trim();
    const channelSecret = secretInput.trim();
    if (!accessToken && !channelSecret) {
      toast.error("กรุณากรอก Access Token หรือ Channel Secret อย่างน้อย 1 ช่อง");
      return;
    }
    setSavingBot(botId);
    const { response, body } = await fetchJson("/api/line/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bot: botId,
        ...(accessToken ? { accessToken } : {}),
        ...(channelSecret ? { channelSecret } : {}),
      }),
    });
    setSavingBot(null);
    if (!response.ok) {
      toast.error(body.error || "บันทึกโทเค็นไม่สำเร็จ");
      return;
    }
    toast.success(`บันทึกข้อมูลบอท ${botId} แล้ว`);
    setTokenInput("");
    setSecretInput("");
    setEditingBot(null);
    await load();
  }

  async function testSend() {
    const { response, body } = await fetchJson("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        meal,
        mode: "test",
        ...(testBot !== "auto" ? { bot: testBot } : {}),
      }),
    });
    if (!response.ok) {
      toast.error(body.error || "ส่งทดสอบไม่สำเร็จ");
      return;
    }
    toast.success(body.results?.[0]?.detail || "ส่งทดสอบแล้ว");
  }

  const webhook1 = `${origin}/api/line/webhook`;
  const webhook2 = `${origin}/api/line/webhook/2`;
  const bots: BotStatus[] = status?.bots ?? [];
  const groups = status?.groups ?? [];

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-[#2F6B4F]">Messaging API</p>
        <h1 className="text-3xl font-bold">ตั้งค่า LINE</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-[#6B5348]">
          แก้ไข Access Token, Channel Secret และเปิด/ปิดการใช้งาน LINE Bot ได้จากหน้านี้ทันที
          ระบบจะสลับบอทส่งอัตโนมัติในกลุ่มที่มีทั้ง 2 บอท หรือใช้บอทที่อยู่ในกลุ่มนั้นๆ
        </p>
      </div>
      {error && <p className="rounded-2xl bg-white p-4">{error}</p>}
      {!status ? (
        <div className="h-40 animate-pulse rounded-[1.6rem] bg-white/70" />
      ) : (
        <>
          <section className="grid gap-3 md:grid-cols-2">
            {(bots.length
              ? bots
              : [
                  {
                    id: "1" as const,
                    enabled: true,
                    hasToken: status.hasToken,
                    hasSecret: status.hasSecret,
                    configured: status.hasToken && status.hasSecret,
                    ok: status.bot.ok,
                    displayName: status.bot.displayName,
                    error: status.bot.error,
                    quota: { ok: false, type: null, limit: null, used: null, error: null },
                  },
                ]
            ).map((bot) => {
              const isEditing = editingBot === bot.id;
              const isSaving = savingBot === bot.id;
              const statusText = !bot.enabled
                ? "ปิดใช้งานชั่วคราว"
                : bot.configured
                  ? "พร้อมใช้งาน"
                  : "ยังไม่ตั้งค่า";
              const statusColor = !bot.enabled
                ? "text-[#8A6D5B]"
                : bot.configured
                  ? "text-[#2F6B4F]"
                  : "text-[#A33B24]";

              return (
                <article key={bot.id} className="rounded-[1.6rem] bg-white p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm text-[#6B5348]">
                        บอท {bot.id} {bot.id === "1" ? "(บัญชีหลัก)" : "(บัญชีที่ 2)"}
                        {status.todayBot === bot.id && bot.enabled ? " · ส่งวันนี้" : ""}
                      </p>
                      <p className={`mt-1 text-xl font-bold ${statusColor}`}>{statusText}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[#6B5348]">{bot.enabled ? "เปิด" : "ปิด"}</span>
                      <Switch
                        checked={bot.enabled}
                        disabled={isSaving}
                        aria-label={`เปิดปิดบอท ${bot.id}`}
                        onCheckedChange={(checked) => void toggleBot(bot.id, checked)}
                      />
                    </div>
                  </div>

                  <div>
                    <p className="text-sm text-[#6B5348]">
                      {bot.displayName || bot.error || "ยังไม่ตรวจชื่อบอท"}
                    </p>
                    <p className="mt-1 text-sm font-medium text-[#2C1810]">{quotaLabel(bot.quota)}</p>
                    <p className="mt-1 text-xs text-[#6B5348]">
                      Token: {bot.hasToken ? bot.tokenHint || "ตั้งค่าแล้ว" : "ยังไม่มี"} · Secret:{" "}
                      {bot.hasSecret ? "ตั้งค่าแล้ว" : "ยังไม่มี"}
                    </p>
                  </div>

                  <div className="pt-1">
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      onClick={() => {
                        if (isEditing) {
                          setEditingBot(null);
                          setTokenInput("");
                          setSecretInput("");
                        } else {
                          setEditingBot(bot.id);
                          setTokenInput("");
                          setSecretInput("");
                        }
                      }}
                    >
                      {isEditing ? "ยกเลิก" : "แก้ไข Token / Secret"}
                    </Button>
                  </div>

                  {isEditing && (
                    <div className="space-y-3 rounded-2xl bg-[#FFF9F2] p-3 border border-[#E4D3C4]">
                      <div>
                        <label className="block text-xs font-medium text-[#5C4033]" htmlFor={`token-${bot.id}`}>
                          Channel Access Token (บอท {bot.id})
                        </label>
                        <input
                          id={`token-${bot.id}`}
                          type="password"
                          value={tokenInput}
                          onChange={(e) => setTokenInput(e.target.value)}
                          placeholder="วาง Access Token ใหม่ (เว้นว่างถ้าไม่เปลี่ยน)"
                          className="mt-1 w-full rounded-xl border border-[#E4D3C4] bg-white px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[#5C4033]" htmlFor={`secret-${bot.id}`}>
                          Channel Secret (บอท {bot.id})
                        </label>
                        <input
                          id={`secret-${bot.id}`}
                          type="password"
                          value={secretInput}
                          onChange={(e) => setSecretInput(e.target.value)}
                          placeholder="วาง Channel Secret ใหม่ (เว้นว่างถ้าไม่เปลี่ยน)"
                          className="mt-1 w-full rounded-xl border border-[#E4D3C4] bg-white px-3 py-2 text-sm"
                        />
                      </div>
                      <Button
                        type="button"
                        disabled={isSaving}
                        onClick={() => void saveCredentials(bot.id)}
                      >
                        {isSaving ? "กำลังบันทึก..." : "บันทึก Token / Secret"}
                      </Button>
                    </div>
                  )}
                </article>
              );
            })}
          </section>

          <StatusCard
            title="กลุ่มปลายทางที่บอทอยู่"
            ok={status.hasTarget}
            detail={
              status.targetOverride
                ? `ส่งเฉพาะ ${status.targetMasked} (ตั้งไว้ใน LINE_TARGET_ID)`
                : status.activeGroups
                  ? `ส่งอัตโนมัติเข้า ${status.activeGroups} กลุ่ม · เชิญบอท 1 หรือบอท 2 เข้ากลุ่มใหม่แล้วพิมพ์ข้อความ 1 ครั้งเพื่อลงทะเบียนกลุ่ม`
                  : "เชิญบอทเข้ากลุ่ม LINE แล้วพิมพ์อะไรก็ได้ในกลุ่มหนึ่งครั้ง"
            }
          >
            {groups.length > 0 && (
              <ul className="mt-3 space-y-1.5 text-xs text-[#5C4033]">
                {groups.map((g) => (
                  <li key={g.idMasked} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#FFF9F2] px-3 py-2">
                    <span className="font-mono font-medium">{g.idMasked} ({g.type})</span>
                    <span className="flex gap-1.5">
                      {g.bots.map((b) => (
                        <span key={b} className="rounded-full bg-[#2F6B4F]/10 px-2 py-0.5 text-[#2F6B4F] font-medium">
                          บอท {b}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </StatusCard>
        </>
      )}

      <section className="rounded-[1.6rem] bg-white p-5">
        <h2 className="font-bold">Webhook URL</h2>
        <p className="mt-3 text-sm font-medium">บอท 1 (บัญชีหลัก)</p>
        <p className="mt-1 break-all rounded-2xl bg-[#FFF4D6] px-3 py-3 text-sm">{webhook1 || "/api/line/webhook"}</p>
        <p className="mt-3 text-sm font-medium">บอท 2 (บัญชีที่ 2)</p>
        <p className="mt-1 break-all rounded-2xl bg-[#FFF4D6] px-3 py-3 text-sm">{webhook2 || "/api/line/webhook/2"}</p>
        <p className="mt-2 text-sm leading-6 text-[#6B5348]">
          ใน LINE Developers ของแต่ละบัญชี เปิด Messaging API แล้ววาง URL ของบอทนั้น เปิด Use webhook
          ปิดการตอบอัตโนมัติและ greeting และอนุญาตให้บอทเข้ากลุ่มได้
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label className="text-sm" htmlFor="test-meal">มื้อทดสอบ</label>
          <select id="test-meal" value={meal} onChange={(event) => setMeal(event.target.value as MealKey)} className="h-11 rounded-2xl border border-[#E4D3C4] px-3">
            {MEALS.map((item) => <option key={item.key} value={item.key}>{item.full}</option>)}
          </select>
          <select
            aria-label="เลือกบอททดสอบ"
            value={testBot}
            onChange={(event) => setTestBot(event.target.value as "auto" | "1" | "2")}
            className="h-11 rounded-2xl border border-[#E4D3C4] px-3"
          >
            <option value="auto">บอทอัตโนมัติ</option>
            <option value="1">บอท 1</option>
            <option value="2">บอท 2</option>
          </select>
          <Button onClick={() => void testSend()}>ส่งทดสอบ</Button>
          <Button variant="secondary" asChild>
            <Link href="/preview">เปิดตัวอย่างข้อความ</Link>
          </Button>
        </div>
        <p className="mt-2 text-sm text-[#A33B24]">การส่งทดสอบกินโควต้าเท่าสมาชิกในกลุ่ม ควรเลี่ยงถ้าไม่จำเป็น</p>
      </section>
    </div>
  );
}

function StatusCard({
  title,
  ok,
  detail,
  children,
}: {
  title: string;
  ok: boolean;
  detail: string;
  children?: React.ReactNode;
}) {
  return (
    <article className="rounded-[1.6rem] bg-white p-4">
      <p className="text-sm text-[#6B5348]">{title}</p>
      <p className={`mt-1 text-xl font-bold ${ok ? "text-[#2F6B4F]" : "text-[#A33B24]"}`}>{ok ? "พร้อม" : "ยังไม่ตั้ง"}</p>
      <p className="mt-1 text-sm text-[#6B5348]">{detail}</p>
      {children}
    </article>
  );
}
