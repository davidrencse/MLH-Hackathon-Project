// Context every 3D building component can read. Values that change often are refs so
// useFrame can read them without re-rendering React.
import { createContext, type RefObject } from 'react'
import type { Building, BuildingStatus } from '../types'

export interface BuildingCtxValue {
  building: Building // snapshot (re-renders when the building object changes)
  footprint: { w: number; d: number } // usable size on its lot (world units)
  height: number // roof height (world units), from BUILDING_HEIGHT
  statusRef: RefObject<BuildingStatus>
  offlineRef: RefObject<boolean> // true when no API key resolves for this building
  selectedRef: RefObject<boolean>
  hoveredRef: RefObject<boolean>
}

const noop = { current: false }
export const BuildingCtx = createContext<BuildingCtxValue>({
  building: undefined as unknown as Building,
  footprint: { w: 2, d: 2 },
  height: 3,
  statusRef: { current: 'idle' },
  offlineRef: noop,
  selectedRef: noop,
  hoveredRef: noop,
})
