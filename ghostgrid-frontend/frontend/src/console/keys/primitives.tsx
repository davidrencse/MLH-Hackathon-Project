// Small building blocks for the API Keys page: native select skin, form field, pixel loader,
// pixel key art, status chip and a confirm dialog.
import { useState } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import './keys.css'

export function PixelSelect({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <div className={cn('relative min-w-0', className)}>
      <select
        {...props}
        className="gg-keys-select h-8 w-full min-w-0 cursor-pointer appearance-none truncate rounded-none border-2 border-gg-haze bg-gg-void pr-8 pl-2.5 text-xl leading-none text-gg-ink outline-none transition-colors hover:border-gg-cyan/50 focus-visible:border-gg-cyan focus-visible:shadow-[2px_2px_0_0_rgba(0,240,255,0.3)] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-gg-red"
      >
        {children}
      </select>
      <ChevronDown
        size={16}
        strokeWidth={2.5}
        className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-gg-mute"
      />
    </div>
  )
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  error?: string | null
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="flex items-center gap-2 text-base leading-none text-gg-red">
          <span className="block size-1.5 shrink-0 bg-gg-red" />
          {error}
        </p>
      ) : hint ? (
        <p className="text-base leading-none text-gg-mute">{hint}</p>
      ) : null}
    </div>
  )
}

export function PixelLoader({ className = '' }: { className?: string }) {
  return (
    <span className={`gg-keys-loader ${className}`} role="status" aria-label="Loading">
      <span />
      <span />
      <span />
    </span>
  )
}

// 18x8 key. P = pink body, I = ink highlight. Drawn with one element's box-shadow.
const KEY_ART = [
  '..PPPP............',
  '.PIIPPP...........',
  'PIP..PPP..........',
  'PP....PPIIIPPPPPPP',
  'PP....PPPPPPPPPPPP',
  'PPP..PPP....PP..PP',
  '.PPPPPP.....PP..PP',
  '..PPPP..........PP',
]
const PX = 6
const KEY_SHADOW = (() => {
  const fg: string[] = []
  const back: string[] = []
  KEY_ART.forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (c === '.') return
      const color = c === 'I' ? 'var(--gg-ink)' : 'var(--gg-pink)'
      fg.push(`${(x + 1) * PX}px ${(y + 1) * PX}px 0 0 ${color}`)
      back.push(`${(x + 2) * PX}px ${(y + 2) * PX}px 0 0 rgba(0,0,0,.5)`)
    }),
  )
  return [...fg, ...back].join(',')
})()
// 3x3 plus-shaped sparkle around a single cyan pixel.
const SPARKLE = [`${PX}px 0`, `-${PX}px 0`, `0 ${PX}px`, `0 -${PX}px`].map((o) => `${o} 0 0 var(--gg-cyan)`).join(',')

export function PixelKey() {
  return (
    <div className="gg-keys-pixkey relative" style={{ width: 19 * PX, height: 9 * PX }} aria-hidden>
      <span className="absolute block" style={{ left: -PX, top: -PX, width: PX, height: PX, boxShadow: KEY_SHADOW }} />
      <span
        className="gg-keys-sparkle absolute block bg-gg-cyan"
        style={{ left: 16 * PX, top: 0, width: PX, height: PX, boxShadow: SPARKLE }}
      />
    </div>
  )
}

export function Chip({ color, children, className = '' }: { color: string; children: ReactNode; className?: string }) {
  return (
    <span
      className={`font-pixel inline-flex items-center gap-2 border-2 px-2 py-1 text-[8px] leading-none uppercase ${className}`}
      style={{ color, borderColor: color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}
    >
      <span className="inline-block size-1.5" style={{ background: color }} />
      {children}
    </span>
  )
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  confirmLabel: string
  onConfirm: () => void | Promise<void>
}) {
  const [busy, setBusy] = useState(false)

  async function confirm() {
    setBusy(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="border-gg-red/60 sm:max-w-md">
        <DialogHeader className="pr-8">
          <DialogTitle className="text-gg-red">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={busy} />}>Cancel</DialogClose>
          <Button variant="destructive" onClick={confirm} disabled={busy}>
            {busy ? <PixelLoader /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
