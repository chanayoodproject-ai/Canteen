"use client";

import { Logo } from "@/components/logo";
import { menuLineShouldWrap, menuLines, menuTextSize, type DishTextSize } from "@/lib/flex";
import { MEAL_MAP, type MealKey } from "@/lib/meals";
import { formatThaiDate } from "@/lib/time";
import { cn } from "@/lib/utils";

const SIZE_CLASS: Record<DishTextSize, string> = {
  "4xl": "text-[36px]",
  "3xl": "text-[30px]",
  xxl: "text-[26px]",
  xl: "text-[22px]",
  lg: "text-[19px]",
};

export function FlexPreview({
  date,
  meal,
  dishText,
}: {
  date: string;
  meal: MealKey;
  dishText: string;
}) {
  const meta = MEAL_MAP[meal];
  const lines = menuLines(dishText);
  const size = menuTextSize(dishText);
  return (
    <div className="mx-auto w-full max-w-[390px] rounded-[2rem] border border-white/40 bg-[#7494C0] p-3 shadow-[0_24px_50px_-28px_rgba(44,24,16,0.7)]">
      <div className="mb-2 flex items-center justify-between px-2 text-[11px] text-white/90">
        <span>LINE</span>
        <span>ตัวอย่างข้อความ</span>
      </div>
      <article className="overflow-hidden rounded-2xl bg-white text-[#2C1810] shadow">
        <header className="flex items-center gap-3 bg-[#06BB46] px-4 py-4 text-white">
          <Logo size={64} className="bg-white" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-white/85">{meta.full}</p>
            <h3 className="text-xl font-bold leading-tight">Canteen มีอารายกิน</h3>
            <p className="mt-1 text-xs text-white/85">{formatThaiDate(date)}</p>
          </div>
        </header>
        <div className="px-5 pb-4 pt-5">
          <p className="text-sm font-bold text-[#8C7264]">เมนูวันนี้</p>
          <div className="mt-2 space-y-1">
            {lines.map((line, index) => (
              <p
                key={`${index}-${line}`}
                className={cn(
                  "font-bold leading-tight",
                  SIZE_CLASS[size],
                  menuLineShouldWrap(line) ? "whitespace-normal break-words" : "whitespace-nowrap",
                )}
              >
                {line}
              </p>
            ))}
          </div>
        </div>
      </article>
    </div>
  );
}
