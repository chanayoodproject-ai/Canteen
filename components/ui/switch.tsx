"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "relative h-7 w-12 shrink-0 rounded-full bg-[#E4D3C4] transition data-[state=checked]:bg-[#2F6B4F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6B4F]",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block h-6 w-6 translate-x-0.5 rounded-full bg-white shadow transition data-[state=checked]:translate-x-[22px]" />
    </SwitchPrimitive.Root>
  );
}
