// Filler city blocks: the dense, non-interactive buildings that pack the sidewalk space
// between the agent lots so the island reads as a city instead of five towers on a slab.
//
// Everything here is deterministic (seeded) — the city must look identical on every reload.
// Placement is a greedy packer over an occupancy grid that already contains the roads, the
// agent/lease LOTS (never covered: the player clicks those) and the street furniture.
import { CURB, LAMPS, LAMP_REACH, PROPS, PUDDLES } from '../ground/layout'
import { CORE_LOTS, districtReserved, MAP, OUTER_LOT_RECTS, ROAD_INDEXES, WALL_ST_PLOT } from '../world'

// Two cities get packed with the same code: the core island, whose free ground is whatever the
// landmark lots, districts and street furniture leave over, and an outer plate, which has none
// of that furniture but keeps its nine super-blocks clear. Identical on every plate, so the
// layout is computed once per variant and shared (see the cache at the bottom).
// 'wallst' is the east plate: an outer plate that also has to leave room for the trading
// district standing on it (see WALL_ST_PLOT in world.ts).
export type SceneryVariant = 'core' | 'outer' | 'wallst'

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
  /** a hero skyscraper from the tower pass, not packed filler: gets a crown and a mast */
  tower: boolean
  seed: number
}

// Dark wall variants. Lambert shading does the top/side separation, so these only need to
// differ enough to break up the skyline.
export const WALLS = ['#30475e', '#26394e', '#435367', '#29475b', '#51435c']
export const NEONS = ['#42e8ed', '#ff4da6', '#b6f36b', '#ffcd70', '#688dff', '#ff995a']

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

function buildGrid(variant: SceneryVariant) {
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
  // An outer plate has no landmarks or street furniture — only its own super-blocks, plus the
  // district standing on it if one does.
  if (variant === 'outer' || variant === 'wallst') {
    for (const r of OUTER_LOT_RECTS)
      markRect(grid, r.x0 - LOT_CLEAR, r.z0 - LOT_CLEAR, r.x1 + LOT_CLEAR, r.z1 + LOT_CLEAR)
    if (variant === 'wallst') {
      for (const r of districtReserved(WALL_ST_PLOT))
        markRect(grid, r.x0 - LOT_CLEAR, r.z0 - LOT_CLEAR, r.x1 + LOT_CLEAR, r.z1 + LOT_CLEAR)
    }
    return grid
  }
  // agent + lease lots. Only the island's own: the trading district's lots sit on a plate.
  for (const l of CORE_LOTS)
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
  // Civic ground the zoned districts own: gateway plazas and the promenades their boundary
  // rails, ticker bands and billboard pylons stand on (city3d/Districts.tsx).
  // The megastructures that used to reserve two blocks in the deep back corner were removed, so
  // the packer is free to fill that ground with ordinary filler city again.
  for (const r of districtReserved()) markRect(grid, r.x0, r.z0, r.x1, r.z1)
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

// ---------- hero towers ----------
// The filler carpet above tops out at 5.8 units, which is why the cyberpunk kit that already
// exists (rooftop masts at h > 5, holo billboards at h > 3, floor bands on tiers over 2.5)
// almost never fired: nothing was tall enough to trigger it. This pass runs first and claims
// the best ground for a handful of real skyscrapers.
//
// They obey the same silhouette rule as everything else — on the core island a tower may only
// stand behind the landmarks, where it frames the skyline instead of hiding the buildings the
// player came to click. An outer plate has nothing to hide, so it gets taller ones and more
// of them.
const TOWER_SIZES: [number, number][] = [
  [3, 3],
  [3, 2.5],
  [2.5, 3],
  [2.5, 2.5],
  [3, 2],
  [2, 3],
]

interface TowerRule {
  /** how many to attempt */
  count: number
  /** only place where x + z is at or below this (camera looks down +x +z) */
  maxDepth: number
  /** roof height range */
  min: number
  max: number
}
// Counts are deliberately low. Nine plates can be open at once, so a generous per-plate number
// turns the horizon into static: a few big silhouettes read as a skyline, forty thin ones read
// as noise.
// REMOVED ON REQUEST, 2026-10-13. The hero towers read to the user as "weird black
// megastructures above my city": unlit slabs 7-15 units tall with no windows, standing over the
// lit filler. The intent was a framing skyline, but against this palette they land as black
// holes in it. The packer and the rules are left in place so this is one number to undo — raise
// a count and they come back — but do not restore them without asking.
const TOWER_RULES: Record<SceneryVariant, TowerRule> = {
  core: { count: 0, maxDepth: -4, min: 7, max: 11 },
  outer: { count: 0, maxDepth: 2, min: 8, max: 15 },
  wallst: { count: 0, maxDepth: 2, min: 8, max: 14 },
}

function packTowers(grid: Uint8Array, r: () => number, variant: SceneryVariant): SceneryBuilding[] {
  const rule = TOWER_RULES[variant]
  const out: SceneryBuilding[] = []
  // Candidate spots on a coarse lattice, shuffled deterministically so the towers scatter
  // instead of marching along the first free row.
  const spots: [number, number][] = []
  for (let z = -HALF + 1; z < HALF - 3; z += 1.5)
    for (let x = -HALF + 1; x < HALF - 3; x += 1.5) spots.push([x, z])
  for (let i = spots.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    const t = spots[i]
    spots[i] = spots[j]
    spots[j] = t
  }

  for (const [x, z] of spots) {
    if (out.length >= rule.count) break
    const [w, d] = TOWER_SIZES[Math.floor(r() * TOWER_SIZES.length)]
    const cx = x + w / 2
    const cz = z + d / 2
    if (cx + cz > rule.maxDepth) continue
    if (!free(grid, x, z, w, d)) continue
    // Depth also sets the height: the further back it stands, the taller it may be.
    const reach = Math.min(1, Math.max(0, (rule.maxDepth - (cx + cz)) / 12))
    const h = rule.min + (rule.max - rule.min) * (0.35 + 0.65 * reach) * (0.7 + r() * 0.3)
    const base: Omit<SceneryBuilding, 'tiers'> = {
      x: cx,
      z: cz,
      w,
      d,
      h,
      // The two lightest wall tones only: a hero tower has to hold its mass against the night
      // sky, and the dark filler greys left nothing but floating neon up there.
      wall: [2, 4, 2, 4, 0][Math.floor(r() * 5)],
      neon: Math.floor(r() * NEONS.length),
      roof: 'none', // the crown in CyberSkyline is this tower's roof furniture
      sign: r() < 0.7,
      hanging: false,
      tower: true,
      seed: Math.floor(r() * 1e6),
    }
    out.push({ ...base, tiers: tiersFor(base, r) })
    // A tower claims a wider skirt than filler does, so it reads as standing in its own plaza.
    markRect(grid, x - ALLEY * 2, z - ALLEY * 2, x + w + ALLEY * 2, z + d + ALLEY * 2)
  }
  return out
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

function towerTiers(b: Omit<SceneryBuilding, 'tiers'>, r: () => number): Tier[] {
  const out: Tier[] = []
  const count = b.h > 11 ? 5 : b.h > 8 ? 4 : 3
  // The shaft keeps most of the height; the steps above it are short, so the taper reads as a
  // crown rather than a wedding cake.
  const shaft = b.h * (0.5 + r() * 0.12)
  let y = 0
  let w = b.w
  let d = b.d
  for (let i = 0; i < count; i++) {
    const last = i === count - 1
    const h = i === 0 ? shaft : last ? b.h - y : (b.h - shaft) / (count - 1) * (0.8 + r() * 0.4)
    if (h <= 0.05) break
    out.push({ x: b.x, y, z: b.z, w, h, d })
    y += h
    if (y >= b.h - 0.05) break
    const step = i === 0 ? 0.35 + r() * 0.25 : 0.25 + r() * 0.2
    w = Math.max(0.5, w - step)
    d = Math.max(0.5, d - step)
  }
  return out
}

function tiersFor(b: Omit<SceneryBuilding, 'tiers'>, r: () => number): Tier[] {
  const out: Tier[] = []
  // A hero tower steps back four or five times and finishes on a narrow crown block, which is
  // what gives it an art-deco skyscraper silhouette instead of a tall shoebox.
  if (b.tower) return towerTiers(b, r)
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

function packScenery(variant: SceneryVariant): SceneryBuilding[] {
  const grid = buildGrid(variant)
  // Different seed per variant so an opened plate is not a pixel-for-pixel mirror of the core.
  const r = rng(variant === 'core' ? 90210 : variant === 'wallst' ? 4711 : 1337)
  // Towers first: they claim the open ground before the filler carpet fills every gap.
  const out: SceneryBuilding[] = packTowers(grid, r, variant)

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
          tower: false,
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

// The pack is deterministic and the eight outer plates share one result, so it runs at most
// twice per session however many plates are open.
const packed = new Map<SceneryVariant, SceneryBuilding[]>()

export function layoutScenery(variant: SceneryVariant = 'core'): SceneryBuilding[] {
  let out = packed.get(variant)
  if (!out) {
    out = packScenery(variant)
    packed.set(variant, out)
  }
  return out
}

/** Ground level the filler sits on (the raised sidewalk, not the road). */
export const SCENERY_Y = CURB
