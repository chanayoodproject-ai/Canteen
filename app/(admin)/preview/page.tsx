"use client";

import { fetchJson } from "@/lib/fetch-json";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FlexPreview } from "@/components/flex-preview";
import { MEALS, type MealKey } from "@/lib/meals";
import { bangkokNow, formatThaiDate } from "@/lib/time";

export default function PreviewPage() {
  const [date, setDate] = useState(() => bangkokNow().iso);
  const [meal, setMeal] = useState<MealKey>("lunch");
  const [dish, setDish] = useState("");

  async function load(nextDate = date, nextMeal = meal) {
    const [year, month, day] = nextDate.split("-").map(Number);
    const { response, body } = await fetchJson(`/api/menus?year=${year}&month=${month}`, { cache: "no-store" });
    if (!response.ok) {
      toast.error(body.error || "โหลดเมนูไม่สำเร็จ");
      return;
    }
    const cell = (body.cells as { day: number; meal: MealKey; dishText: string }[]).find(
      (item) => item.day === day && item.meal === nextMeal,
    );
    setDish(cell?.dishText || "");
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextDate = (/^\d{4}-\d{2}-\d{2}$/.test(params.get("date") || "") ? params.get("date")! : bangkokNow().iso);
    const nextMeal = (params.get("meal") as MealKey) || "lunch";
    const timer = window.setTimeout(() => {
      setDate(nextDate);
      if (MEALS.some((item) => item.key === nextMeal)) setMeal(nextMeal);
      void load(nextDate, MEALS.some((item) => item.key === nextMeal) ? nextMeal : "lunch");
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[1fr_420px]">
      <div>
        <p className="text-sm text-[#7494C0]">Flex Message</p>
        <h1 className="text-3xl font-bold">ตัวอย่างข้อความ LINE</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-[#6B5348]">
          ข้อความที่ส่งเข้ากลุ่มมีแค่วันที่ มื้อ และเมนูอาหารตัวใหญ่ อ่านง่ายบนมือถือ ไม่มีปุ่มให้คะแนน
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-semibold">
            วันที่
            <input type="date" value={date} onChange={(event) => { setDate(event.target.value); void load(event.target.value, meal); }} className="mt-1 h-12 w-full rounded-2xl border border-[#E4D3C4] bg-white px-3 text-base font-normal" />
          </label>
          <label className="text-sm font-semibold">
            มื้อ
            <select value={meal} onChange={(event) => { const next = event.target.value as MealKey; setMeal(next); void load(date, next); }} className="mt-1 h-12 w-full rounded-2xl border border-[#E4D3C4] bg-white px-3 text-base font-normal">
              {MEALS.map((item) => <option key={item.key} value={item.key}>{item.full}</option>)}
            </select>
          </label>
        </div>
        <p className="mt-4 text-sm text-[#6B5348]">{formatThaiDate(date)}</p>
      </div>
      <FlexPreview date={date} meal={meal} dishText={dish} />
    </div>
  );
}
