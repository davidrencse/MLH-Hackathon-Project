// Shared pieces for the CITY STATS overview: palette hexes, game-window frame, segmented bar.
import type { ReactNode } from 'react'
import type { ResourceLevel } from '@/store/resources'
import './overview.css'

// Hex values mirror the --gg-* tokens (SVG attributes need literal colors).
export const C = {
  void: '#0b0820',
  night: '#1a1040',
  dusk: '#2a1a5e',
  haze: '#3d2a7a',
  ink: '#e8e6ff',
  mute: '#8f8ab8',
  pink: '#ff2bd6',
  cyan: '#00f0ff',
  green: '#39ff14',
  yellow: '#ffd400',
  red: '#ff3355',
  grey: '#5a5677',
} as const

export const LEVEL_COLOR: Record<ResourceLevel, string> = { ok: C.green, warn: C.yellow, alert: C.red }

export const fmtInt = new Intl.NumberFormat('en-US')
export const fmtCompact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

// Game-window frame: title bar with a pixel pip, 2px haze border, hard shadow.
export function Panel({
  title,
  pip = C.cyan,
  meta,
  children,
  className = '',
}: {
  title: string
  pip?: string
  meta?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`gg-ov-frame flex min-w-0 flex-col border-2 border-gg-haze bg-gg-night ${className}`}>
      <header className="flex min-h-10 items-center justify-between gap-3 border-b-2 border-gg-haze bg-gg-dusk/50 px-3 py-2">
        <h2 className="font-pixel flex items-center gap-2 text-[10px] leading-none text-gg-ink">
          <span aria-hidden className="gg-ov-pip inline-block size-2" style={{ background: pip }} />
          {title}
        </h2>
        {meta}
      </header>
      <div className="flex min-h-0 flex-1 flex-col p-4">{children}</div>
    </section>
  )
}

// Chunky segmented meter. `pct` is 0..1; any value above 0 lights at least one cell.
export function SegBar({ pct, color, cells = 10, label, tall = false }: { pct: number; color: string; cells?: number; label: string; tall?: boolean }) {
  const lit = pct > 0 ? Math.max(1, Math.round(Math.min(1, pct) * cells)) : 0
  return (
    <div className="flex gap-[2px]" role="img" aria-label={label}>
      {Array.from({ length: cells }, (_, i) => (
        <span
          key={i}
          className={`${tall ? 'h-6' : 'h-3'} flex-1`}
          style={{ background: i < lit ? color : 'rgba(61,42,122,0.55)' }}
        />
      ))}
    </div>
  )
}
