// Request Logs: every call the agents made, newest first. Polls every 3s while LIVE is on,
// so actions in the city (commands, approvals, playground runs) appear here.
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Check, ChevronLeft, ChevronRight, Copy, RefreshCw, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { BUILDINGS } from '@/constants'
import { PageHeader } from '@/console/PageHeader'
import type { BuildingId, HttpMethod, RequestLog } from '@/types'
import './RequestLogsPage.css'

type AgentFilter = BuildingId | 'all'
type StatusFilter = 'all' | '2xx' | '4xx' | '5xx'

const PAGE_SIZE = 25
const POLL_MS = 3000
const COLS = 7
const ICON = { size: 16, strokeWidth: 2.5 } as const

const AGENT_OPTIONS: { value: AgentFilter; label: string }[] = [
  { value: 'all', label: 'ALL' },
  { value: 'codex', label: BUILDINGS.codex.short },
  { value: 'security', label: BUILDINGS.security.short },
]

const STATUS_OPTIONS: { value: StatusFilter; label: string; color: string }[] = [
  { value: 'all', label: 'ALL', color: 'var(--gg-pink)' },
  { value: '2xx', label: '2XX', color: 'var(--gg-green)' },
  { value: '4xx', label: '4XX', color: 'var(--gg-yellow)' },
  { value: '5xx', label: '5XX', color: 'var(--gg-red)' },
]

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
}

const METHOD_STYLE: Record<HttpMethod, string> = {
  GET: 'border-gg-cyan text-gg-cyan',
  POST: 'border-gg-haze bg-gg-dusk text-gg-ink',
  DELETE: 'border-gg-red text-gg-red',
}

// ---------- formatting ----------

const statusColor = (s: number) => (s >= 500 ? 'var(--gg-red)' : s >= 400 ? 'var(--gg-yellow)' : 'var(--gg-green)')
const latencyClass = (ms: number) => (ms > 2000 ? 'text-gg-red' : ms > 1000 ? 'text-gg-yellow' : 'text-gg-ink')
const num = (n: number) => n.toLocaleString('en-US')
const pad = (n: number) => String(n).padStart(2, '0')
const hms = (ts: number) => {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
const fullDate = (ts: number) =>
  new Date(ts).toLocaleString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
const toJson = (v: unknown) => JSON.stringify(v, null, 2) ?? 'null'

// ---------- tiny JSON highlighter ----------
// Groups: 1 string, 2 trailing colon (string is a key), 3 literal, 4 number.
const JSON_TOKEN = /("(?:\\u[0-9a-fA-F]{4}|\\[^u]|[^\\"])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g

function highlightJson(src: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let k = 0
  for (const m of src.matchAll(JSON_TOKEN)) {
    const at = m.index
    if (at > last) out.push(src.slice(last, at))
    const [whole, str, colon, lit, n] = m
    if (str !== undefined && colon !== undefined) {
      out.push(<span key={k++} className="text-gg-cyan">{str}</span>, colon)
    } else if (str !== undefined) {
      out.push(<span key={k++} className="text-gg-green">{str}</span>)
    } else if (lit !== undefined) {
      out.push(<span key={k++} className="text-gg-pink">{lit}</span>)
    } else if (n !== undefined) {
      out.push(<span key={k++} className="text-gg-yellow">{n}</span>)
    }
    last = at + whole.length
  }
  if (last < src.length) out.push(src.slice(last))
  return out
}

// Marks the first case-insensitive match of the search query.
function Hit({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-gg-pink/25 text-gg-pink">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  )
}

// ---------- page ----------

export function RequestLogsPage() {
  const [agent, setAgent] = useState<AgentFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [live, setLive] = useState(true)
  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [rows, setRows] = useState<RequestLog[] | null>(null)
  const [freshIds, setFreshIds] = useState<Set<string>>(() => new Set())
  const [syncedAt, setSyncedAt] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  const [tick, setTick] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const seenRef = useRef<{ key: string; ids: Set<string> } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Debounce the search box (200ms).
  useEffect(() => {
    const next = qInput.trim()
    const t = setTimeout(() => {
      setQ(next)
      setPage(0)
    }, 200)
    return () => clearTimeout(t)
  }, [qInput])

  // Fetch now, then every 3s while LIVE. A stale response from old filters is dropped.
  useEffect(() => {
    let cancelled = false
    let loading = false
    const key = `${agent}|${status}|${q}`
    const load = async () => {
      if (cancelled || loading) return
      loading = true
      try {
        const res = await api.listRequests({ agentId: agent, status, q: q || undefined })
        if (cancelled) return
        const sorted = [...res].sort((a, b) => b.ts - a.ts)
        const prev = seenRef.current?.key === key ? seenRef.current.ids : null
        const fresh = prev ? sorted.filter((r) => !prev.has(r.id)).map((r) => r.id) : []
        seenRef.current = { key, ids: new Set(sorted.map((r) => r.id)) }
        setFreshIds((old) => (fresh.length === 0 && old.size === 0 ? old : new Set(fresh)))
        setRows(sorted)
        setSyncedAt(Date.now())
        setFailed(false)
      } catch {
        if (!cancelled) setFailed(true)
      } finally {
        loading = false
        if (!cancelled) setRefreshing(false)
      }
    }
    void load()
    const onVisibility = () => {
      if (live && !document.hidden) void load()
    }
    const iv = live ? setInterval(() => {
      if (!document.hidden) void load()
    }, POLL_MS) : undefined
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      clearInterval(iv)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [agent, status, q, live, tick])

  // "/" focuses search (when not already typing somewhere).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      e.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const total = rows?.length ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const start = safePage * PAGE_SIZE
  const pageRows = useMemo(() => (rows ?? []).slice(start, start + PAGE_SIZE), [rows, start])
  const filtered = agent !== 'all' || status !== 'all' || q !== ''

  const pickAgent = (v: AgentFilter) => {
    setAgent(v)
    setPage(0)
  }
  const pickStatus = (v: StatusFilter) => {
    setStatus(v)
    setPage(0)
  }
  const clearFilters = () => {
    setAgent('all')
    setStatus('all')
    setQInput('')
    setQ('')
    setPage(0)
  }
  const refresh = () => {
    setRefreshing(true)
    setTick((t) => t + 1)
  }
  const toggle = (id: string) => setExpanded((cur) => (cur === id ? null : id))

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Request Logs"
        description="Every call your agents made. Click a row for the full request and response."
        actions={
          <button
            type="button"
            onClick={refresh}
            className="gg-logs-focus gg-logs-btn font-pixel flex h-9 items-center gap-2 border-2 border-gg-haze bg-gg-night px-3 text-[8px] text-gg-ink hover:border-gg-cyan hover:text-gg-cyan"
          >
            <RefreshCw {...ICON} className={refreshing ? 'gg-logs-spin' : undefined} />
            REFRESH
          </button>
        }
      />

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-end gap-x-6 gap-y-4">
        <FilterGroup label="AGENT">
          <Segmented label="Filter by agent" value={agent} options={AGENT_OPTIONS} onChange={pickAgent} />
        </FilterGroup>
        <FilterGroup label="STATUS">
          <Segmented label="Filter by status" value={status} options={STATUS_OPTIONS} onChange={pickStatus} />
        </FilterGroup>
        <FilterGroup label="SEARCH" className="min-w-60 flex-1">
          <div className="flex h-9 items-center gap-2 border-2 border-gg-haze bg-gg-void px-2 focus-within:border-gg-cyan">
            <Search {...ICON} className="shrink-0 text-gg-mute" />
            <input
              ref={searchRef}
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQInput('')
              }}
              placeholder="Search path or request id"
              aria-label="Search path or request id"
              spellCheck={false}
              className="h-full min-w-0 flex-1 bg-transparent text-lg text-gg-ink outline-none placeholder:text-gg-mute"
            />
            {qInput ? (
              <button
                type="button"
                onClick={() => {
                  setQInput('')
                  searchRef.current?.focus()
                }}
                aria-label="Clear search"
                className="gg-logs-focus text-gg-mute hover:text-gg-pink"
              >
                <X {...ICON} />
              </button>
            ) : (
              <kbd className="font-pixel border-2 border-gg-haze px-1 py-0.5 text-[8px] leading-none text-gg-mute">/</kbd>
            )}
          </div>
        </FilterGroup>
        <FilterGroup label="STREAM">
          <div className="flex h-9 items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={live}
              aria-label="Live updates every 3 seconds"
              onClick={() => setLive((v) => !v)}
              className="gg-logs-focus font-pixel flex h-9 items-center gap-2 border-2 px-3 text-[8px]"
              style={
                live
                  ? {
                      color: 'var(--gg-green)',
                      borderColor: 'var(--gg-green)',
                      background: 'color-mix(in srgb, var(--gg-green) 12%, transparent)',
                      boxShadow: '0 0 8px rgba(57, 255, 20, 0.35)',
                    }
                  : { color: 'var(--gg-mute)', borderColor: 'var(--gg-haze)' }
              }
            >
              <span
                className={`inline-block size-2 ${live ? 'gg-logs-live-dot' : ''}`}
                style={{ background: live ? 'var(--gg-green)' : 'var(--gg-grey)' }}
              />
              LIVE
            </button>
            <span className="whitespace-nowrap text-base text-gg-mute" aria-live="polite">
              {failed ? (
                <span className="text-gg-red">sync failed · retrying</span>
              ) : !live ? (
                'paused'
              ) : syncedAt ? (
                `synced ${hms(syncedAt)}`
              ) : (
                'connecting…'
              )}
            </span>
            {freshIds.size > 0 && (
              <span className="font-pixel border-2 border-gg-pink px-1 py-0.5 text-[8px] leading-none text-gg-pink">
                +{freshIds.size} NEW
              </span>
            )}
          </div>
        </FilterGroup>
      </div>

      {/* Table */}
      <div className="border-2 border-gg-haze bg-gg-night shadow-[4px_4px_0_0_rgba(0,0,0,.5)]">
        <Table className="text-lg">
          <TableHeader className="bg-gg-void/60 [&_tr]:border-b-2 [&_tr]:border-gg-haze">
            <TableRow className="hover:bg-transparent">
              <Th className="pl-4">TIME</Th>
              <Th>AGENT</Th>
              <Th>METHOD</Th>
              <Th>PATH</Th>
              <Th>STATUS</Th>
              <Th className="text-right">LATENCY</Th>
              <Th className="pr-4 text-right">TOKENS</Th>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows === null ? (
              <SkeletonRows />
            ) : pageRows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={COLS} className="whitespace-normal">
                  <EmptyState filtered={filtered} onClear={clearFilters} />
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((log) => {
                const open = expanded === log.id
                const detailId = `gg-logs-detail-${log.id}`
                return (
                  <Fragment key={log.id}>
                    <TableRow
                      tabIndex={0}
                      aria-expanded={open}
                      aria-controls={open ? detailId : undefined}
                      onClick={() => toggle(log.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          toggle(log.id)
                        }
                      }}
                      className={`gg-logs-focus group cursor-pointer border-b-2 border-gg-haze/50 ${
                        open ? 'bg-gg-dusk hover:bg-gg-dusk' : 'hover:bg-gg-dusk/50'
                      } ${freshIds.has(log.id) ? 'gg-logs-fresh' : ''}`}
                    >
                      <TableCell
                        title={fullDate(log.ts)}
                        className={`pl-4 text-gg-mute ${open ? 'shadow-[inset_4px_0_0_0_var(--gg-pink)]' : ''}`}
                      >
                        <span className="flex items-center gap-2">
                          <ChevronRight
                            {...ICON}
                            aria-hidden
                            className={open ? 'rotate-90 text-gg-pink' : 'text-gg-haze group-hover:text-gg-mute group-focus-visible:text-gg-cyan'}
                          />
                          {hms(log.ts)}
                        </span>
                      </TableCell>
                      <TableCell className="text-gg-ink">{BUILDINGS[log.agentId]?.name ?? log.agentId}</TableCell>
                      <TableCell>
                        <span
                          className={`font-pixel inline-block border-2 px-1 py-0.5 text-[8px] leading-none ${METHOD_STYLE[log.method] ?? METHOD_STYLE.POST}`}
                        >
                          {log.method}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[28rem] truncate">
                        <span className="text-gg-ink">
                          <Hit text={log.path} q={q} />
                        </span>
                        <span className="ml-3 text-base text-gg-mute">
                          <Hit text={log.id} q={q} />
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2" style={{ color: statusColor(log.status) }}>
                          <span className="inline-block size-2" style={{ background: statusColor(log.status) }} />
                          {log.status}
                        </span>
                      </TableCell>
                      <TableCell className={`text-right ${latencyClass(log.latencyMs)}`}>
                        {num(log.latencyMs)}
                        <span className="ml-1 text-base text-gg-mute">ms</span>
                      </TableCell>
                      <TableCell className="pr-4 text-right text-gg-ink">
                        {num(log.tokensIn)}
                        <span className="mx-1 text-gg-mute">→</span>
                        {num(log.tokensOut)}
                      </TableCell>
                    </TableRow>
                    {open && <DetailRow log={log} id={detailId} />}
                  </Fragment>
                )
              })
            )}
          </TableBody>
        </Table>

        {/* Pagination */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-gg-haze px-4 py-3">
          <span className="text-lg text-gg-mute">
            {total === 0 ? (
              'No results'
            ) : (
              <>
                <span className="text-gg-ink">
                  {start + 1}–{Math.min(start + PAGE_SIZE, total)}
                </span>{' '}
                of {num(total)}
              </>
            )}
          </span>
          <div className="flex items-center gap-3">
            <PagerButton label="Previous page" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
              <ChevronLeft {...ICON} />
              PREV
            </PagerButton>
            <span className="font-pixel text-[8px] text-gg-mute">
              {safePage + 1}/{pageCount}
            </span>
            <PagerButton label="Next page" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>
              NEXT
              <ChevronRight {...ICON} />
            </PagerButton>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------- pieces ----------

function Th({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <TableHead className={`font-pixel h-10 text-[8px] text-gg-mute ${className}`}>{children}</TableHead>
}

function FilterGroup({ label, className = '', children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <span className="font-pixel text-[8px] text-gg-mute">{label}</span>
      {children}
    </div>
  )
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string; color?: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex border-2 border-gg-haze bg-gg-void">
      {options.map((o, i) => {
        const active = o.value === value
        const color = o.color ?? 'var(--gg-pink)'
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`gg-logs-focus font-pixel h-8 px-3 text-[8px] leading-none ${i ? 'border-l-2 border-gg-haze' : ''} ${
              active ? '' : 'text-gg-mute hover:bg-gg-dusk/60 hover:text-gg-ink'
            }`}
            style={
              active
                ? {
                    color,
                    background: `color-mix(in srgb, ${color} 14%, transparent)`,
                    boxShadow: `inset 0 -4px 0 0 ${color}`,
                  }
                : undefined
            }
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function PagerButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="gg-logs-focus gg-logs-btn font-pixel flex h-8 items-center gap-1 border-2 border-gg-haze bg-gg-void px-2 text-[8px] text-gg-ink enabled:hover:border-gg-cyan enabled:hover:text-gg-cyan"
    >
      {children}
    </button>
  )
}

function DetailRow({ log, id }: { log: RequestLog; id: string }) {
  const reduce = useReducedMotion()
  const color = statusColor(log.status)
  return (
    <TableRow className="border-b-2 border-gg-haze bg-gg-void hover:bg-gg-void">
      <TableCell colSpan={COLS} className="p-0 whitespace-normal">
        <motion.div
          id={id}
          initial={reduce ? false : { opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
          className="p-4 pl-5 shadow-[inset_4px_0_0_0_var(--gg-pink)]"
        >
          <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-base text-gg-mute">
            <span className="text-gg-cyan">{log.id}</span>
            <span>
              <span className="text-gg-ink">{log.method}</span> {log.path}
            </span>
            <span style={{ color }}>
              {log.status} {STATUS_TEXT[log.status] ?? ''}
            </span>
            <span className={latencyClass(log.latencyMs)}>{num(log.latencyMs)} ms</span>
            <span>{fullDate(log.ts)}</span>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <JsonPanel name="Request" value={log.request} accent="var(--gg-cyan)" />
            <JsonPanel name="Response" value={log.response} accent={color} />
          </div>
        </motion.div>
      </TableCell>
    </TableRow>
  )
}

function JsonPanel({ name, value, accent }: { name: string; value: unknown; accent: string }) {
  const text = useMemo(() => toJson(value), [value])
  const tokens = useMemo(() => highlightJson(text), [text])
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${name} JSON copied`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      toast.error('Copy failed. Clipboard is not available.')
    }
  }

  return (
    <section className="min-w-0 border-2 border-gg-haze bg-gg-night shadow-[4px_4px_0_0_rgba(0,0,0,.5)]">
      <header className="flex items-center justify-between gap-2 border-b-2 border-gg-haze bg-gg-dusk/40 px-3 py-2">
        <span className="font-pixel flex items-center gap-2 text-[8px] text-gg-ink">
          <span className="inline-block size-2" style={{ background: accent }} />
          {name.toUpperCase()}
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy ${name.toLowerCase()} JSON`}
          className={`gg-logs-focus gg-logs-btn font-pixel flex h-7 items-center gap-1 border-2 bg-gg-void px-2 text-[8px] ${
            copied ? 'border-gg-green text-gg-green' : 'border-gg-haze text-gg-ink hover:border-gg-cyan hover:text-gg-cyan'
          }`}
        >
          {copied ? <Check {...ICON} /> : <Copy {...ICON} />}
          {copied ? 'COPIED' : 'COPY'}
        </button>
      </header>
      <pre className="gg-logs-code max-h-80 overflow-auto p-3 font-mono text-base leading-5 whitespace-pre-wrap text-gg-mute">
        {tokens}
      </pre>
    </section>
  )
}

function SkeletonRows() {
  const widths = ['w-16', 'w-24', 'w-10', 'w-56', 'w-10', 'w-12', 'w-20']
  return (
    <>
      {Array.from({ length: 8 }, (_, r) => (
        <TableRow key={r} className="border-b-2 border-gg-haze/50 hover:bg-transparent">
          {widths.map((w, c) => (
            <TableCell key={c} className={c === 0 ? 'pl-4' : c === COLS - 1 ? 'pr-4' : ''}>
              <span
                className={`gg-logs-skel block h-3 bg-gg-dusk ${w} ${c >= 5 ? 'ml-auto' : ''}`}
                style={{ animationDelay: `${(r % 4) * 150}ms` }}
              />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  )
}

// 12×11 pixel ghost drawn with box-shadow. X = body, E = eye.
const GHOST = [
  '....XXXX....',
  '..XXXXXXXX..',
  '.XXXXXXXXXX.',
  'XXEEXXXXEEXX',
  'XXEEXXXXEEXX',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  'XX.XX..XX.XX',
  'X...X..X...X',
]
const GHOST_SHADOW = GHOST.flatMap((row, y) =>
  [...row].flatMap((c, x) =>
    c === '.' ? [] : [`${x * 4}px ${y * 4}px 0 0 ${c === 'E' ? 'var(--gg-cyan)' : 'var(--gg-mute)'}`],
  ),
).join(', ')

function EmptyState({ filtered, onClear }: { filtered: boolean; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <div aria-hidden className="flex flex-col items-center gap-3">
        <div className="gg-logs-ghost relative h-11 w-12">
          <div className="absolute top-0 left-0 size-1" style={{ boxShadow: GHOST_SHADOW }} />
        </div>
        <div className="h-1 w-8 bg-gg-haze" />
      </div>
      <p className="font-pixel text-[10px] text-gg-ink">NO SIGNAL</p>
      <p className="max-w-md text-lg text-gg-mute">
        {filtered
          ? 'No requests match these filters.'
          : 'No requests yet. Send a command from the city and it will show up here.'}
      </p>
      {filtered && (
        <button
          type="button"
          onClick={onClear}
          className="gg-logs-focus gg-logs-btn font-pixel flex h-9 items-center gap-2 border-2 border-gg-pink bg-gg-void px-3 text-[8px] text-gg-pink hover:bg-gg-pink/10"
        >
          <X {...ICON} />
          CLEAR FILTERS
        </button>
      )}
    </div>
  )
}
