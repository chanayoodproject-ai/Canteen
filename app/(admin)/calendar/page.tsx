"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { UploadButton } from "@/components/upload-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { MEALS, MEAL_MAP, type MealKey } from "@/lib/meals";
import { THAI_WEEKDAYS, daysInMonth, formatMonthTitle, formatThaiDate, isoFromParts, weekdayIndex } from "@/lib/time";

type Cell = { day: number; meal: MealKey; dishText: string; needsReview: boolean };

export default function CalendarPage() {
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(11);
  const [cells, setCells] = useState<Cell[]>([]);
  const [today, setToday] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<MealKey, string>>({ breakfast: "", lunch: "", dinner: "", late: "" });
  const [saving, setSaving] = useState(false);

  async function load(nextYear = year, nextMonth = month) {
    setError("");
    const response = await fetch(`/api/menus?year=${nextYear}&month=${nextMonth}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error || "โหลดปฏิทินไม่สำเร็จ");
      return;
    }
    setCells(body.cells);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const queryYear = Number(params.get("year"));
    const queryMonth = Number(params.get("month"));
    const initialYear = queryYear || 2026;
    const initialMonth = queryMonth || 11;
    const timer = window.setTimeout(() => {
      setYear(initialYear);
      setMonth(initialMonth);
      void load(initialYear, initialMonth);
      void fetch("/api/dashboard", { cache: "no-store" })
        .then((response) => response.json())
        .then((body) => body.today && setToday(body.today));
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byDay = useMemo(() => {
    const map = new Map<number, Cell[]>();
    for (const cell of cells) {
      map.set(cell.day, [...(map.get(cell.day) ?? []), cell]);
    }
    return map;
  }, [cells]);

  function shift(delta: number) {
    const date = new Date(year, month - 1 + delta, 1);
    const nextYear = date.getFullYear();
    const nextMonth = date.getMonth() + 1;
    setYear(nextYear);
    setMonth(nextMonth);
    void load(nextYear, nextMonth);
  }

  function openDay(day: number) {
    const next = { breakfast: "", lunch: "", dinner: "", late: "" };
    for (const cell of byDay.get(day) ?? []) next[cell.meal] = cell.dishText;
    setDraft(next);
    setEditing(day);
  }

  async function saveDay() {
    if (!editing) return;
    setSaving(true);
    for (const meal of MEALS) {
      const previous = (byDay.get(editing) ?? []).find((cell) => cell.meal === meal.key);
      const response = await fetch("/api/menus", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year,
          month,
          day: editing,
          meal: meal.key,
          dishText: draft[meal.key],
          needsReview: previous?.needsReview && previous.dishText === draft[meal.key],
        }),
      });
      if (!response.ok) {
        const body = await response.json();
        toast.error(body.error || "บันทึกไม่สำเร็จ");
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    setEditing(null);
    toast.success("บันทึกเมนูของวันนี้แล้ว");
    await load();
  }

  const firstWeekday = weekdayIndex(isoFromParts(year, month, 1));
  const total = daysInMonth(year, month);
  const blanks = Array.from({ length: firstWeekday }, (_, index) => index);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-[#8A5A00]">ปฏิทินเมนูรายเดือน</p>
          <h1 className="text-3xl font-bold">{formatMonthTitle(year, month)}</h1>
          <p className="text-sm text-[#6B5348]">ปี ค.ศ. {year} · กดวันที่เพื่อแก้เมนูทั้ง 4 มื้อ</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => shift(-1)}>เดือนก่อน</Button>
          <Button variant="secondary" onClick={() => shift(1)}>เดือนถัดไป</Button>
          <UploadButton className="col-span-2" />
        </div>
      </div>
      {error && (
        <div className="rounded-2xl bg-white p-4">
          <p>{error}</p>
          <Button className="mt-3" onClick={() => void load()}>ลองใหม่</Button>
        </div>
      )}
      <div className="hidden grid-cols-7 gap-2 md:grid">
        {THAI_WEEKDAYS.map((day) => (
          <div key={day} className="px-2 text-center text-xs font-semibold text-[#8C7264]">{day}</div>
        ))}
        {blanks.map((item) => <div key={`blank-${item}`} />)}
        {Array.from({ length: total }, (_, index) => index + 1).map((day) => {
          const iso = isoFromParts(year, month, day);
          const items = byDay.get(day) ?? [];
          const isToday = iso === today;
          return (
            <button
              key={day}
              type="button"
              onClick={() => openDay(day)}
              className={`min-h-36 rounded-2xl bg-white p-2 text-left shadow-sm ring-1 ring-[#F0E4D8] hover:ring-[#C4452D] ${isToday ? "ring-2 ring-[#C4452D]" : ""}`}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="font-bold">{day}</span>
                {isToday && <span className="text-[10px] font-semibold text-[#C4452D]">วันนี้</span>}
              </div>
              {MEALS.map((meal) => {
                const cell = items.find((item) => item.meal === meal.key);
                return (
                  <p key={meal.key} className="truncate text-[11px] leading-5">
                    <span className="font-semibold" style={{ color: meal.ink }}>{meal.label}</span>{" "}
                    {cell?.dishText || "—"}
                    {cell?.needsReview ? " •" : ""}
                  </p>
                );
              })}
            </button>
          );
        })}
      </div>
      <div className="space-y-3 md:hidden">
        {Array.from({ length: total }, (_, index) => index + 1).map((day) => {
          const iso = isoFromParts(year, month, day);
          const items = byDay.get(day) ?? [];
          return (
            <button key={day} type="button" onClick={() => openDay(day)} className="w-full rounded-3xl bg-white p-4 text-left touch-manipulation">
              <p className="text-lg font-bold">{formatThaiDate(iso)}</p>
              {MEALS.map((meal) => {
                const cell = items.find((item) => item.meal === meal.key);
                return (
                  <p key={meal.key} className="mt-2 text-base leading-6">
                    <span className="font-semibold" style={{ color: meal.ink }}>{meal.label}</span> {cell?.dishText || "ยังไม่มี"}
                  </p>
                );
              })}
            </button>
          );
        })}
      </div>
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogTitle>{editing ? formatThaiDate(isoFromParts(year, month, editing)) : "แก้เมนู"}</DialogTitle>
          <DialogDescription>แก้ได้ทีละมื้อ แล้วบันทึกลงฐานข้อมูลทันที</DialogDescription>
          <div className="mt-4 space-y-3">
            {MEALS.map((meal) => (
              <label key={meal.key} className="block text-sm font-semibold" style={{ color: meal.ink }}>
                {meal.full}
                <textarea
                  value={draft[meal.key]}
                  onChange={(event) => setDraft({ ...draft, [meal.key]: event.target.value })}
                  rows={2}
                  className="mt-1 w-full rounded-2xl border border-[#E4D3C4] bg-white p-3 text-base font-normal text-[#2C1810] outline-none focus:ring-2 focus:ring-[#06BB46]"
                />
              </label>
            ))}
          </div>
          <Button className="mt-4 w-full" onClick={() => void saveDay()} disabled={saving}>
            {saving ? "กำลังบันทึก..." : "บันทึกวันนี้"}
          </Button>
        </DialogContent>
      </Dialog>
      <p className="text-xs text-[#8C7264]">จุดสีหลังชื่อเมนูหมายถึงควรตรวจคำกับภาพต้นฉบับ {MEAL_MAP.breakfast.label} ถึง {MEAL_MAP.late.label}</p>
    </div>
  );
}
