// Command input at the bottom of the city: suggestions, phase tracker, prompt bar.
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, KeyboardEvent } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { CornerDownLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useGrid } from '@/store/grid'
import type { TaskPhase } from '@/types'
import './CommandBar.css'

const SUGGESTIONS = ['Clean the build and rebuild', 'Fix the failing auth test', 'Add a dark mode toggle']

const STEPS = [
  { id: 'dispatch', label: 'DISPATCH', color: 'var(--gg-cyan)' },
  { id: 'working', label: 'WORKING', color: 'var(--gg-green)' },
  { id: 'approval', label: 'APPROVAL', color: 'var(--gg-yellow)' },
  { id: 'done', label: 'DONE', color: 'var(--gg-cyan)' },
] as const

const PHASE_COLOR: Record<TaskPhase, string> = {
  dispatch: 'var(--gg-cyan)',
  working: 'var(--gg-green)',
  approval: 'var(--gg-yellow)',
  done: 'var(--gg-cyan)',
  rejected: 'var(--gg-red)',
}

const EASE = [0.2, 0.8, 0.2, 1] as const
const isBusyPhase = (p: TaskPhase | undefined) => p === 'dispatch' || p === 'working' || p === 'approval'
const cssVar = (c: string) => ({ '--gg-cmd-c': c }) as CSSProperties

function useElapsed(since: number | undefined, running: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(t)
  }, [running])
  return since ? Math.max(0, now - since) : 0
}

function ElapsedTime({ since }: { since: number | undefined }) {
  const elapsedMs = useElapsed(since, true)
  return <span className="ml-2 hidden font-pixel text-[8px] leading-none text-gg-mute tabular-nums sm:inline">T+{(elapsedMs / 1000).toFixed(1)}s</span>
}

function PhaseTracker({ phase, approved, createdAt }: { phase: TaskPhase; approved: boolean; createdAt: number | undefined }) {
  // After approval the store goes back to 'working'; keep the tracker moving forward.
  const postApproval = phase === 'working' && approved
  const current = phase === 'rejected' ? 3 : postApproval ? 2 : STEPS.findIndex((s) => s.id === phase)

  return (
    <div className="flex h-8 items-center gap-2 border-2 border-b-0 border-gg-haze bg-gg-night px-3 group-focus-within:border-gg-cyan">
      {STEPS.map((step, i) => {
        let label: string = step.label
        let color: string = step.color
        if (i === 3 && phase === 'rejected') {
          label = 'REJECTED'
          color = 'var(--gg-red)'
        } else if (i === 2 && postApproval) {
          label = 'APPROVED'
          color = 'var(--gg-green)'
        }
        const state = i < current ? 'past' : i === current ? 'on' : 'off'
        const blink = state === 'on' && phase === 'approval'
        return (
          <div key={step.id} className="flex items-center gap-2" aria-current={state === 'on' ? 'step' : undefined}>
            {i > 0 && <span className={cn('h-[2px] w-2 sm:w-3', i <= current ? 'bg-gg-mute' : 'bg-gg-haze')} />}
            <span
              className={cn('gg-cmd-pip', `gg-cmd-pip-${state}`, blink && 'gg-cmd-blink')}
              style={state === 'on' ? cssVar(color) : undefined}
            />
            <span
              className={cn(
                'font-pixel text-[8px] leading-none',
                state === 'on' ? '' : 'hidden sm:inline',
                state === 'past' && 'text-gg-mute',
                state === 'off' && 'text-gg-mute/40',
                blink && 'gg-cmd-blink',
              )}
              style={state === 'on' ? { color } : undefined}
            >
              {label}
            </span>
          </div>
        )
      })}
      {isBusyPhase(phase) && (
        <ElapsedTime since={createdAt} />
      )}
    </div>
  )
}

export function CommandBar() {
  const phase = useGrid((s) => s.task?.phase)
  const command = useGrid((s) => s.task?.command)
  const createdAt = useGrid((s) => s.task?.createdAt)
  const approved = useGrid((s) => !!s.task?.approval)
  const busy = isBusyPhase(phase)

  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const [histIdx, setHistIdx] = useState<number | null>(null)
  const draftRef = useRef('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Global "/" focuses the command line unless the user is already typing somewhere.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const a = document.activeElement as HTMLElement | null
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)) return
      const el = inputRef.current
      if (!el || el.disabled) return
      e.preventDefault()
      el.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const submit = (raw: string) => {
    const cmd = raw.trim()
    if (!cmd || useGrid.getState().isBusy()) return
    setHistory((h) => (h[h.length - 1] === cmd ? h : [...h, cmd].slice(-50)))
    setHistIdx(null)
    draftRef.current = ''
    setText('')
    void useGrid.getState().runCommand(cmd)
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    submit(text)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape') {
      e.currentTarget.blur()
      return
    }
    if (e.key === 'ArrowUp') {
      if (history.length === 0) return
      e.preventDefault()
      if (histIdx === null) draftRef.current = text
      const next = histIdx === null ? history.length - 1 : Math.max(0, histIdx - 1)
      setHistIdx(next)
      setText(history[next])
    } else if (e.key === 'ArrowDown') {
      if (histIdx === null) return
      e.preventDefault()
      if (histIdx < history.length - 1) {
        setHistIdx(histIdx + 1)
        setText(history[histIdx + 1])
      } else {
        setHistIdx(null)
        setText(draftRef.current)
      }
    }
  }

  const color = phase ? PHASE_COLOR[phase] : 'var(--gg-cyan)'
  const canRun = !busy && text.trim().length > 0
  const slide = { duration: 0.25, ease: EASE }

  return (
    <MotionConfig reducedMotion="user">
      <div className="absolute bottom-4 left-1/2 z-40 -translate-x-1/2" style={{ width: 'min(760px, calc(100vw - 32px))' }}>
        {/* Suggestions */}
        <AnimatePresence initial={false}>
          {!busy && (
            <motion.div
              key="chips"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={slide}
              className="mb-3 flex flex-wrap items-center gap-2"
            >
              <span className="mr-1 font-pixel text-[8px] leading-none text-gg-mute">TRY</span>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => submit(s)}
                  className="group/chip flex items-center gap-2 border-2 border-gg-haze bg-gg-night px-2 py-1 text-[18px] leading-none text-gg-ink shadow-[2px_2px_0_0_rgba(0,0,0,0.5)] transition-none hover:-translate-x-[2px] hover:-translate-y-[2px] hover:border-gg-cyan hover:text-gg-cyan hover:shadow-[4px_4px_0_0_rgba(0,0,0,0.5)] focus-visible:border-gg-cyan focus-visible:outline-none active:translate-x-0 active:translate-y-0 active:shadow-none"
                >
                  <span className="size-1 bg-gg-pink group-hover/chip:bg-gg-cyan" />
                  {s}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="group" style={{ filter: 'drop-shadow(4px 4px 0 rgba(0, 0, 0, 0.5))' }}>
          {/* Phase tracker + result tab, attached to the top edge of the bar */}
          <div className="relative z-10 -mb-[2px] flex items-end justify-between gap-2 overflow-hidden">
            <AnimatePresence initial={false}>
              {phase && (
                <motion.div
                  key="tracker"
                  initial={{ y: '100%' }}
                  animate={{ y: 0 }}
                  exit={{ y: '100%' }}
                  transition={slide}
                >
                  <PhaseTracker phase={phase} approved={approved} createdAt={createdAt} />
                </motion.div>
              )}
            </AnimatePresence>
            <AnimatePresence initial={false}>
              {phase === 'done' && (
                <motion.button
                  key="result"
                  type="button"
                  initial={{ y: '100%' }}
                  animate={{ y: 0 }}
                  exit={{ y: '100%' }}
                  transition={slide}
                  onClick={() => useGrid.getState().openResult()}
                  className="flex h-8 shrink-0 items-center gap-2 border-2 border-b-0 border-gg-cyan bg-gg-cyan px-3 font-pixel text-[10px] leading-none text-gg-void hover:border-gg-pink hover:bg-gg-pink focus-visible:outline-none focus-visible:underline"
                >
                  VIEW RESULT
                </motion.button>
              )}
            </AnimatePresence>
          </div>

          {/* Prompt bar */}
          <form
            onSubmit={onSubmit}
            className="gg-cmd-bar relative flex items-center gap-3 overflow-hidden border-2 border-gg-haze bg-gg-night py-2 pl-3 pr-2 focus-within:border-gg-cyan"
          >
            <span aria-hidden className="gg-cmd-scan pointer-events-none absolute inset-0" />

            <span aria-hidden className="relative flex w-5 shrink-0 items-center justify-center" style={cssVar(color)}>
              {busy ? (
                <span className="flex gap-[2px]">
                  <span className="gg-cmd-dot" />
                  <span className="gg-cmd-dot" />
                  <span className="gg-cmd-dot" />
                </span>
              ) : (
                <span className="gg-cmd-glyph font-pixel text-[12px] leading-none text-gg-cyan">&gt;</span>
              )}
            </span>

            <input
              ref={inputRef}
              value={busy ? (command ?? '') : text}
              onChange={(e) => {
                setText(e.target.value)
                setHistIdx(null)
              }}
              onKeyDown={onKeyDown}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              disabled={busy}
              placeholder="Tell the Router what to build…"
              aria-label="Command for the Router"
              autoComplete="off"
              spellCheck={false}
              className={cn(
                'relative h-8 min-w-0 flex-1 bg-transparent font-sans text-[22px] leading-none caret-gg-cyan outline-none placeholder:text-gg-mute/60',
                busy ? 'cursor-not-allowed text-gg-mute/70' : 'text-gg-ink',
              )}
            />

            {!busy && !focused && !text && (
              <kbd
                aria-hidden
                className="relative hidden h-6 min-w-6 items-center justify-center border-2 border-gg-haze px-1 font-pixel text-[8px] leading-none text-gg-mute sm:flex"
              >
                /
              </kbd>
            )}

            <button
              type="submit"
              disabled={!canRun}
              className={cn(
                'relative flex h-8 shrink-0 items-center gap-2 border-2 px-3 font-pixel text-[10px] leading-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gg-cyan',
                canRun
                  ? 'border-gg-cyan bg-gg-cyan text-gg-void shadow-[2px_2px_0_0_rgba(0,0,0,0.5)] hover:border-gg-pink hover:bg-gg-pink active:translate-x-[2px] active:translate-y-[2px] active:shadow-none'
                  : 'cursor-not-allowed border-gg-haze bg-transparent text-gg-mute/60',
              )}
            >
              RUN
              <CornerDownLeft size={16} strokeWidth={2.5} aria-hidden />
            </button>

            {busy && (
              <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0" style={cssVar(color)}>
                <span className="gg-cmd-sweep block" />
              </span>
            )}
          </form>
        </div>
      </div>
    </MotionConfig>
  )
}
