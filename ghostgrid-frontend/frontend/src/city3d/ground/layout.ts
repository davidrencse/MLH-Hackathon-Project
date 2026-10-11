// Static ground layout: block spans, road centers and hand-placed lamps / props / puddles / cars.
// Every position stays off the LOTS footprints in world.ts. y = 0 is the road surface.
import { PALETTE } from '../materials'
import { LOTS, MAP, ROAD_INDEXES } from '../world'

export const HALF = MAP.size / 2
export const CURB = 0.05 // sidewalk / plaza height above the road
export const SLAB_DEPTH = 1.2 // floating platform thickness under the map
export const ROADS = ROAD_INDEXES.map((i) => i + 0.5 - HALF) // world centers of the road rows / cols

export const isRoadIndex = (i: number) => ROAD_INDEXES.includes(i)

// Non-road tile ranges [start, end) along one axis = the blocks between the roads.
export function blockSpans(): [number, number][] {
  const out: [number, number][] = []
  let start = 0
  for (let i = 0; i <= MAP.size; i++) {
    if (i === MAP.size || isRoadIndex(i)) {
      if (i > start) out.push([start, i])
      start = i + 1
    }
  }
  return out
}

// Street lamp: pole at (x, z), arm + head reach toward the road along (ax, az).
export interface Lamp {
  x: number
  z: number
  ax: number
  az: number
  color: string
}
export const LAMP_REACH = 0.3 // head offset from the pole

/** True when (x, z) falls on a lot footprint (grown by pad) — nothing may be placed there. */
export function isOnLot(x: number, z: number, pad = 0) {
  return LOTS.some(
    (l) =>
      x > l.tx - HALF - pad && x < l.tx + l.w - HALF + pad && z > l.tz - HALF - pad && z < l.tz + l.d - HALF + pad,
  )
}

/** True when (x, z) is on a road tile (grown by pad). */
export function isOnRoad(x: number, z: number, pad = 0) {
  return ROAD_INDEXES.some((i) => {
    const a = i - HALF - pad
    const b = i + 1 - HALF + pad
    return (x > a && x < b) || (z > a && z < b)
  })
}

// Two lamps on opposite corners of every road intersection. The grid has 4 roads per axis,
// so this scales with ROAD_INDEXES instead of being hand-placed per corner.
export const LAMPS: Lamp[] = (() => {
  const out: Omit<Lamp, 'color'>[] = []
  const off = 0.65
  for (const rx of ROADS)
    for (const rz of ROADS) {
      out.push({ x: rx - off, z: rz - off, ax: 1, az: 0 })
      out.push({ x: rx + off, z: rz + off, ax: -1, az: 0 })
    }
  return out.map((l, i) => ({ ...l, color: i % 2 ? PALETTE.pink : PALETTE.cyan }))
})()

export type PropKind = 'vending' | 'ac' | 'bench'
// rot = long side / front face along z instead of x
export interface Prop {
  kind: PropKind
  x: number
  z: number
  rot?: boolean
}

// Street furniture lines the kerb of the inner blocks: one item per free block corner, facing
// the road it sits on. Generated from the road grid so it never lands on a lot or a road.
export const PROPS: Prop[] = (() => {
  const out: Prop[] = []
  const kinds: PropKind[] = ['vending', 'ac', 'vending', 'ac']
  const off = 0.45 // in from the kerb
  let n = 0
  for (const rx of ROADS)
    for (const rz of ROADS)
      for (const sx of [-1, 1] as const)
        for (const sz of [-1, 1] as const) {
          // only one of the two axes gets a prop per corner, alternating, to keep it sparse
          if ((n++ & 1) === 0) continue
          const x = rx + sx * off
          const z = rz + sz * (off + 0.9)
          if (isOnLot(x, z, 0.3) || isOnRoad(x, z) || Math.abs(x) > HALF - 0.6 || Math.abs(z) > HALF - 0.6) continue
          out.push({ kind: kinds[n % kinds.length], x, z, rot: (n & 2) === 0 })
        }
  // benches ring the Router Spire plaza in the centre block
  out.push({ kind: 'bench', x: 0, z: -1.55 })
  out.push({ kind: 'bench', x: 0, z: 1.55 })
  out.push({ kind: 'bench', x: -1.55, z: 0, rot: true })
  out.push({ kind: 'bench', x: 1.55, z: 0, rot: true })
  return out
})()

export const PUDDLES: { x: number; y: number; z: number; w: number; d: number; rot: number }[] = [
  { x: ROADS[1] + 0.3, y: 0.004, z: 6.1, w: 0.75, d: 0.45, rot: Math.PI / 2 },
  { x: 5.3, y: 0.004, z: ROADS[1] - 0.2, w: 0.85, d: 0.42, rot: 0 },
  { x: ROADS[2] - 0.4, y: 0.004, z: -4.2, w: 0.7, d: 0.4, rot: 0 },
  { x: -6.4, y: 0.004, z: ROADS[2] + 0.35, w: 0.8, d: 0.45, rot: Math.PI / 2 },
  { x: 1.25, y: CURB + 0.004, z: 1.2, w: 0.6, d: 0.5, rot: 0 },
]

// Cars drive straight along a road and wrap at the platform edge (they shrink to 0 there).
export interface Car {
  axis: 'x' | 'z'
  road: number
  dir: 1 | -1
  speed: number
  phase: number
  color: string
}
// Two cars per road per axis, in both directions: 4 roads × 2 axes × 2 = 16.
const CAR_COLORS = [PALETTE.haze, PALETTE.pink, PALETTE.steel, PALETTE.yellow, PALETTE.cyan, PALETTE.dusk, PALETTE.grey]
const CAR_SPEEDS = [1.6, 1.3, 1.9, 1.5, 1.4, 1.7, 1.2, 2.0]
export const CARS: Car[] = ROADS.flatMap((road, r) =>
  (['x', 'z'] as const).flatMap((axis, a) =>
    ([1, -1] as const).map((dir, d) => {
      const i = r * 4 + a * 2 + d
      return {
        axis,
        road,
        dir,
        speed: CAR_SPEEDS[i % CAR_SPEEDS.length],
        phase: (i * 7) % MAP.size,
        color: CAR_COLORS[i % CAR_COLORS.length],
      }
    }),
  ),
)
