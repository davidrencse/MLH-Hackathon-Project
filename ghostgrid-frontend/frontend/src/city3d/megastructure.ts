// Layout data for the elevated through-lines and the gate towers they run through.
//
// Everything here is pinned to the road grid on purpose. Roads are the one part of the map a
// LOT can never occupy (see world.ts), so a pier placed on a road intersection is guaranteed
// clear of every building the player can place or bulldoze — no runtime collision test needed.
import { MAP } from './world'

/** World-space centre of road row/column `index`. */
export const roadAt = (index: number) => index + 0.5 - MAP.size / 2

export type Axis = 'x' | 'z'

export interface SkyLine {
  /** The axis the track runs along. */
  axis: Axis
  /** Position on the other axis — always a road corridor. */
  at: number
  /** Deck height. The two lines sit at different levels so they can cross without meeting. */
  y: number
  /** Half-length of the deck; the ends disappear into tunnel heads past the platform rim. */
  reach: number
  /** Cars per second along the deck. Sign picks the direction. */
  speed: number
  accent: string
}

// Two straight viaducts cutting clean across the island, one per axis.
// Line 0 threads the central road canyon at tower mid-height; line 1 runs past the core's front
// edge, one level higher, so the two cross without ever meeting.
export const SKY_LINES: SkyLine[] = [
  { axis: 'z', at: roadAt(14), y: 9, reach: 19, speed: 0.052, accent: '#42e8ed' },
  { axis: 'x', at: roadAt(24), y: 12.4, reach: 19, speed: -0.044, accent: '#ff4da6' },
]

export interface Gate {
  /** Index into SKY_LINES. */
  line: number
  /** Where along that line the gate stands — again a road corridor, so the piers land on
   *  road intersections and the portal straddles the track. */
  at: number
  /** Distance from the track to each pier's centre: exactly one road pitch, so both piers
   *  sit on intersections too. */
  reach: number
  /** Stacked setbacks above the lintel, as [height, inset] pairs. */
  tiers: [number, number][]
  wall: string
  accent: string
  sign: string
}

const PIER_PITCH = 5 // road spacing in world units

// Two gates, both behind the core. In this 2:1 dimetric view anything at +x+z sits between the
// camera and the city, so a gate placed there buries the towers it was meant to frame; from
// behind, the same mass reads as skyline. Height is free back there, so they run tall.
// Both sit outside the inner 3x3 core, so no lintel ever hangs over a lot the player can drop a
// 19-unit tower on, and the two never share a pier.
export const GATES: Gate[] = [
  { line: 0, at: roadAt(4), reach: PIER_PITCH, tiers: [[4.2, 3], [3.6, 1.3], [3, 1], [2.4, 0.8]], wall: '#3a5e7a', accent: '#42e8ed', sign: '#ff4da6' },
  { line: 1, at: roadAt(4), reach: PIER_PITCH, tiers: [[4, 3], [3.4, 1.4], [2.8, 1.1]], wall: '#52506f', accent: '#ffcd70', sign: '#ff4da6' },
]

export const PIER = { along: 2.6, across: 2.2 }
export const LINTEL = { height: 1.8, overhang: 0.5 }

/** (distance along the line, distance across it) → world x/z for a gate on `line`. */
export function gatePoint(line: SkyLine, at: number, along: number, across: number) {
  return line.axis === 'z'
    ? { x: line.at + across, z: at + along }
    : { x: at + along, z: line.at + across }
}

// Pier footprints, so the filler-city packer in scenery/layout.ts can keep its distance.
export const GATE_FOOTPRINTS = GATES.flatMap((gate) => {
  const line = SKY_LINES[gate.line]
  return [-gate.reach, gate.reach].map((across) => {
    const { x, z } = gatePoint(line, gate.at, 0, across)
    const [w, d] = line.axis === 'z' ? [PIER.across, PIER.along] : [PIER.along, PIER.across]
    return { x, z, w, d }
  })
})
