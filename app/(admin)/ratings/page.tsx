"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { MEAL_MAP, type MealKey } from "@/lib/meals";
import { THAI_MONTHS, formatMonthTitle, formatThaiDateShort } from "@/lib/time";

type Summary = { menuAvg: number | null; tasteAvg: number | null; menuCount: number; tasteCount: number; people: number };
type MealStat = { meal: MealKey; menuAvg: number | null; tasteAvg: number | null; menuCount: number; tasteCount: number };
type DayStat = { menuDate: string; meal: MealKey; menuAvg: number | null; menuCount: number; tasteAvg: number | null; tasteCount: number };

export default function RatingsPage() {
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(11);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [byMeal, setByMeal] = useState<MealStat[]>([]);
  const [days, setDays] = useState<DayStat[]>([]);
  const [error, setError] = useState("");

  async function load(nextYear = year, nextMonth = month) {
    setError("");
    const response = await fetch(`/api/ratings?year=${nextYear}&month=${nextMonth}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error || "โหลดคะแนนไม่สำเร็จ");
      return;
    }
    setSummary(body.summary);
    setByMeal(body.byMeal);
    setDays(body.days);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(2026, 11), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-[#2F6B4F]">จากปุ่มในข้อความ LINE</p>
          <h1 className="text-3xl font-bold">คะแนนเมนูและรสชาติ</h1>
          <p className="text-sm text-[#6B5348]">{formatMonthTitle(year, month)}</p>
        </div>
        <div className="flex gap-2">
          <select
            aria-label="เดือน"
            value={month}
            onChange={(event) => {
              const next = Number(event.target.value);
              setMonth(next);
              void load(year, next);
            }}
            className="h-11 rounded-2xl border border-[#E4D3C4] bg-white px-3"
          >
            {THAI_MONTHS.map((name, index) => (
              <option key={name} value={index + 1}>{name}</option>
            ))}
          </select>
          <input
            aria-label="ปี ค.ศ."
            type="number"
            value={year}
            onChange={(event) => setYear(Number(event.target.value))}
            onBlur={() => void load()}
            className="h-11 w-28 rounded-2xl border border-[#E4D3C4] bg-white px-3"
          />
        </div>
      </div>
      {error && (
        <div className="rounded-2xl bg-white p-4">
          <p>{error}</p>
          <Button className="mt-3" onClick={() => void load()}>ลองใหม่</Button>
        </div>
      )}
      {summary && summary.people === 0 && (
        <div className="rounded-[1.6rem] bg-white p-6">
          <p className="text-lg font-bold">เดือนนี้ยังไม่มีคะแนน</p>
          <p className="mt-1 text-sm text-[#6B5348]">กดปุ่ม 1–5 ในตัวอย่างข้อความ เพื่อบันทึกคะแนนเมนูอาหารและรสชาติ แล้วกลับมาหน้านี้</p>
          <Button className="mt-4" asChild>
            <Link href="/preview">เปิดตัวอย่างข้อความ</Link>
          </Button>
        </div>
      )}
      {summary && summary.people > 0 && (
        <>
          <section className="grid gap-3 sm:grid-cols-3">
            <Stat title="คะแนนเมนูอาหาร" value={summary.menuAvg} count={summary.menuCount} color="#C4452D" />
            <Stat title="คะแนนรสชาติ" value={summary.tasteAvg} count={summary.tasteCount} color="#2F6B4F" />
            <article className="rounded-[1.6rem] bg-[#2C1810] p-4 text-white">
              <p className="text-sm text-[#F0C27A]">จำนวนคนให้คะแนน</p>
              <p className="mt-2 text-4xl font-bold">{summary.people}</p>
              <p className="text-sm text-[#F6E2CF]">คนละหนึ่งชุดต่อมื้อ อัปเดตซ้ำได้</p>
            </article>
          </section>
          <section className="grid gap-3 md:grid-cols-2">
            {byMeal.map((item) => (
              <article key={item.meal} className="rounded-[1.6rem] bg-white p-4">
                <h2 className="font-bold">{MEAL_MAP[item.meal].full}</h2>
                <Bar label="เมนู" value={item.menuAvg} count={item.menuCount} color="#C4452D" />
                <Bar label="รสชาติ" value={item.tasteAvg} count={item.tasteCount} color="#2F6B4F" />
              </article>
            ))}
          </section>
          <section className="rounded-[1.6rem] bg-white p-4">
            <h2 className="font-bold">รายวัน</h2>
            <ul className="mt-3 space-y-3 md:hidden">
              {days.map((day) => (
                <li key={`${day.menuDate}-${day.meal}`} className="rounded-2xl bg-[#F7FFF4] p-3 text-sm">
                  <p className="font-semibold">{formatThaiDateShort(day.menuDate)} · {MEAL_MAP[day.meal].full}</p>
                  <p className="mt-1">เมนู {day.menuAvg ?? "—"} ({day.menuCount})</p>
                  <p>รสชาติ {day.tasteAvg ?? "—"} ({day.tasteCount})</p>
                </li>
              ))}
            </ul>
            <table className="mt-3 hidden w-full text-left text-sm md:table">
              <thead className="text-[#8C7264]">
                <tr>
                  <th className="py-2 font-medium">วัน</th>
                  <th className="font-medium">มื้อ</th>
                  <th className="font-medium">เมนู</th>
                  <th className="font-medium">รสชาติ</th>
                </tr>
              </thead>
              <tbody>
                {days.map((day) => (
                  <tr key={`${day.menuDate}-${day.meal}`} className="border-t border-[#F3E7DC]">
                    <td className="py-2">{formatThaiDateShort(day.menuDate)}</td>
                    <td>{MEAL_MAP[day.meal].label}</td>
                    <td>{day.menuAvg ?? "—"} <span className="text-[#8C7264]">({day.menuCount})</span></td>
                    <td>{day.tasteAvg ?? "—"} <span className="text-[#8C7264]">({day.tasteCount})</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ title, value, count, color }: { title: string; value: number | null; count: number; color: string }) {
  return (
    <article className="rounded-[1.6rem] bg-white p-4">
      <p className="text-sm text-[#6B5348]">{title}</p>
      <p className="mt-1 text-4xl font-bold" style={{ color }}>{value ?? "—"}</p>
      <p className="text-sm text-[#8C7264]">จาก {count} คะแนน · เต็ม 5</p>
      <div className="mt-3 h-2 rounded-full bg-[#F3E7DC]">
        <div className="h-2 rounded-full" style={{ width: `${((value ?? 0) / 5) * 100}%`, background: color }} />
      </div>
    </article>
  );
}

function Bar({ label, value, count, color }: { label: string; value: number | null; count: number; color: string }) {
  return (
    <div className="mt-3">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span>{value ?? "—"} · {count} คน</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-[#F3E7DC]">
        <div className="h-2 rounded-full" style={{ width: `${((value ?? 0) / 5) * 100}%`, background: color }} />
      </div>
    </div>
  );
}
