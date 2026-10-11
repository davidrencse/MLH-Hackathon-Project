import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-none border-2 border-transparent px-2 font-pixel text-[8px] leading-none tracking-normal uppercase whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gg-cyan focus-visible:outline-solid has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-gg-red [&>svg]:pointer-events-none [&>svg]:size-3! [&>svg]:stroke-[2.5]",
  {
    variants: {
      variant: {
        default:
          "border-gg-cyan bg-gg-cyan/15 text-gg-cyan [a]:hover:bg-gg-cyan/25",
        secondary:
          "border-gg-haze bg-gg-dusk text-gg-ink [a]:hover:border-gg-cyan/60",
        destructive:
          "border-gg-red bg-gg-red/15 text-gg-red [a]:hover:bg-gg-red/25",
        outline:
          "border-gg-haze bg-transparent text-gg-ink [a]:hover:border-gg-cyan [a]:hover:text-gg-cyan",
        ghost:
          "bg-transparent text-gg-mute hover:bg-gg-dusk hover:text-gg-ink",
        link: "bg-transparent text-gg-cyan underline decoration-2 underline-offset-4 hover:text-gg-ink",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
