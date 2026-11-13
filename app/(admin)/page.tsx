"use client";

import { fetchJson } from "@/lib/fetch-json";
import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { UploadButton } from "@/components/upload-button";
import { Button } from "@/components/ui/button";
import { MEAL_MAP, type MealKey } from "@/lib/meals";
import { formatThaiDateShort } from "@/lib/time";

type MealCard = {
  meal: MealKey;
  dishText: string;
  needsReview: boolean;
  sendTime: string;
  enabled: boolean;
  state: string;
  stateLabel: string;
};

type Dashboard = {
  today: string;
  todayLabel: string;
  greeting: string;
  meals: MealCard[];
  next: { date: string; meal: MealKey; sendTime: string; due: boolean } | null;
  logs: { id: string; menuDate: string; meal: MealKey; status: string; detail: string | null; createdAt: string }[];
  lineConfigured: boolean;
  activeGroups?: number;
};

const STATE_STYLE: Record<string, string> = {
  sent: "bg-[#E6F6EC] text-[#1C6B42]",
  due: "bg-[#FDE8E0] text-[#A33B24]",
  upcoming: "bg-[#FFF4D6] text-[#8A5A00]",
  simulated: "bg-[#EFE7F8] text-[#5B3D86]",
  empty: "bg-[#F3EBE3] text-[#6B5348]",
  off: "bg-[#F3EBE3] text-[#6B5348]",
};

export default function HomePage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState<MealKey | null>(null);

  async function load() {
    setError("");
    const { response, body } = await fetchJson("/api/dashboard", { cache: "no-store" });
    if (!response.ok) {
      setError(body.error || "โหลดหน้าแรกไม่สำเร็จ");
      return;
    }
    setData(body);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function sendNow(meal: MealKey) {
    setSending(meal);
    const { response, body } = await fetchJson("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meal, mode: "now" }),
    });
    setSending(null);
    if (!response.ok) {
      toast.error(body.error || "ส่งไม่สำเร็จ");
      return;
    }
    const result = body.results?.[0];
    toast.success(result?.detail || "บันทึกการส่งแล้ว");
    await load();
  }

  if (error) {
    return (
      <div className="rounded-3xl bg-white p-6">
        <p>{error}</p>
        <Button className="mt-4" onClick={() => void load()}>
          ลองใหม่
        </Button>
      </div>
    );
  }

  if (!data) {
    return <div className="h-64 animate-pulse rounded-[2rem] bg-white/70" />;
  }

  const next = data.next;

  return (
    <div className="space-y-6">
      <section className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr] lg:items-end">
        <div>
          <p className="text-sm text-[#8A5A00]">{data.greeting}</p>
          <h1 className="mt-1 text-4xl font-bold leading-tight sm:text-5xl">วันนี้กินอะไรดี</h1>
          <p className="mt-2 text-[#6B5348]">{data.todayLabel}</p>
          <div className="mt-5">
            <UploadButton />
          </div>
        </div>
        <aside className="rounded-[1.7rem] bg-[#2C1810] p-5 text-[#FFF6EC]">
          <p className="text-xs uppercase tracking-[0.18em] text-[#F0C27A]">การส่งถัดไป</p>
          {next ? (
            <>
              <p className="mt-2 text-2xl font-bold">
                {MEAL_MAP[next.meal].full} · {next.sendTime}
              </p>
              <p className="mt-1 text-sm text-[#F6E2CF]">
                {next.date === data.today
                  ? next.due
                    ? "ถึงเวลาแล้ว และยังไม่ได้ส่งวันนี้"
                    : "ยังไม่ถึงเวลาของวันนี้"
                  : `วันถัดไป ${formatThaiDateShort(next.date)}`}
              </p>
            </>
          ) : (
            <p className="mt-2">ยังไม่เปิดการส่งมื้อใด</p>
          )}
          <Link href="/schedule" className="mt-4 inline-block text-sm text-[#F0C27A] underline-offset-4 hover:underline">
            ตั้งเวลาทั้ง 4 มื้อ
          </Link>
        </aside>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        {data.meals.map((meal) => {
          const meta = MEAL_MAP[meal.meal];
          return (
            <article key={meal.meal} className="rounded-[1.6rem] bg-white p-4 shadow-[0_16px_40px_-32px_rgba(44,24,16,0.8)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold" style={{ color: meta.ink }}>
                    {meta.full} · {meal.sendTime}
                  </p>
                  <h2 className="mt-1 text-xl font-bold leading-snug">{meal.dishText || "ยังไม่ได้ใส่เมนู"}</h2>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATE_STYLE[meal.state] || STATE_STYLE.empty}`}>
                  {meal.stateLabel}
                </span>
              </div>
              {meal.needsReview && <p className="mt-2 text-xs text-[#A36B00]">ควรตรวจคำกับภาพปฏิทิน</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!meal.dishText || meal.state === "sent" || sending === meal.meal}
                  onClick={() => void sendNow(meal.meal)}
                >
                  {sending === meal.meal ? "กำลังส่ง..." : meal.state === "sent" ? "ส่งแล้ว" : "ส่งตอนนี้"}
                </Button>
                <Button size="sm" variant="ghost" asChild>
                  <Link href={`/preview?date=${data.today}&meal=${meal.meal}`}>ดูข้อความ</Link>
                </Button>
              </div>
            </article>
          );
        })}
      </section>

      <section className="rounded-[1.6rem] bg-white/80 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold">ประวัติการส่งล่าสุด</h2>
          <Link href="/schedule" className="text-sm text-[#A33B24]">
            ดูทั้งหมด
          </Link>
        </div>
        {data.logs.length === 0 ? (
          <p className="mt-3 text-sm text-[#6B5348]">ยังไม่มีประวัติ ถึงเวลาแล้วระบบจะส่งให้อัตโนมัติ หรือกดส่งตอนนี้ได้เลย</p>
        ) : (
          <ul className="mt-3 divide-y divide-[#F0E4D8] text-sm">
            {data.logs.slice(0, 5).map((log) => (
              <li key={log.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  {formatThaiDateShort(log.menuDate)} · {MEAL_MAP[log.meal].label} · {statusLabel(log.status)}
                </span>
                <span className="text-[#6B5348]">{log.detail}</span>
              </li>
            ))}
          </ul>
        )}
        {data.lineConfigured && typeof data.activeGroups === "number" && (
          <p className="mt-3 text-sm text-[#6B5348]">ส่งเมนูอัตโนมัติเข้า {data.activeGroups} กลุ่ม LINE</p>
        )}
        {!data.lineConfigured && (
          <p className="mt-3 text-sm text-[#6B5348]">
            ยังไม่มี LINE การส่งตอนนี้เป็นการจำลอง และดูตัวอย่างข้อความพร้อมปุ่มคะแนนได้ที่{" "}
            <Link href="/preview" className="font-semibold text-[#A33B24]">
              หน้าตัวอย่าง
            </Link>
          </p>
        )}
      </section>
    </div>
  );
}

function statusLabel(status: string) {
  if (status === "sent") return "ส่งแล้ว";
  if (status === "simulated") return "จำลอง";
  if (status === "failed") return "ไม่สำเร็จ";
  if (status === "test") return "ทดสอบ";
  if (status === "claimed") return "กำลังส่ง";
  return status;
}
