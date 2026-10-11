import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// Ghost Grid pixel buttons: hard shadow that collapses on press (no blur, radius 0).
const press =
  "active:not-aria-[haspopup]:translate-x-0.5 active:not-aria-[haspopup]:translate-y-0.5 active:not-aria-[haspopup]:shadow-none"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-none border-2 border-transparent font-pixel text-[10px] leading-none tracking-normal uppercase whitespace-nowrap transition-colors duration-100 outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gg-cyan focus-visible:outline-solid disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-gg-red [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:stroke-[2.5] [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: `border-gg-cyan bg-gg-cyan text-gg-void shadow-[3px_3px_0_0_rgba(0,0,0,0.6)] hover:shadow-[3px_3px_0_0_rgba(0,0,0,0.6),0_0_12px_0_rgba(0,240,255,0.45)] ${press}`,
        outline:
          "border-gg-haze bg-transparent text-gg-ink hover:border-gg-cyan hover:text-gg-cyan aria-expanded:border-gg-cyan aria-expanded:text-gg-cyan",
        secondary: `border-gg-haze bg-gg-dusk text-gg-ink shadow-[3px_3px_0_0_rgba(0,0,0,0.6)] hover:border-gg-cyan/60 hover:text-gg-cyan aria-expanded:border-gg-cyan ${press}`,
        ghost:
          "bg-transparent hover:bg-gg-dusk hover:text-gg-cyan aria-expanded:bg-gg-dusk aria-expanded:text-gg-cyan",
        destructive: `border-gg-red bg-gg-red text-gg-void shadow-[3px_3px_0_0_rgba(0,0,0,0.6)] hover:shadow-[3px_3px_0_0_rgba(0,0,0,0.6),0_0_12px_0_rgba(255,51,85,0.45)] focus-visible:outline-gg-red ${press}`,
        link: "bg-transparent text-gg-cyan underline decoration-2 underline-offset-4 hover:text-gg-ink",
      },
      size: {
        default:
          "h-8 gap-2 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 px-2 text-[8px] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
        lg: "h-9 gap-2 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-8",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
