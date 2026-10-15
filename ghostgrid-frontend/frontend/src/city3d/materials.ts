// Shared materials + procedural pixel textures for the 3D city.
// EFFICIENCY RULES: create geometries/materials once (module level or useMemo), never per frame;
// animate by mutating material props / texture offsets inside useFrame — never with React state.
import { useFrame } from '@react-three/fiber'
import { useContext, useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { BuildingStatus } from '../types'
import { BuildingCtx } from './BuildingCtx'

export const PALETTE = {
  void: '#070f1c',
  night: '#111f32',
  dusk: '#203047',
  haze: '#3e5a70',
  concrete: '#233448',
  asphalt: '#0b1624',
  steel: '#51677b',
  ink: '#e2f5fa',
  pink: '#ff4da6',
  cyan: '#42e8ed',
  green: '#b6f36b',
  yellow: '#ffcd70',
  red: '#ff627b',
  grey: '#7d96a9',
  orange: '#ff995a',
  blue: '#688dff',
}

export const STATUS_EMISSIVE: Record<BuildingStatus | 'offline', string> = {
  idle: PALETTE.cyan,
  working: PALETTE.green,
  needs_approval: PALETTE.yellow,
  error: PALETTE.red,
  offline: PALETTE.grey,
}

// ---------- shared simple materials (reuse these; do not create per mesh) ----------
const matCache = new Map<string, THREE.Material>()

// Flat lit material (receives light/shadows). Use for walls, roofs, props.
export function flatMat(color: string): THREE.MeshLambertMaterial {
  const k = `flat:${color}`
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshLambertMaterial({ color }))
  return matCache.get(k) as THREE.MeshLambertMaterial
}

// Unlit glowing material for neon strips, signs, beacons. Bloom picks these up.
export function neonMat(color: string, intensity = 2): THREE.MeshBasicMaterial {
  const k = `neon:${color}:${intensity}`
  if (!matCache.has(k)) {
    const c = new THREE.Color(color).multiplyScalar(intensity)
    matCache.set(k, new THREE.MeshBasicMaterial({ color: c, toneMapped: false }))
  }
  return matCache.get(k) as THREE.MeshBasicMaterial
}

// Shared box geometry: scale meshes instead of creating new BoxGeometry per prop.
export const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1)

// ---------- pixel textures ----------
function pixelTexture(canvas: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(canvas)
  t.magFilter = THREE.NearestFilter
  t.minFilter = THREE.NearestFilter
  t.generateMipmaps = false
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function rand(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

// Facade texture: dark wall with a grid of 2×2-pixel windows inside 4×4 cells.
// Returns { map, emissiveMap }: map = wall + unlit windows, emissiveMap = lit windows (white) on black.
export function makeFacadeTextures(cols: number, rows: number, seed: number, wall = PALETTE.night, litRatio = 0.55) {
  const W = cols * 4
  const H = rows * 4
  const a = document.createElement('canvas')
  const e = document.createElement('canvas')
  a.width = e.width = W
  a.height = e.height = H
  const ca = a.getContext('2d')!
  const ce = e.getContext('2d')!
  ca.fillStyle = wall
  ca.fillRect(0, 0, W, H)
  ce.fillStyle = '#000'
  ce.fillRect(0, 0, W, H)
  const r = rand(seed)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const lit = r() < litRatio
      ca.fillStyle = lit ? '#2e2a55' : '#151030'
      ca.fillRect(x * 4 + 1, y * 4 + 1, 2, 2)
      if (lit) {
        ce.fillStyle = r() < 0.15 ? '#ffd9f6' : '#ffffff'
        ce.fillRect(x * 4 + 1, y * 4 + 1, 2, 2)
      }
    }
  }
  return { map: pixelTexture(a), emissiveMap: pixelTexture(e) }
}

// Scrolling "terminal glyph" mask used while a building is working (shared by all buildings).
let glyphTex: THREE.CanvasTexture | null = null
export function getGlyphTexture() {
  if (glyphTex) return glyphTex
  const c = document.createElement('canvas')
  c.width = 32
  c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, 32, 64)
  const r = rand(99)
  g.fillStyle = '#fff'
  for (let y = 0; y < 64; y += 2) {
    let x = 1
    while (x < 31) {
      const len = 1 + Math.floor(r() * 4)
      if (r() < 0.6) g.fillRect(x, y, Math.min(len, 31 - x), 1)
      x += len + 1
    }
  }
  glyphTex = pixelTexture(c)
  glyphTex.wrapS = glyphTex.wrapT = THREE.RepeatWrapping
  return glyphTex
}

// Small canvas texture with pixel text (signs). Cached by text+color.
const signCache = new Map<string, THREE.CanvasTexture>()
export function signTexture(text: string, color: string, bg = '#10272f') {
  const k = `${text}|${color}|${bg}`
  if (signCache.has(k)) return signCache.get(k)!
  const c = document.createElement('canvas')
  const h = 16
  c.height = h
  const g = c.getContext('2d')!
  g.font = '8px "Press Start 2P", monospace'
  c.width = Math.max(16, Math.ceil(g.measureText(text).width) + 8)
  const g2 = c.getContext('2d')!
  g2.fillStyle = bg
  g2.fillRect(0, 0, c.width, h)
  g2.fillStyle = color
  g2.font = '8px "Press Start 2P", monospace'
  g2.textBaseline = 'middle'
  g2.fillText(text, 4, h / 2 + 1)
  const t = pixelTexture(c)
  signCache.set(k, t)
  return t
}

// ---------- facade material that reacts to the building status ----------
// Use inside a building component (it reads BuildingCtx). Returns ONE material; apply it to the
// wall faces of your main body meshes. Animation runs in useFrame by mutating the material.
export function useFacadeMaterial(opts: { cols: number; rows: number; seed: number; wall?: string; tint?: string }) {
  const ctx = useContext(BuildingCtx)
  const { mat, emissiveMap } = useMemo(() => {
    const { map, emissiveMap } = makeFacadeTextures(opts.cols, opts.rows, opts.seed, opts.wall)
    const mat = new THREE.MeshLambertMaterial({ map, emissiveMap, emissive: new THREE.Color(opts.tint ?? PALETTE.cyan) })
    return { mat, emissiveMap }
  }, [opts.cols, opts.rows, opts.seed, opts.wall, opts.tint])
  useEffect(() => () => {
    mat.map?.dispose()
    emissiveMap.dispose()
    mat.dispose()
  }, [mat, emissiveMap])

  const base = useMemo(() => new THREE.Color(opts.tint ?? PALETTE.cyan), [opts.tint])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const status = ctx.statusRef.current
    const offline = ctx.offlineRef.current && status === 'idle'
    const glyph = getGlyphTexture()
    if (status === 'working') {
      if (mat.emissiveMap !== glyph) {
        mat.emissiveMap = glyph
        mat.needsUpdate = true
      }
      glyph.offset.y = -Math.floor(t * 8) / 64 // steps(8) scroll
      mat.emissive.set(PALETTE.green)
      mat.emissiveIntensity = 1.6
      return
    }
    if (mat.emissiveMap !== emissiveMap) {
      mat.emissiveMap = emissiveMap
      mat.needsUpdate = true
    }
    if (offline) {
      mat.emissive.set(PALETTE.grey)
      mat.emissiveIntensity = 0.25
    } else if (status === 'error') {
      mat.emissive.set(PALETTE.red)
      mat.emissiveIntensity = Math.floor(t / 0.3) % 2 ? 1.8 : 0.3
    } else if (status === 'needs_approval') {
      mat.emissive.set(PALETTE.yellow)
      mat.emissiveIntensity = 0.9 + 0.6 * (Math.floor(t / 0.4) % 2)
    } else {
      mat.emissive.copy(base)
      mat.emissiveIntensity = 0.85 + 0.15 * (Math.floor(t * 2 + opts.seed) % 4 === 0 ? 0 : 1) // faint flicker
    }
  })
  return mat
}
