import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { bad } from "@/lib/server/http";
import { MEAL_KEYS } from "@/lib/meals";
import { daysInMonth } from "@/lib/time";
import { parseCsv, tableToDrafts, type DraftCell } from "@/lib/parse-menu";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OCR_PROMPT = `คุณอ่านภาพปฏิทินเมนูโรงอาหารภาษาไทย
ตอบเป็น JSON เท่านั้น รูปแบบ {"days":[{"day":1,"breakfast":"","lunch":"","dinner":"","late":"","review":[]}]}
มื้อคือ เช้า=breakfast เที่ยง=lunch เย็น=dinner ดึก=late
ถอดทุกวันที่อ่านได้ ห้ามแต่งเมนูที่ไม่มีในภาพ ถ้าอ่านไม่ออกให้ใส่ข้อความว่างและใส่ชื่อมื้อนั้นใน review
รวมข้อความที่ตัดบรรทัดในช่องเดียวกันเป็นเมนูของมื้อนั้น`;

export async function POST(request: Request) {
  const form = await request.formData();
  const year = Number(form.get("year"));
  const month = Number(form.get("month"));
  const file = form.get("file");
  if (!year || month < 1 || month > 12) return bad("ระบุเดือนและปีก่อนอัปโหลด");
  if (!(file instanceof File)) return bad("ยังไม่ได้เลือกไฟล์");
  const name = file.name.toLowerCase();
  try {
    if (name.endsWith(".csv") || file.type.includes("csv") || name.endsWith(".txt")) {
      const table = parseCsv(await file.text());
      return NextResponse.json({
        ok: true,
        mode: "file",
        message: "อ่านไฟล์ตารางแล้ว ตรวจแก้ได้ทุกช่องก่อนบันทึก",
        cells: tableToDrafts(table, year, month),
      });
    }
    if (name.endsWith(".xlsx") || name.endsWith(".xls") || file.type.includes("sheet")) {
      const book = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: "buffer" });
      const sheet = book.Sheets[book.SheetNames[0]];
      const table = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1, raw: false });
      const rows = table.map((row) => row.map((cell) => String(cell ?? "").trim()));
      return NextResponse.json({
        ok: true,
        mode: "file",
        message: "อ่านไฟล์ Excel แล้ว ตรวจแก้ได้ทุกช่องก่อนบันทึก",
        cells: tableToDrafts(rows, year, month),
      });
    }
    if (!file.type.startsWith("image/")) return bad("รองรับภาพปฏิทิน, CSV หรือ XLSX");
    const ocr = await readImage(file, year, month);
    if (!ocr) {
      return NextResponse.json({
        ok: true,
        mode: "manual",
        message: "ยังอ่านภาพอัตโนมัติไม่ได้ เพราะไม่มี OPENAI_API_KEY เปิดรูปคู่กับตารางแล้วพิมพ์แก้ได้ทันที หรืออัปโหลด CSV/XLSX",
        cells: [] as DraftCell[],
      });
    }
    return NextResponse.json({ ok: true, mode: "ocr", message: "อ่านภาพแล้ว โปรดตรวจทุกวันก่อนบันทึก", cells: ocr });
  } catch (error) {
    return NextResponse.json({
      ok: true,
      mode: "manual",
      message: error instanceof Error ? `อ่านไฟล์ไม่สำเร็จ: ${error.message} กรอกในตารางได้เลย` : "อ่านไฟล์ไม่สำเร็จ กรอกในตารางได้เลย",
      cells: [],
    });
  }
}

async function readImage(file: File, year: number, month: number): Promise<DraftCell[] | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const mime = file.type || "image/jpeg";
  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_VISION_MODEL || "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: OCR_PROMPT },
            { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
          ],
        },
      ],
    }),
  });
  if (!response.ok) throw new Error("บริการอ่านภาพตอบกลับไม่สำเร็จ");
  const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = payload.choices?.[0]?.message?.content || "{}";
  const parsed = JSON.parse(content) as {
    days?: { day: number; breakfast?: string; lunch?: string; dinner?: string; late?: string; review?: string[] }[];
  };
  const limit = daysInMonth(year, month);
  const cells: DraftCell[] = [];
  for (const day of parsed.days ?? []) {
    if (day.day < 1 || day.day > limit) continue;
    const review = new Set(day.review ?? []);
    for (const meal of MEAL_KEYS) {
      const dishText = String(day[meal] ?? "").trim();
      if (!dishText && !review.has(meal)) continue;
      cells.push({ day: day.day, meal, dishText, needsReview: review.has(meal) || !dishText });
    }
  }
  return cells;
}
