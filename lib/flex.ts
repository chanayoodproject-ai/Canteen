import { MEAL_MAP, type MealKey } from "@/lib/meals";
import { formatThaiDate, formatThaiDateShort } from "@/lib/time";

export type FlexBubble = {
  type: "flex";
  altText: string;
  contents: Record<string, unknown>;
};

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
        paddingAll: "24px",
        contents: [
          { type: "text", text: "เมนูวันนี้", size: "sm", color: "#8C7264", weight: "bold" },
          {
            type: "text",
            text: menu,
            wrap: true,
            weight: "bold",
            size: "4xl",
            color: "#2C1810",
            margin: "lg",
          },
        ],
      },
    },
  };
}
