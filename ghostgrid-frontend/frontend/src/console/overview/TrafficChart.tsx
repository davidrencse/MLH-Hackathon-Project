// The recharts half of TRAFFIC, split out so the dashboard's first paint does not pull
// the charting library (~360 kB) in with it. TrafficPanel lazy-loads this module.
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TooltipContentProps } from 'recharts'
import { C, fmtCompact, fmtInt } from './parts'
import type { Row } from './TrafficPanel'

const AXIS_TICK = { fill: C.mute, fontSize: 16, fontFamily: 'VT323, monospace' }

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

export function TrafficChart({ rows, height }: { rows: Row[]; height: number }) {
  const CHART_H = height
  return (
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
  )
}
