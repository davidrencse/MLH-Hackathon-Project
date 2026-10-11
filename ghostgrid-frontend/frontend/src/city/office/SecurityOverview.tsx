import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { backend, type BackendSession, type BackendUsageSummary } from '@/api/backend'
import { backendStatus } from '@/api/config'

const PAGE_SIZE = 25

export function SecurityOverview() {
  const [page, setPage] = useState(0)
  const [refresh, setRefresh] = useState(0)
  const [data, setData] = useState<{ usage: BackendUsageSummary; sessions: BackendSession[]; total: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    void (async () => {
      try {
        if (!(await backendStatus()).live) throw new Error('Connect the backend to inspect sessions and API usage.')
        const [usage, sessions] = await Promise.all([
          backend.usageSummary(), backend.listSessions({ limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
        ])
        if (active) setData({ usage, sessions: sessions.items, total: sessions.total })
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load the overview.')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [page, refresh])

  const button = 'border-2 border-gg-haze px-3 py-2 text-gg-cyan disabled:opacity-40 hover:border-gg-cyan focus-visible:outline-2 focus-visible:outline-gg-cyan'
  const usage = data?.usage.totals
  return (
    <div className="gg-of-scroll min-h-0 overflow-y-auto p-4 text-lg text-gg-ink" aria-busy={loading}>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h3 className="font-pixel text-[10px]">SESSIONS &amp; API USAGE</h3>
        <button type="button" className={button} disabled={loading} onClick={() => setRefresh((v) => v + 1)}>Refresh</button>
      </div>
      {error && <p role="alert" className="mb-4 text-gg-yellow">{error}</p>}
      {loading && !data && <p role="status" className="text-gg-mute">Loading backend data…</p>}
      {usage && <p className="mb-4 text-gg-mute">
        {usage.requests.toLocaleString()} recorded requests · {(usage.inputTokens + usage.outputTokens).toLocaleString()} known tokens · ${usage.reportedCostUsd.toFixed(4)} reported
        {usage.estimatedCostUsd > 0 && ` + $${usage.estimatedCostUsd.toFixed(4)} estimated`}
        {usage.unknownCostRequests > 0 && ` · ${usage.unknownCostRequests} unpriced requests`}
      </p>}
      {data && <>
        <ul className="divide-y-2 divide-gg-haze border-2 border-gg-haze">
          {data.sessions.map((session) => {
            const counts = session.taskCounts ?? {}
            const activity = counts.running ? 'Running' : counts.awaiting_approval ? 'Needs approval' : counts.queued || counts.pending ? 'Queued' : session.status === 'archived' ? 'Archived' : 'Idle'
            return <li key={session.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <Link className="text-gg-cyan underline underline-offset-4" to={`/dashboard/agents/${encodeURIComponent(session.buildingId ?? session.agentId)}`}>{session.name}</Link>
              <span>{activity} · {session.taskCount ?? 0} tasks</span>
            </li>
          })}
          {data.sessions.length === 0 && <li className="p-3 text-gg-mute">No backend sessions yet.</li>}
        </ul>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button type="button" className={button} disabled={loading || page === 0} onClick={() => setPage((v) => v - 1)}>Previous</button>
          <span className="text-gg-mute">{data.total} sessions</span>
          <button type="button" className={button} disabled={loading || (page + 1) * PAGE_SIZE >= data.total} onClick={() => setPage((v) => v + 1)}>Next</button>
        </div>
      </>}
    </div>
  )
}
