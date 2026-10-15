// Camera feel for the iso city: fit-to-viewport zoom, drag to orbit (drei OrbitControls), idle sway,
// WASD / arrow keys to pan across the ground, Q / E 90° turns, R or double-click on empty space
// to reset.
// EFFICIENCY: all camera motion runs in useFrame by mutating the camera. React re-renders only on resize.
import { OrbitControls } from '@react-three/drei/core/OrbitControls'
import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type ComponentRef } from 'react'
import { usePlots } from '../store/plots'
import { placeCamera, registerWideView, resetCameraOrbit } from './cameraMotion'
import { CAMERA, MAP, platformCorners, PLOT_OFFSETS, WORLD_HALF } from './world'

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
const ZOOM_STEP = 0.0016 // zoom factor per unit of wheel delta (≈1.2x per 120px notch)
const ZOOM_SMOOTH = 14 // exponential approach rate; higher = snappier, lower = floatier
const DRAG_PX = 5 // pointer travel (CSS px) after which a press is a drag, not a click
const ORIGIN: [number, number, number] = [0, 0, 0]

// Points that bound the city: platform slab and the corner towers with their antennas.
// The set is symmetric under 90° turns, so one fit works for every Q / E view.
// The whole platform is framed, not just the core: every lot on the 34x34 map — the leasable
// ring — is reachable and visible without panning. Wall Street and Agent Row have plates of
// their own now (WALL_ST_PLOT, AGENT_PLOT), so they are framed by the open-plate points. Top point is the city's headroom — above the zeppelin lanes; the mid points are
// the tallest landmark blocks with their antennas. Keep these in step with BUILDING_HEIGHT.
const EDGE = MAP.size / 2 + 0.8 // platform rim
const CORE_POINTS: [number, number, number][] = [[0, 20.6, 0]]
for (const sx of [-1, 1])
  for (const sz of [-1, 1])
    CORE_POINTS.push(
      [sx * EDGE, 0, sz * EDGE],
      [sx * EDGE, -1.2, sz * EDGE],
      [sx * 13, 17, sz * 13], // Wall Street / district towers near the rim, crowns included
      [sx * 5, 13.6, sz * 5],
    )

// Headroom to leave above an outer plate: its filler city tops out near 9, but the player can
// lease a Codex Tower out there, which with its per-lot hash reaches ~14 (see buildingHeight).
const PLATE_TOP = 15

// The city the camera has to frame: the core landmarks plus the rim of every plate in `plots`.
// Opening a plate therefore widens the reset view instead of leaving it off-screen.
function fitPointsFor(plots: readonly number[]): [number, number, number][] {
  const out = [...CORE_POINTS]
  for (const [x, z] of platformCorners(plots)) out.push([x, 0, z], [x, -1.2, z], [x, PLATE_TOP, z])
  return out
}

const ALL_PLOTS = PLOT_OFFSETS.map((_, k) => k)
const PAN_MARGIN = 2 // let the player push a corner plate a little past the screen centre
// WASD / arrows pan across the ground. The speed is in CSS pixels per second and divided by the
// zoom, so the city slides under the cursor at the same rate however far in the player is — a
// fixed world-units figure crawls when zoomed in and bolts when zoomed out.
const PAN_PX_PER_S = 900
const PAN_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'])

// Zoom that fits the city into the area between the HUD bars, plus the screen offset (CSS px, +y up)
// of the origin that centres the city box in that area.
function computeFit(w: number, h: number, points: [number, number, number][]) {
  const sa = Math.sin(HOME_AZ)
  const ca = Math.cos(HOME_AZ)
  const sp = Math.sin(HOME_POLAR)
  const cp = Math.cos(HOME_POLAR)
  let u0 = Infinity
  let u1 = -Infinity
  let v0 = Infinity
  let v1 = -Infinity
  for (const [x, y, z] of points) {
    const u = x * ca - z * sa // screen right
    const v = -x * cp * sa + y * sp - z * cp * ca // screen up
    u0 = Math.min(u0, u)
    u1 = Math.max(u1, u)
    v0 = Math.min(v0, v)
    v1 = Math.max(v1, v)
  }
  const side = w >= 900 ? 216 : w < 600 ? 24 : 72 // clear of the BuildMenu column (mirrored on the right)
  const availW = Math.max(120, w - 2 * side)
  const availH = Math.max(120, h - HUD_TOP - HUD_BOTTOM)
  const zoom = Math.min(availW / (u1 - u0), availH / (v1 - v0))
  const ox = -((u0 + u1) / 2) * zoom
  const oy = (HUD_BOTTOM - HUD_TOP) / 2 - ((v0 + v1) / 2) * zoom
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
  // Wheel zoom target. OrbitControls applies orthographic zoom in one step per wheel event,
  // so a scroll arrives as a stair of hard jumps, each with its own projection rebuild. The
  // wheel now only moves this target and the frame loop eases the camera onto it, which is
  // one projection update per frame however fast the wheel spins. `null` = nothing pending,
  // so touch pinch — still OrbitControls' job — is never fought over.
  const zoomTarget = useRef<number | null>(null)
  const fitted = useRef(false)
  const reducedMotion = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, [])

  // Three fits, all from the same solver:
  // - `fit` frames the city as it stands (core + the plates the player opened) → mount + reset;
  // - `coreFit` is the zoom-in reference, so a tower stays inspectable however far the city grew;
  // - `wideFit` frames the whole 3x3 grid *including the locked plates*, and sets minZoom, which
  //   is what makes the eight background plates reachable: zoom all the way out and their OPEN
  //   PLOT buttons come on screen to be clicked.
  const openPlots = usePlots((s) => s.open)
  const fit = useMemo(
    () => computeFit(size.width, size.height, fitPointsFor(openPlots)),
    [size.width, size.height, openPlots],
  )
  const coreFit = useMemo(() => computeFit(size.width, size.height, CORE_POINTS), [size.width, size.height])
  const wideFit = useMemo(() => computeFit(size.width, size.height, fitPointsFor(ALL_PLOTS)), [size.width, size.height])
  const fitRef = useRef(fit)
  const zoomRange = useMemo(
    () => ({ min: Math.min(wideFit.zoom * 0.95, coreFit.zoom * 0.45), max: coreFit.zoom * 2.2 }),
    [coreFit.zoom, wideFit.zoom],
  )

  // (1) Fit on mount; on resize keep the player's zoom relative to the new fit. Opening a plate
  // also changes `fit` — it recentres the frame on the bigger city, but it must NOT rescale the
  // zoom the player chose, or every plate they open would yank the camera backwards.
  const lastSize = useRef({ w: 0, h: 0 })
  useLayoutEffect(() => {
    if (!size.width || !size.height) return
    const prev = fitRef.current
    const resized = lastSize.current.w !== size.width || lastSize.current.h !== size.height
    if (!fitted.current) camera.zoom = fit.zoom
    else if (resized) camera.zoom = Math.min(zoomRange.max, Math.max(zoomRange.min, camera.zoom * (fit.zoom / prev.zoom)))
    camera.setViewOffset(size.width, size.height, -fit.ox, fit.oy, size.width, size.height)
    camera.updateProjectionMatrix()
    if (!fitted.current) camera.lookAt(0, 0, 0)
    fitRef.current = fit
    lastSize.current = { w: size.width, h: size.height }
    fitted.current = true
  }, [camera, fit, zoomRange, size.width, size.height])

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
      zoomTarget.current = null // the tween drives the zoom from here
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
    startTween(az + shortestDelta(az, HOME_AZ), HOME_POLAR, fitRef.current.zoom)
  }, [camera, startTween])

  // (6) Pull back to the whole grid, locked plates included, and face the default iso angle.
  const viewAll = useCallback(() => {
    const c = controls.current
    if (!c) return
    c.enableDamping = false
    c.update()
    resetCameraOrbit(camera, c.target, Math.hypot(...CAMERA.position))
    c.update()
    const az = c.getAzimuthalAngle()
    startTween(az + shortestDelta(az, HOME_AZ), HOME_POLAR, zoomRange.min)
  }, [camera, startTween, zoomRange.min])

  useEffect(() => registerWideView(viewAll), [viewAll])

  // Held pan keys. A Set rather than a flag per key, so opposite keys cancel and two adjacent
  // ones give a diagonal, and it is read in the frame loop instead of moving the camera on the
  // keydown repeat rate (which differs per OS and stutters).
  const panKeys = useRef(new Set<string>())
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return
      const k = e.key.toLowerCase()
      if (!PAN_KEYS.has(k)) return
      e.preventDefault() // arrows would otherwise scroll the page behind the canvas
      panKeys.current.add(k)
      noteInput()
      if (tween.current) endTween()
    }
    const up = (e: KeyboardEvent) => panKeys.current.delete(e.key.toLowerCase())
    // A key held while the window loses focus never sends its keyup, and the camera would drift
    // on its own when the player came back.
    const clear = () => panKeys.current.clear()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clear)
    document.addEventListener('visibilitychange', clear)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clear)
      document.removeEventListener('visibilitychange', clear)
    }
  }, [noteInput, endTween])

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

  // Wheel zoom, eased. Captured before OrbitControls' own wheel listener and stopped there,
  // so the controls never apply their one-step-per-notch zoom — while `enableZoom` stays on,
  // which is what keeps two-finger pinch working on touch screens (same flag, same handler).
  useEffect(() => {
    const el = (events.connected as HTMLElement | undefined) ?? gl.domElement
    const onWheel = (e: WheelEvent) => {
      if (!(e.target instanceof Node) || !el.contains(e.target)) return
      e.preventDefault()
      e.stopPropagation()
      noteInput()
      if (tween.current) endTween()
      const from = zoomTarget.current ?? camera.zoom
      const next = from * Math.exp(-e.deltaY * ZOOM_STEP)
      zoomTarget.current = Math.min(zoomRange.max, Math.max(zoomRange.min, next))
    }
    window.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => window.removeEventListener('wheel', onWheel, { capture: true })
  }, [camera, endTween, events.connected, gl, noteInput, zoomRange.max, zoomRange.min])

  // Coming back to the tab restarts the idle timer instead of jumping the sway phase.
  useEffect(() => {
    const onVis = () => noteInput()
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [noteInput])

  const onStart = useCallback(() => {
    dragging.current = true
    noteInput()
    zoomTarget.current = null // pinch and drag own the camera while they last
    if (tween.current) endTween() // the player takes over from wherever the animation is
  }, [noteInput, endTween])
  const onEnd = useCallback(() => {
    dragging.current = false
    noteInput()
  }, [noteInput])

  // Runs after OrbitControls.update() (priority -1) and before the composer render (priority 1).
  useFrame((_, delta) => {
    const c = controls.current
    if (!c) return

    // (1b) WASD / arrow pan, along the ground in screen directions rather than world axes: W goes
    // "away from the camera" whichever way the player has orbited to, which is what a hand on the
    // keyboard expects. OrbitControls puts the camera at azimuth `az`, so the ground vector from
    // the target toward the camera is (sin az, cos az) — forward is its negative, right is
    // perpendicular. Target and camera move by the same delta, so orbit angle and zoom are
    // untouched, and the clamp below still owns the bounds.
    const held = panKeys.current
    if (held.size > 0 && !dragging.current) {
      const az = c.getAzimuthalAngle()
      const sin = Math.sin(az)
      const cos = Math.cos(az)
      let dx = 0
      let dz = 0
      if (held.has('w') || held.has('arrowup')) { dx -= sin; dz -= cos }
      if (held.has('s') || held.has('arrowdown')) { dx += sin; dz += cos }
      if (held.has('d') || held.has('arrowright')) { dx += cos; dz -= sin }
      if (held.has('a') || held.has('arrowleft')) { dx -= cos; dz += sin }
      const len = Math.hypot(dx, dz)
      if (len > 0) {
        // Normalised, so holding two keys is not 1.41x faster than one.
        const step = (PAN_PX_PER_S / camera.zoom) * delta / len
        camera.position.x += dx * step
        camera.position.z += dz * step
        c.target.x += dx * step
        c.target.z += dz * step
        noteInput()
      }
    }

    // (2) Pan bounds. OrbitControls has no target limits, so a drag could walk the view off the
    // 3x3 grid into empty space with no landmark to steer back by. Clamping the orbit target to
    // the grid (plus a margin) keeps every corner reachable and nothing beyond it. The camera
    // moves by the same delta, so the orbit angle and the zoom are untouched.
    const tgt = c.target
    const limit = WORLD_HALF + PAN_MARGIN
    const cx = Math.min(limit, Math.max(-limit, tgt.x))
    const cy = Math.min(6, Math.max(-1, tgt.y))
    const cz = Math.min(limit, Math.max(-limit, tgt.z))
    if (cx !== tgt.x || cy !== tgt.y || cz !== tgt.z) {
      camera.position.x += cx - tgt.x
      camera.position.y += cy - tgt.y
      camera.position.z += cz - tgt.z
      tgt.set(cx, cy, cz)
    }

    // Ease onto the wheel's zoom target: one projection rebuild per frame, and the motion
    // reads as a glide instead of a stack of steps.
    const wanted = zoomTarget.current
    if (wanted != null) {
      const k = reducedMotion ? 1 : 1 - Math.exp(-delta * ZOOM_SMOOTH)
      const next = camera.zoom + (wanted - camera.zoom) * k
      if (Math.abs(wanted - next) < wanted * 0.0005) {
        camera.zoom = wanted
        zoomTarget.current = null
      } else camera.zoom = next
      camera.updateProjectionMatrix()
    }

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
      minZoom={zoomRange.min}
      maxZoom={zoomRange.max}
      target={ORIGIN}
      onStart={onStart}
      onEnd={onEnd}
    />
  )
}
