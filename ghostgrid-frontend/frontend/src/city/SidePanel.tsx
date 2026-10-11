// Right slide-out panel: building details (panel === 'building') or the task result card (panel === 'result').
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, LayoutDashboard, ScrollText, X } from 'lucide-react'
import { useEffect, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useGrid } from '@/store/grid'
import { BuildingView } from './panel/BuildingView'
import { BTN } from './panel/buttons'
import { ResultView } from './panel/ResultView'
import './panel/panel.css'

const EASE = [0.2, 0.8, 0.2, 1] as const

const ACCENT = {
  building: { accent: 'var(--gg-pink)', glow: 'rgba(255, 43, 214, 0.5)' },
  result: { accent: 'var(--gg-green)', glow: 'rgba(57, 255, 20, 0.5)' },
}

export function SidePanel() {
  const panel = useGrid((s) => s.panel)
  // Any building type, including player-built ones. Returns one stable object (no new refs).
  const building = useGrid((s) => (s.selected ? (s.buildings[s.selected] ?? null) : null))
  const command = useGrid((s) => s.task?.command ?? '')
  const result = useGrid((s) => s.task?.result)
  const reduce = useReducedMotion()

  const mode = panel === 'building' && building ? 'building' : panel === 'result' && result ? 'result' : null
  const open = mode !== null

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const s = useGrid.getState()
      if (s.task?.phase === 'approval') return // approval dialog owns Esc
      s.closePanel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const contentKey = mode === 'building' ? `b-${building?.id}` : 'result'
  const tone = ACCENT[mode ?? 'building']
  const kicker = mode === 'result' ? '// TASK.RESULT' : `// AGENT.INSPECT ${building?.short ?? ''}`

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="gg-side-panel"
          role="dialog"
          aria-modal={false}
          aria-label={mode === 'result' ? 'Task result' : `${building?.name ?? ''} details`}
          initial={reduce ? { opacity: 0 } : { x: '100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { x: '100%', opacity: 0 }}
          transition={{ duration: 0.25, ease: EASE }}
          className="gg-sp-shell absolute top-20 right-4 bottom-4 z-50 flex w-[380px] max-w-[calc(100%-2rem)] flex-col border-2 border-gg-haze bg-gg-night"
          style={{ '--gg-sp-accent': tone.accent, '--gg-sp-glow': tone.glow } as CSSProperties}
        >
          <span className="gg-sp-corner gg-sp-corner-tl" />
          <span className="gg-sp-corner gg-sp-corner-tr" />
          <span className="gg-sp-corner gg-sp-corner-bl" />
          <span className="gg-sp-corner gg-sp-corner-br" />
          <div className="gg-sp-strip h-1 shrink-0" />

          {/* Title bar */}
          <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b-2 border-gg-haze bg-gg-void pr-1 pl-3">
            <span className="font-pixel truncate text-[8px] leading-none text-gg-mute">{kicker}</span>
            <button
              type="button"
              onClick={() => useGrid.getState().closePanel()}
              aria-label="Close panel (Esc)"
              title="Close (Esc)"
              className="gg-sp-btn flex size-8 shrink-0 items-center justify-center border-2 border-gg-haze bg-gg-night text-gg-mute hover:border-gg-pink hover:text-gg-pink"
            >
              <X size={16} strokeWidth={2.5} />
            </button>
          </div>

          {/* Scrolling content */}
          <div className="relative min-h-0 flex-1">
            <div className="gg-sp-scan absolute inset-0" />
            <div className="gg-sp-scroll relative h-full overflow-y-auto p-4">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={contentKey}
                  initial={reduce ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? undefined : { opacity: 0, y: -8 }}
                  transition={{ duration: 0.15, ease: EASE }}
                >
                  {mode === 'building' && building && <BuildingView building={building} />}
                  {mode === 'result' && result && <ResultView command={command} result={result} />}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          {/* Footer actions */}
          <div className="shrink-0 border-t-2 border-gg-haze bg-gg-void p-3">
            {mode === 'building' && building && (
              <Link to={`/dashboard/agents/${building.id}`} className={`${BTN.cyan} w-full justify-between`}>
                <span className="flex items-center gap-2">
                  <LayoutDashboard size={16} strokeWidth={2.5} />
                  Open in dashboard
                </span>
                <ArrowRight size={16} strokeWidth={2.5} />
              </Link>
            )}
            {mode === 'result' && (
              <div className="flex gap-3">
                <Link to="/dashboard/activity" className={`${BTN.cyan} min-w-0 flex-1 whitespace-nowrap`}>
                  <ScrollText size={16} strokeWidth={2.5} className="shrink-0" />
                  Open request logs
                </Link>
                <button
                  type="button"
                  onClick={() => useGrid.getState().closePanel()}
                  className={`${BTN.green} shrink-0 whitespace-nowrap`}
                >
                  New command
                </button>
              </div>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
