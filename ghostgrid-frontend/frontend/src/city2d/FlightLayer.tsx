// Drones and data packets flying between building docks, inside the 384×216 stage.
// One progress value p (0→1, easeInOut) drives each flight; x/y are derived from an
// arc and rounded to whole logical px so sprites stay pixel-snapped.
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion'
import type { MotionValue } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useGrid } from '../store/grid'
import type { Flight, FlightKind } from '../types'
import { Burst, DroneSprite, PacketSprite, ParkedDrone, PatrolDrone, SmokePuff, Spark } from './Drone'
import { DOCK, isStageBuilding } from './layout'
import type { StageBuildingId } from './layout'

const HOVER = 2 // drones hover this many logical px above a dock
const PEAK: Record<FlightKind, number> = { drone: 26, 'drone-cargo': 24, packet: 24 } // apex height above the higher dock
const KIND_COLOR: Record<FlightKind, string> = {
  drone: 'var(--gg-cyan)',
  'drone-cargo': 'var(--gg-green)',
  packet: 'var(--gg-yellow)',
}
const PACKET_GHOSTS = [
  { lag: 0.105, opacity: 0.15 },
  { lag: 0.07, opacity: 0.3 },
  { lag: 0.035, opacity: 0.55 },
]
const SPARKS = [
  { lag: 0.06, color: 'var(--gg-cyan)', opacity: 0.3 },
  { lag: 0.04, color: 'var(--gg-pink)', opacity: 0.5 },
  { lag: 0.02, color: 'var(--gg-cyan)', opacity: 0.8 },
]
// Keep the exiting flight fully visible (landing burst, smoke) and then cut it.
const HOLD = (t: number) => (t >= 1 ? 1 : 0)

type Pt = { x: number; y: number }
type Path = (t: number) => Pt

// y(t) = y0 + d·t − 4H·t(1−t). H is solved so the apex sits exactly `peak` px
// above the higher endpoint: H = (d + 2A + 2√(A(A+d))) / 4, A = y0 − apexY.
function arcPath(a: Pt, b: Pt, peak: number): Path {
  const d = b.y - a.y
  const A = a.y - (Math.min(a.y, b.y) - peak)
  const H = (d + 2 * A + 2 * Math.sqrt(A * (A + d))) / 4
  return (t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + d * t - 4 * H * t * (1 - t) })
}

// A flight between two buildings the 2D stage draws. Flights to/from other buildings are skipped.
type StageFlight = Flight & { from: StageBuildingId; to: StageBuildingId }
const onStage = (f: Flight): f is StageFlight => isStageBuilding(f.from) && isStageBuilding(f.to)

const dockPt = (id: StageBuildingId): Pt => ({ x: DOCK[id].x, y: DOCK[id].y - HOVER })

// A sprite that rides the path `lag` behind the flight head (lag 0 = the head).
function Follower({
  p,
  path,
  lag = 0,
  dy = 0,
  className = '',
  children,
}: {
  p: MotionValue<number>
  path: Path
  lag?: number
  dy?: number
  className?: string
  children: ReactNode
}) {
  const x = useTransform(p, (v) => Math.round(path(Math.max(0, v - lag)).x))
  const y = useTransform(p, (v) => Math.round(path(Math.max(0, v - lag)).y) + dy)
  return (
    <motion.div className={`gg-flt-anchor ${className}`} style={{ x, y }}>
      {children}
    </motion.div>
  )
}

let puffSeq = 0

function FlightSprite({ flight }: { flight: StageFlight }) {
  const reduced = useReducedMotion()
  const rejected = useGrid((s) => s.task?.phase === 'rejected')
  const from = dockPt(flight.from)
  const to = dockPt(flight.to)
  const path = useMemo(
    () => arcPath(dockPt(flight.from), dockPt(flight.to), PEAK[flight.kind]),
    [flight.from, flight.to, flight.kind],
  )

  // Late mount: start part-way along the path so arrival time still matches the store.
  const [p0] = useState(() => {
    const late = Date.now() - flight.startedAt
    return late > 50 ? Math.min(0.9, late / flight.durationMs) : 0
  })
  const p = useMotionValue(p0)
  const [landed, setLanded] = useState(false)

  useEffect(() => {
    const remaining = Math.max(200, flight.durationMs - (Date.now() - flight.startedAt))
    const ctl = animate(p, 1, { duration: remaining / 1000, ease: 'easeInOut', onComplete: () => setLanded(true) })
    return () => ctl.stop()
  }, [p, flight.durationMs, flight.startedAt])

  // A drone flying home after a rejected approval trails grey smoke.
  const damaged = flight.kind === 'drone' && rejected
  const smoky = damaged && !reduced
  const [puffs, setPuffs] = useState<{ id: number; x: number; y: number }[]>([])
  useEffect(() => {
    if (!smoky || landed) return
    const timer = setInterval(() => {
      const pt = path(p.get())
      const id = puffSeq++
      setPuffs((prev) => [...prev.slice(-7), { id, x: Math.round(pt.x) + ((id % 3) - 1), y: Math.round(pt.y) - 4 }])
    }, 110)
    return () => clearInterval(timer)
  }, [smoky, landed, path, p])

  const isPacket = flight.kind === 'packet'
  const sparkDy = flight.kind === 'drone-cargo' ? -7 : -2 // leg height; cargo anchor is the cube bottom
  const color = KIND_COLOR[flight.kind]

  return (
    <motion.div
      className="gg-flt-anchor"
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.5, ease: HOLD } }}
    >
      {p0 === 0 && <Burst x={from.x} y={from.y} color={color} />}

      {isPacket
        ? PACKET_GHOSTS.map((g) => (
            <Follower key={g.lag} p={p} path={path} lag={g.lag} className="gg-flt-trail">
              {!landed && <PacketSprite ghost={g.opacity} />}
            </Follower>
          ))
        : SPARKS.map((s) => (
            <Follower key={s.lag} p={p} path={path} lag={s.lag} dy={sparkDy} className="gg-flt-trail">
              {!landed && <Spark color={s.color} opacity={s.opacity} />}
            </Follower>
          ))}

      {puffs.map((pf) => (
        <SmokePuff key={pf.id} x={pf.x} y={pf.y} light={pf.id % 2 === 0} />
      ))}

      <Follower p={p} path={path}>
        <div className={landed ? 'gg-flt-dock' : undefined}>
          {isPacket ? (
            <PacketSprite />
          ) : (
            <DroneSprite cargo={flight.kind === 'drone-cargo'} flip={to.x < from.x} damaged={damaged} />
          )}
        </div>
      </Follower>

      {landed && <Burst x={to.x} y={to.y} color={color} />}
    </motion.div>
  )
}

export function FlightLayer() {
  // Filter outside the selector: a new array from the selector would re-render forever (zustand v5).
  const flights = useGrid((s) => s.flights).filter(onStage)
  const droneOut = flights.some((f) => f.kind !== 'packet')
  const home = dockPt('router')

  return (
    <div className="pointer-events-none absolute inset-0 z-30" aria-hidden>
      <PatrolDrone />
      {!droneOut && <ParkedDrone x={home.x} y={home.y} />}
      <AnimatePresence>
        {flights.map((f) => (
          <FlightSprite key={f.id} flight={f} />
        ))}
      </AnimatePresence>
    </div>
  )
}
