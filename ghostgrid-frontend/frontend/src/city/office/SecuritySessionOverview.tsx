import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { backend, type Page } from '@/api/backend'
import { isLive, resetBackendStatus } from '@/api/config'
import { ACTIVITY_LABEL, ACTIVITY_ORDER, buildSecurityOverview, totalSpend, type SessionActivity, type Spend } from './securityOverview'

type Overview = ReturnType<typeof buildSecurityOverview>
const number = new Intl.NumberFormat('en-US')
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 })
const TONE: Record<SessionActivity, string> = { running: 'var(--gg-green)', awaiting_approval: 'var(--gg-yellow)', queued: 'var(--gg-cyan)', error: 'var(--gg-red)', idle: 'var(--gg-mute)', archived: 'var(--gg-grey)' }
const CONTROL = 'min-h-10 border-2 border-gg-haze bg-gg-void px-2 text-gg-ink focus-visible:outline-2 focus-visible:outline-gg-cyan'

async function allPages<T>(fetchPage: (query: { limit: number; offset: number }) => Promise<Page<T>>) {
  const items: T[] = []
  let total = 0
  do {
    const page = await fetchPage({ limit: 500, offset: items.length })
    items.push(...page.items)
    total = page.total
    if (!page.items.length) break
  } while (items.length < total)
  return items
}

function Cost({ spend }: { spend: Spend }) {
  return <span className="tabular-nums">
    {spend.records > spend.unknown ? money.format(totalSpend(spend)) : '—'}
    {spend.estimatedRecords > 0 && <span className="ml-1 text-gg-yellow">est.</span>}
    {!!spend.unknown && <span className="block text-[16px] text-gg-mute">{number.format(spend.unknown)} unpriced {spend.unknown === 1 ? 'request' : 'requests'}</span>}
  </span>
}

function Tokens({ spend }: { spend: Spend }) {
  return <span>{spend.records === 0 || (spend.unknownTokens === spend.records && spend.tokens === 0)
    ? 'Tokens unavailable' : `${number.format(spend.tokens)} ${spend.unknownTokens ? 'known tokens' : 'tokens'}`}</span>
}

export function SecuritySessionOverview() {
  const [data, setData] = useState<Overview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [updated, setUpdated] = useState<Date | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<SessionActivity | 'all'>('all')
  const [sort, setSort] = useState<'activity' | 'spend'>('activity')
  const alive = useRef(false)
  const fetching = useRef(false)
  const refresh = useCallback(async () => {
    if (fetching.current) return
    fetching.current = true
    setBusy(true)
    try {
      if (!(await isLive())) {
        resetBackendStatus()
        throw new Error('The backend is offline. Start it to inspect sessions and spending')
      }
      const [sessions, agents, tasks, usage] = await Promise.all([
        allPages(backend.listSessions), allPages(backend.listAgents), allPages(backend.listTasks), allPages(backend.usage),
      ])
      if (alive.current) {
        setData(buildSecurityOverview(sessions, agents, tasks, usage))
        setUpdated(new Date())
        setError(null)
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Could not load session activity')
    } finally {
      fetching.current = false
      if (alive.current) setBusy(false)
    }
  }, [])
  useEffect(() => {
    alive.current = true
    void refresh()
    const timer = window.setInterval(() => { if (!document.hidden) void refresh() }, 5000)
    return () => { alive.current = false; window.clearInterval(timer) }
  }, [refresh])
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (data?.sessions ?? []).filter((s) => (filter === 'all' || s.status === filter)
      && `${s.name} ${s.agentName} ${s.activity}`.toLowerCase().includes(needle))
      .sort((a, b) => (sort === 'spend' ? totalSpend(b.spend) - totalSpend(a.spend) : ACTIVITY_ORDER[a.status] - ACTIVITY_ORDER[b.status]) || b.updatedAt.localeCompare(a.updatedAt))
  }, [data, query, filter, sort])
  const running = data?.sessions.filter((s) => s.status === 'running').length ?? 0
  const queued = data?.sessions.filter((s) => s.status === 'queued').length ?? 0
  const approvals = data?.sessions.filter((s) => s.status === 'awaiting_approval').length ?? 0

  return <div className="gg-of-scroll min-h-0 flex-1 overflow-y-auto p-4 text-[18px] leading-6">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h3 className="font-pixel text-[12px] leading-5 text-gg-ink">SESSION OVERVIEW</h3>
      <div className="flex flex-wrap items-center gap-3 text-gg-mute">
        <span>{updated ? `Updated ${updated.toLocaleTimeString()} · refreshes every 5s` : busy ? 'Loading session activity…' : 'Waiting for session data'}</span>
        <button type="button" onClick={() => void refresh()} disabled={busy} className={`${CONTROL} gg-of-btn flex items-center gap-2 text-gg-cyan hover:border-gg-cyan disabled:opacity-50`}><RefreshCw size={16} strokeWidth={2.5} />{busy ? 'Refreshing…' : 'Refresh'}</button>
      </div>
    </div>
    {error && <p role="alert" className="mb-4 border-2 border-gg-red p-3 text-gg-ink">Could not refresh: {error}. {data ? 'Showing the last successful update.' : 'No session data loaded.'} Use Refresh to retry.</p>}
    {data && <>
      <div className="mb-6 flex flex-wrap gap-x-6 gap-y-2 border-y-2 border-gg-haze py-3 tabular-nums">
        <span className="text-gg-ink">{number.format(data.sessions.length)} sessions</span>
        <span className={running ? 'text-gg-green' : 'text-gg-mute'}>{running} running</span>
        <span className="text-gg-cyan">{queued} queued</span>
        <span className={approvals ? 'text-gg-yellow' : 'text-gg-mute'}>{approvals} need approval</span>
        {!running && <span className="text-gg-mute">No sessions running</span>}
      </div>
      <div className="grid min-w-0 gap-6 min-[900px]:grid-cols-[minmax(0,1fr)_280px]">
        <section className="min-w-0" aria-label="All sessions">
          {!!data.standaloneTasks.length && <div className="mb-4 border-2 border-gg-haze p-3"><h4 className="mb-2 text-gg-ink">Work outside sessions</h4><ul>{data.standaloneTasks.map((t) => <li key={t.id} className="flex flex-wrap justify-between gap-2 py-1"><span className="min-w-0 break-words text-gg-ink">{t.title}</span><span className={t.status === 'running' ? 'text-gg-green' : 'text-gg-yellow'}>{t.status === 'running' ? 'Running' : t.status === 'awaiting_approval' ? 'Needs approval' : 'Queued'}</span></li>)}</ul></div>}
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <label className="min-w-0 basis-full text-gg-mute min-[640px]:flex-1 min-[640px]:basis-auto"><span className="mb-1 block">Search sessions or agents</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, agent or task" className={`${CONTROL} w-full min-w-0 placeholder:text-gg-mute`} /></label>
            <label className="text-gg-mute"><span className="mb-1 block">Status</span><select aria-label="Status" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className={CONTROL}><option value="all">All statuses</option>{Object.entries(ACTIVITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="text-gg-mute"><span className="mb-1 block">Sort</span><select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={CONTROL}><option value="activity">Activity first</option><option value="spend">Highest spend</option></select></label>
          </div>
          <div className="overflow-x-auto border-2 border-gg-haze">
            <table className="w-full border-collapse text-left"><caption className="sr-only">All sessions, status, agent and recorded lifetime spending</caption>
              <thead className="bg-gg-void text-gg-mute"><tr>{['Session / agent', 'Status', 'Spend / tokens'].map((title) => <th key={title} scope="col" className="px-3 py-2 font-normal">{title}</th>)}</tr></thead>
              <tbody>{rows.map((s) => <tr key={s.id} className="border-t-2 border-gg-haze align-top">
                <td className="max-w-[260px] break-words px-3 py-3"><div className="text-gg-ink">{s.name}</div><div className="text-gg-cyan">{s.agentName}</div><div className="mt-1 text-[16px] leading-5 text-gg-mute">{s.activity}</div></td>
                <td className="px-3 py-3"><span className="inline-flex items-center gap-2" style={{ color: TONE[s.status] }}><span aria-hidden className="size-2 shrink-0 bg-current" />{ACTIVITY_LABEL[s.status]}</span></td>
                <td className="px-3 py-3 text-gg-ink"><Cost spend={s.spend} /><div className="text-[16px] text-gg-mute"><Tokens spend={s.spend} /></div></td>
              </tr>)}</tbody>
            </table>
            {!rows.length && <p className="p-6 text-center text-gg-mute">{data.sessions.length ? 'No sessions match these filters.' : 'No sessions yet. Start one in an agent office to see its activity here.'}</p>}
          </div>
        </section>
        <aside className="min-w-0" aria-label="Agent spending ranking">
          <h4 className="mb-3 font-pixel text-[10px] leading-5 text-gg-ink">SPENDING BY AGENT</h4>
          <p className="mb-3 text-[16px] leading-5 text-gg-mute">All recorded time · USD. Highest known spend first; includes tasks outside sessions.</p>
          <ol className="border-y-2 border-gg-haze">{data.agents.map((a, i) => <li key={a.id} className="flex items-start gap-3 border-b-2 border-gg-haze py-3 last:border-0"><span className="w-4 shrink-0 text-gg-mute">{i + 1}</span><div className="min-w-0 flex-1"><div className="break-words text-gg-ink">{a.name}</div><div className="text-[16px] text-gg-mute">{a.sessions} sessions · {a.running} running</div><div className="text-[16px] text-gg-mute"><Tokens spend={a.spend} /></div></div><div className="max-w-28 text-right text-gg-ink"><Cost spend={a.spend} /></div></li>)}</ol>
          {!data.agents.length && <p className="py-3 text-gg-mute">No agent usage recorded yet.</p>}
          <div className="mt-4 text-gg-mute"><span className="block">Total known spend</span><span className="text-[24px] text-gg-ink"><Cost spend={data.totals} /></span><p className="mt-2 text-[16px] leading-5">Estimates are marked “est.” Unpriced requests are excluded from dollar totals.</p></div>
        </aside>
      </div>
    </>}
  </div>
}
