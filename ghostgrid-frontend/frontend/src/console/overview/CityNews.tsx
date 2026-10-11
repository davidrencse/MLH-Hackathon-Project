// Row 3 right: the latest 12 city log entries, newest first, styled as a game event log.
import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { CATALOG } from '@/constants'
import { useGrid } from '@/store/grid'
import type { LogLevel } from '@/types'
import { C, Panel } from './parts'

const LEVEL_TEXT: Record<LogLevel, string> = { info: C.ink, ok: C.green, warn: C.yellow, error: C.red }
const LEVEL_TAG: Record<LogLevel, string> = { info: 'INFO', ok: 'OK', warn: 'WARN', error: 'ERR' }
const fmtTime = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })

export function CityNews() {
  // useShallow keeps the same array while the last 12 entries are unchanged.
  const logs = useGrid(useShallow((s) => s.logs.slice(-12)))
  const buildings = useGrid((s) => s.buildings)

  // Direct visit to /dashboard: the city page has not loaded the seed logs yet.
  useEffect(() => {
    if (useGrid.getState().logs.length === 0) void useGrid.getState().loadInitialLogs()
  }, [])

  return (
    <Panel
      title="CITY NEWS"
      pip={C.green}
      meta={
        <span className="font-pixel flex items-center gap-2 text-[8px] leading-none text-gg-green">
          <span aria-hidden className="gg-ov-cursor inline-block size-2 bg-gg-green" />
          LIVE
        </span>
      }
    >
      {logs.length === 0 ? (
        <div className="font-pixel gg-ov-cursor py-6 text-center text-[8px] text-gg-mute">WAITING FOR NEWS_</div>
      ) : (
        <ol className="-mx-4 -my-2 flex flex-col" aria-live="polite">
          {logs.map((_, i) => {
            const l = logs[logs.length - 1 - i] // newest first
            const b = buildings[l.buildingId]
            const accent = b ? (b.bot?.color ?? CATALOG[b.type].accent) : C.mute
            const who = b ? b.short : l.buildingId.toUpperCase()
            return (
              <li
                key={l.id}
                className={`grid grid-cols-[auto_auto_1fr] items-baseline gap-x-3 border-b-2 border-dashed border-gg-haze/60 px-4 py-1.5 text-lg leading-tight last:border-b-0 ${
                  i === 0 ? 'bg-gg-dusk/50' : ''
                }`}
              >
                <span className="tabular-nums text-gg-mute">{fmtTime.format(l.ts)}</span>
                <span className="font-pixel w-[72px] truncate text-[8px] leading-none" style={{ color: accent }} title={b?.name}>
                  {who}
                </span>
                <span className="min-w-0 break-words" style={{ color: LEVEL_TEXT[l.level] }}>
                  <span className="text-gg-mute">[{LEVEL_TAG[l.level]}]</span> {l.text}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </Panel>
  )
}
