import { cn } from "@/lib/utils";

export function Logo({
  size = 48,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    // Exact official artwork, cropped to the circular emblem for tight spaces.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/logo-mark.png"
      alt="Canteen มีอารายกิน"
      width={size}
      height={size}
      className={cn("shrink-0 rounded-full", className)}
    />
  );
}
