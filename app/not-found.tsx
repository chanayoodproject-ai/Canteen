import Link from "next/link";
import { Logo } from "@/components/logo";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="text-center">
        <Logo size={160} className="mx-auto" />
        <h1 className="mt-4 text-2xl font-bold">ไม่พบหน้านี้</h1>
        <Link href="/" className="mt-4 inline-flex h-12 items-center rounded-full bg-[#06BB46] px-5 font-bold text-white">
          กลับไปวันนี้
        </Link>
      </div>
    </main>
  );
}
