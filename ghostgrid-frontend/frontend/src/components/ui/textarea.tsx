import * as React from "react"
import { cn } from "cn"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-none px-2.5 py-2 leading-tight border-2 border-gg-haze bg-gg-void text-xl text-gg-ink caret-gg-cyan transition-colors outline-none selection:bg-gg-pink selection:text-gg-void placeholder:text-gg-mute hover:border-gg-cyan/50 focus-visible:border-gg-cyan focus-visible:shadow-[2px_2px_0_0_rgba(0,240,255,0.3)] disabled:cursor-not-allowed disabled:bg-gg-night disabled:opacity-50 aria-invalid:border-gg-red",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
