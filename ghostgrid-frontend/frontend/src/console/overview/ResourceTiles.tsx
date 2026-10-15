// Row 1: the city resources as chunky game tiles.
import type { ReactNode } from 'react'
import { useResources } from '@/store/resources'
import type { Resource } from '@/store/resources'
import { C, LEVEL_COLOR, SegBar } from './parts'

function Tile({ r }: { r: Resource }) {
  const color = LEVEL_COLOR[r.level]
  return (
    <div
      title={r.metric}
      className="gg-ov-frame flex min-w-0 flex-col gap-3 border-2 bg-gg-night p-3"
      style={{ borderColor: r.level === 'ok' ? C.haze : color }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-pixel truncate text-[8px] leading-none text-gg-mute">{r.label}</span>
        <span
          aria-hidden
          className={`gg-ov-pip inline-block size-2 flex-none ${r.level === 'alert' ? 'gg-ov-alert' : ''}`}
          style={{ background: color }}
        />
      </div>
      <div className="font-pixel truncate text-base leading-none" style={{ color: r.level === 'ok' ? C.ink : color }}>
        {r.value}
      </div>
      <div className="truncate text-lg leading-none text-gg-mute">{r.sub}</div>
      <SegBar pct={r.pct} color={color} label={`${r.label} ${Math.round(r.pct * 100)}%`} />
    </div>
  )
}

function RowLabel({ color, children }: { color: string; children: ReactNode }) {
  return (
    <div className="font-pixel mb-2 text-[8px] leading-none" style={{ color }}>
      {children}
    </div>
  )
}

export function ResourceTiles() {
  const resources = useResources()

  return (
    <div className="min-w-0">
      <RowLabel color={C.cyan}>CITY RESOURCES</RowLabel>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {resources.map((r) => (
          <Tile key={r.key} r={r} />
        ))}
      </div>
    </div>
  )
}
