import { MEAL_MAP, type MealKey } from "@/lib/meals";
import { formatThaiDate, formatThaiDateShort } from "@/lib/time";

export type FlexBubble = {
  type: "flex";
  altText: string;
  contents: Record<string, unknown>;
};

const MENU_COLOR = "#C4452D";
const TASTE_COLOR = "#2F6B4F";

function scoreButtons(input: {
  date: string;
  meal: MealKey;
  kind: "menu" | "taste";
  color: string;
}) {
  const label = input.kind === "menu" ? "เมนูอาหาร" : "รสชาติ";
  return {
    type: "box",
    layout: "horizontal",
    spacing: "sm",
    margin: "md",
    contents: [1, 2, 3, 4, 5].map((score) => ({
      type: "button",
      flex: 1,
      height: "sm",
      style: "primary",
      color: input.color,
      action: {
        type: "postback",
        label: String(score),
        data: `k=${input.kind}&d=${input.date}&m=${input.meal}&s=${score}`,
        displayText: `ให้คะแนน${label} ${score}/5`,
      },
    })),
  };
}

export function buildFlexMessage(input: { date: string; meal: MealKey; dishText: string; logoUrl?: string }): FlexBubble {
  const meta = MEAL_MAP[input.meal];
  const when = formatThaiDateShort(input.date);
  const full = formatThaiDate(input.date);
  const menu = input.dishText.trim() || "ยังไม่มีเมนู";
  const title: Record<string, unknown> = {
    type: "box",
    layout: "vertical",
    flex: 1,
    contents: [
      { type: "text", text: meta.full, color: "#FFFFFF", weight: "bold", size: "xl" },
      { type: "text", text: full, color: "#F3FFE8", size: "xs", margin: "sm", wrap: true },
    ],
  };
  const headerContents: Record<string, unknown>[] = [];
  if (input.logoUrl) {
    headerContents.push({
      type: "image",
      url: input.logoUrl,
      size: "sm",
      aspectRatio: "1:1",
      aspectMode: "cover",
      flex: 0,
    });
  }
  headerContents.push(title);
  return {
    type: "flex",
    altText: `${meta.full} ${when}: ${menu}`.slice(0, 380),
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "horizontal",
        backgroundColor: "#06BB46",
        paddingAll: "16px",
        spacing: "md",
        alignItems: "center",
        contents: headerContents,
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "18px",
        contents: [
          { type: "text", text: "เมนูวันนี้", size: "xs", color: "#8C7264" },
          {
            type: "text",
            text: menu,
            wrap: true,
            weight: "bold",
            size: "lg",
            color: "#2C1810",
            margin: "md",
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "16px",
        spacing: "none",
        contents: [
          { type: "text", text: "ให้คะแนนเมนูอาหาร", weight: "bold", size: "sm", color: MENU_COLOR },
          { type: "text", text: "แตะ 1 ถึง 5", size: "xxs", color: "#8C7264", margin: "xs" },
          scoreButtons({ ...input, kind: "menu", color: MENU_COLOR }),
          { type: "separator", margin: "lg" },
          { type: "text", text: "ให้คะแนนรสชาติ", weight: "bold", size: "sm", color: TASTE_COLOR, margin: "lg" },
          { type: "text", text: "แตะ 1 ถึง 5", size: "xxs", color: "#8C7264", margin: "xs" },
          scoreButtons({ ...input, kind: "taste", color: TASTE_COLOR }),
        ],
      },
    },
  };
}

export type ParsedPostback =
  | { ok: true; kind: "menu" | "taste"; date: string; meal: MealKey; score: number }
  | { ok: false };

export function parsePostback(data: string): ParsedPostback {
  const params = new URLSearchParams(data);
  const kind = params.get("k");
  const date = params.get("d") || "";
  const meal = params.get("m");
  const score = Number(params.get("s"));
  if ((kind !== "menu" && kind !== "taste") || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false };
  if (meal !== "breakfast" && meal !== "lunch" && meal !== "dinner" && meal !== "late") return { ok: false };
  if (!Number.isInteger(score) || score < 1 || score > 5) return { ok: false };
  return { ok: true, kind, date, meal, score };
}

export function thankYouText(input: { kind: "menu" | "taste"; score: number; updated: boolean }) {
  const topic = input.kind === "menu" ? "เมนูอาหาร" : "รสชาติ";
  if (input.updated) return `อัปเดตคะแนน${topic}เป็น ${input.score}/5 แล้ว ขอบคุณค่ะ`;
  return `ขอบคุณที่ให้คะแนน${topic} ${input.score}/5 ค่ะ`;
}
