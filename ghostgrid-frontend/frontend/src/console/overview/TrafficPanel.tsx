// Row 2 left: requests/day + errors/day as stepped pixel areas, with a 7D / 30D toggle.
import { useEffect, useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TooltipContentProps } from 'recharts'
import { api } from '@/api/client'
import type { UsageSummary } from '@/types'
import { C, Panel, fmtCompact, fmtInt } from './parts'

type Days = 7 | 30

interface Row {
  label: string // "10/05"
  requests: number
  errors: number
}

const AXIS_TICK = { fill: C.mute, fontSize: 16, fontFamily: 'VT323, monospace' }
const CHART_H = 220

function PixelTip({ active, payload }: { active?: boolean; payload?: TooltipContentProps['payload'] }) {
  const row = active ? (payload?.[0]?.payload as Row | undefined) : undefined
  if (!row) return null
  return (
    <div className="min-w-[160px] border-2 border-gg-haze bg-gg-night px-3 py-2 shadow-[4px_4px_0_0_rgba(0,0,0,0.6)]">
      <div className="font-pixel mb-2 text-[8px] leading-none text-gg-mute">DAY {row.label}</div>
      {[
        { label: 'Requests', color: C.cyan, value: row.requests },
        { label: 'Errors', color: C.red, value: row.errors },
      ].map((l) => (
        <div key={l.label} className="flex items-center justify-between gap-4 text-lg leading-tight">
          <span className="flex items-center gap-2 text-gg-mute">
            <span className="inline-block size-2" style={{ background: l.color }} />
            {l.label}
          </span>
          <span className="tabular-nums text-gg-ink">{fmtInt.format(l.value)}</span>
        </div>
      ))}
    </div>
  )
}

function SquareDot({ cx, cy, color }: { cx?: number; cy?: number; color: string }) {
  if (cx == null || cy == null) return null
  return <rect x={cx - 4} y={cy - 4} width={8} height={8} fill={color} stroke={C.void} strokeWidth={2} shapeRendering="crispEdges" />
}

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
          <ResponsiveContainer width="100%" height={CHART_H}>
            <AreaChart data={rows} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={C.haze} strokeDasharray="4 4" vertical={false} />
              <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: C.haze, strokeWidth: 2 }} tickLine={false} tickMargin={8} minTickGap={16} />
              <YAxis yAxisId="req" tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} tickFormatter={(v: number) => fmtCompact.format(v)} />
              <YAxis
                yAxisId="err"
                orientation="right"
                tick={{ ...AXIS_TICK, fill: C.red }}
                axisLine={false}
                tickLine={false}
                width={36}
                tickFormatter={(v: number) => fmtCompact.format(v)}
              />
              <Tooltip
                cursor={{ stroke: C.haze, strokeWidth: 2 }}
                wrapperStyle={{ outline: 'none' }}
                isAnimationActive={false}
                content={(p) => <PixelTip active={p.active} payload={p.payload} />}
              />
              <Area
                yAxisId="req"
                type="stepAfter"
                dataKey="requests"
                stroke={C.cyan}
                strokeWidth={2}
                strokeLinejoin="miter"
                strokeLinecap="square"
                fill={C.cyan}
                fillOpacity={0.14}
                dot={false}
                activeDot={<SquareDot color={C.cyan} />}
                isAnimationActive={false}
              />
              <Area
                yAxisId="err"
                type="stepAfter"
                dataKey="errors"
                stroke={C.red}
                strokeWidth={2}
                strokeLinejoin="miter"
                strokeLinecap="square"
                fill={C.red}
                fillOpacity={0.18}
                dot={false}
                activeDot={<SquareDot color={C.red} />}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Panel>
  )
}
