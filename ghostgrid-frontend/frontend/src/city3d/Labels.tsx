// Building name plates as plain DOM above the canvas (crisp text, no drei <Html> roots).
// BuildingShell registers a world-space anchor per building; LabelProjector (inside the Canvas)
// projects anchors to screen space every frame and writes only style.transform — no React state.
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useNavigate } from 'react-router-dom'
import { openLibrarySite } from '../api/config'
import { STATUS_COLOR, STATUS_LABEL } from '../constants'
import { useBuildingList, useGrid } from '../store/grid'
import { useIsOffline } from '../store/keys'
import type { Building } from '../types'
import { PALETTE } from './materials'

const anchors = new Map<string, THREE.Vector3>()
const elements = new Map<string, HTMLElement>()

export function setLabelAnchor(id: string, x: number, y: number, z: number) {
  anchors.set(id, new THREE.Vector3(x, y, z))
}
export function removeLabelAnchor(id: string) {
  anchors.delete(id)
}

const tmp = new THREE.Vector3()

// Mount inside <Canvas>.
export function LabelProjector() {
  const size = useThree((s) => s.size)
  useFrame(({ camera }) => {
    for (const [id, el] of elements) {
      const a = anchors.get(id)
      if (!a) {
        if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden'
        continue
      }
      tmp.copy(a).project(camera)
      const x = ((tmp.x + 1) / 2) * size.width
      const y = ((1 - tmp.y) / 2) * size.height
      const visibility = tmp.z > 1 ? 'hidden' : 'visible'
      const transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`
      if (el.style.visibility !== visibility) el.style.visibility = visibility
      if (el.style.transform !== transform) el.style.transform = transform
    }
  })
  return null
}

function Label({ b }: { b: Building }) {
  const navigate = useNavigate()
  const offline = useIsOffline(b.id)
  const selected = useGrid((s) => s.selected === b.id)
  const status = offline && b.status === 'idle' ? 'offline' : b.status
  return (
    <button
      type="button"
      aria-label={b.type === 'codex' || b.type === 'claude' ? `Enter ${b.name} office` : `Open ${b.name}`}
      onClick={() => {
        if (useGrid.getState().buildMode) return
        if (b.type === 'library') openLibrarySite()
        else if (b.type === 'codex' || b.type === 'claude') navigate(`/office/${encodeURIComponent(b.id)}`)
        else useGrid.getState().selectBuilding(b.id)
      }}
      ref={(el) => {
        if (el) elements.set(b.id, el)
        else elements.delete(b.id)
      }}
      className={`font-pixel pointer-events-auto absolute left-0 top-0 cursor-pointer whitespace-nowrap border-2 px-1.5 py-1 text-[8px] leading-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gg-cyan ${selected ? '' : 'max-sm:hidden'}`}
      style={{
        visibility: 'hidden',
        color: selected ? PALETTE.pink : PALETTE.ink,
        borderColor: STATUS_COLOR[status],
        background: 'rgba(11,8,32,0.85)',
        boxShadow: '2px 2px 0 rgba(0,0,0,.6)',
      }}
      title={offline ? 'Add an API key first' : undefined}
    >
      <span className="mr-1 inline-block size-1.5 align-middle" style={{ background: STATUS_COLOR[status] }} />
      {b.short}
      {status !== 'idle' && <span style={{ color: STATUS_COLOR[status] }}> · {STATUS_LABEL[status]}</span>}
    </button>
  )
}

// Mount next to the <Canvas>, inside the same positioned wrapper.
export function BuildingLabels() {
  const list = useBuildingList()
  return (
    <div className="pointer-events-none absolute inset-0 z-[11] overflow-hidden">
      {list.filter((b) => b.type !== 'router').map((b) => (
        <Label key={b.id} b={b} />
      ))}
    </div>
  )
}
