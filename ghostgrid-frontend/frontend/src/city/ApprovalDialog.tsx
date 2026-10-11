// Human-approval modal for the Security Checkpoint. Visible while task.phase === 'approval'.
// Not dismissable: no outside-click / Esc close. Y approves, N rejects.
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig, motion, useIsPresent, useReducedMotion } from 'framer-motion'
import { BUILDINGS } from '../constants'
import { useGrid } from '../store/grid'
import type { Task } from '../types'
import './ApprovalDialog.css'

type Approval = NonNullable<Task['approval']>
type Choice = 'approve' | 'reject'

// Hold the pressed state briefly so the decision reads on screen before the dialog pops out.
const HOLD_MS = 260
const steps3 = (t: number) => Math.floor(t * 3) / 3
const POP = { duration: 0.15, ease: steps3 }

const ACCENT: Record<Choice | 'pending', string> = {
  pending: 'var(--gg-yellow)',
  approve: 'var(--gg-green)',
  reject: 'var(--gg-red)',
}

const TITLE: Record<Choice | 'pending', string> = {
  pending: 'SECURITY CHECKPOINT',
  approve: 'ACCESS GRANTED',
  reject: 'REQUEST DENIED',
}

// Pixel warning sign, 11×10 cells at 2px. '#' = ink, '.' = transparent (the "!" shows through).
const WARN = [
  '.....#.....',
  '....###....',
  '....#.#....',
  '...##.##...',
  '...##.##...',
  '..###.###..',
  '..#######..',
  '.####.####.',
  '.#########.',
  '###########',
]
const PX = 2
const WARN_SHADOW = WARN.flatMap((row, y) =>
  [...row].flatMap((c, x) => (c === '#' ? [`${x * PX}px ${y * PX}px 0 0 currentColor`] : [])),
).join(',')

function scopeOf(action: string) {
  const path = action.split(/\s+/).find((t) => t.startsWith('/'))
  return path ? `/${path.split('/')[1]} (outside repo)` : 'repo'
}

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

export function ApprovalDialog() {
  const open = useGrid((s) => s.task?.phase === 'approval')
  const taskId = useGrid((s) => s.task?.id ?? '')
  const approval = useGrid((s) => s.task?.approval)

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {open && approval && <ApprovalPanel key={taskId} taskId={taskId} approval={approval} />}
      </AnimatePresence>
    </MotionConfig>
  )
}

function ApprovalPanel({ taskId, approval }: { taskId: string; approval: Approval }) {
  const [choice, setChoice] = useState<Choice | null>(null)
  const [waited, setWaited] = useState(0)
  const choiceRef = useRef<Choice | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const approveRef = useRef<HTMLButtonElement>(null)
  const rejectRef = useRef<HTMLButtonElement>(null)
  const present = useIsPresent()
  const reduce = useReducedMotion()
  const titleId = useId()
  const descId = useId()

  const requester = BUILDINGS[approval.requester]
  const gate = BUILDINGS[approval.buildingId]
  const state = choice ?? 'pending'

  const choose = useCallback((c: Choice) => {
    if (choiceRef.current) return
    choiceRef.current = c
    setChoice(c)
    // The store guards on phase === 'approval', so a late call after an external close is a no-op.
    window.setTimeout(() => {
      const g = useGrid.getState()
      void (c === 'approve' ? g.approve() : g.reject())
    }, HOLD_MS)
  }, [])

  // "You must choose": a 3-step pixel shake instead of closing.
  const nudge = useCallback(() => {
    if (reduce || choiceRef.current) return
    const jump = 'steps(1, end)'
    panelRef.current?.animate(
      [
        { transform: 'translateX(0)', easing: jump },
        { transform: 'translateX(-4px)', easing: jump },
        { transform: 'translateX(4px)', easing: jump },
        { transform: 'translateX(0)' },
      ],
      { duration: 240 },
    )
  }, [reduce])

  // Focus Approve on open; give focus back on close.
  useEffect(() => {
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null
    approveRef.current?.focus({ preventScroll: true })
    return () => {
      if (prev?.isConnected) prev.focus({ preventScroll: true })
    }
  }, [])

  // Y / N shortcuts. Capture phase so Esc never reaches panels behind the dialog.
  useEffect(() => {
    if (!present) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        nudge()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      const k = e.key.toLowerCase()
      if (k !== 'y' && k !== 'n') return
      e.preventDefault()
      e.stopPropagation()
      choose(k === 'y' ? 'approve' : 'reject')
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [present, choose, nudge])

  // Wait timer — the agent is paused while this is open.
  useEffect(() => {
    if (choice) return
    const t = window.setInterval(() => setWaited((s) => s + 1), 1000)
    return () => window.clearInterval(t)
  }, [choice])

  // Keep Tab inside the two buttons.
  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return
    e.preventDefault()
    const next = document.activeElement === approveRef.current ? rejectRef.current : approveRef.current
    next?.focus()
  }

  const btn =
    'font-pixel h-12 border-2 px-3 text-[10px] leading-none select-none shadow-[4px_4px_0_0_rgba(0,0,0,0.5)] ' +
    'active:translate-x-[2px] active:translate-y-[2px] active:shadow-none ' +
    'data-[pressed=true]:translate-x-[2px] data-[pressed=true]:translate-y-[2px] data-[pressed=true]:shadow-none ' +
    'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gg-cyan ' +
    'disabled:cursor-not-allowed data-[dim=true]:opacity-40'

  return (
    <motion.div
      className="gg-apv-overlay fixed inset-0 z-60 flex items-center justify-center px-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={POP}
      onMouseDown={(e) => {
        // Outside click: keep focus on the buttons and shake. Never close.
        if (e.target === e.currentTarget) {
          e.preventDefault()
          nudge()
        }
      }}
    >
      <div className="gg-apv-sweep" aria-hidden />

      <motion.div
        className="w-full max-w-[520px]"
        initial={{ scale: 0.9 }}
        animate={{ scale: 1 }}
        exit={{ scale: 0.9 }}
        transition={POP}
      >
        <div
          ref={panelRef}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descId}
          data-choice={choice ?? undefined}
          tabIndex={-1}
          className="gg-apv-panel outline-none"
          style={{ '--apv-accent': ACCENT[state] } as React.CSSProperties}
          onKeyDown={trapTab}
        >
          {/* Header */}
          <div className="gg-apv-head flex items-center gap-3 px-4 py-2">
            <span aria-hidden className="gg-apv-bob relative inline-block shrink-0" style={{ width: 22, height: 20 }}>
              <span className="absolute top-0 left-0" style={{ width: PX, height: PX, boxShadow: WARN_SHADOW }} />
            </span>
            <h2 id={titleId} className="font-pixel text-[12px] leading-none">
              {TITLE[state]}
            </h2>
            <span className="font-pixel ml-auto text-[8px] leading-none opacity-70">
              REQ #{taskId.slice(-4).toUpperCase()}
            </span>
          </div>
          <div className="gg-apv-hazard" aria-hidden />

          {/* Body */}
          <div className="flex flex-col gap-4 p-5">
            <p className="font-pixel text-[8px] leading-none text-gg-mute">
              INCOMING · {requester.short} <span className="text-gg-cyan">-&gt;</span> {gate.short}
            </p>

            <div id={descId} className="flex flex-col gap-3">
              <p className="text-[26px] leading-[1.1] text-gg-ink">{approval.message}</p>
              <div className="border-2 border-gg-haze bg-gg-void px-3 py-2 text-[20px] leading-none text-gg-green">
                <span className="text-gg-mute">$ </span>
                {approval.action}
                <span className="gg-apv-cursor" aria-hidden />
              </div>
            </div>

            <dl className="grid grid-cols-1 border-2 border-gg-haze sm:grid-cols-[1fr_auto_1.4fr]">
              <Meta label="REQUESTED BY" value={requester.name.toUpperCase()} />
              <Meta label="RISK" value="MEDIUM" valueClass="text-gg-yellow" />
              <Meta label="SCOPE" value={scopeOf(approval.action)} />
            </dl>

            <div className="mt-1 grid grid-cols-2 gap-3">
              <button
                ref={approveRef}
                type="button"
                disabled={choice !== null}
                data-pressed={choice === 'approve'}
                data-dim={choice === 'reject'}
                onClick={() => choose('approve')}
                className={`${btn} border-gg-green bg-gg-green text-gg-void hover:shadow-[inset_0_0_0_2px_var(--gg-void),4px_4px_0_0_rgba(0,0,0,0.5)]`}
              >
                {choice === 'approve' ? '[ APPROVED ]' : '[ APPROVE (Y) ]'}
              </button>
              <button
                ref={rejectRef}
                type="button"
                disabled={choice !== null}
                data-pressed={choice === 'reject'}
                data-dim={choice === 'approve'}
                onClick={() => choose('reject')}
                className={`${btn} border-gg-red bg-gg-void text-gg-red hover:bg-gg-red/15 data-[pressed=true]:bg-gg-red data-[pressed=true]:text-gg-void`}
              >
                {choice === 'reject' ? '[ REJECTED ]' : '[ REJECT (N) ]'}
              </button>
            </div>

            <div className="font-pixel flex items-center justify-between gap-3 text-[8px] leading-none text-gg-mute">
              <span className="flex items-center gap-2">
                {choice ? (
                  <span>DECISION LOGGED</span>
                ) : (
                  <>
                    <span className="gg-apv-dot" aria-hidden />
                    <span>
                      {requester.short} PAUSED · {mmss(waited)}
                    </span>
                  </>
                )}
              </span>
              <span>PRESS Y / N</span>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

function Meta({ label, value, valueClass = 'text-gg-ink' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex flex-col gap-2 border-gg-haze px-3 py-2 not-last:border-b-2 sm:not-last:border-r-2 sm:not-last:border-b-0">
      <dt className="font-pixel text-[8px] leading-none text-gg-mute">{label}</dt>
      <dd className={`text-[18px] leading-none ${valueClass}`}>{value}</dd>
    </div>
  )
}
