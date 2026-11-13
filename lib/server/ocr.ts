import { generateText, jsonSchema, Output } from "ai";
import type { GatewayProviderOptions } from "@ai-sdk/gateway";
import { ocrToDrafts, type OcrResult } from "@/lib/parse-menu";
import type { DraftCell } from "@/lib/parse-menu";

// Primary vision model + fallbacks. All IDs were checked against https://ai-gateway.vercel.sh/v1/models.
// Override without code changes by setting AI_VISION_MODEL in Vercel env.
export const DEFAULT_VISION_MODEL = "google/gemini-3-flash";
const FALLBACK_MODELS = ["openai/gpt-5-mini", "google/gemini-2.5-flash"];

const OCR_PROMPT = (year: number, month: number) => `คุณอ่านภาพปฏิทินหรือตารางเมนูโรงอาหารภาษาไทย ของเดือน ${month}/${year} (ค.ศ.)
แต่ละช่องวันที่มักมีบรรทัด "เช้า:", "เที่ยง:", "เย็น:", "ดึก:" ตามด้วยชื่ออาหาร
กติกา:
- breakfast = เช้า, lunch = เที่ยง/กลางวัน, dinner = เย็น, late = ดึก
- คัดลอกชื่ออาหารตามที่เขียนในภาพ ภาษาไทยให้สะกดตามภาพ ห้ามแต่งหรือเดาเมนูที่ไม่มี
- ถ้าช่องเดียวกันมีหลายเมนูหรือขึ้นบรรทัดใหม่ ให้รวมเป็นข้อความเดียวคั่นด้วยช่องว่าง ไม่ต้องใส่คำว่า "เช้า:" นำหน้า
- ถ้าอ่านไม่ชัดหรือไม่แน่ใจ ให้ใส่เท่าที่อ่านได้ และใส่ชื่อมื้อนั้นใน review
- ถ้าวันไหนไม่มีเมนูมื้อใด ให้เป็นข้อความว่าง
- ใส่ทุกวันที่มีในภาพ (เลขวันที่ 1-31)
- detectedMonth/detectedYear คือเดือน (1-12) และปี ค.ศ. ที่เขียนไว้บนภาพ ถ้าไม่มีให้ใส่ 0 (ถ้าภาพเขียนปี พ.ศ. ให้ลบ 543)
- ถ้ามีหลายภาพ ให้ถือว่าเป็นเดือนเดียวกันและรวมทุกวันเข้าด้วยกัน`;

const MEAL_TEXT = { type: "string" } as const;

const schema = jsonSchema<OcrResult>({
  type: "object",
  additionalProperties: false,
  properties: {
    detectedMonth: { type: "integer" },
    detectedYear: { type: "integer" },
    days: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          day: { type: "integer" },
          breakfast: MEAL_TEXT,
          lunch: MEAL_TEXT,
          dinner: MEAL_TEXT,
          late: MEAL_TEXT,
          review: { type: "array", items: { type: "string", enum: ["breakfast", "lunch", "dinner", "late"] } },
        },
        required: ["day", "breakfast", "lunch", "dinner", "late", "review"],
      },
    },
  },
  required: ["detectedMonth", "detectedYear", "days"],
});

export type OcrImage = { data: Uint8Array; mediaType: string };

export type OcrOutcome =
  | { ok: true; cells: DraftCell[]; model: string; detectedMonth: number; detectedYear: number }
  | { ok: false; reason: "not_configured" | "failed"; detail: string };

function gatewayAvailable() {
  // On Vercel the deployment authenticates to AI Gateway with OIDC automatically.
  return Boolean(process.env.VERCEL || process.env.VERCEL_OIDC_TOKEN || process.env.AI_GATEWAY_API_KEY);
}

export async function readMenuImages(images: OcrImage[], year: number, month: number): Promise<OcrOutcome> {
  let gatewayError = "";
  if (gatewayAvailable()) {
    try {
      const model = process.env.AI_VISION_MODEL || DEFAULT_VISION_MODEL;
      const result = await generateText({
        model,
        output: Output.object({ schema, name: "menu_month" }),
        maxRetries: 1,
        timeout: { totalMs: 100_000 },
        providerOptions: {
          gateway: {
            models: FALLBACK_MODELS.filter((item) => item !== model),
            tags: ["canteen-ocr"],
          } satisfies GatewayProviderOptions,
        },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: OCR_PROMPT(year, month) },
              ...images.map((image) => ({ type: "file" as const, mediaType: image.mediaType, data: image.data })),
            ],
          },
        ],
      });
      return {
        ok: true,
        cells: ocrToDrafts(result.output, year, month),
        model: result.response?.modelId || model,
        detectedMonth: Number(result.output?.detectedMonth) || 0,
        detectedYear: Number(result.output?.detectedYear) || 0,
      };
    } catch (error) {
      gatewayError = describeGatewayError(error);
      console.error("[ocr] gateway failed:", error instanceof Error ? error.message : error);
    }
  }
  const geminiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      return await readWithGemini(geminiKey, images, year, month);
    } catch (error) {
      console.error("[ocr] gemini failed:", error instanceof Error ? error.message : error);
      if (!process.env.OPENAI_API_KEY) {
        return { ok: false, reason: "failed", detail: error instanceof Error ? error.message : "อ่านภาพไม่สำเร็จ" };
      }
    }
  }
  if (process.env.OPENAI_API_KEY) {
    try {
      return await readWithOpenAI(images, year, month);
    } catch (error) {
      return { ok: false, reason: "failed", detail: error instanceof Error ? error.message : "อ่านภาพไม่สำเร็จ" };
    }
  }
  if (gatewayError) return { ok: false, reason: "failed", detail: gatewayError };
  return { ok: false, reason: "not_configured", detail: "ยังไม่ได้เปิดบริการอ่านภาพ" };
}

function describeGatewayError(error: unknown) {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/credit card|add a card/i.test(text)) return "บริการ AI ของ Vercel ยังไม่เปิด ต้องผูกบัตรในหน้า AI Gateway ของ Vercel ก่อนเพื่อรับเครดิตฟรี";
  if (/credit|insufficient|payment|quota|budget/i.test(text)) return "เครดิต AI Gateway หมดหรือถึงงบที่ตั้งไว้";
  if (/free tier|not available|ineligible|not allowed/i.test(text)) return "โมเดลอ่านภาพนี้ใช้กับแพ็กเกจปัจจุบันไม่ได้";
  if (/auth|oidc|401|403|token/i.test(text)) return "ยืนยันตัวตนกับ AI Gateway ไม่สำเร็จ";
  if (/timeout|abort/i.test(text)) return "อ่านภาพนานเกินไป ลองใช้ภาพที่ครอปเฉพาะตารางหรือแบ่งเป็นสองภาพ";
  if (/rate|429/i.test(text)) return "มีการเรียกอ่านภาพถี่เกินไป รอสักครู่แล้วลองใหม่";
  return "บริการอ่านภาพตอบกลับไม่สำเร็จ";
}

async function readWithOpenAI(images: OcrImage[], year: number, month: number): Promise<OcrOutcome> {
  const model = process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(100_000),
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `${OCR_PROMPT(year, month)}\nตอบเป็น JSON เท่านั้น รูปแบบ {"detectedMonth":0,"detectedYear":0,"days":[{"day":1,"breakfast":"","lunch":"","dinner":"","late":"","review":[]}]}`,
            },
            ...images.map((image) => ({
              type: "image_url",
              image_url: { url: `data:${image.mediaType};base64,${Buffer.from(image.data).toString("base64")}` },
            })),
          ],
        },
      ],
    }),
  });
  if (!response.ok) throw new Error("บริการอ่านภาพตอบกลับไม่สำเร็จ");
  const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const parsed = jsonFromText(payload.choices?.[0]?.message?.content || "{}");
  return {
    ok: true,
    cells: ocrToDrafts(parsed, year, month),
    model: `openai/${model}`,
    detectedMonth: Number(parsed.detectedMonth) || 0,
    detectedYear: Number(parsed.detectedYear) || 0,
  };
}

function jsonFromText(text: string): OcrResult {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  return JSON.parse(cleaned || "{}") as OcrResult;
}

/** Direct Google Gemini API (free tier key from aistudio.google.com) as a no-card alternative. */
async function readWithGemini(key: string, images: OcrImage[], year: number, month: number): Promise<OcrOutcome> {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal: AbortSignal.timeout(100_000),
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `${OCR_PROMPT(year, month)}\nตอบเป็น JSON เท่านั้น รูปแบบ {"detectedMonth":0,"detectedYear":0,"days":[{"day":1,"breakfast":"","lunch":"","dinner":"","late":"","review":[]}]}`,
              },
              ...images.map((image) => ({
                inline_data: { mime_type: image.mediaType, data: Buffer.from(image.data).toString("base64") },
              })),
            ],
          },
        ],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
    },
  );
  if (!response.ok) throw new Error(`Gemini ตอบกลับไม่สำเร็จ (${response.status})`);
  const payload = (await response.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "{}";
  const parsed = jsonFromText(text);
  return {
    ok: true,
    cells: ocrToDrafts(parsed, year, month),
    model: `google/${model}`,
    detectedMonth: Number(parsed.detectedMonth) || 0,
    detectedYear: Number(parsed.detectedYear) || 0,
  };
}
