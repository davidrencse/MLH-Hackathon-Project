"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"
import { cn } from "cn"

function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-none border-2 p-0.5 transition-colors duration-100 outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gg-cyan focus-visible:outline-solid aria-invalid:border-gg-red data-[size=default]:h-5 data-[size=default]:w-9 data-[size=sm]:h-4 data-[size=sm]:w-7 data-checked:border-gg-cyan data-checked:bg-gg-cyan data-checked:shadow-[0_0_8px_0_rgba(0,240,255,0.4)] data-unchecked:border-gg-haze data-unchecked:bg-gg-void data-unchecked:hover:border-gg-cyan/60 data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-none transition-transform duration-100 ease-[steps(2)] group-data-[size=default]/switch:size-3 group-data-[size=sm]/switch:size-2 group-data-[size=default]/switch:data-checked:translate-x-4 group-data-[size=sm]/switch:data-checked:translate-x-3 data-checked:bg-gg-void group-data-[size=default]/switch:data-unchecked:translate-x-0 group-data-[size=sm]/switch:data-unchecked:translate-x-0 data-unchecked:bg-gg-mute"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
