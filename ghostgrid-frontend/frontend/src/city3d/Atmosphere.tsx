// Night mood around the floating city: pixel sky, distant city, flying cars.
// Cars mutate instance buffers in useFrame.
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { PALETTE, UNIT_BOX } from './materials'
import { ISO_Q } from './isoFrame'
import { MAP } from './world'

const REDUCED =
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// ---------- iso screen frame ----------
// ISO_Q (see world.ts) has local +x = screen right, +y = screen up, +z = toward the camera.
const SCR_X = new THREE.Vector3(1, 0, 0).applyQuaternion(ISO_Q)
const SCR_Y = new THREE.Vector3(0, 1, 0).applyQuaternion(ISO_Q)
const VIEW = new THREE.Vector3(0, 0, 1).applyQuaternion(ISO_Q) // toward the camera

function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function nearestTex(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c)
  t.magFilter = THREE.NearestFilter
  t.minFilter = THREE.NearestFilter
  t.generateMipmaps = false
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// ---------- layout (screen-space, see ISO_Q) ----------

// Flying-car lanes (world space, along x).
const LANES = [
  { z: -16, y: 2, from: -40, to: 40, speed: 7, color: PALETTE.pink, phase: 0 },
  { z: 17, y: -4, from: 28, to: -44, speed: 9, color: PALETTE.cyan, phase: 31 },
]

// Platform lower silhouette in screen space (assumes a slab up to SLAB deep under the 16×16 ground).
const HALF = MAP.size / 2 + 0.6
const SLAB = 2.5
const P_FRONT_SY = HALF * SCR_Y.x - SLAB * SCR_Y.y + HALF * SCR_Y.z
const P_SIDE_SX = Math.abs(-HALF * SCR_X.x + HALF * SCR_X.z)
const P_SIDE_SY = -HALF * SCR_Y.x - SLAB * SCR_Y.y + HALF * SCR_Y.z
const platformFloor = (ax: number) => P_FRONT_SY + (P_SIDE_SY - P_FRONT_SY) * Math.min(1, ax / P_SIDE_SX)

// ---------- sky ----------
function hexRgb(h: string) {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function makeSkyTexture() {
  const H = 128
  const c = document.createElement('canvas')
  c.width = 1
  c.height = H
  const g = c.getContext('2d')!
  const stops: [number, number[]][] = [
    [0, hexRgb(PALETTE.void)],
    [0.5, hexRgb(PALETTE.night)],
    [1, hexRgb(PALETTE.dusk)],
  ]
  const pink = hexRgb(PALETTE.pink)
  const BAND = 4 // posterized steps → pixel-art sky
  for (let y = 0; y < H; y += BAND) {
    const t = (y + BAND / 2) / H
    const i = t < stops[1][0] ? 0 : 1
    const f = (t - stops[i][0]) / (stops[i + 1][0] - stops[i][0])
    const glow = Math.exp(-(((t - 0.74) / 0.05) ** 2)) * 0.14 // faint pink horizon band
    const col = [0, 1, 2].map((k) => {
      const base = stops[i][1][k] + (stops[i + 1][1][k] - stops[i][1][k]) * f
      return Math.round(base + (pink[k] - base) * glow)
    })
    g.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`
    g.fillRect(0, y, 1, BAND)
  }
  return nearestTex(c)
}

function Sky() {
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    const tex = makeSkyTexture()
    const prev = scene.background
    scene.background = tex
    return () => {
      if (scene.background === tex) scene.background = prev
      tex.dispose()
    }
  }, [scene])
  return null
}

// ---------- stars (GPU twinkle) ----------
// ---------- distant city (1 instanced mesh, windows via one shared emissive texture) ----------
const CITY_COLORS = ['#120b2a', '#1a1040', '#24164f']

function makeWindowTexture() {
  const S = 32 // 8×8 cells of 4 texels, 2×2 windows; texel (0,0) is always dark (used for roofs)
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, S, S)
  const r = rng(31)
  const lit = [PALETTE.ink, PALETTE.ink, PALETTE.ink, PALETTE.cyan, PALETTE.pink, PALETTE.yellow]
  for (let y = 0; y < S; y += 4)
    for (let x = 0; x < S; x += 4)
      if (r() < 0.2) {
        g.fillStyle = lit[Math.floor(r() * lit.length)]
        g.fillRect(x + 1, y + 1, 2, 2)
      }
  const t = nearestTex(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

interface CityBox {
  x: number
  y: number
  z: number
  w: number
  h: number
  d: number
  c: number
}

function layoutCity(count: number): CityBox[] {
  const r = rng(2077)
  const out: CityBox[] = []
  for (let tries = 0; out.length < count && tries < count * 8; tries++) {
    const a = r() * Math.PI * 2
    const R = HALF + 3 + Math.pow(r(), 0.85) * 18 // ring starts outside the platform rim
    const x = Math.cos(a) * R
    const z = Math.sin(a) * R
    const w = 0.8 + r() * 1.6
    const d = 0.8 + r() * 1.6
    const h = 2 + Math.pow(r(), 1.5) * 12
    const sx = x * SCR_X.x + z * SCR_X.z
    const hwS = (0.7072 * (w + d)) / 2 // half screen width of the box
    const hdY = (0.3536 * (w + d)) / 2 // top diamond rises this much on screen
    const syBase = x * SCR_Y.x + z * SCR_Y.z
    const topFor = (syLimit: number) => (syLimit - hdY - syBase) / SCR_Y.y

    let maxTop = topFor(8.5 + r() * 2.5) // keep the sky visible above the skyline
    // In front of the platform: stay below its lower silhouette.
    const ax = Math.max(0, Math.abs(sx) - hwS)
    if (x * VIEW.x + z * VIEW.z > 0 && ax < P_SIDE_SX + 0.5) maxTop = Math.min(maxTop, topFor(platformFloor(ax) - 0.5))
    // Keep the car lanes clear.
    for (const l of LANES) if (Math.abs(z - l.z) < d / 2 + 0.9) maxTop = Math.min(maxTop, l.y - 0.7)

    let top = -6 + h
    let base = -6
    if (top > maxTop) {
      top = maxTop
      base = Math.max(-26, top - h) // sink it (reads as a city far below) instead of flattening it
    }
    const hh = top - base
    if (hh < 1) continue
    out.push({ x, y: base + hh / 2, z, w, h: hh, d, c: Math.floor(r() * CITY_COLORS.length) })
  }
  return out
}

function DistantCity() {
  const ref = useRef<THREE.InstancedMesh>(null)
  const boxes = useMemo(() => layoutCity(210), [])
  const mat = useMemo(() => {
    const m = new THREE.MeshLambertMaterial({
      color: '#ffffff',
      emissive: '#ffffff',
      emissiveMap: makeWindowTexture(),
      emissiveIntensity: 1.1,
    })
    // World-scaled window UVs per instance (no stretching on tall boxes), dark roofs, per-building offset.
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
#ifdef USE_INSTANCING
  vec3 ggS = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vec2 ggOff = floor(fract(instanceMatrix[3].xz * vec2(0.137, 0.213)) * 8.0) / 8.0;
  vec2 ggRep = abs(normal.x) > 0.5 ? ggS.zy : ggS.xy;
  vEmissiveMapUv = abs(normal.y) > 0.5 ? vec2(0.01) : uv * ggRep / 3.2 + ggOff;
#endif`,
      )
    }
    m.customProgramCacheKey = () => 'gg-distant-city'
    return m
  }, [])
  useEffect(() => () => {
    mat.emissiveMap?.dispose()
    mat.dispose()
  }, [mat])
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const m = new THREE.Matrix4()
    const c = new THREE.Color()
    boxes.forEach((b, i) => {
      mesh.setMatrixAt(i, m.makeScale(b.w, b.h, b.d).setPosition(b.x, b.y, b.z))
      mesh.setColorAt(i, c.set(CITY_COLORS[b.c]))
    })
    mesh.count = boxes.length
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [boxes])
  return <instancedMesh ref={ref} args={[UNIT_BOX, mat, boxes.length]} />
}

// ---------- flying cars with light trails (1 instanced mesh) ----------
const TRAIL = 7
const PER_CAR = 2 + TRAIL // body, headlight, trail segments

function FlyingCars() {
  const ref = useRef<THREE.InstancedMesh>(null)
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), [])
  useEffect(() => () => mat.dispose(), [mat])
  const m = useMemo(() => new THREE.Matrix4(), [])

  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const c = new THREE.Color()
    LANES.forEach((l, i) => {
      const o = i * PER_CAR
      mesh.setColorAt(o, c.set(PALETTE.dusk))
      mesh.setColorAt(o + 1, c.set(PALETTE.ink).multiplyScalar(3))
      for (let j = 0; j < TRAIL; j++)
        mesh.setColorAt(o + 2 + j, c.set(l.color).multiplyScalar(2.6 * Math.pow(1 - j / TRAIL, 1.3)))
    })
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [])

  useFrame(({ clock }) => {
    const mesh = ref.current
    if (!mesh) return
    const t = REDUCED ? 0 : clock.elapsedTime
    LANES.forEach((l, i) => {
      const o = i * PER_CAR
      const len = Math.abs(l.to - l.from)
      const dir = Math.sign(l.to - l.from)
      const x = l.from + dir * ((t * l.speed + l.phase) % len)
      mesh.setMatrixAt(o, m.makeScale(0.9, 0.32, 0.5).setPosition(x, l.y, l.z))
      mesh.setMatrixAt(o + 1, m.makeScale(0.16, 0.16, 0.42).setPosition(x + dir * 0.5, l.y, l.z))
      for (let j = 0; j < TRAIL; j++)
        mesh.setMatrixAt(o + 2 + j, m.makeScale(0.42, 0.14, 0.14).setPosition(x - dir * (0.75 + j * 0.5), l.y, l.z))
    })
    mesh.instanceMatrix.needsUpdate = true
  })

  return <instancedMesh ref={ref} args={[UNIT_BOX, mat, LANES.length * PER_CAR]} frustumCulled={false} />
}

export function Atmosphere() {
  return (
    <>
      <Sky />
      <DistantCity />
      <FlyingCars />
    </>
  )
}
