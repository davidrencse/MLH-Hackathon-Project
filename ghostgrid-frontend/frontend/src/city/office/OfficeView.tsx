// Office interior: what you see after walking into an agent building.
// Left: the room — one desk per session, a window onto the night city, and a wall fixture that
// changes per building. Right: the session menu (run locally, or connect to ChatGPT / Claude / …).
// Desks mirror the store, so a session started here also shows up in the city panel and the logs.
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Square, Trash2, X } from 'lucide-react'
import { useEffect, type CSSProperties } from 'react'
import { StatusBadge } from '@/components/StatusBadge'
import { CATALOG } from '@/constants'
import { RUNTIMES } from '@/constants'
import { useGrid } from '@/store/grid'
import { useIsOffline } from '@/store/keys'
import type { Building, Session } from '@/types'
import { flavorFor, type RoomPropKind } from './flavor'
import { SessionMenu } from './SessionMenu'
import { SecuritySessionOverview } from './SecuritySessionOverview'
import './office.css'

const EASE = [0.2, 0.8, 0.2, 1] as const

const SESSION_TONE: Record<Session['status'], string> = {
  running: 'var(--gg-green)',
  queued: 'var(--gg-cyan)',
  done: 'var(--gg-mute)',
  error: 'var(--gg-red)',
}

const SESSION_LABEL: Record<Session['status'], string> = { running: 'RUNNING', queued: 'QUEUED', done: 'DONE', error: 'STOPPED' }

const fmtK = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`)

export function OfficeView() {
  const building = useGrid((s) => (s.office ? (s.buildings[s.office] ?? null) : null))
  const reduce = useReducedMotion()
  const open = building !== null

  // Esc closes the office. Capture + preventDefault so the side panel underneath keeps its state.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return
      e.preventDefault()
      useGrid.getState().closeOffice()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  return (
    <AnimatePresence>
      {open && building && (
        <motion.div
          key="gg-office"
          className="absolute inset-0 z-60 flex items-center justify-center bg-gg-void/80 p-4"
          initial={reduce ? { opacity: 0 } : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={() => useGrid.getState().closeOffice()}
        >
          <motion.section
            role="dialog"
            aria-modal
            aria-label={`${building.name} office`}
            initial={reduce ? false : { scale: 0.94, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={reduce ? undefined : { scale: 0.96, opacity: 0 }}
            transition={{ duration: 0.18, ease: EASE }}
            onClick={(e) => e.stopPropagation()}
            className="gg-of-shell flex max-h-full w-full max-w-[1100px] flex-col border-2 border-gg-haze bg-gg-night"
          >
            <OfficeHeader building={building} />
            {building.type === 'security' ? <SecuritySessionOverview /> : (
            <div className="gg-of-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 min-[900px]:flex-row">
              <Room building={building} />
              <aside className="w-full shrink-0 border-2 border-gg-haze bg-gg-void p-3 min-[900px]:w-[300px]">
                <div className="mb-3 flex items-center gap-2">
                  <span className="inline-block size-2 shrink-0 bg-gg-pink" />
                  <h3 className="font-pixel text-[10px] leading-none text-gg-ink">SESSION MENU</h3>
                </div>
                <SessionMenu building={building} />
              </aside>
            </div>
            )}
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function OfficeHeader({ building }: { building: Building }) {
  const offline = useIsOffline(building.id)
  const flavor = flavorFor(building.type)
  const accent = CATALOG[building.type].accent
  const badge = offline && building.status === 'idle' ? 'offline' : building.status

  return (
    <header className="shrink-0 border-b-2 border-gg-haze bg-gg-void">
      <div className="h-1 w-full" style={{ background: accent, boxShadow: `0 0 10px 0 color-mix(in srgb, ${accent} 50%, transparent)` }} />
      <div className="flex items-start justify-between gap-3 p-3">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-pixel text-[12px] leading-[16px] text-gg-ink">{building.name}</h2>
            <span className="font-pixel text-[8px] leading-none" style={{ color: accent }}>
              {flavor.floor}
            </span>
            {building.type !== 'security' && <StatusBadge status={badge} />}
          </div>
          <p className="text-[18px] leading-[20px] text-gg-mute">{flavor.tagline}</p>
        </div>
        <button
          type="button"
          onClick={() => useGrid.getState().closeOffice()}
          aria-label="Leave office (Esc)"
          title="Leave (Esc)"
          className="gg-of-btn flex size-8 shrink-0 items-center justify-center border-2 border-gg-haze bg-gg-night text-gg-mute hover:border-gg-pink hover:text-gg-pink"
        >
          <X size={16} strokeWidth={2.5} />
        </button>
      </div>
    </header>
  )
}

// ---- the room: wall (window + fixture + notes) over a tiled floor of desks ----

function Room({ building }: { building: Building }) {
  const flavor = flavorFor(building.type)
  const sessions = building.sessions
  const running = sessions.filter((x) => x.status === 'running').length

  return (
    <div className="relative flex min-w-0 flex-1 flex-col border-2 border-gg-haze">
      <div className="gg-of-scan pointer-events-none absolute inset-0 z-10" />

      {/* back wall */}
      <div className="gg-of-wall relative flex shrink-0 items-stretch gap-3 border-b-2 border-gg-haze p-3">
        <SkylineWindow />
        <RoomProp kind={flavor.prop} />
        <ul className="hidden min-w-0 flex-col justify-center gap-1 min-[1000px]:flex">
          {flavor.notes.map((note) => (
            <li key={note} className="border-2 border-gg-haze bg-gg-void px-2 py-[2px] text-[16px] leading-[18px] text-gg-mute">
              {note}
            </li>
          ))}
        </ul>
      </div>

      {/* floor */}
      <div className="gg-of-floor min-h-0 flex-1 p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="inline-block size-2 shrink-0 bg-gg-pink" />
          <h3 className="font-pixel shrink-0 text-[8px] leading-none text-gg-mute">{flavor.deskWord}S</h3>
          <span className="h-[2px] flex-1 bg-gg-haze" />
          <span
            className="font-pixel shrink-0 text-[8px] leading-none"
            style={{ color: running ? 'var(--gg-green)' : 'var(--gg-mute)' }}
          >
            {running} RUNNING · {sessions.length}
          </span>
        </div>

        {sessions.length === 0 ? (
          <p className="border-2 border-gg-haze bg-gg-void px-3 py-6 text-center text-[18px] leading-[20px] text-gg-mute">
            Empty floor. Start a session on the right to put someone at a desk.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 min-[640px]:grid-cols-2">
            {sessions.map((session) => (
              <Desk key={session.id} buildingId={building.id} session={session} deskWord={flavor.deskWord} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// Night city behind the glass: a few blocks with flickering lit windows.
const BLOCKS = [
  { h: 34, w: 14, lit: [0, 2, 5] },
  { h: 52, w: 10, lit: [1, 3] },
  { h: 26, w: 16, lit: [0, 1, 4] },
  { h: 44, w: 12, lit: [2, 3] },
]

function SkylineWindow() {
  return (
    <div aria-hidden className="relative flex h-24 w-40 shrink-0 items-end gap-1 overflow-hidden border-2 border-gg-haze bg-gg-void p-1">
      {BLOCKS.map((b, i) => (
        <span key={i} className="relative block bg-gg-dusk" style={{ height: b.h, width: b.w }}>
          {b.lit.map((row) => (
            <span
              key={row}
              className="gg-of-win absolute left-1 block size-1 bg-gg-cyan"
              style={{ top: 4 + row * 6, animationDelay: `${(row + i) * 0.3}s` }}
            />
          ))}
        </span>
      ))}
      {/* window mullion */}
      <span className="absolute inset-y-0 left-1/2 w-[2px] bg-gg-haze" />
    </div>
  )
}

// ---- wall fixtures, one per building type ----

function RoomProp({ kind }: { kind: RoomPropKind }) {
  if (kind === 'shelf')
    return (
      <div aria-hidden className="flex h-24 w-32 shrink-0 flex-col justify-between border-2 border-gg-haze bg-gg-void p-1">
        {[0, 1, 2].map((shelf) => (
          <span key={shelf} className="flex h-6 items-end gap-[2px] border-b-2 border-gg-haze">
            {[...Array(9)].map((_, i) => (
              <span
                key={i}
                className="block w-[3px]"
                style={{
                  height: 10 + ((i * 7 + shelf * 5) % 3) * 4,
                  background: ['var(--gg-orange, #ff9d4d)', 'var(--gg-pink)', 'var(--gg-cyan)', 'var(--gg-haze)'][(i + shelf) % 4],
                }}
              />
            ))}
          </span>
        ))}
      </div>
    )

  if (kind === 'rack')
    return (
      <div aria-hidden className="flex h-24 w-32 shrink-0 gap-1 border-2 border-gg-haze bg-gg-void p-1">
        {[0, 1].map((col) => (
          <span key={col} className="flex flex-1 flex-col gap-1">
            {[...Array(6)].map((_, row) => (
              <span key={row} className="flex flex-1 items-center gap-1 border-2 border-gg-haze bg-gg-night px-1">
                <span className={`gg-of-led gg-of-led-${(row % 4) + 1} block size-1 bg-gg-green`} />
                <span className="block h-[2px] flex-1 bg-gg-haze" />
              </span>
            ))}
          </span>
        ))}
      </div>
    )

  if (kind === 'rail')
    return (
      <div aria-hidden className="flex h-24 w-32 shrink-0 flex-col justify-center gap-2 border-2 border-gg-haze bg-gg-void p-2">
        {[0, 1, 2].map((lane) => (
          <span key={lane} className="flex items-center gap-1">
            {[1, 2, 3].map((step) => (
              <span
                key={step}
                className={`gg-of-chev gg-of-chev-${step} block h-2 w-5`}
                style={{ background: '#b36bff', animationDelay: `${step * 0.3 + lane * 0.1}s` }}
              />
            ))}
          </span>
        ))}
      </div>
    )

  if (kind === 'switchboard')
    return (
      <div aria-hidden className="grid h-24 w-32 shrink-0 grid-cols-4 gap-1 border-2 border-gg-haze bg-gg-void p-2">
        {[...Array(16)].map((_, i) => (
          <span key={i} className="flex items-center justify-center border-2 border-gg-haze bg-gg-night">
            <span className="gg-of-plug block size-1 bg-gg-cyan" style={{ animationDelay: `${(i % 5) * 0.3}s` }} />
          </span>
        ))}
      </div>
    )

  // whiteboard: a scribbled plan with a little branch graph
  return (
    <div aria-hidden className="relative h-24 w-32 shrink-0 border-2 border-gg-haze bg-gg-night p-2">
      {[0, 1, 2].map((line) => (
        <span key={line} className="mb-1 block h-[2px] bg-gg-haze" style={{ width: `${70 - line * 15}%` }} />
      ))}
      <span className="absolute bottom-2 left-2 flex items-center gap-1">
        {[0, 1, 2, 3].map((node) => (
          <span key={node} className="flex items-center gap-1">
            <span className="block size-2 bg-gg-green" />
            {node < 3 && <span className="block h-[2px] w-3 bg-gg-green" />}
          </span>
        ))}
      </span>
      <span className="absolute right-2 bottom-5 block size-2 bg-gg-pink" />
    </div>
  )
}

// ---- one desk = one session ----

function Desk({ buildingId, session, deskWord }: { buildingId: string; session: Session; deskWord: string }) {
  const rt = RUNTIMES[session.runtime]
  const tone = SESSION_TONE[session.status]
  const run = session.status === 'running'
  const busy = run || session.status === 'queued'

  return (
    <li
      data-busy={busy ? 1 : 0}
      className="gg-of-desk flex flex-col gap-2 border-2 border-l-4 border-gg-haze bg-gg-night p-2"
      style={
        {
          borderLeftColor: tone,
          '--gg-of-tone': tone,
          '--gg-of-glow': `color-mix(in srgb, ${tone} 40%, transparent)`,
        } as CSSProperties
      }
    >
      {/* monitor + the person at the desk */}
      <div className="flex items-end gap-2">
        <div className="gg-of-screen relative h-16 flex-1 border-2 border-gg-haze">
          <span className="gg-of-glyph" data-run={run ? 1 : 0} />
          {!run && <span className="gg-of-caret absolute bottom-1 left-1 block size-2" style={{ background: tone }} />}
          <span className="absolute top-1 right-1 block size-1" style={{ background: tone }} />
        </div>
        <span aria-hidden className="gg-of-worker flex shrink-0 flex-col items-center" data-run={run ? 1 : 0}>
          <span className="block size-3" style={{ background: 'var(--gg-mute)' }} />
          <span className="block h-4 w-6" style={{ background: rt.accent }} />
        </span>
      </div>
      {/* desk slab */}
      <span aria-hidden className="block h-1 w-full bg-gg-haze" />

      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 break-words text-[18px] leading-[20px] text-gg-ink">{session.title}</span>
        <span
          className="font-pixel inline-flex shrink-0 items-center gap-1 border-2 px-1 py-[3px] text-[8px] leading-none"
          style={{ color: tone, borderColor: tone, background: 'color-mix(in srgb, currentColor 12%, transparent)' }}
        >
          <span className={`inline-block size-1 ${run ? 'gg-of-caret' : ''}`} style={{ background: tone }} />
          {SESSION_LABEL[session.status]}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className="font-pixel border-2 px-1 py-[2px] text-[8px] leading-none"
          style={{ color: rt.accent, borderColor: rt.accent }}
          title={rt.mode === 'local' ? `${deskWord} runs on this machine` : `${deskWord} calls ${rt.host}`}
        >
          {rt.short}
        </span>
        <span className="text-[16px] leading-[18px] text-gg-mute">{session.model}</span>
        <span className="text-[16px] leading-[18px] text-gg-mute tabular-nums">{fmtK(session.tokens)} tok</span>
      </div>

      <div className="flex gap-2">
        {busy ? (
          <button
            type="button"
            onClick={() => void useGrid.getState().stopSession(buildingId, session.id)}
            className="gg-of-btn font-pixel flex h-8 flex-1 items-center justify-center gap-1 border-2 border-gg-red bg-gg-void px-2 text-[8px] leading-none text-gg-red uppercase hover:bg-gg-red hover:text-gg-void"
          >
            <Square size={16} strokeWidth={2.5} />
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={() => useGrid.getState().clearSession(buildingId, session.id)}
            className="gg-of-btn font-pixel flex h-8 flex-1 items-center justify-center gap-1 border-2 border-gg-haze bg-gg-void px-2 text-[8px] leading-none text-gg-mute uppercase hover:border-gg-ink hover:text-gg-ink"
          >
            <Trash2 size={16} strokeWidth={2.5} />
            Clear desk
          </button>
        )}
      </div>
    </li>
  )
}
