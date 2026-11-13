import { generateText, jsonSchema, Output } from "ai";
import type { GatewayProviderOptions } from "@ai-sdk/gateway";
import { ocrToDrafts, type OcrResult } from "@/lib/parse-menu";
import { getAppSecret } from "@/lib/server/app-secrets";
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
  const errors: string[] = [];
  const startedAt = Date.now();

  // 1) Google Gemini direct (free key from aistudio.google.com). Key comes from Vercel env or public.app_secrets.
  const geminiKey =
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    (await getAppSecret("GOOGLE_GENERATIVE_AI_API_KEY").catch(() => ""));
  if (geminiKey) {
    const deadline = Date.now() + 105_000;
    const tried = new Set<string>();
    let queue = geminiModels();
    let discovered = false;
    while (queue.length && deadline - Date.now() > 8_000) {
      const model = queue.shift()!;
      if (tried.has(model)) continue;
      tried.add(model);
      try {
        return await readWithGemini(geminiKey, model, images, year, month, Math.min(90_000, deadline - Date.now()));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[ocr] gemini ${model} failed:`, message);
        errors.push(message);
        if (error instanceof GeminiError && !error.retryWithOtherModel) break;
        // Google retires model IDs over time; when one is gone, ask the API which flash models this key can use.
        if (error instanceof GeminiError && error.status === 404 && !discovered) {
          discovered = true;
          queue = [...queue, ...(await discoverGeminiModels(geminiKey))];
        }
      }
    }
  }

  // 2) Vercel AI Gateway (needs a card on the Vercel team to unlock credits).
  const gatewayBudget = 108_000 - (Date.now() - startedAt);
  if (gatewayAvailable() && gatewayBudget > 20_000) {
    try {
      const model = process.env.AI_VISION_MODEL || DEFAULT_VISION_MODEL;
      const result = await generateText({
        model,
        output: Output.object({ schema, name: "menu_month" }),
        maxRetries: 1,
        timeout: { totalMs: Math.min(100_000, gatewayBudget) },
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
      console.error("[ocr] gateway failed:", error instanceof Error ? error.message : error);
      if (!geminiKey) errors.push(describeGatewayError(error));
    }
  }

  // 3) OpenAI key, if one was ever added.
  if (process.env.OPENAI_API_KEY) {
    try {
      return await readWithOpenAI(images, year, month);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "อ่านภาพไม่สำเร็จ");
    }
  }
  if (errors.length) return { ok: false, reason: "failed", detail: errors[errors.length - 1] };
  return { ok: false, reason: "not_configured", detail: "ยังไม่ได้เปิดบริการอ่านภาพ" };
}

/** Gemini models tried in order. Override the first with GEMINI_MODEL in Vercel env. */
// Checked against the key's model list on 2026-11-13 (gemini-2.5-flash is closed to new keys).
// gemini-3-flash-preview copied the real November photo most faithfully (113/120 cells exact, the rest
// tone-mark spelling); if Google retires it, the 404 triggers discovery of newer flash models.
export const DEFAULT_GEMINI_MODELS = [
  "gemini-3-flash-preview",
  "gemini-3.5-flash",
  "gemini-flash-latest",
  "gemini-3.5-flash-lite",
  "gemini-flash-lite-latest",
];
function geminiModels() {
  const preferred = (process.env.GEMINI_MODEL || "").trim();
  return [...new Set([preferred, ...DEFAULT_GEMINI_MODELS].filter(Boolean))];
}

class GeminiError extends Error {
  constructor(
    message: string,
    readonly retryWithOtherModel: boolean,
    readonly status = 0,
  ) {
    super(message);
  }
}

/** Newest general-purpose flash models available to this key (skips tts/image/live variants). */
async function discoverGeminiModels(key: string): Promise<string[]> {
  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
      headers: { "x-goog-api-key": key },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { models?: { name?: string; supportedGenerationMethods?: string[] }[] };
    const version = (name: string) => Number(name.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] || 0);
    return (payload.models ?? [])
      .filter((item) => item.supportedGenerationMethods?.includes("generateContent"))
      .map((item) => String(item.name || "").replace(/^models\//, ""))
      .filter((name) => /^gemini-[\d.]+-flash(-lite)?(-preview)?$/.test(name))
      .sort((a, b) => Number(a.includes("lite")) - Number(b.includes("lite")) || version(b) - version(a))
      .slice(0, 4);
  } catch {
    return [];
  }
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
async function readWithGemini(
  key: string,
  model: string,
  images: OcrImage[],
  year: number,
  month: number,
  timeoutMs: number,
  thinkingLevel: string | null = /^gemini-(3|flash)/.test(model) ? process.env.GEMINI_THINKING || "minimal" : null,
): Promise<OcrOutcome> {
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        signal: AbortSignal.timeout(timeoutMs),
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
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0,
            maxOutputTokens: 32768,
            // Long "thinking" makes a month-sized table take 90s+; copying text from a photo needs very little.
            ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
          },
        }),
      },
    );
  } catch (error) {
    const timeout = error instanceof Error && /timeout|abort/i.test(error.name + error.message);
    throw new GeminiError(
      timeout ? "อ่านภาพนานเกินไป ลองใช้ภาพที่ครอปเฉพาะตารางหรือแบ่งเป็นสองภาพ" : "เชื่อมต่อ Gemini ไม่สำเร็จ",
      !timeout,
    );
  }
  if (!response.ok) {
    const status = response.status;
    if (status === 400 || status === 401 || status === 403) {
      // 400 on a bad/expired key, 403 when the key is restricted. Other models will fail the same way.
      const body = await response.text().catch(() => "");
      if (status === 400 && thinkingLevel && /thinking/i.test(body)) {
        // Some models reject "minimal"; retry the same model with its default thinking.
        return readWithGemini(key, model, images, year, month, timeoutMs - (Date.now() - startedAt), null);
      }
      const keyProblem = /API_KEY|api key|PERMISSION_DENIED/i.test(body) || status !== 400;
      throw new GeminiError(
        keyProblem ? "คีย์ Gemini ใช้ไม่ได้หรือหมดอายุ ต้องสร้างคีย์ใหม่ที่ Google AI Studio" : `Gemini ตอบกลับไม่สำเร็จ (${status})`,
        !keyProblem,
      );
    }
    if (status === 429) throw new GeminiError("ใช้ Gemini ฟรีครบโควตาชั่วคราว รอสักครู่แล้วลองใหม่", true, status);
    if (status === 503) throw new GeminiError("Gemini มีผู้ใช้มากชั่วคราว รอสักครู่แล้วลองใหม่", true, status);
    throw new GeminiError(`Gemini ตอบกลับไม่สำเร็จ (${status})`, true, status);
  }
  const payload = (await response.json()) as {
    candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  };
  const candidate = payload.candidates?.[0];
  const text = candidate?.content?.parts?.filter((part) => !part.thought).map((part) => part.text || "").join("") || "";
  let parsed: OcrResult;
  try {
    parsed = jsonFromText(text || "{}");
  } catch {
    throw new GeminiError(`Gemini ตอบกลับไม่ครบ (${candidate?.finishReason || "no text"})`, true);
  }
  const cells = ocrToDrafts(parsed, year, month);
  if (!cells.length) throw new GeminiError("Gemini อ่านเมนูจากภาพไม่ได้เลย", true);
  return {
    ok: true,
    cells,
    model: `google/${model}`,
    detectedMonth: Number(parsed.detectedMonth) || 0,
    detectedYear: Number(parsed.detectedYear) || 0,
  };
}
