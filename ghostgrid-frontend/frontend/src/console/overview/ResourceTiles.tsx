// Row 1: the six city resources as chunky game tiles. COST (real USD) sits apart under "REAL MONEY".
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
  const game = resources.filter((r) => r.key !== 'cost')
  const cost = resources.find((r) => r.key === 'cost')

  return (
    <div className="flex flex-col gap-4 xl:flex-row">
      <div className="min-w-0 flex-1">
        <RowLabel color={C.cyan}>CITY RESOURCES</RowLabel>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {game.map((r) => (
            <Tile key={r.key} r={r} />
          ))}
        </div>
      </div>
      {cost && (
        <div className="border-t-2 border-dashed border-gg-haze pt-4 xl:w-[200px] xl:flex-none xl:border-t-0 xl:border-l-2 xl:pt-0 xl:pl-4">
          <RowLabel color={C.yellow}>REAL MONEY</RowLabel>
          <Tile r={cost} />
        </div>
      )}
    </div>
  )
}
