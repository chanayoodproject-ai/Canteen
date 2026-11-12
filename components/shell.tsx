"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Clock, Home, MessageCircle, Settings, Star, Upload } from "lucide-react";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "วันนี้", icon: Home },
  { href: "/calendar", label: "ปฏิทิน", icon: CalendarDays },
  { href: "/upload", label: "อัปโหลด", icon: Upload, emphasize: true },
  { href: "/schedule", label: "เวลา", icon: Clock },
  { href: "/ratings", label: "คะแนน", icon: Star },
  { href: "/preview", label: "LINE", icon: MessageCircle },
  { href: "/line", label: "ตั้งค่า", icon: Settings },
];

export function AppShell({
  children,
  supabase,
}: {
  children: React.ReactNode;
  supabase: boolean;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-[#D7EBD4] bg-[#F7FFF4]/95 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-3">
          <Link href="/" className="flex min-w-0 items-center gap-2">
            <Logo size={48} />
            <span className="sr-only">Canteen มีอารายกิน</span>
          </Link>
          <nav className="ml-auto hidden flex-wrap justify-end gap-1 md:flex">
            {LINKS.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "inline-flex h-11 items-center rounded-full px-3 text-sm font-semibold",
                    active ? "bg-[#06BB46] text-white" : "text-[#245C30] hover:bg-[#E7F8E4]",
                    link.emphasize && !active && "bg-[#06BB46] text-white hover:bg-[#04963A]",
                  )}
                >
                  {link.href === "/upload" ? "อัปโหลดเมนูอาหาร" : link.label === "LINE" ? "ข้อความ LINE" : link.label === "เวลา" ? "เวลาส่ง" : link.label === "ตั้งค่า" ? "ตั้งค่า LINE" : link.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      {!supabase && (
        <div className="bg-[#E7F8E4] px-4 py-2 text-sm leading-6 text-[#1E6B32]">
          <p className="mx-auto max-w-6xl">โหมดตัวอย่าง: ยังไม่ได้เชื่อม Supabase ข้อมูลอยู่แค่ในหน่วยความจำของเซิร์ฟเวอร์นี้</p>
        </div>
      )}
      <main className="mx-auto max-w-6xl px-4 py-4 pb-28 md:pb-10">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[#D7EBD4] bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
        <div className="grid grid-cols-[1fr_1.05fr_1.35fr_0.85fr_1fr_0.8fr_0.95fr]">
          {LINKS.map((link) => {
            const active = pathname === link.href;
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-16 flex-col items-center justify-center gap-1 px-0 py-1.5 text-[10px] font-semibold leading-none",
                  active ? "text-[#04963A]" : "text-[#3D6B48]",
                )}
              >
                <span
                  className={cn(
                    "grid h-8 w-8 place-items-center rounded-full",
                    active && "bg-[#E7F8E4]",
                    link.emphasize && "bg-[#06BB46] text-white",
                    link.emphasize && active && "bg-[#04963A]",
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="whitespace-nowrap">{link.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
