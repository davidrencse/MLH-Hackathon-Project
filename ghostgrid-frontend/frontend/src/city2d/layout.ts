// City stage geometry in LOGICAL pixels. The stage is 384×216 and is scaled by an
// integer factor (CSS var --stage-scale). Everything inside the stage uses these numbers.
import type { BuildingId } from '../types'

export const STAGE = { w: 384, h: 216, ground: 192 } // ground = y of the street top edge

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

// The 2D stage has art and a slot only for these two default buildings.
// Claude, DeepSeek and player-built buildings exist only in the 3D city.
export type StageBuildingId = 'codex' | 'security'

export function isStageBuilding(id: BuildingId): id is StageBuildingId {
  return id === 'codex' || id === 'security'
}

// Building bounding boxes (body only; roof props may stick out above y).
export const BUILDING_RECT: Record<StageBuildingId, Rect> = {
  codex: { x: 56, y: 80, w: 64, h: 112 },
  security: { x: 256, y: 124, w: 80, h: 68 },
}

// Where drones take off / land (roof centers).
export const DOCK: Record<StageBuildingId, { x: number; y: number }> = {
  codex: { x: 88, y: 72 },
  security: { x: 296, y: 116 },
}

// Space reserved in real (unscaled) px around the stage.
export const CHROME = { top: 64, bottom: 0 }

export function computeStageScale(viewW: number, viewH: number): number {
  const s = Math.floor(Math.min(viewW / STAGE.w, (viewH - CHROME.top - CHROME.bottom) / STAGE.h))
  return Math.max(1, Math.min(6, s))
}
