import { MEAL_MAP, type MealKey } from "@/lib/meals";
import { formatThaiDate, formatThaiDateShort } from "@/lib/time";

export type FlexBubble = {
  type: "flex";
  altText: string;
  contents: Record<string, unknown>;
};

export type DishTextSize = "4xl" | "3xl" | "xxl" | "xl" | "lg";

const COMBINING = /\p{M}/gu;

/**
 * Thai display-cell length: one grapheme cluster per visible letter,
 * so combining vowels and tone marks are not counted on their own.
 */
export function thaiDisplayLength(text: string): number {
  const value = text.normalize("NFC");
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter("th", { granularity: "grapheme" });
    return [...segmenter.segment(value)].length;
  }
  return [...value.replace(COMBINING, "")].length;
}

export function menuLines(dishText: string): string[] {
  const lines = dishText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length ? lines : ["ยังไม่มีเมนู"];
}

/**
 * One size for every dish in the message, taken from the longest line so
 * the card stays consistent. Calibrated to a LINE mega bubble (~300px wide,
 * 20px padding on each side): at 4xl (~36px) about 8 Thai display cells
 * fit on one phone line, which is where "ต้มจืดมะระยัดไส้ไก่" previously
 * wrapped. Larger names step down; shrink-to-fit covers the last cell of
 * each tier.
 *
 * 4xl ≤ 8 · 3xl ≤ 10 · xxl ≤ 12 · xl ≤ 14 · lg otherwise
 */
export function menuTextSize(dishText: string): DishTextSize {
  const longest = Math.max(0, ...menuLines(dishText).map(thaiDisplayLength));
  if (longest <= 8) return "4xl";
  if (longest <= 10) return "3xl";
  if (longest <= 12) return "xxl";
  if (longest <= 14) return "xl";
  return "lg";
}

/** Lines longer than this stay readable only if LINE may wrap at a space. */
const WRAP_AFTER = 20;

export function menuLineShouldWrap(line: string): boolean {
  return thaiDisplayLength(line) > WRAP_AFTER;
}

function dishTextNode(line: string, size: DishTextSize, margin: string) {
  const wrap = menuLineShouldWrap(line);
  return {
    type: "text",
    text: line,
    wrap,
    adjustMode: wrap ? undefined : "shrink-to-fit",
    weight: "bold",
    size,
    color: "#2C1810",
    margin,
  };
}

export function buildFlexMessage(input: { date: string; meal: MealKey; dishText: string; logoUrl?: string }): FlexBubble {
  const meta = MEAL_MAP[input.meal];
  const when = formatThaiDateShort(input.date);
  const full = formatThaiDate(input.date);
  const lines = menuLines(input.dishText);
  const size = menuTextSize(input.dishText);
  const menu = lines.join("\n");
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
        paddingTop: "20px",
        paddingBottom: "16px",
        paddingStart: "20px",
        paddingEnd: "20px",
        contents: [
          { type: "text", text: "เมนูวันนี้", size: "sm", color: "#8C7264", weight: "bold" },
          ...lines.map((line, index) => dishTextNode(line, size, index === 0 ? "md" : "sm")),
        ],
      },
    },
  };
}
