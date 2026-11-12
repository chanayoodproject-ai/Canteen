"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { MEALS, type MealKey } from "@/lib/meals";
import { THAI_MONTHS, daysInMonth, formatThaiDate } from "@/lib/time";
import { applyDrafts, blankDrafts, type DraftCell } from "@/lib/parse-menu";
import { isoFromParts } from "@/lib/time";

export default function UploadPage() {
  const router = useRouter();
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(11);
  const [step, setStep] = useState<"choose" | "review">("choose");
  const [cells, setCells] = useState<DraftCell[]>([]);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState("");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<number | null>(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function cellText(day: number, meal: MealKey) {
    return cells.find((cell) => cell.day === day && cell.meal === meal)?.dishText ?? "";
  }

  function updateCell(day: number, meal: MealKey, dishText: string) {
    setCells((current) =>
      current.map((cell) => (cell.day === day && cell.meal === meal ? { ...cell, dishText, needsReview: false } : cell)),
    );
  }

  async function existingCells() {
    const response = await fetch(`/api/menus?year=${year}&month=${month}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) return blankDrafts(year, month);
    return (body.cells as DraftCell[]) ?? blankDrafts(year, month);
  }

  async function startBlank() {
    setBusy(true);
    const current = await existingCells();
    setCells(current);
    setMessage(current.some((cell) => cell.dishText) ? "ดึงเมนูเดิมของเดือนนี้มาให้แก้ บันทึกแล้วจะถามก่อนแทนที่" : "เริ่มเดือนนี้จากช่องว่าง");
    setFileName("");
    setPreview("");
    setStep("review");
    setBusy(false);
  }

  async function loadSample(path: string, name: string, type: string) {
    const response = await fetch(path);
    const blob = await response.blob();
    await onFile(new File([blob], name, { type }));
  }

  async function onFile(file: File) {
    setBusy(true);
    setFileName(file.name);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(file.type.startsWith("image/") ? URL.createObjectURL(file) : "");
    const form = new FormData();
    form.set("year", String(year));
    form.set("month", String(month));
    form.set("file", file);
    const response = await fetch("/api/upload/parse", { method: "POST", body: form });
    const body = await response.json();
    const base = body.mode === "manual" ? await existingCells() : blankDrafts(year, month);
    const drafts = (body.cells ?? []) as DraftCell[];
    setCells(applyDrafts(base, drafts));
    setMessage(body.message || (response.ok ? "ตรวจเมนูก่อนบันทึก" : "อ่านไฟล์ไม่สำเร็จ"));
    if (!response.ok) toast.error(body.error || "อัปโหลดไม่สำเร็จ");
    setStep("review");
    setBusy(false);
  }

  async function save(confirmOverwrite = false) {
    setBusy(true);
    const response = await fetch("/api/menus/month", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year, month, cells, confirmOverwrite }),
    });
    const body = await response.json();
    setBusy(false);
    if (response.status === 409) {
      setConflict(body.filled || 0);
      return;
    }
    if (!response.ok) {
      toast.error(body.error || "บันทึกไม่สำเร็จ");
      return;
    }
    toast.success("บันทึกเมนูทั้งเดือนแล้ว");
    router.push(`/calendar?year=${year}&month=${month}`);
  }

  const total = daysInMonth(year, month);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-[#A33B24]">ทีละเดือน</p>
        <h1 className="text-3xl font-bold">อัปโหลดเมนูอาหาร</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-[#6B5348]">
          เลือกเดือน แล้ววางภาพปฏิทิน ไฟล์ CSV หรือ Excel จากนั้นตรวจเมนูเช้า เที่ยง เย็น ดึก ทุกวันก่อนบันทึก ระบบจะไม่ทับเดือนที่มีเมนูอยู่แล้วถ้ายังไม่ยืนยัน
        </p>
      </div>

      {step === "choose" && (
        <section className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <div className="rounded-[1.6rem] bg-white p-4">
            <label className="block text-sm font-semibold" htmlFor="month">เดือน</label>
            <select id="month" value={month} onChange={(event) => setMonth(Number(event.target.value))} className="mt-1 h-11 w-full rounded-2xl border border-[#E4D3C4] bg-[#FFF9F3] px-3">
              {THAI_MONTHS.map((name, index) => (
                <option key={name} value={index + 1}>{name}</option>
              ))}
            </select>
            <label className="mt-3 block text-sm font-semibold" htmlFor="year">ปี ค.ศ.</label>
            <input id="year" type="number" value={year} onChange={(event) => setYear(Number(event.target.value))} className="mt-1 h-11 w-full rounded-2xl border border-[#E4D3C4] bg-[#FFF9F3] px-3" />
            <Button variant="secondary" className="mt-4 w-full" onClick={() => void startBlank()} disabled={busy}>กรอกเอง</Button>
          </div>
          <label className="grid min-h-64 cursor-pointer place-items-center rounded-[1.8rem] border-2 border-dashed border-[#E0B8A8] bg-white/80 p-6 text-center">
            <input
              type="file"
              accept="image/*,.csv,.xlsx,.xls,text/csv"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onFile(file);
              }}
            />
            <div>
              <p className="text-2xl font-bold">วางภาพปฏิทินหรือไฟล์ตาราง</p>
              <p className="mt-2 text-sm text-[#6B5348]">JPG, PNG, CSV, XLSX · ตัวอย่างเดือนพฤศจิกายนอยู่ด้านล่าง</p>
              <span className="mt-4 inline-flex h-12 items-center rounded-full bg-[#06BB46] px-5 font-bold text-white">เลือกไฟล์เมนู</span>
            </div>
          </label>
        </section>
      )}

      {step === "choose" && (
        <div className="grid gap-2 sm:flex sm:flex-wrap">
          <Button variant="secondary" disabled={busy} onClick={() => void loadSample("/sample/november-2026-calendar.jpg", "november-2026-calendar.jpg", "image/jpeg")}>
            ลองด้วยภาพปฏิทินตัวอย่าง
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => void loadSample("/sample/november-2026.csv", "november-2026.csv", "text/csv")}>
            ลองด้วย CSV ตัวอย่าง
          </Button>
          <a className="inline-flex h-11 items-center rounded-full bg-white px-4" href="/sample/november-2026-calendar.jpg" target="_blank" rel="noreferrer">เปิดภาพต้นฉบับ</a>
        </div>
      )}

      {step === "review" && (
        <section className="space-y-4">
          <div className="rounded-3xl bg-[#FFF4D6] p-4 text-sm leading-6 text-[#6A4B12]">
            <p className="font-semibold">{fileName || "กรอกเอง"} · {THAI_MONTHS[month - 1]} {year + 543}</p>
            <p>{message}</p>
            <button type="button" className="mt-2 underline" onClick={() => setStep("choose")}>เลือกไฟล์ใหม่</button>
          </div>
          <div className="grid items-start gap-4 lg:grid-cols-[280px_1fr]">
            {preview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="ภาพปฏิทินที่อัปโหลด" className="max-h-72 w-full rounded-3xl bg-white object-contain p-2 shadow lg:sticky lg:top-24 lg:max-h-none" />
            )}
            <div className="space-y-3">
              {Array.from({ length: total }, (_, index) => index + 1).map((day) => (
                <article key={day} className="rounded-3xl bg-white p-4">
                  <h2 className="font-bold">{formatThaiDate(isoFromParts(year, month, day))}</h2>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {MEALS.map((meal) => {
                      const current = cells.find((cell) => cell.day === day && cell.meal === meal.key);
                      return (
                        <label key={meal.key} className="block text-sm font-semibold" style={{ color: meal.ink }}>
                          {meal.full}{current?.needsReview ? " · ควรตรวจ" : ""}
                          <textarea
                            value={cellText(day, meal.key)}
                            onChange={(event) => updateCell(day, meal.key, event.target.value)}
                            rows={2}
                            className="mt-1 w-full rounded-2xl border border-[#E4D3C4] p-3 text-base font-normal text-[#2C1810]"
                          />
                        </label>
                      );
                    })}
                  </div>
                </article>
              ))}
            </div>
          </div>
          <Button size="lg" className="w-full" disabled={busy} onClick={() => void save(false)}>
            {busy ? "กำลังบันทึก..." : "ยืนยันบันทึกทั้งเดือน"}
          </Button>
        </section>
      )}

      <Dialog open={conflict !== null} onOpenChange={(open) => !open && setConflict(null)}>
        <DialogContent>
          <DialogTitle>เดือนนี้มีเมนูอยู่แล้ว</DialogTitle>
          <DialogDescription>
            พบเมนูเดิม {conflict} รายการ การบันทึกนี้จะแทนที่ทั้งเดือน ไม่ได้ทับเงียบ ๆ
          </DialogDescription>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" onClick={() => setConflict(null)}>กลับไปแก้</Button>
            <Button
              onClick={() => {
                setConflict(null);
                void save(true);
              }}
            >
              ยืนยันแทนที่
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
