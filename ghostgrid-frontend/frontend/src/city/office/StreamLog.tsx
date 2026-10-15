// Why: the office could show one employee's conversation, or the engine's whole event firehose,
// and nothing in between. What an operator wants for a work stream is the middle — who is on it,
// what each of them is doing right now, and what has happened on it in order. One backend read
// (`/api/v1/office/log`) answers all three, so this is one poller rather than one per desk.
//
// The roster is the part worth reading first, so it is on top and never scrolls away: a stream
// with a lead idle and three engineers working is a different situation from the reverse, and
// that has to be legible without scanning a feed. Interns appear in the roster but are marked as
// answering to their engineer, because the operator cannot address one — the backend refuses a
// message to an intern, and `talkable` is how that rule arrives here instead of being guessed.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, UserPlus } from 'lucide-react'
import { backend, type OfficeLogEntry, type OfficeStreamLog, type RoleKind } from '@/api/backend'
import { useVisibleInterval } from '@/lib/useVisibleInterval'
import { MAX_DESKS } from './projectOffice'
import './stream-log.css'

const BUSY_POLL_MS = 2500
const IDLE_POLL_MS = 15_000

/**
 * What each kind is, in a word, for the badge beside a name. Exported so a test can hold it
 * against the backend's own `ROLE_KINDS`: a kind added on the server with no entry here would
 * render `undefined` under somebody's name.
 */
export const KIND_WORD: Record<RoleKind, string> = {
  manage: 'plans',
  lead: 'delegates',
  build: 'implements',
  intern: 'helps',
}

/** Statuses the engine will not move on its own. */
const SETTLED = ['completed', 'failed', 'cancelled']

/**
 * How many people on a stream the room cannot seat.
 *
 * Engineers are unbounded but desks are not: `seatsIn` (projectOffice.ts) takes the first
 * MAX_DESKS of them and drops the rest, which from the floor looks like nothing happened. The
 * lead stands on their own strip at the back and an intern sits against their engineer, so
 * neither consumes a desk — exactly as the seating does it, or this would warn about a full
 * room that is not full. Exported so the arithmetic is checked rather than eyeballed.
 */
export function standingRoomOnly(
  staff: { roleKind: RoleKind }[],
  seats = MAX_DESKS,
): number {
  const desked = staff.filter((person) => person.roleKind !== 'lead' && person.roleKind !== 'intern').length
  return Math.max(0, desked - seats)
}
/** Engine statuses in the operator's words. Exported for the same drift check as KIND_WORD. */
export const STATUS_WORD: Record<string, string> = {
  queued: 'queued',
  pending: 'queued',
  running: 'working',
  awaiting_approval: 'needs you',
  completed: 'done',
  failed: 'failed',
  cancelled: 'stopped',
}

const clock = (iso: string) => {
  const at = Date.parse(iso)
  return Number.isFinite(at) ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
}

const took = (ms: number | null) =>
  ms === null ? null : ms < 1000 ? `${ms}ms` : ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m`

/** One row of the feed. */
function Entry({ entry }: { entry: OfficeLogEntry }) {
  const working = !SETTLED.includes(entry.status)
  const spent = took(entry.durationMs)
  return (
    <li className="gg-slog-entry" data-status={entry.status} data-kind={entry.roleKind}>
      <span className="gg-slog-at">{clock(entry.at)}</span>
      <span className="gg-slog-who">{entry.who}</span>
      <span className="gg-slog-what">
        <b>{entry.label}</b>
        {entry.summary && entry.summary !== entry.label ? <em>{entry.summary}</em> : null}
        {/* A failure says what failed. Reporting one as finished is the bug this exists to avoid. */}
        {entry.error ? <strong className="gg-slog-error">{entry.error}</strong> : null}
      </span>
      <span className="gg-slog-status" data-working={working}>
        {STATUS_WORD[entry.status] ?? entry.status}{spent ? ` · ${spent}` : ''}
      </span>
    </li>
  )
}

export function StreamLog({ projectId, buildingId, officeProjectId, streamName, onStaffChanged }: {
  projectId: string
  buildingId: string
  /** Omit to read the whole building rather than one stream. */
  officeProjectId?: string
  streamName?: string
  /** Fired after a hire, so the floor and the staffing board re-read who is on the stream. */
  onStaffChanged?: () => void
}) {
  const [log, setLog] = useState<OfficeStreamLog | null>(null)
  const [error, setError] = useState('')
  const [hiring, setHiring] = useState(false)
  const [note, setNote] = useState('')

  const load = useCallback(() => {
    if (!projectId || !buildingId) return
    void backend
      .officeLog(projectId, buildingId, officeProjectId)
      .then((answer) => { setLog(answer); setError('') })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'Could not read this stream’s log.')
      })
  }, [projectId, buildingId, officeProjectId])

  // Re-read immediately when the stream changes rather than waiting out the poll.
  useEffect(() => { setLog(null); load() }, [load])

  const working = useMemo(
    () => (log?.entries ?? []).some((entry) => !SETTLED.includes(entry.status)),
    [log],
  )
  useVisibleInterval(load, working ? BUSY_POLL_MS : IDLE_POLL_MS)

  const hire = async () => {
    if (!officeProjectId || hiring) return
    setHiring(true); setError(''); setNote('')
    try {
      const made = await backend.hireEngineer({ projectId, buildingId, officeProjectId })
      setNote(`${made.name} joined as ${made.title}.`)
      load()
      onStaffChanged?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not hire an engineer.')
    } finally { setHiring(false) }
  }

  const staff = log?.staff ?? []
  const entries = log?.entries ?? []
  // Hiring is offered right here, so the room's ceiling is said here too rather than being
  // discovered as people quietly failing to appear on the floor.
  const standing = standingRoomOnly(staff)

  return (
    <section className="gg-slog" aria-label={streamName ? `${streamName} log` : 'Office log'}>
      <header className="gg-slog-head">
        <h3>{streamName ?? 'This office'}</h3>
        <span className="gg-slog-count">
          {staff.length ? `${staff.length} on this stream` : 'nobody on this stream'}
        </span>
        {/* Engineers are the one unbounded role, so this is the only hire offered here. A lead is
            created with the stream and pinned to it; an intern is hired by an engineer, at the
            engineer's own desk. */}
        {officeProjectId && (
          <button type="button" className="gg-pixel-button" disabled={hiring} onClick={() => void hire()}>
            <UserPlus size={13} strokeWidth={2.5} /> {hiring ? 'Hiring…' : 'Hire engineer'}
          </button>
        )}
        <button type="button" className="gg-pixel-button" aria-label="Refresh" onClick={load}>
          <RefreshCw size={13} strokeWidth={2.5} />
        </button>
      </header>

      <ul className="gg-slog-roster">
        {staff.map((person) => (
          <li key={person.sessionId} data-kind={person.roleKind} data-busy={person.activeTasks > 0}>
            <span className="gg-slog-dot" aria-hidden="true" />
            <span className="gg-slog-person">
              <b>{person.name}</b>
              <span className="gg-slog-badge" data-kind={person.roleKind}>
                {person.title} · {KIND_WORD[person.roleKind]}
              </span>
            </span>
            <span className="gg-slog-doing">{person.doing}</span>
            <span className="gg-slog-chain">
              {person.managerName ? `answers to ${person.managerName}` : 'answers to you'}
              {/* The operator's own reach, stated rather than discovered by being refused. */}
              {person.talkable ? '' : ' · not yours to brief'}
            </span>
          </li>
        ))}
        {log && !staff.length && (
          <li className="gg-slog-empty">
            Nobody is on this stream. Create it with a building named and it arrives with a lead
            and an engineer, or hire an engineer onto it once it has a lead.
          </li>
        )}
      </ul>

      <ol className="gg-slog-feed">
        {entries.map((entry) => <Entry key={entry.id} entry={entry} />)}
        {log && !entries.length && <li className="gg-slog-empty">Nothing has run on this stream yet.</li>}
      </ol>

      {standing > 0 && (
        <p className="gg-slog-warn" role="status">
          {standing} {standing === 1 ? 'engineer has' : 'engineers have'} no desk — the room seats {MAX_DESKS}.
          They work and appear here, but the floor cannot show them.
        </p>
      )}
      {log && log.total > entries.length && (
        <p className="gg-slog-more">Showing the newest {entries.length} of {log.total}.</p>
      )}
      {note && <p className="gg-slog-note" role="status">{note}</p>}
      {error && <p className="native-office-error" role="alert">{error}</p>}
    </section>
  )
}
