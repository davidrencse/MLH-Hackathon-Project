"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-stretch justify-start gap-1 rounded-none border-gg-haze p-0 text-gg-mute group-data-horizontal/tabs:h-9 group-data-horizontal/tabs:border-b-2 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col group-data-vertical/tabs:border-r-2",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex flex-1 items-center justify-center gap-2 rounded-none border-0 border-transparent px-3 font-pixel text-[8px] leading-none tracking-normal whitespace-nowrap text-gg-mute uppercase transition-colors duration-100 outline-none group-data-horizontal/tabs:-mb-0.5 group-data-horizontal/tabs:border-b-2 group-data-vertical/tabs:-mr-0.5 group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start group-data-vertical/tabs:border-r-2 group-data-vertical/tabs:py-2.5 hover:text-gg-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gg-cyan focus-visible:outline-solid disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:stroke-[2.5] [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=default]/tabs-list:hover:bg-gg-dusk/40 group-data-[variant=default]/tabs-list:data-active:bg-gg-dusk/60",
        "data-active:border-gg-cyan data-active:text-gg-ink data-active:[&_svg]:text-gg-cyan",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gg-cyan focus-visible:outline-solid", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
