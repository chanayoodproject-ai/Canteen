import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold transition touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#06BB46] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-[#06BB46] text-white shadow-[0_10px_24px_-12px_rgba(6,187,70,0.9)] hover:bg-[#04963A]",
        secondary: "border border-[#E4D3C4] bg-white text-[#2C1810] hover:bg-[#FFF7EE]",
        herb: "bg-[#2F6B4F] text-white hover:bg-[#24563F]",
        ghost: "text-[#5C4033] hover:bg-black/5",
      },
      size: {
        default: "h-12 px-5 text-base",
        lg: "h-14 px-7 text-base",
        sm: "h-11 px-4 text-sm",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
