// Building name plates as plain DOM above the canvas (crisp text, no drei <Html> roots).
// BuildingShell registers a world-space anchor per building; LabelProjector (inside the Canvas)
// projects anchors to screen space every frame and writes only style.transform — no React state.
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useNavigate } from 'react-router-dom'
import { hasOfficePage, STATUS_COLOR, STATUS_LABEL } from '../constants'
import { useBuildingList, useGrid } from '../store/grid'
import { useIsOffline } from '../store/keys'
import type { Building } from '../types'
import { PALETTE } from './materials'

const anchors = new Map<string, THREE.Vector3>()
const elements = new Map<string, HTMLElement>()

// Label box sizes, kept by a ResizeObserver instead of read per frame. Reading offsetWidth
// inside the projector forced a synchronous layout of the whole document on every tick,
// which is what made dragging and zooming feel heavy: the camera moves, so every tick had
// to re-measure before it could write a transform.
const boxes = new Map<HTMLElement, { w: number; h: number }>()
const boxObserver =
  typeof ResizeObserver === 'undefined'
    ? null
    : new ResizeObserver((entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement
          if (!boxes.has(el)) continue
          const box = entry.borderBoxSize?.[0]
          boxes.set(el, box ? { w: box.inlineSize, h: box.blockSize } : { w: el.offsetWidth, h: el.offsetHeight })
        }
      })

// DOM overlays the city must never hide behind: a label projected under one of these is hidden
// instead of being drawn half-covered by an opaque panel.
const KEEP_OUT = '[data-hud-panel]'
const KEEP_OUT_PAD = 6
const keepOut: DOMRect[] = []
/** How long the HUD's keep-out rectangles are reused before being measured again. */
const KEEP_OUT_TTL_MS = 500

// Labels also hide each other: six towers standing close together projected six plates
// onto the same hundred pixels ("WATCHTOWER" over "RELAY", "MUSE" over "FREQTRADE"), and
// an unreadable label is worse than a missing one. Rank decides who survives, and it is
// deliberately stable — ranking by screen position instead would make the pair swap, and
// flicker, every time the camera drifted.
const LABEL_PAD = 2
interface Placement {
  el: HTMLElement
  left: number
  top: number
  w: number
  h: number
  x: number
  y: number
  hidden: boolean
  rank: number
}
// Pooled across frames: this loop runs 30x a second and must not allocate.
const placements: Placement[] = []
const order: Placement[] = []

export function setLabelAnchor(id: string, x: number, y: number, z: number) {
  anchors.set(id, new THREE.Vector3(x, y, z))
}
// Register the DOM node a projected anchor drives. Labels keyed `plot:<k>` come from the
// districts; everything else is a building.
export function setLabelElement(id: string, el: HTMLElement | null) {
  const previous = elements.get(id)
  if (previous && previous !== el) {
    boxObserver?.unobserve(previous)
    boxes.delete(previous)
  }
  if (el) {
    elements.set(id, el)
    if (!boxes.has(el)) {
      boxes.set(el, { w: el.offsetWidth, h: el.offsetHeight })
      boxObserver?.observe(el)
    }
  } else elements.delete(id)
}
export function setLabelEmphasis(id: string, active: boolean) {
  const el = elements.get(id)
  if (el && el.dataset.highlighted !== String(active)) el.dataset.highlighted = String(active)
}
export function removeLabelAnchor(id: string) {
  anchors.delete(id)
}

const tmp = new THREE.Vector3()

// Mount inside <Canvas>.
export function LabelProjector() {
  const size = useThree((s) => s.size)
  const gl = useThree((s) => s.gl)
  const elapsed = useRef(0)
  const canvasRect = useRef<DOMRect | null>(null)
  const keepOutAt = useRef(0)

  // The canvas fills its wrapper, so its box only moves when the viewport does.
  useEffect(() => {
    canvasRect.current = gl.domElement.getBoundingClientRect()
    keepOutAt.current = 0
  }, [gl, size.width, size.height])

  useFrame(({ camera }, delta) => {
    elapsed.current += delta
    if (elapsed.current < 1 / 30) return
    elapsed.current %= 1 / 30
    // Canvas-space → viewport-space offset, so keep-out rects and label points share coordinates.
    const canvas = (canvasRect.current ??= gl.domElement.getBoundingClientRect())
    // The HUD panels move only when the layout changes, not when the camera does, so their
    // boxes are measured a couple of times a second rather than every tick.
    const now = performance.now()
    if (now - keepOutAt.current > KEEP_OUT_TTL_MS) {
      keepOutAt.current = now
      keepOut.length = 0
      for (const node of document.querySelectorAll(KEEP_OUT)) {
        const rect = node.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) keepOut.push(rect)
      }
    }
    // Pass 1 — where every label lands, and whether the HUD or the frame already hides it.
    let count = 0
    let seat = elements.size
    for (const [id, el] of elements) {
      seat--
      const box = boxes.get(el)
      const w = box?.w ?? 0, h = box?.h ?? 0
      const a = anchors.get(id)
      if (!a) {
        if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden'
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
      const p = (placements[count] ??= { el, left, top, w, h, x, y, hidden: false, rank: 0 })
      p.el = el
      p.left = left
      p.top = top
      p.w = w
      p.h = h
      p.x = x
      p.y = y
      p.hidden = offscreen || covered
      // Whatever the player is pointing at wins, then the landmark towers, then the order
      // the city registered them in — a fixed seat, so the same label keeps winning.
      p.rank =
        (el.dataset.highlighted === 'true' ? 2e6 : 0) +
        (el.dataset.landmark === 'true' ? 1e6 : 0) +
        (el.dataset.secondary === 'true' ? 0 : 5e5) +
        seat
      count++
    }

    // Pass 2 — the survivors claim their space, strongest first; anything that lands on a
    // claim is dropped for this frame.
    order.length = 0
    for (let i = 0; i < count; i++) order.push(placements[i])
    order.sort((a, b) => b.rank - a.rank)
    for (let i = 0; i < order.length; i++) {
      const p = order[i]
      if (p.hidden || p.w === 0) continue
      for (let j = 0; j < i; j++) {
        const q = order[j]
        if (q.hidden) continue
        if (
          p.left < q.left + q.w + LABEL_PAD && p.left + p.w + LABEL_PAD > q.left &&
          p.top < q.top + q.h + LABEL_PAD && p.top + p.h + LABEL_PAD > q.top
        ) {
          p.hidden = true
          break
        }
      }
    }

    // Pass 3 — write to the DOM.
    for (let i = 0; i < count; i++) {
      const p = placements[i]
      const el = p.el
      const visibility = p.hidden ? 'hidden' : 'visible'
      // A hidden label must not keep focus or clicks; `inert` covers both without a re-render.
      if (el.style.visibility !== visibility) {
        el.style.visibility = visibility
        el.toggleAttribute('inert', p.hidden)
      }
      const anchorY = el.dataset.anchor === 'center' ? '-50%' : '-100%'
      const transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, ${anchorY})`
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
      aria-label={hasOfficePage(b.type) ? `Enter ${b.name} office` : `Open ${b.name}`}
      onClick={() => {
        if (useGrid.getState().buildMode) return
        if (hasOfficePage(b.type)) navigate(`/office/${encodeURIComponent(b.id)}`)
        else useGrid.getState().selectBuilding(b.id)
      }}
      ref={(el) => setLabelElement(b.id, el)}
      data-landmark={hasOfficePage(b.type)}
      // A Wall Street repo is scenery, not an agent; when plates collide the towers that can
      // actually run something keep their name on the map.
      data-secondary={b.type === 'quant' ? 'true' : undefined}
      // The theme restyles labels; this lets it keep its soft idle border without
      // flattening the status colours set below (see cyberpunk.css).
      data-status={status}
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
      {list.map((b) => (
        <Label key={b.id} b={b} />
      ))}
    </div>
  )
}
