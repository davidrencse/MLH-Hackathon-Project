// Camera feel for the iso city: fit-to-viewport zoom, drag to orbit (drei OrbitControls), idle sway,
// Q / E 90° turns, R or double-click on empty space to reset.
// EFFICIENCY: all camera motion runs in useFrame by mutating the camera. React re-renders only on resize.
import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type ComponentRef } from 'react'
import { placeCamera, resetCameraOrbit } from './cameraMotion'
import { CAMERA } from './world'

type Controls = ComponentRef<typeof OrbitControls>

const DEG = Math.PI / 180
const QUARTER = Math.PI / 2
const HOME_AZ = 45 * DEG // default azimuth: camera on +x/+z (see CAMERA.position)
const HOME_POLAR = 60 * DEG // elevation 30° = 60° from vertical → 2:1 dimetric
const HUD_TOP = 72 // CSS px kept free for the TopNav
const HUD_BOTTOM = 16 // Keep a small margin below the expanded city
const IDLE_S = 4 // seconds without input before the sway starts
const SWAY = 6 * DEG
const SWAY_PERIOD = 16 // seconds
const SWAY_FADE_IN = 3 // seconds
const TURN_S = 0.6 // Q / E / reset animation
const DRAG_PX = 5 // pointer travel (CSS px) after which a press is a drag, not a click
const ORIGIN: [number, number, number] = [0, 0, 0]

// Points that bound the city: platform slab, corner towers with antennas, router spire.
// The set is symmetric under 90° turns, so one fit works for every Q / E view.
// Default view is this much closer than "fit whole city" so more detail is visible. 1 = old view.
const CITY_SCALE = 1.15
const FIT_POINTS: [number, number, number][] = [[0, 22, 0]]
for (const sx of [-1, 1])
  for (const sz of [-1, 1]) FIT_POINTS.push([sx * 20, 0, sz * 20], [sx * 20, -1.2, sz * 20], [sx * 5.5, 19, sz * 5.5])

// Zoom that fits the city into the area between the HUD bars, plus the screen offset (CSS px, +y up)
// of the origin that centres the city box in that area.
function computeFit(w: number, h: number) {
  const sa = Math.sin(HOME_AZ)
  const ca = Math.cos(HOME_AZ)
  const sp = Math.sin(HOME_POLAR)
  const cp = Math.cos(HOME_POLAR)
  let u0 = Infinity
  let u1 = -Infinity
  let v0 = Infinity
  let v1 = -Infinity
  for (const [x, y, z] of FIT_POINTS) {
    const u = x * ca - z * sa // screen right
    const v = -x * cp * sa + y * sp - z * cp * ca // screen up
    u0 = Math.min(u0, u)
    u1 = Math.max(u1, u)
    v0 = Math.min(v0, v)
    v1 = Math.max(v1, v)
  }
  const side = w >= 900 ? 216 : w < 600 ? 24 : 72 // clear of the BuildMenu column (mirrored on the right)
  const availW = Math.max(120, w - 2 * side)
  const top = w < 900 ? 124 : HUD_TOP
  const bottom = w < 900 ? 210 : HUD_BOTTOM
  const availH = Math.max(120, h - top - bottom)
  const zoom = Math.min(availW / (u1 - u0), availH / (v1 - v0))
  const ox = -((u0 + u1) / 2) * zoom
  const oy = (bottom - top) / 2 - ((v0 + v1) / 2) * zoom
  return { zoom, ox, oy }
}

// Nearest clean iso azimuth (45° + k·90°).
const snapIso = (az: number) => HOME_AZ + Math.round((az - HOME_AZ) / QUARTER) * QUARTER
const shortestDelta = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from))
const easeInOutCubic = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2)
const nowS = () => performance.now() / 1000

interface Tween {
  t0: number
  dur: number
  az0: number
  az1: number
  p0: number
  p1: number
  z0: number
  z1: number
}

function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
}

export function CameraRig() {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const gl = useThree((s) => s.gl)
  const events = useThree((s) => s.events)
  const get = useThree((s) => s.get)

  const controls = useRef<Controls>(null)
  const tween = useRef<Tween | null>(null)
  const sway = useRef<{ base: number; from: number; t0: number } | null>(null)
  const lastInput = useRef(nowS())
  const dragging = useRef(false)
  const fitted = useRef(false)
  const reducedMotion = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, [])

  const fit = useMemo(() => computeFit(size.width, size.height), [size.width, size.height])
  const fitRef = useRef(fit)

  // (1) Fit on mount; on resize keep the player's zoom relative to the new fit.
  useLayoutEffect(() => {
    if (!size.width || !size.height) return
    const prev = fitRef.current
    const z = fitted.current ? camera.zoom * (fit.zoom / prev.zoom) : fit.zoom * (size.width < 900 ? 1.75 : CITY_SCALE)
    camera.zoom = Math.min(fit.zoom * 14, Math.max(fit.zoom * 0.18, z))
    camera.setViewOffset(size.width, size.height, -fit.ox, fit.oy, size.width, size.height)
    camera.updateProjectionMatrix()
    if (!fitted.current) camera.lookAt(0, 0, 0)
    fitRef.current = fit
    fitted.current = true
  }, [camera, fit, size.width, size.height])

  const noteInput = useCallback(() => {
    lastInput.current = nowS()
    sway.current = null
  }, [])

  const endTween = useCallback(() => {
    tween.current = null
    if (controls.current) controls.current.enableDamping = true
    lastInput.current = nowS()
  }, [])

  const startTween = useCallback(
    (az1: number, p1: number, z1: number) => {
      const c = controls.current
      if (!c) return
      noteInput()
      // Damping off for the tween: the next controls.update() flushes leftover drag inertia at once,
      // so it cannot fight the animation. endTween() turns damping back on.
      c.enableDamping = false
      tween.current = {
        t0: nowS(),
        dur: reducedMotion ? 0.001 : TURN_S,
        az0: c.getAzimuthalAngle(),
        az1,
        p0: c.getPolarAngle(),
        p1,
        z0: camera.zoom,
        z1,
      }
    },
    [camera, noteInput, reducedMotion],
  )

  // (4) Q / E: turn the view 90° from the nearest clean iso angle (chains while a turn is running).
  const turn = useCallback(
    (dir: 1 | -1) => {
      const c = controls.current
      if (!c) return
      const t = tween.current
      const base = t ? t.az1 : snapIso(c.getAzimuthalAngle())
      startTween(base + dir * QUARTER, t ? t.p1 : c.getPolarAngle(), t ? t.z1 : camera.zoom)
    },
    [camera, startTween],
  )

  // (5) Back to the default iso angle and the fit zoom.
  const reset = useCallback(() => {
    const c = controls.current
    if (!c) return
    // Flush pending pan/rotation before recentering, so inertia cannot undo reset.
    c.enableDamping = false
    c.update()
    resetCameraOrbit(camera, c.target, Math.hypot(...CAMERA.position))
    c.update()
    const az = c.getAzimuthalAngle()
    startTween(az + shortestDelta(az, HOME_AZ), HOME_POLAR, fitRef.current.zoom * (size.width < 900 ? 1.75 : CITY_SCALE))
  }, [camera, startTween, size.width])

  // Shared camera actions give touch users the same controls as the keyboard.
  useEffect(() => {
    const onCamera = (event: Event) => {
      const action = (event as CustomEvent<string>).detail
      if (action === 'left') turn(1)
      else if (action === 'right') turn(-1)
      else if (action === 'reset') reset()
      else if (action === 'in' || action === 'out') {
        const c = controls.current
        if (!c) return
        const zoom = Math.min(fitRef.current.zoom * 14, Math.max(fitRef.current.zoom * 0.18, camera.zoom * (action === 'in' ? 1.35 : 1 / 1.35)))
        startTween(c.getAzimuthalAngle(), c.getPolarAngle(), zoom)
      }
    }
    window.addEventListener('gg:camera', onCamera)
    return () => window.removeEventListener('gg:camera', onCamera)
  }, [camera, turn, reset, startTween])

  // Keyboard: Q / E turn, R reset. Ignored while typing or with modifier keys (Cmd+R must still reload).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTyping(e.target)) return
      const k = e.key.toLowerCase()
      if (k === 'q') turn(1)
      else if (k === 'e') turn(-1)
      else if (k === 'r') reset()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [turn, reset])

  // Pointer bookkeeping on the canvas wrapper (the element R3F and OrbitControls listen on):
  // - a press that travels more than DRAG_PX is an orbit drag, so its click never reaches R3F;
  // - double-click on empty space (no interactive object under the pointer) resets the view;
  // - any pointer activity over the city counts as input and stops the idle sway.
  // Window capture listeners run before R3F's listeners, whatever the event target is.
  useEffect(() => {
    const el = (events.connected as HTMLElement | undefined) ?? gl.domElement
    let inside = false
    let dragged = false
    let downX = 0
    let downY = 0
    const within = (t: EventTarget | null) => t instanceof Node && el.contains(t)
    const onDown = (e: PointerEvent) => {
      inside = within(e.target)
      if (!inside) return
      dragged = false
      downX = e.clientX
      downY = e.clientY
      noteInput()
    }
    const onMove = (e: PointerEvent) => {
      if (!within(e.target)) return
      lastInput.current = nowS()
      if (!inside || dragged || e.buttons === 0) return
      const dx = e.clientX - downX
      const dy = e.clientY - downY
      if (dx * dx + dy * dy > DRAG_PX * DRAG_PX) dragged = true
    }
    const onClick = (e: MouseEvent) => {
      if (dragged && within(e.target)) e.stopPropagation()
    }
    const onDouble = (e: MouseEvent) => {
      if (!within(e.target)) return
      if (dragged) {
        e.stopPropagation()
        return
      }
      if (get().internal.initialHits.length === 0) reset()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('click', onClick, true)
    window.addEventListener('dblclick', onDouble, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('click', onClick, true)
      window.removeEventListener('dblclick', onDouble, true)
    }
  }, [events.connected, gl, get, noteInput, reset])

  // Coming back to the tab restarts the idle timer instead of jumping the sway phase.
  useEffect(() => {
    const onVis = () => noteInput()
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [noteInput])

  const onStart = useCallback(() => {
    dragging.current = true
    noteInput()
    if (tween.current) endTween() // the player takes over from wherever the animation is
  }, [noteInput, endTween])
  const onEnd = useCallback(() => {
    dragging.current = false
    noteInput()
  }, [noteInput])

  // Runs after OrbitControls.update() (priority -1) and before the composer render (priority 1).
  useFrame(() => {
    const c = controls.current
    if (!c) return
    const now = nowS()
    const tw = tween.current
    if (tw) {
      const k = Math.min(1, (now - tw.t0) / tw.dur)
      const e = easeInOutCubic(k)
      placeCamera(camera, c.target, tw.az0 + (tw.az1 - tw.az0) * e, tw.p0 + (tw.p1 - tw.p0) * e)
      if (tw.z1 !== tw.z0) {
        camera.zoom = tw.z0 + (tw.z1 - tw.z0) * e
        camera.updateProjectionMatrix()
      }
      if (k >= 1) endTween()
      return
    }

    // (3) Idle sway: ease onto a ±6° sine around the nearest iso angle (or around the player's own
    // angle when they turned far away from it). Stops on any input; the camera stays where it is.
    if (reducedMotion || dragging.current || now - lastInput.current < IDLE_S) return
    let s = sway.current
    if (!s) {
      const from = c.getAzimuthalAngle()
      const iso = snapIso(from)
      s = sway.current = { base: Math.abs(from - iso) <= SWAY + 2 * DEG ? iso : from, from, t0: now }
    }
    const t = now - s.t0
    const f = Math.min(1, t / SWAY_FADE_IN)
    const env = f * f * (3 - 2 * f)
    const target = s.base + SWAY * Math.sin((t / SWAY_PERIOD) * Math.PI * 2)
    placeCamera(camera, c.target, s.from + (target - s.from) * env, c.getPolarAngle())
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.5}
      minPolarAngle={45 * DEG}
      maxPolarAngle={70 * DEG}
      minZoom={fit.zoom * 0.18}
      maxZoom={fit.zoom * 14}
      zoomToCursor
      target={ORIGIN}
      onStart={onStart}
      onEnd={onEnd}
    />
  )
}
