// Agents list. Every building in the city is an agent, including the bots the player builds.
// Status, key, model, sessions and last activity come from the live stores, so this table mirrors
// the city in real time. api.listAgents() only fills in last activity until the city logs something.
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, ChevronRight, Plug, ShieldAlert } from 'lucide-react'
import { api } from '@/api/client'
import { StatusBadge } from '@/components/StatusBadge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CATALOG, PROVIDERS, STATUS_COLOR, botLabel } from '@/constants'
import { useAgentBuildingList, useGrid } from '@/store/grid'
import { maskKey, resolveBuildingKey, useKeys } from '@/store/keys'
import type { AgentSummary, Building, BuildingId, BuildingStatus, BuildingType } from '@/types'
import { PageHeader } from '../PageHeader'

// ---------- shared bits (also used by AgentDetailPage) ----------

const CSS = `
@keyframes gg-agents-blink { 0%, 49.9% { opacity: 1 } 50%, 100% { opacity: .15 } }
@keyframes gg-agents-skel { from { opacity: .3 } to { opacity: .85 } }
@keyframes gg-agents-in { from { opacity: 0; transform: translateX(-4px) } to { opacity: 1; transform: none } }
.gg-agents-blink { animation: gg-agents-blink 1s linear infinite }
.gg-agents-skel { display: block; background: var(--gg-haze); animation: gg-agents-skel .9s steps(3) infinite alternate }
.gg-agents-in { animation: gg-agents-in .24s steps(3) both }
@media (prefers-reduced-motion: reduce) {
  .gg-agents-blink, .gg-agents-skel, .gg-agents-in { animation: none }
}
`

// React 19 hoists and dedupes <style href precedence>, so both pages can render this.
export function AgentsCss() {
  return (
    <style href="gg-agents" precedence="medium">
      {CSS}
    </style>
  )
}

export function LiveChip({ label = 'LIVE' }: { label?: string }) {
  return (
    <span className="font-pixel flex items-center gap-2 text-[8px] leading-none text-gg-green">
      <span className="gg-agents-blink block size-2 bg-gg-green" />
      {label}
    </span>
  )
}

export function SkeletonBlock({ w, h = 12, delay = 0, className = '' }: { w: number; h?: number; delay?: number; className?: string }) {
  return <span aria-hidden className={`gg-agents-skel ${className}`} style={{ width: w, height: h, animationDelay: `${delay}ms` }} />
}

// Neon accent of a building: the bot's own color for bots, else its catalog accent.
export const accentOf = (b: Pick<Building, 'type' | 'bot'>) => b.bot?.color ?? CATALOG[b.type].accent

// Short type label: the bot's own identity for bots, "CODEX" etc. for agent buildings.
export const typeLabel = (b: Pick<Building, 'type' | 'bot'>) =>
  b.bot ? botLabel(b.bot).toUpperCase() : CATALOG[b.type].short

export function AccentSquare({ color, size = 16, dim = false }: { color: string; size?: number; dim?: boolean }) {
  return (
    <span
      aria-hidden
      className="block shrink-0"
      style={{
        width: size,
        height: size,
        background: dim ? 'var(--gg-grey)' : color,
        boxShadow: `inset -${size / 4}px -${size / 4}px 0 0 rgba(0,0,0,.35)${dim ? '' : `, 0 0 6px color-mix(in srgb, ${color} 50%, transparent)`}`,
      }}
    />
  )
}

// 8x8 pixel building per building type. A = bright accent tip, B = tinted body, W = windows lit by status.
const GLYPH: Record<BuildingType, string[]> = {
  router: ['...AA...', '...BB...', '..BBBB..', '..BWBB..', '..BBWB..', '..BWBB..', '..BBWB..', '..BBBB..'],
  codex: ['.AAAAAA.', '.BBBBBB.', '.BWBBWB.', '.BBBBBB.', '.BWBBWB.', '.BBBBBB.', '.BWBBWB.', '.BBBBBB.'],
  cursor: ['.A......', '.AA.....', '.ABA....', '.ABBA...', '.ABBBA..', '.ABAAA..', '.A.AB...', '...AA...'],
  claude: ['...AA...', '..BBBB..', '..BWWB..', '.BBBBBB.', '.BWBBWB.', 'BBBBBBBB', 'BWBWWBWB', 'BBBBBBBB'],
  deepseek: ['.A......', '.B......', '.B..AAAA', 'BBBBBBBB', 'BWBWBWBB', 'BBBBBBBB', 'BWWBBWWB', 'BBBBBBBB'],
  groq: ['........', '.A.AA.A.', 'AAAAAAAA', 'BWBBWBBB', 'BBBBBBBB', 'BWBBWBBB', 'BBBBBBBB', 'A.BBBB.A'],
  security: ['........', '...AA...', '..BBBB..', 'BBBBBBBB', 'BWWBBWWB', 'BBBBBBBB', 'BWWBBWWB', 'BBBBBBBB'],
  bot: ['...A....', '...B....', '.BBBBBB.', '.BWBBWB.', '.BBBBBB.', '.BBWWBB.', '.BBBBBB.', '..B..B..'],
  library: ['...A....', '...B....', '..BWB...', '.BWBWB..', '.BBBBB..', 'BWBWBWBB', 'BBBBBBBB', 'BWBWWBWB'],
}

export function AgentGlyph({
  id,
  status,
  px = 2,
  type,
}: {
  id: BuildingId
  status: BuildingStatus | 'offline'
  px?: number
  type?: BuildingType
}) {
  const storeType = useGrid((s) => s.buildings[id]?.type)
  const botColor = useGrid((s) => s.buildings[id]?.bot?.color)
  const t = type ?? storeType ?? 'bot'
  const accent = botColor ?? CATALOG[t].accent
  const shadow = useMemo(() => {
    const off = status === 'offline'
    const tip = off ? 'var(--gg-grey)' : accent
    const body = `color-mix(in srgb, ${tip} 40%, var(--gg-night))`
    const lit = off
      ? 'var(--gg-void)'
      : status === 'idle'
        ? 'color-mix(in srgb, var(--gg-cyan) 35%, var(--gg-void))'
        : STATUS_COLOR[status]
    const color: Record<string, string> = { A: tip, B: body, W: lit }
    return GLYPH[t]
      .flatMap((row, y) => [...row].flatMap((c, x) => (color[c] ? [`${x * px}px ${y * px}px 0 0 ${color[c]}`] : [])))
      .join(', ')
  }, [t, accent, status, px])
  return (
    <span aria-hidden className="relative inline-block shrink-0" style={{ width: 8 * px, height: 8 * px }}>
      <span className="absolute top-0 left-0 block" style={{ width: px, height: px, boxShadow: shadow }} />
    </span>
  )
}

export function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

export function ago(ts: number, now: number) {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

// ---------- page ----------

const PANEL = 'border-2 border-gg-haze bg-gg-night shadow-[4px_4px_0_0_rgba(0,0,0,.5)]'
const HEAD = 'font-pixel h-10 px-4 text-[8px] leading-none text-gg-mute'

function Kpi({
  label,
  hits,
  all,
  color,
  icon,
  hint,
  alert = false,
}: {
  label: string
  hits: Building[]
  all: Building[]
  color: string
  icon: ReactNode
  hint: string
  alert?: boolean
}) {
  const on = hits.length > 0
  const tone = on ? color : 'var(--gg-mute)'
  return (
    <div className={`${PANEL} p-4`} style={on && alert ? { borderColor: color } : undefined}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-pixel flex items-center gap-2 text-[8px] leading-none text-gg-mute">
          {on && alert && <span className="gg-agents-blink block size-2" style={{ background: color }} />}
          {label}
        </span>
        <span style={{ color: tone }}>{icon}</span>
      </div>
      <div className="mt-4 flex items-end justify-between gap-4">
        <div className="flex items-baseline gap-2">
          <span className="font-pixel text-[24px] leading-none" style={{ color: tone }}>
            {hits.length}
          </span>
          <span className="text-lg leading-none text-gg-mute">/ {all.length}</span>
        </div>
        <div className="flex flex-wrap justify-end gap-1" aria-hidden>
          {all.map((b) => {
            const hit = hits.includes(b)
            return (
              <span
                key={b.id}
                title={b.short}
                className="block size-3 border-2"
                style={{
                  borderColor: hit ? color : 'var(--gg-haze)',
                  background: hit ? color : 'transparent',
                  boxShadow: hit ? `0 0 6px color-mix(in srgb, ${color} 50%, transparent)` : undefined,
                }}
              />
            )
          })}
        </div>
      </div>
      <p className="mt-3 truncate text-base text-gg-mute" style={on && alert ? { color } : undefined}>
        {hint}
      </p>
    </div>
  )
}

export function AgentsPage() {
  const navigate = useNavigate()
  const buildings = useAgentBuildingList()
  const logs = useGrid((s) => s.logs)
  const keys = useKeys((s) => s.keys)
  const buildingConfig = useKeys((s) => s.buildingConfig)
  const [summaries, setSummaries] = useState<Record<BuildingId, AgentSummary>>({})
  const now = useNow(5000)

  useEffect(() => {
    let alive = true
    api.listAgents().then((list) => {
      if (alive) setSummaries(Object.fromEntries(list.map((a) => [a.id, a])))
    })
    // Seed the city logs when the dashboard is the first page opened (same guard as CityPage).
    if (useGrid.getState().logs.length === 0) void useGrid.getState().loadInitialLogs()
    return () => {
      alive = false
    }
  }, [])

  const lastLogTs = useMemo(() => {
    const out: Record<BuildingId, number> = {}
    for (const l of logs) out[l.buildingId] = Math.max(out[l.buildingId] ?? 0, l.ts)
    return out
  }, [logs])

  const rows = buildings.map((b) => {
    const key = resolveBuildingKey({ keys, buildingConfig }, b.id)
    const status: BuildingStatus | 'offline' = !key && b.status === 'idle' ? 'offline' : b.status
    return { b, key, status }
  })

  const online = rows.filter((r) => r.key).map((r) => r.b)
  const working = rows.filter((r) => r.status === 'working').map((r) => r.b)
  const approval = rows.filter((r) => r.status === 'needs_approval').map((r) => r.b)
  const shorts = (list: Building[]) => list.map((b) => b.short).join(' + ')

  const open = (id: BuildingId) => navigate(`/dashboard/agents/${id}`)

  return (
    <>
      <AgentsCss />
      <PageHeader
        title="Agents"
        description="Every building in your city is an agent, including the bots you build."
        actions={<LiveChip label="LIVE · SYNCED WITH CITY" />}
      />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Kpi
          label="AGENTS ONLINE"
          hits={online}
          all={buildings}
          color="var(--gg-green)"
          icon={<Plug size={16} strokeWidth={2.5} />}
          hint={
            online.length === buildings.length
              ? 'Every building has a key.'
              : online.length === 0
                ? 'No keys yet. The city is dark.'
                : `${shorts(buildings.filter((b) => !online.includes(b)))} dark: no key.`
          }
        />
        <Kpi
          label="WORKING NOW"
          hits={working}
          all={buildings}
          color="var(--gg-green)"
          icon={<Activity size={16} strokeWidth={2.5} />}
          hint={working.length ? `${shorts(working)} on the job.` : 'All quiet. Send a command from the city.'}
        />
        <Kpi
          label="NEEDS APPROVAL"
          hits={approval}
          all={buildings}
          color="var(--gg-yellow)"
          icon={<ShieldAlert size={16} strokeWidth={2.5} />}
          hint={approval.length ? `${shorts(approval)} is waiting for a human.` : 'Nothing is waiting for you.'}
          alert
        />
      </div>

      <div className={PANEL}>
        <Table className="gg-agents-table text-lg">
          <TableHeader className="[&_tr]:border-b-2 [&_tr]:border-gg-haze">
            <TableRow className="hover:bg-transparent">
              <TableHead className={HEAD}>NAME</TableHead>
              <TableHead className={HEAD}>TYPE</TableHead>
              <TableHead className={HEAD}>MODEL</TableHead>
              <TableHead className={HEAD}>PROVIDER / KEY</TableHead>
              <TableHead className={HEAD}>STATUS</TableHead>
              <TableHead className={`${HEAD} text-right`}>SESSIONS</TableHead>
              <TableHead className={HEAD}>LAST ACTIVITY</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ b, key, status }) => {
              const accent = accentOf(b)
              const model = buildingConfig[b.id]?.model ?? summaries[b.id]?.model ?? b.model
              const running = b.sessions.filter((x) => x.status === 'running').length
              const ts = lastLogTs[b.id] ?? summaries[b.id]?.lastActivity ?? b.builtAt
              const fresh = now - ts < 60_000
              return (
                <TableRow
                  key={b.id}
                  tabIndex={0}
                  title={`Open ${b.name}`}
                  onClick={() => open(b.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') open(b.id)
                  }}
                  className="group cursor-pointer border-b-2 border-gg-haze outline-none hover:bg-gg-dusk/60 focus-visible:bg-gg-dusk/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gg-cyan focus-visible:outline-solid"
                >
                  <TableCell className="relative px-4 py-3">
                    <span className="absolute inset-y-0 left-0 w-1 bg-gg-pink opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
                    <div className="flex items-center gap-3">
                      <AccentSquare color={accent} dim={status === 'offline'} />
                      <div className="min-w-0 leading-none">
                        <div className="max-w-[220px] truncate text-xl text-gg-ink group-hover:text-gg-pink">{b.name}</div>
                        <div className="mt-1 text-base text-gg-mute">{b.id}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell data-label="TYPE" className="px-4">
                    <span className="font-pixel text-[8px] leading-none whitespace-nowrap" style={{ color: accent }}>
                      {typeLabel(b)}
                    </span>
                  </TableCell>
                  <TableCell data-label="MODEL" className="px-4 text-gg-ink">{model}</TableCell>
                  <TableCell data-label="PROVIDER" className="px-4 leading-none">
                    {key ? (
                      <>
                        <div className="text-gg-ink">{PROVIDERS[key.provider].label}</div>
                        <div className="mt-1 text-base whitespace-nowrap text-gg-mute">
                          {key.name} · {maskKey(key.key)}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-gg-grey">No key</div>
                        <div className="mt-1 text-base whitespace-nowrap text-gg-mute">
                          wants {PROVIDERS[CATALOG[b.type].provider].label}
                        </div>
                      </>
                    )}
                  </TableCell>
                  <TableCell data-label="STATUS" className="px-4">
                    <StatusBadge status={status} />
                  </TableCell>
                  <TableCell data-label="SESSIONS" className="px-4 text-right whitespace-nowrap">
                    <span className={running ? 'text-gg-green' : 'text-gg-mute'}>{running}</span>
                    <span className="text-gg-mute"> / {b.sessions.length}</span>
                  </TableCell>
                  <TableCell data-label="LAST ACTIVITY" className={`px-4 whitespace-nowrap ${fresh ? 'text-gg-green' : 'text-gg-mute'}`}>
                    <span title={new Date(ts).toLocaleString('en-US')}>{ago(ts, now)}</span>
                  </TableCell>
                  <TableCell className="w-8 pr-4">
                    <ChevronRight size={16} strokeWidth={2.5} className="text-gg-haze group-hover:text-gg-pink group-focus-visible:text-gg-cyan" />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      <p className="mt-3 text-base text-gg-mute">
        Status, key, model and sessions update live from the city. Sessions show running / total. Click a row to open an agent.
      </p>
    </>
  )
}
