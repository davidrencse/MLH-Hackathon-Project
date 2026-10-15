// Agent detail for any building in the city (default buildings and player-built bots):
// key + model config, live logs, sessions, bot config (bots only) and the agent's recent API requests.
import { useEffect, useRef, useState } from 'react'
import type { ReactNode, SelectHTMLAttributes } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, ChevronDown, MapPin, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { StatusBadge } from '@/components/StatusBadge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { BOT_KINDS, PROVIDERS, botLabel } from '@/constants'
import { useBuildingLogs, useGrid } from '@/store/grid'
import { maskKey, resolveBuildingKey, useKeys } from '@/store/keys'
import type { BotConfig, Building, BuildingConfig, BuildingId, HttpMethod, LogLevel, Provider, RequestLog, Session } from '@/types'
import { AccentSquare, AgentGlyph, AgentsCss, LiveChip, SkeletonBlock, accentOf, ago, typeLabel, useNow } from './AgentsPage'

const SHADOW = 'shadow-[4px_4px_0_0_rgba(0,0,0,.5)]'
const FOCUS = 'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gg-cyan'
const HEAD = 'font-pixel h-10 px-4 text-[8px] leading-none text-gg-mute'

const clock = (ts: number) => new Date(ts).toLocaleTimeString('en-US', { hour12: false })

export function AgentDetailPage() {
  const { agentId } = useParams()
  // hasOwn: ids like "constructor" must not resolve to Object.prototype members.
  const b = useGrid((s) => (agentId && Object.hasOwn(s.buildings, agentId) ? s.buildings[agentId] : undefined))
  if (!b) return <NotFound agentId={agentId} />
  return <AgentDetail key={b.id} b={b} />
}

// ---------- layout pieces ----------

function BackLink() {
  return (
    <Link
      to="/dashboard/agents"
      className={`font-pixel inline-flex items-center gap-2 text-[8px] leading-none text-gg-mute hover:text-gg-cyan ${FOCUS}`}
    >
      <ArrowLeft size={16} strokeWidth={2.5} />
      AGENTS
    </Link>
  )
}

function NotFound({ agentId }: { agentId?: string }) {
  return (
    <div className={`mx-auto mt-16 max-w-lg border-2 border-gg-haze bg-gg-night p-8 text-center ${SHADOW}`}>
      <p className="font-pixel text-[24px] leading-none text-gg-pink">404</p>
      <h1 className="font-pixel mt-6 text-[12px] leading-none text-gg-ink">Agent not found</h1>
      <p className="mt-4 text-lg text-gg-mute">No building called "{agentId}" stands in this city.</p>
      <Link
        to="/dashboard/agents"
        className={`font-pixel mt-6 inline-flex h-10 items-center gap-2 border-2 border-gg-cyan px-4 text-[10px] leading-none text-gg-cyan hover:bg-gg-cyan hover:text-gg-void ${FOCUS}`}
      >
        <ArrowLeft size={16} strokeWidth={2.5} />
        Back to agents
      </Link>
    </div>
  )
}

function PixelButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`font-pixel inline-flex h-10 cursor-pointer items-center gap-2 border-2 border-gg-cyan bg-gg-void px-4 text-[10px] leading-none text-gg-cyan ${SHADOW} hover:bg-gg-cyan hover:text-gg-void active:translate-x-0.5 active:translate-y-0.5 active:shadow-[2px_2px_0_0_rgba(0,0,0,.5)] ${FOCUS}`}
    >
      {children}
    </button>
  )
}

function Panel({ title, right, children, bodyClass = 'p-4' }: { title: string; right?: ReactNode; children: ReactNode; bodyClass?: string }) {
  return (
    <section className={`flex min-w-0 flex-col border-2 border-gg-haze bg-gg-night ${SHADOW}`}>
      <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b-2 border-gg-haze px-4">
        <h2 className="font-pixel text-[10px] leading-none text-gg-ink">{title}</h2>
        {right}
      </header>
      <div className={`flex-1 ${bodyClass}`}>{children}</div>
    </section>
  )
}

function PixelSelect({ label, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return (
    <label className="block">
      <span className="font-pixel mb-2 block text-[8px] leading-none text-gg-mute">{label}</span>
      <span className="relative block">
        <select
          {...props}
          className="h-10 w-full cursor-pointer appearance-none border-2 border-gg-haze bg-gg-void pr-10 pl-3 text-lg text-gg-ink outline-none hover:border-gg-pink focus-visible:border-gg-cyan disabled:cursor-not-allowed disabled:opacity-50 [&_optgroup]:bg-gg-night [&_option]:bg-gg-night"
        >
          {children}
        </select>
        <ChevronDown size={16} strokeWidth={2.5} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-gg-cyan" />
      </span>
    </label>
  )
}

// ---------- page ----------

function AgentDetail({ b }: { b: Building }) {
  const navigate = useNavigate()
  const hasKey = useKeys((s) => resolveBuildingKey(s, b.id) !== null)
  const status = !hasKey && b.status === 'idle' ? 'offline' : b.status

  // Seed the city logs when the dashboard is the first page opened (same guard as CityPage).
  useEffect(() => {
    if (useGrid.getState().logs.length === 0) void useGrid.getState().loadInitialLogs()
  }, [])

  const viewInCity = () => {
    navigate('/')
    useGrid.getState().selectBuilding(b.id)
  }

  return (
    <>
      <AgentsCss />
      <BackLink />
      <div className="mt-4 mb-6 flex flex-wrap items-end justify-between gap-4 border-b-2 border-gg-haze pb-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className={`border-2 border-gg-haze bg-gg-void p-2 ${SHADOW}`}>
            <AgentGlyph id={b.id} type={b.type} status={status} px={4} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-pixel text-base leading-none text-gg-ink">{b.name}</h1>
              <StatusBadge status={status} />
            </div>
            <p className="mt-2 text-lg text-gg-mute">
              <span className="font-pixel text-[8px] leading-none" style={{ color: accentOf(b) }}>
                {typeLabel(b)}
              </span>{' '}
              · {b.role}
            </p>
          </div>
        </div>
        <PixelButton onClick={viewInCity}>
          <MapPin size={16} strokeWidth={2.5} />
          View in city
        </PixelButton>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <ConfigCard id={b.id} name={b.name} defaultModel={b.model} />
        <LogsCard id={b.id} />
      </div>
      <div className={`mt-6 grid gap-6 ${b.bot ? 'lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]' : ''}`}>
        <SessionsCard sessions={b.sessions} />
        {b.bot && <BotCard bot={b.bot} />}
      </div>
      <div className="mt-6">
        <RequestsCard id={b.id} />
      </div>
    </>
  )
}

// ---------- (1) config ----------

function ConfigCard({ id, name, defaultModel }: { id: BuildingId; name: string; defaultModel: string }) {
  const keys = useKeys((s) => s.keys)
  const keyId = useKeys((s) => s.buildingConfig[id]?.keyId ?? null)
  const model = useKeys((s) => s.buildingConfig[id]?.model ?? defaultModel)
  const resolved = useKeys((s) => resolveBuildingKey(s, id))

  const save = (patch: Partial<BuildingConfig>, message: string) => {
    useKeys.getState().setBuildingConfig(id, patch)
    toast.success(message)
  }

  const onKey = (value: string) => {
    const next = keys.find((k) => k.id === value) ?? keys[0] ?? null
    const patch: Partial<BuildingConfig> = { keyId: value || null }
    const models = next ? PROVIDERS[next.provider].models : null
    // Switching provider: move to a model that provider actually serves.
    if (models && !models.includes(model)) patch.model = models[0]
    save(patch, `${name} now uses ${next ? next.name : 'the default key'}${patch.model ? ` · ${patch.model}` : ''}`)
  }

  const models = resolved ? PROVIDERS[resolved.provider].models : null
  const extraModel = models && !models.includes(model) ? model : null

  return (
    <Panel title="CONFIG" right={<span className="font-pixel text-[8px] leading-none text-gg-mute">SAVED IN THIS BROWSER</span>}>
      {keys.length === 0 && (
        <div className="mb-4 flex gap-3 border-2 border-gg-yellow p-3 text-lg leading-tight text-gg-ink" style={{ background: 'color-mix(in srgb, var(--gg-yellow) 10%, transparent)' }}>
          <TriangleAlert size={16} strokeWidth={2.5} className="mt-0.5 shrink-0 text-gg-yellow" />
          <p>
            No provider key yet. This building stays dark in the city until you add one.{' '}
            <Link to="/dashboard/keys" className={`text-gg-cyan underline underline-offset-4 hover:text-gg-pink ${FOCUS}`}>
              Add a key
            </Link>
          </p>
        </div>
      )}

      <div className="flex flex-col gap-4">
        <PixelSelect label="PROVIDER KEY" value={keyId ?? ''} disabled={keys.length === 0} onChange={(e) => onKey(e.target.value)}>
          <option value="">{keys.length ? `Default · ${keys[0].name}` : 'No keys yet'}</option>
          {keys.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name} · {PROVIDERS[k.provider].label} · {maskKey(k.key)}
            </option>
          ))}
        </PixelSelect>

        <PixelSelect label="MODEL" value={model} onChange={(e) => save({ model: e.target.value }, `${name} now runs ${e.target.value}`)}>
          {models ? (
            <>
              {extraModel && <option value={extraModel}>{extraModel} (current)</option>}
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </>
          ) : (
            (Object.keys(PROVIDERS) as Provider[]).map((p) => (
              <optgroup key={p} label={PROVIDERS[p].label}>
                {PROVIDERS[p].models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </optgroup>
            ))
          )}
        </PixelSelect>

        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 border-t-2 border-gg-haze pt-4 text-lg leading-tight">
          <dt className="font-pixel pt-1 text-[8px] text-gg-mute">PROVIDER</dt>
          <dd className={resolved ? 'text-gg-ink' : 'text-gg-grey'}>{resolved ? PROVIDERS[resolved.provider].label : 'None'}</dd>
          <dt className="font-pixel pt-1 text-[8px] text-gg-mute">ENDPOINT</dt>
          <dd className={`truncate ${resolved ? 'text-gg-cyan' : 'text-gg-grey'}`} title={resolved?.baseUrl}>
            {resolved?.baseUrl || '—'}
          </dd>
          <dt className="font-pixel pt-1 text-[8px] text-gg-mute">KEY</dt>
          <dd className={resolved ? 'text-gg-ink' : 'text-gg-grey'}>
            {resolved ? (
              <>
                {maskKey(resolved.key)}
                {!keyId && <span className="text-gg-mute"> (default)</span>}
              </>
            ) : (
              'No key: offline'
            )}
          </dd>
        </dl>
      </div>
    </Panel>
  )
}

// ---------- (2) live logs ----------

const LEVEL: Record<LogLevel, { tag: string; tagColor: string; textColor: string }> = {
  info: { tag: 'INFO', tagColor: 'var(--gg-cyan)', textColor: 'var(--gg-ink)' },
  ok: { tag: 'OK', tagColor: 'var(--gg-green)', textColor: 'var(--gg-green)' },
  warn: { tag: 'WARN', tagColor: 'var(--gg-yellow)', textColor: 'var(--gg-yellow)' },
  error: { tag: 'ERR', tagColor: 'var(--gg-red)', textColor: 'var(--gg-red)' },
}

function LogsCard({ id }: { id: BuildingId }) {
  const logs = useBuildingLogs(id, 20)
  const ref = useRef<HTMLOListElement>(null)

  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs])

  return (
    <Panel title="LIVE LOGS" right={<LiveChip label={`LIVE · LAST ${logs.length}`} />} bodyClass="relative min-h-80">
      <ol ref={ref} role="log" className="absolute inset-0 overflow-y-auto bg-gg-void px-4 py-3 text-lg leading-6">
        {logs.length === 0 && <li className="text-gg-mute">No activity yet. Send a command from the city.</li>}
        {logs.map((l) => (
          <li key={l.id} className="gg-agents-in flex gap-3">
            <time className="shrink-0 text-gg-mute" dateTime={new Date(l.ts).toISOString()}>
              {clock(l.ts)}
            </time>
            <span className="w-10 shrink-0" style={{ color: LEVEL[l.level].tagColor }}>
              {LEVEL[l.level].tag}
            </span>
            <span className="min-w-0 break-words" style={{ color: LEVEL[l.level].textColor }}>
              {l.text}
            </span>
          </li>
        ))}
        <li aria-hidden className="flex items-center gap-2 text-gg-green">
          &gt;
          <span className="gg-agents-blink inline-block h-4 w-2.5 bg-gg-green" />
        </li>
      </ol>
    </Panel>
  )
}

// ---------- (3) sessions ----------

const SESSION_TONE: Record<Session['status'], { label: string; color: string }> = {
  running: { label: 'RUNNING', color: 'var(--gg-green)' },
  queued: { label: 'QUEUED', color: 'var(--gg-mute)' },
  done: { label: 'DONE', color: 'var(--gg-cyan)' },
  error: { label: 'ERROR', color: 'var(--gg-red)' },
}

function SessionsCard({ sessions }: { sessions: Session[] }) {
  const now = useNow(10_000)
  const running = sessions.filter((s) => s.status === 'running').length
  return (
    <Panel
      title="SESSIONS"
      bodyClass="p-0"
      right={
        <span className="font-pixel text-[8px] leading-none text-gg-mute">
          <span className={running ? 'text-gg-green' : ''}>{running} RUNNING</span> / {sessions.length} TOTAL
        </span>
      }
    >
      {sessions.length === 0 ? (
        <p className="px-4 py-8 text-center text-lg text-gg-mute">No sessions yet. Send a command from the city.</p>
      ) : (
        <ul>
          {sessions.map((s) => {
            const tone = SESSION_TONE[s.status]
            return (
              <li key={s.id} className="flex items-center gap-4 border-b-2 border-gg-haze px-4 py-3 last:border-b-0">
                <span
                  aria-hidden
                  className={`block size-2 shrink-0 ${s.status === 'running' ? 'gg-agents-blink' : ''}`}
                  style={{ background: tone.color }}
                />
                <div className="min-w-0 flex-1 leading-none">
                  <div className="truncate text-xl text-gg-ink">{s.title}</div>
                  <div className="mt-1 truncate text-base text-gg-mute">
                    {s.branch ? <span className="text-gg-cyan">{s.branch}</span> : s.id} · started {ago(s.startedAt, now)}
                  </div>
                </div>
                <div className="shrink-0 text-right leading-none">
                  <div className="font-pixel text-[8px] leading-none" style={{ color: tone.color }}>
                    {tone.label}
                  </div>
                  <div className="mt-2 text-base text-gg-mute">{s.tokens.toLocaleString('en-US')} tok</div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

// ---------- (4) bot config (bots only) ----------

function BotCard({ bot }: { bot: BotConfig }) {
  const kind = BOT_KINDS[bot.kind]
  return (
    <Panel
      title="BOT CONFIG"
      right={
        <span className="font-pixel text-[8px] leading-none" style={{ color: bot.color }}>
          {botLabel(bot).toUpperCase()}
        </span>
      }
    >
      <p className="text-lg leading-tight text-gg-mute">{kind.description}</p>
      <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 border-t-2 border-gg-haze pt-4 text-lg leading-tight">
        <dt className="font-pixel pt-1 text-[8px] text-gg-mute">ENDPOINT</dt>
        <dd className={`truncate ${bot.endpoint ? 'text-gg-cyan' : 'text-gg-grey'}`} title={bot.endpoint || undefined}>
          {bot.endpoint || 'Not set'}
        </dd>
        <dt className="font-pixel pt-1 text-[8px] text-gg-mute">SCHEDULE</dt>
        <dd className={bot.schedule ? 'text-gg-ink' : 'text-gg-grey'}>{bot.schedule || 'Not set'}</dd>
        <dt className="font-pixel pt-1 text-[8px] text-gg-mute">COLOR</dt>
        <dd className="flex items-center gap-2 text-gg-ink">
          <AccentSquare color={bot.color} size={12} />
          {bot.color}
        </dd>
        <dt className="font-pixel pt-1 text-[8px] text-gg-mute">NOTES</dt>
        <dd className={`break-words ${bot.notes ? 'text-gg-ink' : 'text-gg-grey'}`}>{bot.notes || 'None'}</dd>
      </dl>
    </Panel>
  )
}

// ---------- (5) recent requests ----------

const METHOD_COLOR: Record<HttpMethod, string> = {
  GET: 'var(--gg-cyan)',
  POST: 'var(--gg-pink)',
  DELETE: 'var(--gg-red)',
}

function statusColor(code: number) {
  if (code >= 500) return 'var(--gg-red)'
  if (code >= 400) return 'var(--gg-yellow)'
  return 'var(--gg-green)'
}

function RequestsCard({ id }: { id: BuildingId }) {
  const [rows, setRows] = useState<RequestLog[] | null>(null)
  // Refetch whenever this building logs something new in the city, plus a slow poll.
  const latestLog = useGrid((s) => {
    for (let i = s.logs.length - 1; i >= 0; i--) if (s.logs[i].buildingId === id) return s.logs[i].id
    return null
  })

  useEffect(() => {
    let alive = true
    const load = () =>
      api
        .listRequests({ agentId: id })
        .then((r) => {
          if (alive) setRows(r.slice(0, 10))
        })
        // A read the backend refused is not an empty request log; the panel stays on its
        // loading state rather than claiming this building has made no calls.
        .catch(() => undefined)
    void load()
    const t = setInterval(load, 5000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [id, latestLog])

  return (
    <Panel
      title="RECENT REQUESTS"
      bodyClass="p-0"
      right={
        <Link to="/dashboard/activity" className={`font-pixel inline-flex items-center gap-2 text-[8px] leading-none text-gg-cyan hover:text-gg-pink ${FOCUS}`}>
          ALL ACTIVITY
          <ArrowRight size={16} strokeWidth={2.5} />
        </Link>
      }
    >
      <Table className="text-lg">
        <TableHeader className="[&_tr]:border-b-2 [&_tr]:border-gg-haze">
          <TableRow className="hover:bg-transparent">
            <TableHead className={HEAD}>TIME</TableHead>
            <TableHead className={HEAD}>METHOD</TableHead>
            <TableHead className={HEAD}>PATH</TableHead>
            <TableHead className={HEAD}>STATUS</TableHead>
            <TableHead className={`${HEAD} text-right`}>LATENCY</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody aria-busy={!rows}>
          {!rows ? (
            [0, 1, 2, 3, 4].map((i) => (
              <TableRow key={i} className="border-b-2 border-gg-haze hover:bg-transparent">
                <TableCell className="px-4 py-3"><SkeletonBlock w={64} delay={i * 80} /></TableCell>
                <TableCell className="px-4"><SkeletonBlock w={32} h={8} delay={i * 80} /></TableCell>
                <TableCell className="px-4"><SkeletonBlock w={160} delay={i * 80} /></TableCell>
                <TableCell className="px-4"><SkeletonBlock w={40} delay={i * 80} /></TableCell>
                <TableCell className="px-4"><SkeletonBlock w={56} delay={i * 80} className="ml-auto" /></TableCell>
              </TableRow>
            ))
          ) : rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={5} className="px-4 py-8 text-center text-gg-mute">
                No requests yet.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => (
              <TableRow key={r.id} className="gg-agents-in border-b-2 border-gg-haze hover:bg-gg-dusk/60">
                <TableCell className="px-4 py-2 text-gg-mute">
                  <span title={new Date(r.ts).toLocaleString('en-US')}>{clock(r.ts)}</span>
                </TableCell>
                <TableCell className="px-4">
                  <span className="font-pixel text-[8px] leading-none" style={{ color: METHOD_COLOR[r.method] }}>
                    {r.method}
                  </span>
                </TableCell>
                <TableCell className="px-4 text-gg-ink">{r.path}</TableCell>
                <TableCell className="px-4">
                  <span className="inline-flex items-center gap-2" style={{ color: statusColor(r.status) }}>
                    <span className="block size-2 bg-current" />
                    {r.status}
                  </span>
                </TableCell>
                <TableCell className="px-4 text-right" style={{ color: r.latencyMs > 2000 ? 'var(--gg-yellow)' : 'var(--gg-ink)' }}>
                  {r.latencyMs.toLocaleString('en-US')}
                  <span className="text-gg-mute"> ms</span>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Panel>
  )
}
