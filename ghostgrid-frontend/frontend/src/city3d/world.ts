// 3D city layout. 1 tile = 1 world unit. The map is MAP.size × MAP.size tiles centered on the origin.
// +x goes to the screen's lower-right, +z to the lower-left (camera looks from +x,+y,+z toward the origin).
import type { Building, BuildingType } from '../types'

export const MAP = { size: 34 }

// Roads are full rows/columns of tiles at these indexes (both axes) → a 5×5 grid of 4×4 blocks.
// The inner 3×3 blocks hold the agent lots; the outer ring is filler city (see scenery/).
// The camera frames the inner core only (CameraRig.FIT_POINTS), so the outer ring runs off
// the edges of the frame and the city reads as if it continues past the screen.
export const ROAD_INDEXES = [4, 9, 14, 19, 24, 29]

/** Index into PLOT_OFFSETS of the plate Wall Street stands on: the east one, named for it.
 *  Declared up here because LOTS below zones its lots onto that plate. */
export const WALL_ST_PLOT = 6

/** Index into PLOT_OFFSETS of the north plate, PLOT_NAMES[3] = 'Attention Span'. The utility
 *  bots are zoned onto it the way the trading bots are zoned onto Wall St, so each kind of bot
 *  reads as a district of its own instead of scattering across the core island. */
export const ATTENTION_PLOT = 3

/** Index into PLOT_OFFSETS of the north-west plate, PLOT_NAMES[0] = 'Stochastic Park'. Agent Row
 *  moved here off the core island: the player's own assistants are houses, not towers, and a
 *  park is where a residential quarter belongs. It is also the far corner from Wall St, which
 *  was the point of the original placement. */
export const AGENT_PLOT = 0

/** Agent Row's quarter within its plate: the 2x2 of inner blocks nearest the core — three house
 *  plots and the garden plaza. Declared here because OUTER_LOTS has to leave these blocks out of
 *  the leasable super-blocks and DISTRICTS has to describe the same rectangle, and the two
 *  drifting apart would put a lease pad on top of a house. */
const AGENT_QUARTER = { tx0: 15, tx1: 24, tz0: 15, tz1: 24 }

export interface Lot {
  id: number
  tx: number // first tile column (0..15)
  tz: number // first tile row (0..15)
  w: number // tiles along x
  d: number // tiles along z
  /** index into PLOT_OFFSETS for a lot on an outer plot; undefined = the core island */
  plot?: number
}

// Lots 0–4 hold the default buildings (see DEFAULT_BUILDINGS). Lots 5–12 are empty plots the
// player can build on. All of them sit in the inner 3×3 blocks (tile spans 5–8, 10–13, 15–18)
// so the camera always frames them; the outer ring of blocks is scenery.
export const LOTS: Lot[] = [
  // The five landmark lots fill their whole 4×4 block, so the towers on them read as
  // super-blocks instead of houses. The 2×2 lots that follow stay small on purpose: the
  // contrast between slim towers and super-blocks is what gives the skyline its shape.
  { id: 0, tx: 15, tz: 15, w: 4, d: 4 }, // center plaza → free landmark lot
  { id: 1, tx: 10, tz: 10, w: 4, d: 4 }, // NW block (back) → DeepSeek Forge
  { id: 2, tx: 20, tz: 10, w: 4, d: 4 }, // NE block (right) → Claude Nexus
  { id: 3, tx: 10, tz: 20, w: 4, d: 4 }, // SW block (left) → Codex Tower
  { id: 4, tx: 20, tz: 20, w: 4, d: 4 }, // SE block (front) → Security Checkpoint
  // Two small lots per mid block, one seeded and one left free (see DEFAULT_BUILDINGS): every
  // approach to the spire gets a tower and a lease pad next to it.
  { id: 5, tx: 15, tz: 10, w: 2, d: 2 }, // N block → Library of Babel
  { id: 13, tx: 17, tz: 10, w: 2, d: 2 }, // N block → security watchtower bot
  { id: 14, tx: 15, tz: 12, w: 2, d: 2 }, // N block → RSS feed bot
  { id: 6, tx: 17, tz: 12, w: 2, d: 2 }, // N block, free
  { id: 7, tx: 15, tz: 20, w: 2, d: 2 }, // S block → network healthcheck bot
  { id: 8, tx: 17, tz: 22, w: 2, d: 2 }, // S block, free
  { id: 9, tx: 10, tz: 15, w: 2, d: 2 }, // W block → Groq Speedway
  { id: 10, tx: 12, tz: 17, w: 2, d: 2 }, // W block → repo commit bot
  { id: 11, tx: 21, tz: 15, w: 2, d: 2 }, // E block → Cursor Studio
  { id: 12, tx: 22, tz: 17, w: 2, d: 2 }, // E block, free
  // ---- Zoned outer ring. The 34x34 map is a 7x7 grid of 4x4 blocks: the inner 3x3 is the core
  // above, the 40 around it are the ring. Two quarters are zoned so the trading towers and the
  // player's own agents read as places instead of scattered lots.

  // AGENT ROW — personal agents, now a quarter of Stochastic Park (AGENT_PLOT) rather than a
  // corner of the core island. 3x3 house plots, kept low (BUILDING_HEIGHT.agent) so the row
  // still reads as domestic next to everything else in the city. The three wrap the far two
  // sides of the quarter, facing (20,20) — the block nearest the core, left free as the garden
  // plaza the gateway opens onto, so the houses look onto a shared green rather than a road. These blocks are part of the plate's inner 3x3, so the filler-city
  // packer already keeps them clear (OUTER_LOT_RECTS) and no scenery variant is needed.
  { id: 15, tx: 15, tz: 15, w: 3, d: 3, plot: AGENT_PLOT }, // back corner → Grok Bot
  { id: 16, tx: 20, tz: 15, w: 3, d: 3, plot: AGENT_PLOT }, // → Dots
  { id: 17, tx: 15, tz: 20, w: 3, d: 3, plot: AGENT_PLOT }, // → Muse

  // WALL STREET — the trading district, now a plate of its own: the east cell of the 3x3 grid,
  // which is why that plate is named Wall St (PLOT_NAMES[WALL_ST_PLOT]). It keeps the shape it
  // had on the core island, a 2x5 block strip down the plate's west flank (tiles x 0..8,
  // z 5..28) — the flank that faces the core, so the five quant super-blocks still read as a
  // wall of skyscrapers seen from the centre of the city, in one straight line, with the two
  // trading-bot plots and the gateway plaza between them in the inner column. (5,5) and (5,25)
  // are left to that plate's filler city.
  { id: 25, tx: 0, tz: 5, w: 4, d: 4, plot: WALL_ST_PLOT }, // → Freqtrade Exchange
  { id: 26, tx: 0, tz: 10, w: 4, d: 4, plot: WALL_ST_PLOT }, // → Hummingbot Pit
  { id: 27, tx: 0, tz: 15, w: 4, d: 4, plot: WALL_ST_PLOT }, // → Nautilus Clearing
  { id: 28, tx: 0, tz: 20, w: 4, d: 4, plot: WALL_ST_PLOT }, // → Lean Engine Hall
  { id: 29, tx: 0, tz: 25, w: 4, d: 4, plot: WALL_ST_PLOT }, // → Qlib Research
  { id: 35, tx: 5, tz: 10, w: 3, d: 3, plot: WALL_ST_PLOT }, // trading-bot annex → Paper Trading
  { id: 36, tx: 5, tz: 20, w: 3, d: 3, plot: WALL_ST_PLOT }, // trading-bot annex → Market Signal
  // Downtown: the plate's inner 3x3 blocks, which on every other plate are leasable super-blocks
  // (OUTER_LOTS). Wall Street is built out instead — the district is a finished downtown, not a
  // frontier, so those nine blocks carry towers and plazas rather than lease pads. (15,15) stays
  // the trading-floor plaza and (20,20) is left to the plate's filler city, so the grid reads as
  // a city centre with a square in it.
  { id: 37, tx: 10, tz: 10, w: 4, d: 4, plot: WALL_ST_PLOT }, // → Backtrader Floor
  { id: 38, tx: 15, tz: 10, w: 4, d: 4, plot: WALL_ST_PLOT }, // → Zipline Archive
  { id: 39, tx: 20, tz: 10, w: 4, d: 4, plot: WALL_ST_PLOT }, // → Vectorbt Terminal
  { id: 40, tx: 10, tz: 15, w: 4, d: 4, plot: WALL_ST_PLOT }, // → CCXT Gateway
  { id: 41, tx: 20, tz: 15, w: 4, d: 4, plot: WALL_ST_PLOT }, // → Jesse Desk
  { id: 42, tx: 10, tz: 20, w: 4, d: 4, plot: WALL_ST_PLOT }, // → OctoBot Tower
  { id: 43, tx: 15, tz: 20, w: 4, d: 4, plot: WALL_ST_PLOT }, // → QuantLib Vault

  // Unzoned leasable plots on the rest of the ring: the N frontier row, the S row, and the E
  // edge. The west flank is filler city again now that Wall Street has its own plate.
  { id: 19, tx: 5, tz: 0, w: 3, d: 3 },
  { id: 20, tx: 10, tz: 0, w: 3, d: 3 },
  { id: 30, tx: 15, tz: 0, w: 3, d: 3 },
  { id: 31, tx: 20, tz: 0, w: 3, d: 3 },
  { id: 18, tx: 10, tz: 30, w: 3, d: 3 },
  { id: 32, tx: 15, tz: 30, w: 3, d: 3 },
  { id: 21, tx: 30, tz: 10, w: 3, d: 3 },
  { id: 22, tx: 30, tz: 15, w: 3, d: 3 },
  { id: 23, tx: 30, tz: 20, w: 3, d: 3 },
  { id: 24, tx: 30, tz: 25, w: 3, d: 3 },
  { id: 33, tx: 20, tz: 30, w: 3, d: 3 },
  { id: 34, tx: 25, tz: 30, w: 3, d: 3 },
]

// District layout, not real estate: the build menu cannot lease any of these.
// One lot per open-source quant project — see wallstreet/roster.ts.

/** The original wall of skyscrapers: one column down the plate rim that faces the core, in
 *  roster order, so the five read as a single skyline from the centre of the city. */
export const WALL_STREET_RIM_LOTS = [25, 26, 27, 28, 29]

/** Downtown, on the plate's inner 3x3 blocks — the nine that every other plate leases out.
 *  A grid, deliberately not a column: the rim is the skyline, this is the city behind it. */
export const WALL_STREET_DOWNTOWN_LOTS = [37, 38, 39, 40, 41, 42, 43]

export const WALL_STREET_LOTS = [...WALL_STREET_RIM_LOTS, ...WALL_STREET_DOWNTOWN_LOTS]

// Wall Street's annex plots: where a trading bot stands. The demo catalog that used to fill
// them is gone, so these are lots for the bots you place.
export const TRADING_LOTS = [35, 36]

// Grok Bot, Dots and Muse — see agents/personal.ts.
export const AGENT_LOTS = [15, 16, 17]

const ZONED = new Set([...WALL_STREET_LOTS, ...TRADING_LOTS, ...AGENT_LOTS])

/** Lots still on the core island. Wall Street's sit on their own plate (WALL_ST_PLOT). */
export const CORE_LOTS = LOTS.filter((l) => l.plot === undefined)

/** Leasable lots on the core island. Always available — the island is never locked. */
export const CORE_BUILDABLE_LOTS = CORE_LOTS.filter((l) => l.id >= 5 && !ZONED.has(l.id)).map((l) => l.id)

// ---- Outer plots ----
// The core island is the middle cell of a 3x3 grid of same-sized plates. The eight around it
// start locked and flat; the player opens one at a time and it grows its own filler city
// (VoxelDistricts.tsx) *and* nine leasable super-blocks, so the "background" is real estate
// rather than backdrop. Everything that positions a lot goes through lotCenter, which adds the
// plate offset, so buildings, lease pads, labels and drones work out there with no extra code.

export const PLOT_GAP = 1.2 // canal between two plates
export const PLOT_STEP = MAP.size + PLOT_GAP

// ORDER IS LOAD-BEARING: usePlots persists opened plots by index in localStorage, so appending
// is fine and reordering would silently open the wrong plate for anyone who already played.
export const PLOT_OFFSETS: [number, number][] = []
for (const x of [-1, 0, 1]) for (const z of [-1, 0, 1]) if (x || z) PLOT_OFFSETS.push([x * PLOT_STEP, z * PLOT_STEP])

// One name per plate, in PLOT_OFFSETS order, which runs NW, W, SW, N, S, NE, E, SE. Each is a
// machine-learning or shell joke wearing a real district suffix, except the east plate: the
// trading district moved there whole, so it carries the district's own name instead of a pun.
// Overfit Heights still sits where its pun lands.
export const PLOT_NAMES = [
  'Stochastic Park', // NW — AGENT_PLOT: Agent Row's houses and garden, in a park
  'Cache Flow', // W
  'Gradient Descent', // SW
  'Attention Span', // N
  'Dropout Alley', // S
  'Overfit Heights', // NE
  'Wall St', // E — WALL_ST_PLOT: the trading district, towers and all
  'Yak Shave Yards', // SE
]

/** The centre cell of the 3x3 grid: the core island, where the Router Spire stands. */
export const CORE_NAME = 'Main Thread'

// Each plate carries lots on its own inner 3x3 blocks (tile spans 10–13, 15–18, 20–23) — the
// same blocks the core island uses for its landmarks, so an opened plot reads as a sibling of
// the core instead of a different kind of place. The ring of blocks around them stays filler.
const OUTER_BLOCKS: [number, number][] = []
for (const tz of [10, 15, 20]) for (const tx of [10, 15, 20]) OUTER_BLOCKS.push([tx, tz])

/** Outer lot ids start at 100 so core ids (0–36) stay readable: 100 + plot*10 + block. */
export const OUTER_LOT_BASE = 100
// Wall Street's plate is the exception: its inner blocks are the district's own towers (lots
// 37-43 above), so it offers no leasable super-blocks at all and the build menu shows no pads
// there. Every other plate keeps its nine.
export const OUTER_LOTS: Lot[] = PLOT_OFFSETS.flatMap((_, plot) =>
  plot === WALL_ST_PLOT
    ? []
    : OUTER_BLOCKS.flatMap(([tx, tz], n) =>
        // Agent Row owns four of its plate's blocks — three houses and the garden plaza — so
        // Stochastic Park offers five super-blocks instead of nine.
        plot === AGENT_PLOT && tx >= AGENT_QUARTER.tx0 && tz >= AGENT_QUARTER.tz0
          ? []
          : [{ id: OUTER_LOT_BASE + plot * 10 + n, tx, tz, w: 4, d: 4, plot }]),
)

/** Local (plot-space) footprints of the outer lots, identical on every plate. The filler-city
 *  packer keeps these clear so a player's tower never lands inside a procedural block. */
export const OUTER_LOT_RECTS = OUTER_BLOCKS.map(([tx, tz]) => {
  const half = MAP.size / 2
  return { x0: tx - half, z0: tz - half, x1: tx + 4 - half, z1: tz + 4 - half }
})

/** The nine super-blocks of the Attention Span plate, in the packer's order: the bot district.
 *  Derived from OUTER_LOTS so it cannot drift from the ids that plate actually carries. */
export const ATTENTION_LOTS = OUTER_LOTS.filter((l) => l.plot === ATTENTION_PLOT).map((l) => l.id)

/** Every lot the build menu can lease, open or not. Used for buffer sizing and totals. */
export const BUILDABLE_LOTS = [...CORE_BUILDABLE_LOTS, ...OUTER_LOTS.map((l) => l.id)]

/** Is this lot leasable right now? Core lots always are; outer lots need their plate opened. */
export function isLotLeasable(lotId: number, openPlots: readonly number[]): boolean {
  if (ZONED.has(lotId)) return false
  if (CORE_BUILDABLE_LOTS.includes(lotId)) return true
  const plot = LOT_BY_ID.get(lotId)?.plot
  return plot !== undefined && openPlots.includes(plot)
}

/** The lots the player may build on given the plates they have opened. */
export function leasableLots(openPlots: readonly number[]): number[] {
  return [
    ...CORE_BUILDABLE_LOTS,
    ...OUTER_LOTS.filter((l) => openPlots.includes(l.plot as number)).map((l) => l.id),
  ]
}

/** Half-extent of the whole 3x3 grid: how far the camera may pan before it leaves the city. */
export const WORLD_HALF = PLOT_STEP + MAP.size / 2

/** Ground-plane corners [x, z] of the core platform plus the given plates. `openPlots` picks
 *  which outer plates count; pass every index to frame the grid including the locked ones. */
export function platformCorners(openPlots: readonly number[]): [number, number][] {
  const edge = MAP.size / 2 + 0.8 // platform rim
  const out: [number, number][] = []
  const plate = (cx: number, cz: number) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push([cx + sx * edge, cz + sz * edge])
  }
  plate(0, 0)
  for (const k of openPlots) {
    const o = PLOT_OFFSETS[k]
    if (o) plate(o[0], o[1])
  }
  return out
}

// ---- Districts ----
// A zoned quarter of the ring in tile coordinates (half-open: [tx0, tx1) x [tz0, tz1)).
// city3d/Districts.tsx draws the ground dressing. Screen compass, as the lot comments above use
// it: low tx / low tz = NW (back), high tx / low tz = NE (right), low tx / high tz = SW (left).
export interface District {
  id: 'wallstreet' | 'agentrow'
  name: string
  short: string
  tagline: string
  accent: string
  /** index into PLOT_OFFSETS for a district on an outer plate; undefined = the core island */
  plot?: number
  /**
   * Which of its own edges carries the gateway and the boundary furniture. Left out, it is the
   * edge nearest the core, which is right for a quarter of the core island. A quarter flush with
   * an outer plate's rim has to name it: the edge facing the core is the rim itself, with no
   * avenue outside it for a rail or an arch to stand on.
   */
  face?: 'x0' | 'x1' | 'z0' | 'z1'
  /** tile bounds of the quarter within its own plate, roads on its inner edges excluded */
  tx0: number
  tx1: number
  tz0: number
  tz1: number
  /** block origin of the plaza facing the core, where the gateway stands */
  gate: [number, number]
  /** 'neon' gets billboards and a ticker, 'quiet' gets lamps */
  mood: 'neon' | 'quiet'
}

export const DISTRICTS: District[] = [
  {
    id: 'wallstreet',
    name: 'Wall Street',
    short: 'WALL STREET',
    tagline: 'TRADING FLOOR',
    accent: '#b6f36b',
    plot: WALL_ST_PLOT,
    // Flush with the plate's west rim, so the towers face the core across it, and now deep
    // enough to hold downtown as well: the rim column (tiles 0-8) plus the inner blocks
    // (10-23). The avenue is still on the far side — between the district and the rest of the
    // plate, which the expansion pushed out to x=24 — and the arch opens off it.
    face: 'x1',
    tx0: 0,
    tx1: 24,
    tz0: 5,
    tz1: 29,
    // The arch stays on the avenue between the rim wall and downtown: you pass the skyline,
    // go under the gateway, and you are in the district proper. (5,15) is the one block in
    // that column with no lot on it — 35 and 36 are at tz 10 and 20.
    gate: [5, 15],
    mood: 'neon',
  },
  {
    id: 'agentrow',
    name: 'Agent Row',
    short: 'AGENT ROW',
    tagline: 'RESIDENTIAL',
    accent: '#ff4da6',
    plot: AGENT_PLOT,
    // A quarter inside its plate rather than flush with a rim, so it needs no `face`: the roads
    // at tiles 14 and 24 are avenues on every side, and the default core-facing edge has one to
    // stand the boundary furniture and the arch on.
    ...AGENT_QUARTER,
    // The block nearest the core, left free: the garden plaza the gateway opens onto.
    gate: [20, 20],
    mood: 'quiet',
  },
]

/** Plate offset of anything carrying a `plot`: [0, 0] on the core island. */
export function plateOffset(plot: number | undefined): [number, number] {
  return plot === undefined ? [0, 0] : PLOT_OFFSETS[plot] ?? [0, 0]
}

/** World-space rectangle of a district on the ground plane: center, width and depth. */
export function districtRect(d: District) {
  const half = MAP.size / 2
  const [ox, oz] = plateOffset(d.plot)
  return {
    x: (d.tx0 + d.tx1) / 2 - half + ox,
    z: (d.tz0 + d.tz1) / 2 - half + oz,
    w: d.tx1 - d.tx0,
    d: d.tz1 - d.tz0,
  }
}

/** World-space center of a 4x4 block from its tile origin (used for plazas, which have no lot).
 *  `plot` places the block on an outer plate; omit it for the core island. */
export function blockCenter(tx: number, tz: number, plot?: number): [number, number] {
  const half = MAP.size / 2
  const [ox, oz] = plateOffset(plot)
  return [tx + 2 - half + ox, tz + 2 - half + oz]
}

/** World-space bounds plus `ix`/`iz`: the edge on each axis facing the core, i.e. whichever of
 *  the two sits nearer the origin. Rails, tickers, the gateway and the medians all line up on
 *  these.
 *
 *  An axis the quarter *straddles* has no core-facing edge — both ends are caps on a strip
 *  running past the centre — and comes back `null`, which the boundary furniture skips. A corner
 *  quarter has two edges, a flank strip one. */
export function districtEdges(d: District) {
  const half = MAP.size / 2
  const [ox, oz] = plateOffset(d.plot)
  const x0 = d.tx0 - half + ox
  const x1 = d.tx1 - half + ox
  const z0 = d.tz0 - half + oz
  const z1 = d.tz1 - half + oz
  // Nearer the origin means nearer the core island, which is what a quarter of the island faces.
  const inner = (a: number, b: number) => (a < 0 && b > 0 ? null : Math.abs(a) < Math.abs(b) ? a : b)
  // A district that names its face gets that one edge and no other: a strip has one avenue.
  const named = (lo: number, hi: number, loKey: string, hiKey: string) =>
    d.face === loKey ? lo : d.face === hiKey ? hi : null
  return {
    x0, x1, z0, z1,
    ix: d.face ? named(x0, x1, 'x0', 'x1') : inner(x0, x1),
    iz: d.face ? named(z0, z1, 'z0', 'z1') : inner(z0, z1),
  }
}

/** Lots whose footprint falls inside a district. Districts.tsx wires skybridges off this rather
 *  than hand-listing the ids twice. */
export function districtLots(d: District): Lot[] {
  // Tile bounds repeat on every plate, so the plate has to match too or a district would claim
  // the lots standing on the same tiles one cell over.
  return LOTS.filter((l) => l.plot === d.plot
    && l.tx >= d.tx0 && l.tx + l.w <= d.tx1 && l.tz >= d.tz0 && l.tz + l.d <= d.tz1)
}

/** Centre line of the boundary avenue outside each core-facing edge, where the district's street
 *  furniture stands. Traffic drives at road centre +/- 0.22, so the centre line is free ground
 *  and still inside the district's frame — a median. `null` on an axis with no core-facing edge. */
export function districtMedian(d: District) {
  const { x0, x1, z0, z1, ix, iz } = districtEdges(d)
  const nx = ix === null ? 0 : ix > (x0 + x1) / 2 ? 1 : -1
  const nz = iz === null ? 0 : iz > (z0 + z1) / 2 ? 1 : -1
  return { nx, nz, mx: ix === null ? null : ix + nx * 0.5, mz: iz === null ? null : iz + nz * 0.5 }
}

/** Rectangles the filler-city packer must keep clear, in one plate's own tile space (centred the
 *  way OUTER_LOT_RECTS is). Pass no `plot` for the core island.
 *
 *  Gateway plazas need it because no lot stands on them, so the packer would build over the arch;
 *  the medians are road tiles, which it already skips. A district on a plate also has to list its
 *  own lots, because the outer packer knows only that plate's nine super-blocks. */
export function districtReserved(plot?: number): { x0: number; z0: number; x1: number; z1: number }[] {
  const half = MAP.size / 2
  const rect = (tx: number, tz: number, w: number, d: number) =>
    ({ x0: tx - half, z0: tz - half, x1: tx + w - half, z1: tz + d - half })
  return [
    ...DISTRICTS.filter((d) => d.plot === plot).map((d) => rect(d.gate[0], d.gate[1], 4, 4)),
    ...(plot === undefined ? [] : LOTS.filter((l) => l.plot === plot).map((l) => rect(l.tx, l.tz, l.w, l.d))),
  ]
}

// LOTS is grouped by district, not sorted by id, so lookups go through this map. Don't index
// LOTS directly: `LOTS[id]` was only ever correct while the two happened to match.
const LOT_BY_ID = new Map([...LOTS, ...OUTER_LOTS].map((l) => [l.id, l]))
export const lotById = (lotId: number): Lot => {
  const l = LOT_BY_ID.get(lotId)
  if (!l) throw new Error(`unknown lot ${lotId}`)
  return l
}

// World-space center of a lot on the ground plane. Outer-plot lots carry their plate offset
// here, which is why the rest of the city needs no notion of plots at all.
export function lotCenter(lotId: number): [number, number, number] {
  const l = lotById(lotId)
  const half = MAP.size / 2
  const [ox, oz] = l.plot === undefined ? [0, 0] : PLOT_OFFSETS[l.plot]
  return [l.tx + l.w / 2 - half + ox, 0, l.tz + l.d / 2 - half + oz]
}

// Footprint size (world units) a building may use on its lot (leave a 0.15 margin for sidewalks).
export function lotFootprint(lotId: number): { w: number; d: number } {
  const l = lotById(lotId)
  return { w: l.w - 0.3, d: l.d - 0.3 }
}

// Roof height (world units) of each building type, without antennas. Drones land at the roof.
// Spread wide on purpose: the four landmark blocks form the top tier and the small lots fill in
// below. Building art is parametric in this value, so changing a number here restyles the
// massing (see BuildingCtx.height).
export const BUILDING_HEIGHT: Record<BuildingType, number> = {
  codex: 12,
  claude: 11,
  library: 9.5,
  cursor: 8,
  deepseek: 8,
  bot: 6.5,
  // Wall Street towers: art-deco setback skyscrapers, the tallest thing in the city.
  quant: 12,
  // Personal agents: low neighbourhood houses, deliberately domestic next to the towers.
  agent: 4.5,
  groq: 6,
  // The checkpoint's art is a fortified gatehouse — glacis, gate lane, watchtower — which lives
  // in the bottom few units, so it was kept squat at 4. At that height it disappeared next to the
  // provider towers on the neighbouring super-blocks, so it now stands with them: tall enough to
  // be found on the skyline, still short enough that the gatehouse reads as a gatehouse and not a
  // stretched box.
  security: 8,
}

// Actual roof height of one building: the type height, nudged by a per-lot hash so two towers
// of the same type never share a roof line.
// Everything that needs a roof height (shell, labels, drone docks, alert light) goes through here.
export function buildingHeight(b: Pick<Building, 'lot' | 'type'>): number {
  const h = BUILDING_HEIGHT[b.type]
  const hash = ((b.lot * 2654435761) >>> 0) / 2 ** 32 // deterministic 0..1
  return h * (0.86 + 0.3 * hash)
}

// Where drones take off / land for a building (just above its roof).
export function dockPoint(b: Pick<Building, 'lot' | 'type'>): [number, number, number] {
  const [x, , z] = lotCenter(b.lot)
  return [x, buildingHeight(b) + 0.6, z]
}

// Camera: orthographic, 2:1 dimetric ("pixel isometric") — elevation 30°, azimuth 45°.
export const CAMERA = {
  position: [20, 16.33, 20] as [number, number, number],
  zoom: 34, // world-units → CSS px; CameraRig adapts it to the viewport
  near: -100,
  far: 200,
}


// Each rendered pixel covers PIXEL_SIZE × PIXEL_SIZE CSS pixels (pixel-art look + cheap rendering).
export const PIXEL_SIZE = 3
