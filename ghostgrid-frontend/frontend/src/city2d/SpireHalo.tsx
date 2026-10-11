// Holographic halo above Router Spire. Rendered INSIDE the integer-scaled stage, in logical px.
// Pure CSS pixel art (no WebGPU canvas here): the shaders renderer sizes its canvas from
// getBoundingClientRect on init but from ResizeObserver content boxes afterwards, which disagree
// under the stage's CSS scale(). DOM pixels at integer positions stay crisp at every scale.
//
// Motion: framer-motion drives one frame loop. Every ring pixel is placed on an ellipse at an
// integer (x, y), so the ring "spins" around the spire's vertical axis like 8-bit 3D.
import { useEffect, useLayoutEffect, useRef } from 'react'
import { animate, useAnimationFrame, useMotionValue, useReducedMotion } from 'framer-motion'
import { useGrid } from '../store/grid'
import { HALO } from './layout'
import './shader-sky.css'

type HaloState = 'calm' | 'approval' | 'error'

const TAU = Math.PI * 2
const C = HALO.size / 2
const TURN_CALM_MS = 6000
const TURN_WORKING_MS = 2000

interface Orbit {
  rx: number
  ry: number
  cy: number
  tilt: number // y shift per unit of x: a slightly tilted orbit plane
}

const OUTER: Orbit = { rx: 17, ry: 5, cy: C + 1, tilt: 0 }
const INNER: Orbit = { rx: 10, ry: 3, cy: C - 6, tilt: 0 }
const SAT: Orbit = { rx: 22, ry: 7, cy: C, tilt: 0.16 }

// Antenna tip of Router Spire is at stage y 28 (see buildings/RouterSpire.tsx); in halo-local px:
const TIP = 28 - (HALO.y - C)
const RING_TOP = INNER.cy - INNER.ry

// Ring slots: which are lit, which are the pink leading pixel of an arc.
const OUTER_SLOTS = Array.from({ length: 30 }, (_, i) => i).filter((i) => i % 10 < 6)
const INNER_SLOTS = Array.from({ length: 16 }, (_, i) => i).filter((i) => i % 8 < 4)
const OUTER_N = 30
const INNER_N = 16

// Satellites: speed multiplier (negative = counter-orbit) and phase offset.
const SATS = [
  { speed: 0.7, offset: 0.0, tone: 'hi' },
  { speed: -1.15, offset: 0.4, tone: 'main' },
  { speed: 1.6, offset: 0.72, tone: 'ink' },
] as const

function point(o: Orbit, angle: number) {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return {
    x: Math.round(C + o.rx * cos),
    y: Math.round(o.cy + o.ry * sin + o.tilt * o.rx * cos),
    front: sin > 0,
  }
}

// Static ellipse track as box-shadow pixels on a 1×1 element.
function trackShadow(o: Orbit): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (let i = 0; i < 160; i++) {
    const p = point(o, (i / 160) * TAU)
    const k = `${p.x},${p.y}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(`${p.x}px ${p.y}px 0 0 currentColor`)
  }
  return out.join(',')
}
const OUTER_TRACK = trackShadow(OUTER)
const INNER_TRACK = trackShadow(INNER)

interface Refs {
  outer: (HTMLSpanElement | null)[]
  inner: (HTMLSpanElement | null)[]
  sats: (HTMLSpanElement | null)[]
  trails: (HTMLSpanElement | null)[]
}

function put(el: HTMLSpanElement | null, x: number, y: number, front: boolean, dim: number) {
  if (!el) return
  el.style.transform = `translate(${x}px, ${y}px)`
  el.style.zIndex = front ? '3' : '1'
  el.style.opacity = front ? '1' : String(dim)
}

function layout(refs: Refs, phase: number) {
  OUTER_SLOTS.forEach((slot, i) => {
    const p = point(OUTER, (phase + slot / OUTER_N) * TAU)
    put(refs.outer[i], p.x - 1, p.y, p.front, 0.4) // 2px wide segment, centered
  })
  INNER_SLOTS.forEach((slot, i) => {
    const p = point(INNER, (-phase * 1.4 + slot / INNER_N) * TAU)
    put(refs.inner[i], p.x, p.y, p.front, 0.3)
  })
  SATS.forEach((s, i) => {
    const a = (phase * s.speed + s.offset) * TAU
    const p = point(SAT, a)
    put(refs.sats[i], p.x - 1, p.y - 1, p.front, 0.45)
    const t = point(SAT, a - Math.sign(s.speed) * 0.32)
    put(refs.trails[i], t.x, t.y, t.front, 0.25)
  })
}

export function SpireHalo() {
  const state = useGrid((s): HaloState => {
    if (s.buildings.router.status === 'error') return 'error'
    for (const b of Object.values(s.buildings)) if (b.status === 'needs_approval') return 'approval'
    return 'calm'
  })
  const working = useGrid((s) => s.buildings.router.status === 'working')
  const still = useReducedMotion() === true

  const refs = useRef<Refs>({ outer: [], inner: [], sats: [], trails: [] })
  const phase = useRef(0.08)
  const turnsPerMs = useMotionValue(1 / TURN_CALM_MS)

  // Spin up / spin down smoothly when the router starts or stops working.
  useEffect(() => {
    const ctrl = animate(turnsPerMs, 1 / (working ? TURN_WORKING_MS : TURN_CALM_MS), { duration: 0.8, ease: 'easeInOut' })
    return () => ctrl.stop()
  }, [working, turnsPerMs])

  // Place pixels before first paint (and as the static pose under reduced motion).
  useLayoutEffect(() => {
    layout(refs.current, phase.current)
  }, [])

  useAnimationFrame((_, delta) => {
    if (still) return
    phase.current = (phase.current + Math.min(delta, 100) * turnsPerMs.get()) % 1
    layout(refs.current, phase.current)
  })

  return (
    <div
      className="gg-halo"
      data-state={state}
      data-working={working}
      aria-hidden="true"
      style={{ left: HALO.x - C, top: HALO.y - C, width: HALO.size, height: HALO.size }}
    >
      {/* projector: light cone + core beam from the antenna tip up through the rings, faint beam above */}
      <div className="gg-halo-cone">
        <i style={{ left: C - 1, top: TIP - 4, width: 2, height: 4 }} />
        <i style={{ left: C - 3, top: TIP - 8, width: 6, height: 4 }} />
        <i style={{ left: C - 5, top: TIP - 12, width: 10, height: 4 }} />
        <i style={{ left: C - 7, top: RING_TOP, width: 14, height: TIP - 12 - RING_TOP }} />
      </div>
      <i className="gg-halo-beam" style={{ left: C - 1, top: RING_TOP, height: TIP - RING_TOP }} />
      <i className="gg-halo-beam-up" style={{ left: C - 1, top: RING_TOP - 14, height: 14 }} />
      <i className="gg-halo-packet" style={{ left: C - 1 }} />

      {/* static ellipse tracks */}
      <i className="gg-halo-track" style={{ boxShadow: OUTER_TRACK }} />
      <i className="gg-halo-track gg-halo-track--inner" style={{ boxShadow: INNER_TRACK }} />

      {/* floating data core */}
      <i className="gg-halo-core" style={{ left: C - 2, top: C - 2 }} />

      {OUTER_SLOTS.map((slot, i) => (
        <span
          key={`o${slot}`}
          ref={(el) => {
            refs.current.outer[i] = el
          }}
          className={slot % 10 === 5 ? 'gg-halo-px gg-halo-px--seg gg-halo-px--hi' : 'gg-halo-px gg-halo-px--seg'}
        />
      ))}
      {INNER_SLOTS.map((slot, i) => (
        <span
          key={`i${slot}`}
          ref={(el) => {
            refs.current.inner[i] = el
          }}
          className={slot % 8 === 0 ? 'gg-halo-px gg-halo-px--hi' : 'gg-halo-px'}
        />
      ))}
      {SATS.map((s, i) => (
        <span
          key={`t${i}`}
          ref={(el) => {
            refs.current.trails[i] = el
          }}
          className={`gg-halo-px gg-halo-px--${s.tone}`}
        />
      ))}
      {SATS.map((s, i) => (
        <span
          key={`s${i}`}
          ref={(el) => {
            refs.current.sats[i] = el
          }}
          className={`gg-halo-px gg-halo-px--sat gg-halo-px--${s.tone}`}
        />
      ))}
    </div>
  )
}
