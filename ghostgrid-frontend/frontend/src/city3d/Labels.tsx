// Building name plates as plain DOM above the canvas (crisp text, no drei <Html> roots).
// BuildingShell registers a world-space anchor per building; LabelProjector (inside the Canvas)
// projects anchors to screen space every frame and writes only style.transform — no React state.
import { useRef } from 'react'
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

// DOM overlays the city must never hide behind: a label projected under one of these is hidden
// instead of being drawn half-covered by an opaque panel.
const KEEP_OUT = '.gg-top-nav, .gg-build-menu, .gg-weather, .gg-dozer-button, .gg-camera-controls, .gg-mobile-nav, .gg-mobile-city-hint'
const KEEP_OUT_PAD = 6
const keepOut: DOMRect[] = []
const sizes: number[] = []

export function setLabelAnchor(id: string, x: number, y: number, z: number) {
  anchors.set(id, new THREE.Vector3(x, y, z))
}
// Register the DOM node a projected anchor drives. Labels keyed `plot:<k>` come from the
// districts; everything else is a building.
export function setLabelElement(id: string, el: HTMLElement | null) {
  if (el) elements.set(id, el)
  else elements.delete(id)
}
export function setLabelEmphasis(id: string, active: boolean) {
  const el = elements.get(id)
  if (el && el.dataset.highlighted !== String(active)) el.dataset.highlighted = String(active)
}
export function removeLabelAnchor(id: string) {
  anchors.delete(id)
}

const tmp = new THREE.Vector3()

// A label the camera cannot show must not keep focus or clicks either, so visibility and
// `inert` always move together. Both are checked before writing: no layout churn per frame.
function hide(el: HTMLElement, hidden: boolean) {
  const visibility = hidden ? 'hidden' : 'visible'
  if (el.style.visibility !== visibility) el.style.visibility = visibility
  if (el.hasAttribute('inert') !== hidden) el.toggleAttribute('inert', hidden)
}

// Mount inside <Canvas>.
export function LabelProjector() {
  const size = useThree((s) => s.size)
  const gl = useThree((s) => s.gl)
  const elapsed = useRef(0)
  useFrame(({ camera }, delta) => {
    elapsed.current += delta
    if (elapsed.current < 1 / 30) return
    elapsed.current %= 1 / 30
    // Canvas-space → viewport-space offset, so keep-out rects and label points share coordinates.
    const canvas = gl.domElement.getBoundingClientRect()
    keepOut.length = 0
    for (const node of document.querySelectorAll(KEEP_OUT)) {
      const rect = node.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) keepOut.push(rect)
    }
    // Read every size before writing any transform, so the loop cannot thrash layout.
    sizes.length = 0
    for (const [, el] of elements) sizes.push(el.offsetWidth, el.offsetHeight)
    let slot = 0
    for (const [id, el] of elements) {
      const w = sizes[slot++], h = sizes[slot++]
      const a = anchors.get(id)
      if (!a) {
        hide(el, true)
        continue
      }
      tmp.copy(a).project(camera)
      const x = ((tmp.x + 1) / 2) * size.width
      const y = ((1 - tmp.y) / 2) * size.height
      // Where the box actually lands: centred horizontally, and either above the anchor
      // (building plates) or centred on it (district plot buttons).
      const left = canvas.left + x - w / 2
      const top = canvas.top + y - (el.dataset.anchor === 'center' ? h / 2 : h)
      const offscreen = tmp.z > 1 || tmp.z < -1 || Math.abs(tmp.x) > 1.05 || Math.abs(tmp.y) > 1.05
      const covered = keepOut.some((r) =>
        left < r.right + KEEP_OUT_PAD && left + w > r.left - KEEP_OUT_PAD &&
        top < r.bottom + KEEP_OUT_PAD && top + h > r.top - KEEP_OUT_PAD)
      hide(el, offscreen || covered)
      const anchorY = el.dataset.anchor === 'center' ? '-50%' : '-100%'
      const transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, ${anchorY})`
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
      ref={(el) => setLabelElement(b.id, el)}
      data-landmark={b.type === 'codex' || b.type === 'claude'}
      className={`gg-building-label font-pixel pointer-events-auto absolute left-0 top-0 cursor-pointer whitespace-nowrap border-2 px-1.5 py-1 text-[8px] leading-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gg-cyan ${selected ? '' : 'max-sm:hidden'}`}
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
      {status !== 'idle' && status !== 'offline' && <span style={{ color: STATUS_COLOR[status] }}> · {STATUS_LABEL[status]}</span>}
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
