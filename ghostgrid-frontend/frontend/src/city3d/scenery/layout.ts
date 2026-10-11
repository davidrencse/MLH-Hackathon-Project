// Filler city blocks: the dense, non-interactive buildings that pack the sidewalk space
// between the agent lots so the island reads as a city instead of five towers on a slab.
//
// Everything here is deterministic (seeded) — the city must look identical on every reload.
// Placement is a greedy packer over an occupancy grid that already contains the roads, the
// agent/lease LOTS (never covered: the player clicks those) and the street furniture.
import { CURB, LAMPS, LAMP_REACH, PROPS, PUDDLES } from '../ground/layout'
import { LOTS, MAP, ROAD_INDEXES } from '../world'

const HALF = MAP.size / 2
const CELL = 0.25 // occupancy grid resolution, world units
const G = Math.round(MAP.size / CELL)
const LOT_CLEAR = 0.45 // lot footprint + selection frame + a walkable gap
const ROAD_CLEAR = 0.18 // keep the curb edge free
const PROP_CLEAR = 0.4 // lamps, vending machines, benches, puddles
const RIM_CLEAR = 0.5 // stay inside the platform's neon rim
const ALLEY = 0.25 // gap between two filler buildings

export type RoofKind = 'tank' | 'ac' | 'antenna' | 'stair' | 'none'

export interface Tier {
  /** center, world units (y = bottom of the tier) */
  x: number
  y: number
  z: number
  w: number
  h: number
  d: number
}

export interface SceneryBuilding {
  x: number
  z: number
  w: number
  d: number
  /** roof height above the sidewalk */
  h: number
  tiers: Tier[]
  wall: number // index into WALLS
  neon: number // index into NEONS
  roof: RoofKind
  /** vertical neon sign on the camera-facing face */
  sign: boolean
  /** neon bar cantilevered over the sidewalk */
  hanging: boolean
  seed: number
}

// Dark wall variants. Lambert shading does the top/side separation, so these only need to
// differ enough to break up the skyline.
export const WALLS = ['#1a1040', '#150e36', '#20164a', '#120b2a', '#241a52']
export const NEONS = ['#ff2bd6', '#00f0ff', '#39ff14', '#ffd400', '#ff9d4d', '#4d7cff']

function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

// ---------- occupancy grid ----------
const toCell = (world: number) => Math.floor((world + HALF) / CELL)

function markRect(grid: Uint8Array, x0: number, z0: number, x1: number, z1: number) {
  const cx0 = Math.max(0, toCell(x0))
  const cz0 = Math.max(0, toCell(z0))
  const cx1 = Math.min(G - 1, toCell(x1 - 1e-6))
  const cz1 = Math.min(G - 1, toCell(z1 - 1e-6))
  for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) grid[cz * G + cx] = 1
}

function buildGrid() {
  const grid = new Uint8Array(G * G)
  // platform rim
  markRect(grid, -HALF, -HALF, HALF, -HALF + RIM_CLEAR)
  markRect(grid, -HALF, HALF - RIM_CLEAR, HALF, HALF)
  markRect(grid, -HALF, -HALF, -HALF + RIM_CLEAR, HALF)
  markRect(grid, HALF - RIM_CLEAR, -HALF, HALF, HALF)
  // roads (full rows and columns), widened so nothing overhangs the curb
  for (const i of ROAD_INDEXES) {
    const a = i - HALF - ROAD_CLEAR
    const b = i + 1 - HALF + ROAD_CLEAR
    markRect(grid, -HALF, a, HALF, b)
    markRect(grid, a, -HALF, b, HALF)
  }
  // agent + lease lots
  for (const l of LOTS)
    markRect(grid, l.tx - HALF - LOT_CLEAR, l.tz - HALF - LOT_CLEAR, l.tx + l.w - HALF + LOT_CLEAR, l.tz + l.d - HALF + LOT_CLEAR)
  // street furniture
  for (const l of LAMPS) {
    markRect(grid, l.x - PROP_CLEAR, l.z - PROP_CLEAR, l.x + PROP_CLEAR, l.z + PROP_CLEAR)
    const hx = l.x + l.ax * LAMP_REACH
    const hz = l.z + l.az * LAMP_REACH
    markRect(grid, hx - PROP_CLEAR, hz - PROP_CLEAR, hx + PROP_CLEAR, hz + PROP_CLEAR)
  }
  for (const p of PROPS) markRect(grid, p.x - PROP_CLEAR, p.z - PROP_CLEAR, p.x + PROP_CLEAR, p.z + PROP_CLEAR)
  for (const p of PUDDLES) markRect(grid, p.x - PROP_CLEAR, p.z - PROP_CLEAR, p.x + PROP_CLEAR, p.z + PROP_CLEAR)
  return grid
}

function free(grid: Uint8Array, x0: number, z0: number, w: number, d: number) {
  const cx0 = toCell(x0)
  const cz0 = toCell(z0)
  const cx1 = toCell(x0 + w - 1e-6)
  const cz1 = toCell(z0 + d - 1e-6)
  if (cx0 < 0 || cz0 < 0 || cx1 >= G || cz1 >= G) return false
  for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) if (grid[cz * G + cx]) return false
  return true
}

// ---------- silhouette rules ----------
// The camera sits at (+x, +y, +z), so x + z grows toward the viewer. Filler in front of the
// landmarks must stay low or it hides them; filler behind them can tower and frame the skyline.
function heightLimit(x: number, z: number) {
  const depth = x + z
  if (depth > 6) return 1.5
  if (depth > 2) return 2.2
  if (depth > -3) return 3.2
  if (depth > -8) return 4.6
  return 5.8
}

// Footprints the packer tries, largest first, so wide gaps get wide buildings.
const SIZES: [number, number][] = [
  [2.5, 2],
  [2, 2.5],
  [2, 2],
  [2.5, 1.5],
  [1.5, 2.5],
  [2, 1.5],
  [1.5, 2],
  [1.5, 1.5],
  [1.75, 1.25],
  [1.25, 1.75],
  [1.25, 1.25],
  [1, 1],
]

function tiersFor(b: Omit<SceneryBuilding, 'tiers'>, r: () => number): Tier[] {
  const out: Tier[] = []
  // 1–3 stacked boxes, each stepped in a little: the classic setback skyline silhouette.
  const count = b.h < 2 ? 1 : b.h < 3.4 ? (r() < 0.45 ? 1 : 2) : r() < 0.3 ? 2 : 3
  let y = 0
  let w = b.w
  let d = b.d
  for (let i = 0; i < count; i++) {
    // last tier takes whatever height is left
    const h = i === count - 1 ? b.h - y : Math.max(0.6, (b.h / count) * (0.75 + r() * 0.5))
    out.push({ x: b.x, y, z: b.z, w, h, d })
    y += h
    if (y >= b.h - 0.3) break
    const step = 0.2 + r() * 0.3
    w = Math.max(0.6, w - step)
    d = Math.max(0.6, d - step)
  }
  return out
}

export function layoutScenery(): SceneryBuilding[] {
  const grid = buildGrid()
  const r = rng(90210)
  const out: SceneryBuilding[] = []

  for (const [w, d] of SIZES) {
    // Scan on the ALLEY lattice so neighbours line up along the street instead of drifting.
    for (let z = -HALF; z < HALF - d; z += ALLEY) {
      for (let x = -HALF; x < HALF - w; x += ALLEY) {
        if (!free(grid, x, z, w, d)) continue
        const cx = x + w / 2
        const cz = z + d / 2
        const limit = heightLimit(cx, cz)
        const h = Math.max(0.9, limit * (0.5 + r() * 0.5))
        const base: Omit<SceneryBuilding, 'tiers'> = {
          x: cx,
          z: cz,
          w,
          d,
          h,
          wall: Math.floor(r() * WALLS.length),
          neon: Math.floor(r() * NEONS.length),
          roof: (['tank', 'ac', 'antenna', 'stair', 'none', 'ac', 'antenna'] as RoofKind[])[Math.floor(r() * 7)],
          // signage only where it reads: tall enough, and not on the tiny infill boxes
          sign: h > 1.6 && r() < 0.5,
          hanging: h > 1.3 && r() < 0.28,
          seed: Math.floor(r() * 1e6),
        }
        out.push({ ...base, tiers: tiersFor(base, r) })
        // claim the footprint plus an alley so the next building keeps its distance
        markRect(grid, x - ALLEY, z - ALLEY, x + w + ALLEY, z + d + ALLEY)
      }
    }
  }
  return out
}

/** Ground level the filler sits on (the raised sidewalk, not the road). */
export const SCENERY_Y = CURB
