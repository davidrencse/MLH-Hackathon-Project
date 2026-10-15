// SESSIONS: the working sessions inside an agent building (codex / claude / deepseek).
import { GitBranch } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Session } from '@/types'
import { SectionTitle } from './parts'

const SESSION_STYLE: Record<Session['status'], { color: string; label: string }> = {
  running: { color: 'var(--gg-green)', label: 'RUNNING' },
  queued: { color: 'var(--gg-cyan)', label: 'QUEUED' },
  done: { color: 'var(--gg-mute)', label: 'DONE' },
  error: { color: 'var(--gg-red)', label: 'ERROR' },
}

const fmtK = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`)

function ago(ts: number, now: number) {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 60) return s < 10 ? 'just now' : `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

export function SessionsSection({ sessions }: { sessions: Session[] }) {
  // Relative times refresh every 15s (one cheap re-render, nothing per frame).
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [])
  const running = sessions.filter((x) => x.status === 'running').length

  return (
    <section>
      <SectionTitle
        right={
          <span className="font-pixel text-[8px] leading-none" style={{ color: running ? 'var(--gg-green)' : 'var(--gg-mute)' }}>
            {running} RUNNING · {sessions.length}
          </span>
        }
      >
        SESSIONS
      </SectionTitle>
      {sessions.length === 0 ? (
        <p className="border-2 border-gg-haze bg-gg-void px-3 py-2 text-[18px] leading-[20px] text-gg-mute">No sessions</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sessions.map((x) => {
            const st = SESSION_STYLE[x.status]
            return (
              <li
                key={x.id}
                className="flex flex-col gap-1 border-2 border-l-4 border-gg-haze bg-gg-void px-3 py-2"
                style={{ borderLeftColor: st.color }}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 break-words text-[18px] leading-[20px] text-gg-ink">{x.title}</span>
                  <span
                    className="font-pixel inline-flex shrink-0 items-center gap-1 border-2 px-1 py-[3px] text-[8px] leading-none"
                    style={{ color: st.color, borderColor: st.color, background: 'color-mix(in srgb, currentColor 12%, transparent)' }}
                  >
                    <span className={`inline-block size-1 ${x.status === 'running' ? 'gg-sp-live' : ''}`} style={{ background: st.color }} />
                    {st.label}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 text-[16px] leading-[18px] text-gg-mute">
                  {x.branch && (
                    <span className="flex min-w-0 items-center gap-1 text-gg-cyan">
                      <GitBranch size={16} strokeWidth={2.5} className="shrink-0" />
                      <span className="truncate">{x.branch}</span>
                    </span>
                  )}
                  <span className="tabular-nums" title={x.tokens > 0 ? undefined : 'No usage recorded for this session'}>{x.tokens > 0 ? `${fmtK(x.tokens)} tok` : '— tok'}</span>
                  <span className="tabular-nums">{ago(x.startedAt, now)}</span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
