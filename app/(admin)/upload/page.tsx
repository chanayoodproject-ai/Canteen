"use client";

import { fetchJson } from "@/lib/fetch-json";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { MEALS, type MealKey } from "@/lib/meals";
import { THAI_MONTHS, daysInMonth, defaultUploadMonth, formatThaiDate } from "@/lib/time";
import { shrinkImage } from "@/lib/resize-image";
import { applyDrafts, blankDrafts, type DraftCell } from "@/lib/parse-menu";
import { isoFromParts } from "@/lib/time";

export default function UploadPage() {
  const router = useRouter();
  const [year, setYear] = useState(() => defaultUploadMonth().year);
  const [month, setMonth] = useState(() => defaultUploadMonth().month);
  const [step, setStep] = useState<"choose" | "review">("choose");
  const [cells, setCells] = useState<DraftCell[]>([]);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState("");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState("");
  const [conflict, setConflict] = useState<number | null>(null);
  const [onlyFlagged, setOnlyFlagged] = useState(false);

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

  function patchCell(day: number, meal: MealKey, patch: Partial<DraftCell>) {
    setCells((current) => current.map((cell) => (cell.day === day && cell.meal === meal ? { ...cell, ...patch } : cell)));
  }

  const isFlagged = (cell?: DraftCell) => Boolean(cell && (cell.needsReview || cell.altText !== undefined || cell.originalText));

  async function existingCells() {
    try {
      const { response, body } = await fetchJson(`/api/menus?year=${year}&month=${month}`, { cache: "no-store" });
      if (!response.ok) return blankDrafts(year, month);
      return (body.cells as DraftCell[]) ?? blankDrafts(year, month);
    } catch {
      return blankDrafts(year, month);
    }
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
    await onFiles([new File([blob], name, { type })]);
  }

  async function onFiles(selected: File[]) {
    if (!selected.length) return;
    setBusy(true);
    const images = selected.filter((file) => file.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name));
    const files = images.length ? images.slice(0, 4) : selected.slice(0, 1);
    setFileName(files.map((file) => file.name).join(", "));
    if (preview) URL.revokeObjectURL(preview);
    setPreview(images.length ? URL.createObjectURL(images[0]) : "");
    let body: { mode?: string; message?: string; error?: string; cells?: DraftCell[] } = {};
    let ok = false;
    try {
      setBusyText(images.length ? "กำลังเตรียมภาพ..." : "กำลังอ่านไฟล์...");
      const prepared = images.length ? await Promise.all(files.map((file) => shrinkImage(file))) : files;
      const form = new FormData();
      form.set("year", String(year));
      form.set("month", String(month));
      for (const file of prepared) form.append("file", file);
      if (images.length) setBusyText("AI กำลังอ่านเมนูจากภาพ อาจใช้เวลาราว 30-60 วินาที...");
      const response = await fetch("/api/upload/parse", { method: "POST", body: form });
      ok = response.ok;
      body = await response.json().catch(() => ({
        error: response.status === 413 ? "ไฟล์ใหญ่เกินไป ลองครอปเฉพาะตารางแล้วอัปโหลดใหม่" : "อ่านไฟล์ไม่สำเร็จ",
      }));
    } catch {
      body = { error: "เชื่อมต่อไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองใหม่" };
    }
    const manualMode = !ok || body.mode === "manual";
    const base = manualMode ? await existingCells() : blankDrafts(year, month);
    setCells(applyDrafts(base, body.cells ?? []));
    setMessage(body.message || body.error || (ok ? "ตรวจเมนูก่อนบันทึก" : "อ่านไฟล์ไม่สำเร็จ พิมพ์ในตารางด้านล่างได้เลย"));
    if (!ok) toast.error(body.error || "อัปโหลดไม่สำเร็จ");
    setOnlyFlagged(false);
    setStep("review");
    setBusy(false);
    setBusyText("");
  }

  async function save(confirmOverwrite = false) {
    setBusy(true);
    let response: Response;
    let body: { filled?: number; error?: string } = {};
    try {
      response = await fetch("/api/menus/month", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, month, cells, confirmOverwrite }),
      });
      body = await response.json().catch(() => ({}));
    } catch {
      setBusy(false);
      toast.error("เชื่อมต่อไม่สำเร็จ เมนูยังอยู่ในหน้านี้ ลองกดบันทึกอีกครั้ง");
      return;
    }
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
  const flaggedCount = cells.filter(isFlagged).length;
  const visibleDays = Array.from({ length: total }, (_, index) => index + 1).filter(
    (day) => !onlyFlagged || cells.some((cell) => cell.day === day && isFlagged(cell)),
  );

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
              multiple
              className="sr-only"
              disabled={busy}
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                if (files.length) void onFiles(files);
              }}
            />
            <div>
              <p className="text-2xl font-bold">วางภาพปฏิทินหรือไฟล์ตาราง</p>
              <p className="mt-2 text-sm text-[#6B5348]">ภาพถ่าย/JPG/PNG (เลือกได้สูงสุด 4 ภาพ), CSV, XLSX · AI อ่านภาพให้อัตโนมัติ แล้วตรวจก่อนบันทึก</p>
              <span className="mt-4 inline-flex h-12 items-center rounded-full bg-[#06BB46] px-5 font-bold text-white">{busy ? busyText || "กำลังอ่าน..." : "เลือกไฟล์เมนู"}</span>
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
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
              <button type="button" className="underline" onClick={() => setStep("choose")}>เลือกไฟล์ใหม่</button>
              {flaggedCount > 0 && (
                <button type="button" className="font-semibold underline" onClick={() => setOnlyFlagged((value) => !value)}>
                  {onlyFlagged ? "แสดงทุกวัน" : `ดูเฉพาะช่องที่ควรตรวจ (${flaggedCount})`}
                </button>
              )}
            </div>
            {flaggedCount > 0 && (
              <p className="mt-2 text-xs text-[#8A5A1A]">
                <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-[#F08A24] align-middle" />สีส้ม = อ่าน 2 รอบได้ไม่ตรงกันหรือควรตรวจ
                <span className="ml-3 mr-1 inline-block h-2.5 w-2.5 rounded-full bg-[#3B82F6] align-middle" />สีฟ้า = แก้คำสะกดให้อัตโนมัติ
              </p>
            )}
          </div>
          <div className="grid items-start gap-4 lg:grid-cols-[280px_1fr]">
            {preview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="ภาพปฏิทินที่อัปโหลด" className="max-h-72 w-full rounded-3xl bg-white object-contain p-2 shadow lg:sticky lg:top-24 lg:max-h-none" />
            )}
            <div className="space-y-3">
              {visibleDays.map((day) => (
                <article key={day} className="rounded-3xl bg-white p-4">
                  <h2 className="font-bold">{formatThaiDate(isoFromParts(year, month, day))}</h2>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {MEALS.map((meal) => {
                      const current = cells.find((cell) => cell.day === day && cell.meal === meal.key);
                      if (onlyFlagged && !isFlagged(current)) return null;
                      const disagree = current?.altText !== undefined;
                      // Typing in a cell or picking a reading marks it as checked; the notes stay so it can be changed back.
                      const warn = Boolean(current?.needsReview);
                      const fixed = Boolean(current?.originalText);
                      return (
                        <div key={meal.key} className="text-sm">
                          <label className="block font-semibold" style={{ color: meal.ink }}>
                            {meal.full}
                            {warn ? (disagree ? " · อ่าน 2 รอบไม่ตรงกัน" : " · ควรตรวจ") : disagree ? " · เลือกแล้ว" : fixed ? " · แก้คำสะกดแล้ว" : ""}
                            <textarea
                              value={cellText(day, meal.key)}
                              onChange={(event) => updateCell(day, meal.key, event.target.value)}
                              rows={2}
                              className={`mt-1 w-full rounded-2xl border p-3 text-base font-normal text-[#2C1810] ${
                                warn
                                  ? "border-2 border-[#F08A24] bg-[#FFF4E8]"
                                                : fixed
                                    ? "border-2 border-[#93C5FD] bg-[#F3F8FF]"
                                    : "border-[#E4D3C4]"
                              }`}
                            />
                          </label>
                          {disagree && current && (
                            <p className="mt-1 rounded-xl bg-[#FFF4E8] px-3 py-2 text-xs leading-5 text-[#8A4B0F]">
                              อีกรอบอ่านได้: {current.altText ? `“${current.altText}”` : "(ว่าง)"}
                              {current.altText ? (
                                <button
                                  type="button"
                                  className="ml-2 font-semibold underline"
                                  onClick={() =>
                                    patchCell(day, meal.key, {
                                      dishText: current.altText ?? "",
                                      altText: current.dishText,
                                      originalText: undefined,
                                      needsReview: false,
                                    })
                                  }
                                >
                                  ใช้แบบนี้
                                </button>
                              ) : null}
                            </p>
                          )}
                          {fixed && current && (
                            <p className="mt-1 rounded-xl bg-[#F3F8FF] px-3 py-2 text-xs leading-5 text-[#1E4E8C]">
                              แก้คำสะกดอัตโนมัติ จาก “{current.originalText}”
                              <button
                                type="button"
                                className="ml-2 font-semibold underline"
                                onClick={() =>
                                  patchCell(day, meal.key, { dishText: current.originalText ?? "", originalText: undefined, needsReview: false })
                                }
                              >
                                ใช้คำเดิม
                              </button>
                            </p>
                          )}
                        </div>
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
