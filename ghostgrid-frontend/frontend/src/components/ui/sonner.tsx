import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

// Ghostgrid is always night: no next-themes provider, theme is forced to dark.
// Sonner injects unlayered CSS, so overrides use Tailwind's important (!) modifier.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group font-sans!"
      icons={{
        success: (
          <CircleCheckIcon className="size-4 text-gg-green" strokeWidth={2.5} />
        ),
        info: (
          <InfoIcon className="size-4 text-gg-cyan" strokeWidth={2.5} />
        ),
        warning: (
          <TriangleAlertIcon className="size-4 text-gg-yellow" strokeWidth={2.5} />
        ),
        error: (
          <OctagonXIcon className="size-4 text-gg-red" strokeWidth={2.5} />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin text-gg-cyan" strokeWidth={2.5} />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--gg-night)",
          "--normal-bg-hover": "var(--gg-dusk)",
          "--normal-text": "var(--gg-ink)",
          "--normal-border": "var(--gg-haze)",
          "--normal-border-hover": "var(--gg-cyan)",
          "--border-radius": "0px",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast:
            "cn-toast rounded-none! border-2! border-gg-haze! bg-gg-night! font-sans! text-lg! leading-tight! text-gg-ink! shadow-[4px_4px_0_0_rgba(0,0,0,0.6)]! gap-3!",
          title: "font-normal! text-lg! leading-tight! text-gg-ink!",
          description: "text-base! leading-tight! text-gg-mute!",
          actionButton:
            "rounded-none! h-7! px-3! font-pixel! text-[8px]! uppercase! bg-gg-cyan! text-gg-void! shadow-[2px_2px_0_0_rgba(0,0,0,0.6)]!",
          cancelButton:
            "rounded-none! h-7! px-3! border-2! border-gg-haze! font-pixel! text-[8px]! uppercase! bg-transparent! text-gg-mute!",
          closeButton: "rounded-none! border-2!",
          success: "border-l-4! border-l-gg-green!",
          info: "border-l-4! border-l-gg-cyan!",
          warning: "border-l-4! border-l-gg-yellow!",
          error: "border-l-4! border-l-gg-red!",
          loading: "border-l-4! border-l-gg-cyan!",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
