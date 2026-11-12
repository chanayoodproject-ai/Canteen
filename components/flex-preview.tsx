"use client";

import { Logo } from "@/components/logo";
import { MEAL_MAP, type MealKey } from "@/lib/meals";
import { formatThaiDate } from "@/lib/time";
import { cn } from "@/lib/utils";

export function FlexPreview({
  date,
  meal,
  dishText,
  menuScore,
  tasteScore,
  onRate,
  pending,
}: {
  date: string;
  meal: MealKey;
  dishText: string;
  menuScore?: number | null;
  tasteScore?: number | null;
  onRate?: (kind: "menu" | "taste", score: number) => void;
  pending?: boolean;
}) {
  const meta = MEAL_MAP[meal];
  const menu = dishText.trim() || "ยังไม่มีเมนูสำหรับมื้อนี้";
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
        <div className="px-4 py-4">
          <p className="text-xs text-[#8C7264]">เมนูวันนี้</p>
          <p className="mt-2 whitespace-pre-wrap text-lg font-bold leading-snug">{menu}</p>
        </div>
        <footer className="space-y-3 border-t border-[#F0E4D8] px-4 py-4">
          <ScoreRow
            title="ให้คะแนนเมนูอาหาร"
            color="#C4452D"
            selected={menuScore}
            disabled={pending || !onRate}
            onPick={(score) => onRate?.("menu", score)}
          />
          <div className="h-px bg-[#F0E4D8]" />
          <ScoreRow
            title="ให้คะแนนรสชาติ"
            color="#2F6B4F"
            selected={tasteScore}
            disabled={pending || !onRate}
            onPick={(score) => onRate?.("taste", score)}
          />
        </footer>
      </article>
    </div>
  );
}

function ScoreRow({
  title,
  color,
  selected,
  onPick,
  disabled,
}: {
  title: string;
  color: string;
  selected?: number | null;
  onPick: (score: number) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <p className="text-sm font-bold" style={{ color }}>
        {title}
      </p>
      <p className="text-[11px] text-[#8C7264]">แตะ 1 ถึง 5</p>
      <div className="mt-2 grid grid-cols-5 gap-1.5">
        {[1, 2, 3, 4, 5].map((score) => (
          <button
            key={score}
            type="button"
            disabled={disabled}
            onClick={() => onPick(score)}
            className={cn(
              "h-12 rounded-xl text-base font-bold text-white transition touch-manipulation",
              selected === score ? "ring-2 ring-offset-1" : "opacity-95",
            )}
            style={{ background: color, ["--tw-ring-color" as string]: color }}
            aria-label={`${title} ${score} จาก 5`}
            aria-pressed={selected === score}
          >
            {score}
          </button>
        ))}
      </div>
    </div>
  );
}
