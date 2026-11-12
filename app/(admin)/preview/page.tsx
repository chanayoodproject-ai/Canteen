"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FlexPreview } from "@/components/flex-preview";
import { MEALS, type MealKey } from "@/lib/meals";
import { formatThaiDate } from "@/lib/time";
import { thankYouText } from "@/lib/flex";

const PREVIEW_USER = "preview-admin";

export default function PreviewPage() {
  const [date, setDate] = useState("2026-11-12");
  const [meal, setMeal] = useState<MealKey>("lunch");
  const [dish, setDish] = useState("");
  const [menuScore, setMenuScore] = useState<number | null>(null);
  const [tasteScore, setTasteScore] = useState<number | null>(null);
  const [reply, setReply] = useState("");
  const [pending, setPending] = useState(false);

  async function load(nextDate = date, nextMeal = meal) {
    const [year, month, day] = nextDate.split("-").map(Number);
    const response = await fetch(`/api/menus?year=${year}&month=${month}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) {
      toast.error(body.error || "โหลดเมนูไม่สำเร็จ");
      return;
    }
    const cell = (body.cells as { day: number; meal: MealKey; dishText: string }[]).find(
      (item) => item.day === day && item.meal === nextMeal,
    );
    setDish(cell?.dishText || "");
    const ratings = await fetch(`/api/ratings?year=${year}&month=${month}`, { cache: "no-store" });
    const ratingBody = await ratings.json();
    if (ratings.ok) {
      const row = (ratingBody.days as { menuDate: string; meal: MealKey; menuAvg: number | null; tasteAvg: number | null; menuCount: number; tasteCount: number }[])
        .find((item) => item.menuDate === nextDate && item.meal === nextMeal);
      setMenuScore(row && row.menuCount === 1 ? row.menuAvg : row && row.menuCount ? null : null);
      setTasteScore(row && row.tasteCount === 1 ? row.tasteAvg : null);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextDate = params.get("date") || "2026-11-12";
    const nextMeal = (params.get("meal") as MealKey) || "lunch";
    const timer = window.setTimeout(() => {
      setDate(nextDate);
      if (MEALS.some((item) => item.key === nextMeal)) setMeal(nextMeal);
      void load(nextDate, MEALS.some((item) => item.key === nextMeal) ? nextMeal : "lunch");
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function rate(kind: "menu" | "taste", score: number) {
    setPending(true);
    const response = await fetch("/api/ratings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ menuDate: date, meal, kind, score, lineUserId: PREVIEW_USER }),
    });
    const body = await response.json();
    setPending(false);
    if (!response.ok) {
      toast.error(body.error || "บันทึกคะแนนไม่สำเร็จ");
      return;
    }
    if (kind === "menu") setMenuScore(score);
    else setTasteScore(score);
    const text = thankYouText({ kind, score, updated: Boolean(body.updated) });
    setReply(text);
    toast.success(text);
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[1fr_420px]">
      <div>
        <p className="text-sm text-[#7494C0]">Flex Message</p>
        <h1 className="text-3xl font-bold">ตัวอย่างข้อความ LINE</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-[#6B5348]">
          ข้อความจริงมีปุ่ม postback สองชุด คือให้คะแนนเมนูอาหาร และให้คะแนนรสชาติ กดในหน้านี้ได้โดยไม่ต้องมีบัญชี LINE คะแนนจะถูกบันทึกในชื่อ {PREVIEW_USER} และแก้คะแนนเดิมได้
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-semibold">
            วันที่
            <input type="date" value={date} onChange={(event) => { setDate(event.target.value); setReply(""); void load(event.target.value, meal); }} className="mt-1 h-12 w-full rounded-2xl border border-[#E4D3C4] bg-white px-3 text-base font-normal" />
          </label>
          <label className="text-sm font-semibold">
            มื้อ
            <select value={meal} onChange={(event) => { const next = event.target.value as MealKey; setMeal(next); setReply(""); void load(date, next); }} className="mt-1 h-12 w-full rounded-2xl border border-[#E4D3C4] bg-white px-3 text-base font-normal">
              {MEALS.map((item) => <option key={item.key} value={item.key}>{item.full}</option>)}
            </select>
          </label>
        </div>
        <p className="mt-4 text-sm text-[#6B5348]">{formatThaiDate(date)}</p>
        {reply && <p className="mt-4 max-w-sm rounded-2xl rounded-tl-sm bg-white px-4 py-3 text-sm shadow">{reply}</p>}
      </div>
      <FlexPreview date={date} meal={meal} dishText={dish} menuScore={menuScore} tasteScore={tasteScore} onRate={(kind, score) => void rate(kind, score)} pending={pending} />
    </div>
  );
}
