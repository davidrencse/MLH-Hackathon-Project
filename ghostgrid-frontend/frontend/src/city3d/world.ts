// 3D city layout. 1 tile = 1 world unit. The map is MAP.size × MAP.size tiles centered on the origin.
// +x goes to the screen's lower-right, +z to the lower-left (camera looks from +x,+y,+z toward the origin).
import type { Building, BuildingType } from '../types'

export const MAP = { size: 34 }

// Roads are full rows/columns of tiles at these indexes (both axes) → a 5×5 grid of 4×4 blocks.
// The inner 3×3 blocks hold the agent lots; the outer ring is filler city (see scenery/).
// The camera frames the inner core only (CameraRig.FIT_POINTS), so the outer ring runs off
// the edges of the frame and the city reads as if it continues past the screen.
export const ROAD_INDEXES = [4, 9, 14, 19, 24, 29]

export interface Lot {
  id: number
  tx: number // first tile column (0..15)
  tz: number // first tile row (0..15)
  w: number // tiles along x
  d: number // tiles along z
}

// Lots 0–4 hold the default buildings (see DEFAULT_BUILDINGS). Lots 5–12 are empty plots the
// player can build on. All of them sit in the inner 3×3 blocks (tile spans 5–8, 10–13, 15–18)
// so the camera always frames them; the outer ring of blocks is scenery.
export const LOTS: Lot[] = [
  { id: 0, tx: 16, tz: 16, w: 2, d: 2 }, // center plaza → Router Spire
  { id: 1, tx: 10, tz: 10, w: 3, d: 3 }, // NW block (back) → DeepSeek Forge
  { id: 2, tx: 21, tz: 10, w: 3, d: 3 }, // NE block (right) → Claude Nexus
  { id: 3, tx: 10, tz: 21, w: 3, d: 3 }, // SW block (left) → Codex Tower
  { id: 4, tx: 21, tz: 21, w: 3, d: 3 }, // SE block (front) → Security Checkpoint
  { id: 5, tx: 15, tz: 10, w: 2, d: 2 }, // N block
  { id: 6, tx: 17, tz: 12, w: 2, d: 2 },
  { id: 7, tx: 15, tz: 20, w: 2, d: 2 }, // S block
  { id: 8, tx: 17, tz: 22, w: 2, d: 2 },
  { id: 9, tx: 10, tz: 15, w: 2, d: 2 }, // W block
  { id: 10, tx: 12, tz: 17, w: 2, d: 2 },
  { id: 11, tx: 21, tz: 15, w: 2, d: 2 }, // E block
  { id: 12, tx: 23, tz: 17, w: 2, d: 2 },
  { id: 13, tx: 17, tz: 10, w: 2, d: 2 }, // N block → Cursor Studio
  { id: 14, tx: 15, tz: 12, w: 2, d: 2 }, // N block → paper-trading bot
  // New outer districts; existing world positions are preserved.
  { id: 15, tx: 0, tz: 5, w: 3, d: 3 },
  { id: 16, tx: 0, tz: 10, w: 3, d: 3 },
  { id: 17, tx: 0, tz: 15, w: 3, d: 3 },
  { id: 18, tx: 0, tz: 20, w: 3, d: 3 },
  { id: 19, tx: 0, tz: 25, w: 3, d: 3 },
  { id: 20, tx: 30, tz: 5, w: 3, d: 3 },
  { id: 21, tx: 30, tz: 10, w: 3, d: 3 },
  { id: 22, tx: 30, tz: 15, w: 3, d: 3 },
  { id: 23, tx: 30, tz: 20, w: 3, d: 3 },
  { id: 24, tx: 30, tz: 25, w: 3, d: 3 },
  { id: 25, tx: 5, tz: 0, w: 3, d: 3 },
  { id: 26, tx: 10, tz: 0, w: 3, d: 3 },
  { id: 27, tx: 15, tz: 0, w: 3, d: 3 },
  { id: 28, tx: 20, tz: 0, w: 3, d: 3 },
  { id: 29, tx: 25, tz: 0, w: 3, d: 3 },
  { id: 30, tx: 5, tz: 30, w: 3, d: 3 },
  { id: 31, tx: 10, tz: 30, w: 3, d: 3 },
  { id: 32, tx: 15, tz: 30, w: 3, d: 3 },
  { id: 33, tx: 20, tz: 30, w: 3, d: 3 },
  { id: 34, tx: 25, tz: 30, w: 3, d: 3 },
]

export const BUILDABLE_LOTS = LOTS.filter((l) => l.id >= 5).map((l) => l.id)

// World-space center of a lot on the ground plane.
export function lotCenter(lotId: number): [number, number, number] {
  const l = LOTS[lotId]
  const half = MAP.size / 2
  return [l.tx + l.w / 2 - half, 0, l.tz + l.d / 2 - half]
}

// Footprint size (world units) a building may use on its lot (leave a 0.2 margin for sidewalks).
export function lotFootprint(lotId: number): { w: number; d: number } {
  const l = LOTS[lotId]
  return { w: l.w - 0.4, d: l.d - 0.4 }
}

// Roof height (world units) of each building type, without antennas. Drones land at the roof.
export const BUILDING_HEIGHT: Record<BuildingType, number> = {
  router: 7,
  codex: 5,
  cursor: 3.8,
  claude: 4.5,
  deepseek: 3.5,
  groq: 3,
  security: 2.2,
  bot: 2.6,
  library: 4,
}

// Where drones take off / land for a building (just above its roof).
export function dockPoint(b: Pick<Building, 'lot' | 'type'>): [number, number, number] {
  const [x, , z] = lotCenter(b.lot)
  return [x, BUILDING_HEIGHT[b.type] * 1.8 + 0.6, z]
}

// Camera: orthographic, 2:1 dimetric ("pixel isometric") — elevation 30°, azimuth 45°.
export const CAMERA = {
  position: [20, 16.33, 20] as [number, number, number],
  zoom: 34, // world-units → CSS px; CameraRig adapts it to the viewport
  near: -100,
  far: 200,
}

// Each rendered pixel covers PIXEL_SIZE × PIXEL_SIZE CSS pixels (pixel-art look + cheap rendering).
export const PIXEL_SIZE = 1 // was chunky pixel upscale; 1 = native high-res
