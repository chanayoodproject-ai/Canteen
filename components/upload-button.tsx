import Link from "next/link";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

export function UploadButton({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <Link
      href="/upload"
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full bg-[#06BB46] font-bold text-white shadow-[0_14px_30px_-14px_rgba(6,187,70,0.95)] transition touch-manipulation hover:bg-[#04963A]",
        compact ? "h-12 w-full px-4 text-base sm:w-auto" : "h-14 w-full px-6 text-lg",
        className,
      )}
    >
      <Upload className="h-5 w-5" />
      อัปโหลดเมนูอาหาร
    </Link>
  );
}
