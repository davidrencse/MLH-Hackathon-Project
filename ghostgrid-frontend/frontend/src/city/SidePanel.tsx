// Right slide-out panel: building details.
//
// It used to have a second 'result' mode for a task result card, driven by a `task` slice in
// the grid store that nothing ever wrote — so the mode was unreachable and the card never
// rendered. Both are gone; when an approval/result flow exists, it gets a panel that is wired
// to it rather than one that has been waiting, inert, for a writer.
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, LayoutDashboard, X } from 'lucide-react'
import { useEffect, useRef, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useGrid } from '@/store/grid'
import { BuildingView } from './panel/BuildingView'
import { BTN } from './panel/buttons'
import './panel/panel.css'

const EASE = [0.2, 0.8, 0.2, 1] as const

const ACCENT = { building: { accent: 'var(--gg-pink)', glow: 'rgba(255, 43, 214, 0.5)' } }

export function SidePanel() {
  const panel = useGrid((s) => s.panel)
  // Any building type, including player-built ones. Returns one stable object (no new refs).
  const building = useGrid((s) => (s.selected ? (s.buildings[s.selected] ?? null) : null))
  const reduce = useReducedMotion()

  const open = panel === 'building' && building !== null

  // Keyboard focus follows the panel. Without this the panel opens behind the map's
  // ~28 label buttons in tab order, so reaching its contents from the keyboard meant
  // tabbing through the whole city; Esc then dropped focus to <body>.
  const shell = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!open) return
    // Captured for the cleanup: by the time the panel closes the ref may already be
    // cleared, and `opener` has to survive that to receive focus back.
    const node = shell.current
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    node?.focus({ preventScroll: true })
    return () => {
      // Only take focus back if it is still inside the closing panel: a click that
      // moved focus somewhere else must keep it.
      const active = document.activeElement
      if (active && active !== document.body && !node?.contains(active)) return
      opener?.focus({ preventScroll: true })
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      useGrid.getState().closePanel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const contentKey = `b-${building?.id}`
  const tone = ACCENT.building
  const kicker = `// AGENT.INSPECT ${building?.short ?? ''}`

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="gg-side-panel"
          ref={shell}
          tabIndex={-1}
          role="dialog"
          aria-modal={false}
          aria-label={`${building?.name ?? ''} details`}
          initial={reduce ? { opacity: 0 } : { x: '100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { x: '100%', opacity: 0 }}
          transition={{ duration: 0.25, ease: EASE }}
          data-hud-panel
          className="gg-sp-shell absolute top-20 right-4 bottom-4 z-50 flex w-[380px] max-w-[calc(100%-2rem)] flex-col border-2 border-gg-haze bg-gg-night focus:outline-none"
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
                  {building && <BuildingView building={building} />}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          {/* Footer actions */}
          <div className="shrink-0 border-t-2 border-gg-haze bg-gg-void p-3">
            {building && (
              <Link to={`/dashboard/agents/${building.id}`} className={`${BTN.cyan} w-full justify-between`}>
                <span className="flex items-center gap-2">
                  <LayoutDashboard size={16} strokeWidth={2.5} />
                  Open in dashboard
                </span>
                <ArrowRight size={16} strokeWidth={2.5} />
              </Link>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
