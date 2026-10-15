// Why: selecting a live desk used to show a canned animation of invented commands. Each of
// those desks is a real `claude` terminal on this machine, and the backend can read what that
// session is actually doing, so the desk shows the session itself: the prompts, the replies and
// the tool calls, printed as an 8-bit CRT the same way the rest of the city is drawn.
//
// Polls while the tab is visible, because the only alternative the backend offers is the same
// read on a timer, and a terminal nobody is looking at does not need to be current.
//
// It answers, too. Claude Code can continue one of its own sessions non-interactively, so a
// message typed here is sent to *this* session — same id, same history, same folder — and its
// turns appear in the transcript above as the poll picks them up. The desk used to be read-only,
// which made the panel look broken: a conversation on screen and nowhere to type.
import { useCallback, useEffect, useRef, useState } from 'react'
import { CornerDownLeft } from 'lucide-react'
import { backend, type ActivityKind, type CliActivity, type CliSubagent } from '@/api/backend'
import { useVisibleInterval } from '@/lib/useVisibleInterval'
import { shortPath } from './crew'
import './crew-terminal.css'

const POLL_MS = 2000
const LINES = 40

// The prompt character each kind of line gets, the way a shell would mark it.
const GLYPH: Record<ActivityKind, string> = {
  prompt: '>',
  say: '*',
  tool: '$',
  // A spawn is not a tool call: the CLI handed work to somebody. It gets a mark of its own so
  // the transcript reads as delegation rather than as another command.
  subagent: '@',
  result: '=',
  error: '!',
  hook: '~',
}

/** "14h 17m" / "3m" / "12s" — how long ago the session last wrote anything. */
function since(iso: string | null): string {
  if (!iso) return '—'
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`
}

export function CrewTerminal({ pid, fallbackName, onSubagents }: {
  pid: number
  fallbackName: string
  /**
   * The subagents this CLI is running, reported upward as they are read.
   *
   * The office draws a desk per subagent, and this component already polls the transcript they
   * come from — so it hands them up rather than the page starting a second poll of the same
   * route for the same pid. One reader, two views.
   */
  onSubagents?: (pid: number, subagents: CliSubagent[]) => void
}) {
  const [activity, setActivity] = useState<CliActivity | null>(null)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [note, setNote] = useState('')
  const [, tick] = useState(0)
  const body = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  const load = useCallback(() => {
    let alive = true
    void backend
      .officeActivity(pid, LINES)
      .then((next) => {
        if (!alive) return
        setActivity(next)
        setError('')
        onSubagents?.(pid, next.subagents ?? [])
      })
      .catch((cause: unknown) => {
        if (!alive) return
        // A terminal with no transcript is the normal case for a CLI that keeps none; say so
        // instead of showing an empty screen that looks broken.
        setError(cause instanceof Error ? cause.message : 'could not read this session')
      })
    return () => {
      alive = false
    }
  }, [pid, onSubagents])

  // A new desk starts empty rather than showing the previous desk's session.
  useEffect(() => {
    setActivity(null)
    setError('')
    pinned.current = true
  }, [pid])

  useVisibleInterval(load, POLL_MS)
  // The idle clock in the header counts up between polls.
  useVisibleInterval(
    useCallback(() => tick((n) => n + 1), []),
    1000,
  )

  // Follow the tail like a terminal does, unless the reader scrolled up to look at something.
  useEffect(() => {
    const node = body.current
    if (node && pinned.current) node.scrollTop = node.scrollHeight
  }, [activity])

  const onScroll = () => {
    const node = body.current
    if (!node) return
    pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24
  }

  const status = (activity?.status ?? 'unknown').toUpperCase()
  const lines = activity?.lines ?? []

  const send = async () => {
    const prompt = draft.trim()
    if (!prompt || sending) return
    setSending(true)
    setError('')
    setNote('')
    try {
      const answer = await backend.messageDesk(pid, prompt)
      setDraft('')
      // The reply itself is already in the transcript; what the operator cannot see there is
      // whether the CLI shared the open session or continued a copy of it.
      setNote(answer.copied
        ? 'Answered in a copy of this session — the window on your machine will not show it.'
        : 'Answered in this session.')
      load()
    } catch (reason) {
      // "Route not found" means the backend is older than the app talking to it — the message
      // route is new. Say what to do instead of repeating the router's own words.
      setError(reason instanceof Error && /route not found/i.test(reason.message)
        ? 'This backend does not have the desk message route yet. Restart it with ./dev.sh backend and send again.'
        : reason instanceof Error ? reason.message : 'That message could not be sent.')
    } finally { setSending(false) }
  }

  return (
    <section className="gg-crt" aria-label={`Terminal for ${activity?.name ?? fallbackName}`}>
      <header className="gg-crt-bar">
        <span className="gg-crt-dot" aria-hidden />
        <span className="font-pixel gg-crt-name">{activity?.name ?? fallbackName}</span>
        <span className="font-pixel gg-crt-status" data-status={activity?.status ?? 'unknown'}>
          {status}
        </span>
      </header>
      <p className="gg-crt-meta font-mono">
        pid {pid}
        {activity?.cwd ? ` · ${shortPath(activity.cwd)}` : ''}
        {activity?.version ? ` · v${activity.version}` : ''}
        {activity ? ` · last write ${since(activity.updatedAt)} ago` : ''}
      </p>
      <div className="gg-crt-screen">
        <div className="gg-crt-body font-mono" ref={body} onScroll={onScroll} role="log" aria-live="polite">
          {lines.map((line, index) => (
            <p key={`${line.at ?? index}-${index}`} className="gg-crt-line" data-kind={line.kind}>
              <span className="gg-crt-glyph" aria-hidden>
                {GLYPH[line.kind]}
              </span>
              {line.text}
            </p>
          ))}
          {!lines.length && (
            <p className="gg-crt-line" data-kind="hook">
              <span className="gg-crt-glyph" aria-hidden>
                ~
              </span>
              {error ? error : activity ? 'session is quiet — no turns recorded yet' : 'reading session…'}
            </p>
          )}
          {activity?.status === 'busy' && <span className="gg-crt-cursor" aria-hidden />}
        </div>
        <div className="gg-crt-scan" aria-hidden />
      </div>
      <form className="gg-crt-composer" onSubmit={(event) => { event.preventDefault(); void send() }}>
        <textarea
          value={draft}
          rows={2}
          maxLength={8000}
          disabled={sending}
          aria-label={`Message ${activity?.name ?? fallbackName}`}
          placeholder={sending
            ? 'Waiting for this terminal to finish its turn…'
            : `Message this session… (Enter sends, Shift+Enter for a new line)`}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
            event.preventDefault()
            void send()
          }}
        />
        <button type="submit" className="gg-pixel-button gg-crt-send" data-tone="accent" disabled={sending || !draft.trim()}>
          <CornerDownLeft size={14} strokeWidth={2.5} /> {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
      {note && <p className="gg-crt-note">{note}</p>}
      {error && <p role="alert" className="gg-crt-alert">{error}</p>}
    </section>
  )
}
