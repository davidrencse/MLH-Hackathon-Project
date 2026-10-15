// Why: clicking a backend employee in the room used to select them and show nothing — the panel
// under the floor only knew how to draw a terminal desk, so a hired employee had a name, a role
// and a brief, and no way to talk to them. This is that conversation.
//
// A turn here is a real backend task: sending a message creates one on this employee's session,
// which means it runs as them — their standing role brief, their workspace, their provider — and
// lands in the same ledger as everything the orchestrator starts. That is also why the transcript
// is built from the session's tasks rather than from the session's message list: a task carries
// what was asked, what came back, whether it failed, how long it took and what it cost, and all
// of that belongs in the conversation. Work the orchestrator gave this employee shows up here too,
// because it is the same desk.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Ban, Check, ChevronsDownUp, ChevronsUpDown, CornerDownLeft, RefreshCw } from 'lucide-react'
import { backend, type BackendTask, type BackendTaskStatus } from '@/api/backend'
import { useVisibleInterval } from '@/lib/useVisibleInterval'
import './employee-chat.css'

/** Statuses the engine will not move on its own; anything else means work is in flight. */
const SETTLED: BackendTaskStatus[] = ['completed', 'failed', 'cancelled']
const BUSY_POLL_MS = 2000
const IDLE_POLL_MS = 12_000
/** Lines of a prompt shown before it is clamped. An orchestrated brief runs to hundreds. */
const CLAMP_LINES = 10

const STATUS_WORD: Record<string, string> = {
  pending: 'queued',
  queued: 'queued',
  running: 'working',
  awaiting_approval: 'waiting for you',
  completed: 'answered',
  failed: 'failed',
  cancelled: 'stopped',
}

const clock = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''

function duration(task: BackendTask): string | null {
  if (!task.startedAt || !task.completedAt) return null
  const ms = Date.parse(task.completedAt) - Date.parse(task.startedAt)
  if (!Number.isFinite(ms) || ms < 0) return null
  return ms < 1000 ? `${ms}ms` : ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

/** Tokens and cost, only the figures the provider actually reported. */
function meter(task: BackendTask): string | null {
  const usage = task.usage
  if (!usage) return null
  const parts: string[] = []
  if (typeof usage.inputTokens === 'number' && typeof usage.outputTokens === 'number')
    parts.push(`${usage.inputTokens}→${usage.outputTokens} tok`)
  const cost = usage.costUsd ?? usage.estimatedCostUsd ?? null
  if (typeof cost === 'number') parts.push(`$${cost.toFixed(4)}${usage.costUsd === null ? ' est.' : ''}`)
  return parts.length ? parts.join(' · ') : null
}

export function EmployeeChat({ sessionId, name, role, detail, readOnly }: {
  sessionId: string
  name: string
  role: string
  /** One line of real identity under the name: team, work stream, what is in flight. */
  detail?: string
  /**
   * Why the operator may not write here, when they may not. An intern was hired by one engineer
   * for one piece of that engineer's task and is accountable to them, so the backend refuses a
   * message to one with a 409. The transcript is still shown — seeing what an intern did is the
   * point of selecting them — but the composer is replaced by this sentence, so the rule is
   * read rather than discovered by having a message bounce.
   */
  readOnly?: string
}) {
  const [turns, setTurns] = useState<BackendTask[] | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [tall, setTall] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  // Bringing this panel into view is the page's job (OfficePage scrolls to it on select), so a
  // desk and an employee land the same way.

  const load = useCallback(() => {
    let alive = true
    void backend
      .sessionTasks(sessionId)
      .then((page) => {
        if (!alive) return
        // Oldest first: a conversation reads down the page.
        setTurns([...page.items].sort((left, right) => left.createdAt.localeCompare(right.createdAt)))
        setError('')
      })
      .catch((reason: unknown) => {
        if (!alive) return
        setError(reason instanceof Error ? reason.message : 'Could not read this conversation.')
      })
    return () => { alive = false }
  }, [sessionId])

  // No reset effect: the page mounts this panel keyed on the session, so clicking a different
  // employee gives a fresh component rather than one that has to forget the last one's turns.
  useEffect(() => load(), [load])

  const working = (turns ?? []).some((task) => !SETTLED.includes(task.status))
  useVisibleInterval(load, working ? BUSY_POLL_MS : IDLE_POLL_MS)

  // Follow the newest turn unless the reader scrolled up to re-read something.
  useEffect(() => {
    const node = body.current
    if (node && pinned.current) node.scrollTop = node.scrollHeight
  }, [turns])

  const send = async () => {
    const prompt = draft.trim()
    if (!prompt || sending) return
    setSending(true)
    setError('')
    try {
      await backend.sendMessage(sessionId, { prompt, title: prompt.slice(0, 60) })
      setDraft('')
      pinned.current = true
      load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `${name} could not be given that task.`)
    } finally { setSending(false) }
  }

  const act = async (label: string, action: () => Promise<unknown>) => {
    setError('')
    try { await action(); load() }
    catch (reason) { setError(reason instanceof Error ? reason.message : `Could not ${label}.`) }
  }

  const empty = turns !== null && turns.length === 0
  const status = useMemo(() => {
    if (turns === null) return 'reading'
    const live = turns.find((task) => !SETTLED.includes(task.status))
    return live ? STATUS_WORD[live.status] ?? live.status : 'idle'
  }, [turns])

  return (
    <section className="gg-chat" data-tall={tall} aria-label={`Conversation with ${name}`}>
      <header className="gg-chat-bar">
        <span className="gg-chat-dot" data-working={working} aria-hidden />
        <span className="font-pixel gg-chat-name">{name}</span>
        <span className="font-pixel gg-chat-role">{role}</span>
        <span className="font-pixel gg-chat-status" data-working={working}>{status}</span>
        <button type="button" className="gg-chat-icon" title="Re-read this conversation" onClick={() => load()}>
          <RefreshCw size={14} strokeWidth={2.5} />
        </button>
        {/* A long transcript needs more room than a panel under a 3D room can give it by default. */}
        <button type="button" className="gg-chat-icon" aria-pressed={tall}
          title={tall ? 'Shrink this conversation' : 'Give this conversation more room'}
          onClick={() => setTall((current) => !current)}>
          {tall ? <ChevronsDownUp size={14} strokeWidth={2.5} /> : <ChevronsUpDown size={14} strokeWidth={2.5} />}
        </button>
      </header>
      {detail && <p className="gg-chat-meta font-mono">{detail}</p>}

      <div className="gg-chat-screen">
      <div className="gg-chat-log font-mono" ref={body} role="log" aria-live="polite"
        onScroll={() => {
          const node = body.current
          if (node) pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24
        }}>
        {turns === null && <p className="gg-chat-note">reading {name}’s turns…</p>}
        {empty && (
          <p className="gg-chat-note">
            Nothing yet. A message here becomes a task on {name}’s own session, so it runs as them —
            their role brief, their workspace, their provider — and shows up in the ledger like any
            other work.
          </p>
        )}
        {(turns ?? []).map((task) => {
          const settled = SETTLED.includes(task.status)
          const long = task.prompt.split('\n').length > CLAMP_LINES || task.prompt.length > 600
          const shown = open[task.id] || !long
          const cost = meter(task)
          const took = duration(task)
          return (
            <article key={task.id} className="gg-chat-turn" data-status={task.status}>
              <header>
                <span className="gg-chat-time">{clock(task.createdAt)}</span>
                <span className="gg-chat-title">{task.title}</span>
                <span className="gg-chat-turn-status" data-status={task.status}>
                  {STATUS_WORD[task.status] ?? task.status}
                </span>
                {took && <span className="gg-chat-side">{took}</span>}
                {cost && <span className="gg-chat-side">{cost}</span>}
              </header>

              <div className="gg-chat-said" data-who="operator">
                {/* The same gutter the desk terminal uses, so a conversation and a transcript
                    read as one instrument: a character per line kind, in one column. */}
                <span className="gg-chat-glyph" aria-hidden>&gt;</span>
                <pre data-clamped={!shown}>{task.prompt}</pre>
                {long && (
                  <button type="button" className="gg-chat-more"
                    onClick={() => setOpen((current) => ({ ...current, [task.id]: !current[task.id] }))}>
                    {shown ? 'show less' : `show all ${task.prompt.split('\n').length} lines`}
                  </button>
                )}
              </div>

              <div className="gg-chat-said" data-who="employee">
                <span className="gg-chat-glyph" aria-hidden>{task.error ? '!' : '='}</span>
                {task.result
                  ? <pre>{task.result}</pre>
                  : task.error
                    ? <>
                      <pre className="gg-chat-error">{[task.error.code, task.error.message].filter(Boolean).join(': ')}</pre>
                      {/* The one failure an operator can fix from here, named where it happens: a
                          coding provider refuses file tools until the office has a repository. */}
                      {/workspace/i.test(task.error.message ?? '') && (
                        <p className="gg-chat-note">
                          Assign this office a repository in the RUNS tab, or take file access away from
                          its agent, then ask again.
                        </p>
                      )}
                    </>
                    : settled
                      ? <pre className="gg-chat-note">no answer recorded</pre>
                      : <p className="gg-chat-waiting">
                        {STATUS_WORD[task.status] ?? task.status}
                        <span className="gg-chat-cursor" aria-hidden />
                      </p>}
              </div>

              {!settled && (
                <footer className="gg-chat-actions">
                  {task.status === 'awaiting_approval' && (
                    <button type="button" className="gg-pixel-button" data-tone="accent"
                      onClick={() => void act('approve this step', () => backend.approveTask(task.id))}>
                      <Check size={13} strokeWidth={2.5} /> Approve
                    </button>
                  )}
                  <button type="button" className="gg-pixel-button" data-tone="danger"
                    onClick={() => void act('stop this turn', () => task.status === 'awaiting_approval'
                      ? backend.rejectTask(task.id, 'Declined from the chat')
                      : backend.cancelTask(task.id))}>
                    <Ban size={13} strokeWidth={2.5} /> {task.status === 'awaiting_approval' ? 'Decline' : 'Stop'}
                  </button>
                </footer>
              )}
            </article>
          )
        })}
      </div>
      </div>

      {readOnly
        ? <p className="gg-chat-readonly">{readOnly}</p>
        : <form className="gg-chat-composer" onSubmit={(event) => { event.preventDefault(); void send() }}>
        <textarea
          value={draft}
          rows={2}
          maxLength={8000}
          aria-label={`Message ${name}`}
          placeholder={`Message ${name}… (Enter sends, Shift+Enter for a new line)`}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
            event.preventDefault()
            void send()
          }}
        />
        <button type="submit" className="gg-pixel-button gg-chat-send" data-tone="accent" disabled={sending || !draft.trim()}>
          <CornerDownLeft size={14} strokeWidth={2.5} /> {sending ? 'Sending…' : 'Send'}
        </button>
      </form>}
      {error && <p role="alert" className="gg-chat-alert">{error}</p>}
    </section>
  )
}
