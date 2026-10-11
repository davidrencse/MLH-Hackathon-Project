// Dashboard shell: fixed TopNav (64px) + one scroll container below it (body has overflow:hidden).
// Inside: "CITY STATS" game frame, a sticky pixel tab strip, then the current page.
import { useEffect, useRef } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowLeft } from 'lucide-react'
import { TopNav } from '@/components/TopNav'
import { useGrid } from '@/store/grid'
import { useKeys } from '@/store/keys'
import './ConsoleLayout.css'

const FOCUS = 'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gg-cyan'

const TABS: { to: string; label: string; end?: boolean }[] = [
  { to: '/dashboard', label: 'OVERVIEW', end: true },
  { to: '/dashboard/agents', label: 'AGENTS' },
  { to: '/dashboard/activity', label: 'ACTIVITY' },
  { to: '/dashboard/keys', label: 'API KEYS' },
]

function tabClass({ isActive }: { isActive: boolean }) {
  const base = `font-pixel relative -ml-0.5 flex h-10 shrink-0 items-center gap-2 border-2 px-4 text-[10px] leading-none first:ml-0 ${FOCUS}`
  return isActive
    ? `${base} z-10 border-gg-cyan bg-gg-cyan text-gg-void shadow-[4px_4px_0_0_rgba(0,0,0,.5)]`
    : `${base} border-gg-haze bg-gg-void text-gg-mute hover:z-10 hover:border-gg-pink hover:text-gg-pink`
}

// L-shaped pixel brackets on the four corners of the parent (parent must be `relative`).
function Corners() {
  const c = 'pointer-events-none absolute size-4 border-gg-pink'
  return (
    <>
      <span aria-hidden className={`${c} -top-1 -left-1 border-t-4 border-l-4`} />
      <span aria-hidden className={`${c} -top-1 -right-1 border-t-4 border-r-4`} />
      <span aria-hidden className={`${c} -bottom-1 -left-1 border-b-4 border-l-4`} />
      <span aria-hidden className={`${c} -right-1 -bottom-1 border-r-4 border-b-4`} />
    </>
  )
}

function StatsHeader() {
  const count = useGrid((s) => s.order.filter((id) => s.buildings[id].type !== 'router').length)
  return (
    <header className="relative mb-6 border-2 border-gg-haze bg-gg-night px-6 py-5 shadow-[4px_4px_0_0_rgba(0,0,0,.5)]">
      <Corners />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="font-pixel text-[16px] leading-none text-gg-ink">
            CITY <span className="text-gg-pink">STATS</span>
          </p>
          <p className="font-pixel mt-3 text-[8px] leading-none text-gg-mute">
            CITY: <span className="text-gg-cyan">SLOP ANGELES</span> · DAY 1
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <span className="font-pixel flex items-center gap-2 text-[8px] leading-none text-gg-green">
            <span aria-hidden className="block size-2 bg-gg-green shadow-[0_0_6px_rgba(57,255,20,.6)]" />
            LIVE
          </span>
          <span className="text-[20px] leading-none text-gg-mute">
            <span className="text-gg-ink">{count}</span> buildings
          </span>
          <Link
            to="/"
            className={`font-pixel inline-flex h-10 items-center gap-2 border-2 border-gg-cyan bg-gg-void px-4 text-[10px] leading-none text-gg-cyan shadow-[4px_4px_0_0_rgba(0,0,0,.5)] hover:bg-gg-cyan hover:text-gg-void active:translate-x-0.5 active:translate-y-0.5 active:shadow-[2px_2px_0_0_rgba(0,0,0,.5)] ${FOCUS}`}
          >
            <ArrowLeft size={16} strokeWidth={2.5} aria-hidden />
            BACK TO CITY
          </Link>
        </div>
      </div>
    </header>
  )
}

function TabStrip() {
  const noKeys = useKeys((s) => s.keys.length === 0)
  return (
    <nav
      aria-label="Dashboard"
      className="sticky top-0 z-20 -mx-6 mb-6 flex overflow-x-auto border-b-2 border-gg-haze bg-gg-void/90 px-6 py-3 max-sm:-mx-4 max-sm:px-4"
    >
      {TABS.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} className={tabClass}>
          {t.label}
          {t.to === '/dashboard/keys' && noKeys && (
            <span
              role="img"
              aria-label="No provider key added"
              title="No provider key added"
              className="gg-cl-bang grid size-4 place-items-center bg-gg-yellow text-[8px] leading-none text-gg-void"
            >
              !
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

export function DashboardLayout() {
  const { pathname } = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const reduce = useReducedMotion()

  // <main> keeps its scroll offset across routes; reset it like a normal page load.
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0)
  }, [pathname])

  return (
    <div className="h-full bg-gg-void">
      <TopNav />
      <main ref={mainRef} className="gg-cl-grid fixed inset-x-0 top-16 bottom-0 overflow-auto">
        <div className="mx-auto max-w-[1280px] px-6 py-6 max-sm:px-4">
          <StatsHeader />
          <TabStrip />
          <motion.div
            key={pathname}
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <Outlet />
          </motion.div>
        </div>
      </main>
    </div>
  )
}
