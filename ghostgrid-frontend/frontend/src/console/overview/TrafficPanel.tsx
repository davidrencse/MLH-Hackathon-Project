// Row 2 left: requests/day + errors/day as stepped pixel areas, with a 7D / 30D toggle.
import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { api } from '@/api/client'
import type { UsageSummary } from '@/types'
import { C, Panel, fmtCompact } from './parts'

// Charting is ~360 kB of the dashboard bundle and sits below the stat line, so it loads
// after the panel is on screen rather than blocking the first paint.
const TrafficChart = lazy(() => import('./TrafficChart').then((m) => ({ default: m.TrafficChart })))

type Days = 7 | 30

export interface Row {
  label: string // "10/05"
  requests: number
  errors: number
}

const CHART_H = 220

export function TrafficPanel() {
  const [days, setDays] = useState<Days>(7)
  // Keyed by range so no state is set synchronously inside the effect.
  const [data, setData] = useState<{ days: Days; summary: UsageSummary } | null>(null)
  const [failed, setFailed] = useState<Days | null>(null)

  useEffect(() => {
    let alive = true
    api
      .getUsage(days)
      .then((summary) => alive && setData({ days, summary }))
      .catch(() => alive && setFailed(days))
    return () => {
      alive = false
    }
  }, [days])

  const rows = useMemo<Row[]>(
    () =>
      data?.summary.points.map((p) => ({ label: `${p.date.slice(5, 7)}/${p.date.slice(8, 10)}`, requests: p.requests, errors: p.errors })) ??
      [],
    [data],
  )
  const loading = data?.days !== days
  const totals = data?.summary.totals
  const perDay = totals && rows.length ? Math.round(totals.requests / rows.length) : null

  const toggle = (
    <div className="flex" role="group" aria-label="Range">
      {([7, 30] as const).map((d) => (
        <button
          key={d}
          type="button"
          aria-pressed={days === d}
          onClick={() => setDays(d)}
          className={`font-pixel -ml-[2px] border-2 px-2 py-1 text-[8px] leading-none outline-none first:ml-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gg-cyan ${
            days === d ? 'relative z-10 border-gg-cyan bg-gg-cyan text-gg-void' : 'border-gg-haze text-gg-mute hover:text-gg-ink'
          }`}
        >
          {d}D
        </button>
      ))}
    </div>
  )

  return (
    <Panel title="TRAFFIC" pip={C.cyan} meta={toggle}>
      <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-lg leading-none">
        <span className="flex items-center gap-2 text-gg-mute">
          <span className="inline-block size-2 bg-gg-cyan" />
          REQ/DAY <span className="tabular-nums text-gg-ink">{perDay !== null ? fmtCompact.format(perDay) : '--'}</span>
        </span>
        <span className="flex items-center gap-2 text-gg-mute">
          <span className="inline-block size-2 bg-gg-red" />
          ERRORS <span className="tabular-nums text-gg-ink">{totals ? `${(totals.errorRate * 100).toFixed(1)}%` : '--'}</span>
        </span>
        {loading && <span className="font-pixel gg-ov-cursor text-[8px] text-gg-cyan">{failed === days ? 'NO SIGNAL' : 'LOADING_'}</span>}
      </div>
      <div style={{ height: CHART_H }} className={loading ? 'opacity-50' : undefined}>
        {rows.length > 0 && (
          <Suspense fallback={null}>
            <TrafficChart rows={rows} height={CHART_H} />
          </Suspense>
        )}
      </div>
    </Panel>
  )
}
