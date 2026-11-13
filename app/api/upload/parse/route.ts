import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { bad } from "@/lib/server/http";
import { parseCsv, tableToDrafts, type DraftCell } from "@/lib/parse-menu";
import { readMenuImages, type OcrImage } from "@/lib/server/ocr";
import { buildDictionary } from "@/lib/dish-correct";
import { store } from "@/lib/server/store";
import { THAI_MONTHS } from "@/lib/time";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const preferredRegion = "bom1";
// Reading a full month calendar with a vision model can take 20-60s.
export const maxDuration = 120;

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"];

function manual(message: string) {
  return NextResponse.json({ ok: true, mode: "manual", message, cells: [] as DraftCell[] });
}

function isImage(file: File) {
  const name = file.name.toLowerCase();
  return file.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|heic|heif)$/.test(name);
}

function imageType(file: File) {
  if (IMAGE_TYPES.includes(file.type)) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".heic") || name.endsWith(".heif")) return "image/heic";
  return "image/jpeg";
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad("อ่านไฟล์ที่ส่งมาไม่ได้ ไฟล์อาจใหญ่เกินไป ลองถ่ายภาพใหม่หรือครอปเฉพาะตาราง", 413);
  }
  const year = Number(form.get("year"));
  const month = Number(form.get("month"));
  const files = form.getAll("file").filter((item): item is File => item instanceof File && item.size > 0);
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    return bad("ระบุเดือนและปีก่อนอัปโหลด");
  }
  if (!files.length) return bad("ยังไม่ได้เลือกไฟล์");
  const first = files[0];
  const name = first.name.toLowerCase();
  try {
    if (name.endsWith(".csv") || first.type.includes("csv") || name.endsWith(".txt")) {
      const table = parseCsv(await first.text());
      return NextResponse.json({
        ok: true,
        mode: "file",
        message: "อ่านไฟล์ตารางแล้ว ตรวจแก้ได้ทุกช่องก่อนบันทึก",
        cells: tableToDrafts(table, year, month),
      });
    }
    if (name.endsWith(".xlsx") || name.endsWith(".xls") || first.type.includes("sheet") || first.type.includes("excel")) {
      const book = XLSX.read(Buffer.from(await first.arrayBuffer()), { type: "buffer" });
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
    const images = files.filter(isImage).slice(0, MAX_IMAGES);
    if (!images.length) return bad("รองรับภาพปฏิทิน (JPG, PNG), CSV หรือ XLSX");
    if (images.some((file) => file.size > MAX_IMAGE_BYTES)) {
      return manual("ภาพใหญ่เกินไป ลองครอปเฉพาะตารางเมนูแล้วอัปโหลดใหม่ หรือพิมพ์ในตารางด้านล่างได้เลย");
    }
    const payload: OcrImage[] = await Promise.all(
      images.map(async (file) => ({ data: new Uint8Array(await file.arrayBuffer()), mediaType: imageType(file) })),
    );
    // Dishes saved in earlier months teach the spelling fixer; it grows every time a month is saved.
    const known = await store.knownDishTexts().catch((error) => {
      console.error("[upload/parse] dictionary", error instanceof Error ? error.message : error);
      return [] as string[];
    });
    const ocr = await readMenuImages(payload, year, month, { dictionary: buildDictionary(known) });
    if (!ocr.ok) {
      return manual(
        ocr.reason === "not_configured"
          ? "ยังอ่านภาพอัตโนมัติไม่ได้ เปิดรูปคู่กับตารางแล้วพิมพ์แก้ได้ทันที หรืออัปโหลด CSV/XLSX"
          : `อ่านภาพอัตโนมัติไม่สำเร็จ (${ocr.detail}) พิมพ์เมนูในตารางด้านล่างได้เลย หรือลองอัปโหลดใหม่`,
      );
    }
    const filled = ocr.cells.filter((cell) => cell.dishText).length;
    if (!filled) {
      return manual("อ่านภาพแล้วแต่ไม่พบเมนู ลองใช้ภาพที่ชัดขึ้นหรือครอปเฉพาะตาราง หรือพิมพ์ในตารางด้านล่างได้เลย");
    }
    const days = new Set(ocr.cells.map((cell) => cell.day)).size;
    const review = ocr.cells.filter((cell) => cell.needsReview).length;
    const fixed = ocr.cells.filter((cell) => cell.originalText).length;
    const disagree = ocr.cells.filter((cell) => cell.altText !== undefined).length;
    const checks = [
      ocr.reads === 2
        ? disagree
          ? `อ่าน 2 รอบ ไม่ตรงกัน ${disagree} ช่อง (ไฮไลต์สีส้ม)`
          : "อ่าน 2 รอบ ตรงกันทุกช่อง"
        : "อ่านได้รอบเดียว",
      fixed ? `แก้คำสะกดอัตโนมัติ ${fixed} ช่อง (กดใช้คำเดิมได้)` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const mismatch =
      (ocr.detectedMonth && ocr.detectedMonth !== month) || (ocr.detectedYear && ocr.detectedYear !== year)
        ? ` ⚠️ ภาพนี้น่าจะเป็นเดือน${THAI_MONTHS[(ocr.detectedMonth || month) - 1]} ${(ocr.detectedYear || year) + 543} แต่เลือก${THAI_MONTHS[month - 1]} ${year + 543} ไว้ ตรวจเดือนก่อนบันทึก`
        : "";
    return NextResponse.json({
      ok: true,
      mode: "ocr",
      model: ocr.model,
      detectedMonth: ocr.detectedMonth,
      detectedYear: ocr.detectedYear,
      message: `อ่านภาพแล้ว ได้ ${days} วัน ${filled} มื้อ · ${checks}${review ? ` · ควรตรวจ ${review} ช่อง` : ""} โปรดตรวจก่อนบันทึก${mismatch}`,
      reads: ocr.reads ?? 1,
      fixed,
      disagree,
      cells: ocr.cells,
    });
  } catch (error) {
    console.error("[upload/parse]", error instanceof Error ? error.message : error);
    return manual("อ่านไฟล์ไม่สำเร็จ พิมพ์เมนูในตารางด้านล่างได้เลย หรือลองอัปโหลดใหม่");
  }
}
