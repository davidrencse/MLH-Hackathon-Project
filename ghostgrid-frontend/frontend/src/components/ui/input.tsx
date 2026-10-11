import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-none px-2.5 py-0 leading-none border-2 border-gg-haze bg-gg-void text-xl text-gg-ink caret-gg-cyan transition-colors outline-none selection:bg-gg-pink selection:text-gg-void placeholder:text-gg-mute hover:border-gg-cyan/50 focus-visible:border-gg-cyan focus-visible:shadow-[2px_2px_0_0_rgba(0,240,255,0.3)] disabled:cursor-not-allowed disabled:bg-gg-night disabled:opacity-50 aria-invalid:border-gg-red file:mr-2 file:inline-flex file:h-6 file:border-0 file:bg-transparent file:font-pixel file:text-[8px] file:text-gg-cyan file:uppercase disabled:pointer-events-none",
        className
      )}
      {...props}
    />
  )
}

export { Input }
