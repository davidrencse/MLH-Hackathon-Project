// The filler city: ~55 procedural voxel buildings packed into the blocks around the agent lots.
// Nothing here is interactive — raycasting is disabled so clicks fall through to the lots, the
// lease pads and the canvas' onPointerMissed.
//
// EFFICIENCY: 4 draw calls total. Every tier box is merged into ONE geometry (world-aligned
// facade UVs + vertex colours for wall variety), roof props and neon go into one InstancedMesh
// each, and all the fake shadows merge into one quad mesh. The only per-frame work is a stepped
// window flicker, which writes two material fields.
import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { PALETTE, UNIT_BOX } from '../materials'
import { layoutScenery, NEONS, SCENERY_Y, WALLS, type SceneryBuilding, type SceneryVariant } from './layout'
import { FACADE_TILE, makeFacadeTextures } from './textures'
import { CyberSkyline } from './CyberSkyline'

// Moon sits at (-9, 16, 7), so shadows fall toward (+0.79, −0.61). Same value as BuildingShell.
const SHADOW_YAW = Math.atan2(0.614, 0.789)
const ROOF_DARKEN = 0.5 // tar roofs read darker than the walls
const BLANK_UV = 0.01 // first texel of the reserved blank cell

type Part = { p: [number, number, number]; s: [number, number, number]; c: string; k?: number }

function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

// ---------- merged facades ----------
// UVs come from world position, so the window grid is continuous across tiers and never
// stretches: horizontal faces sample the reserved blank cell instead.
function buildFacades(buildings: SceneryBuilding[]) {
  const parts: THREE.BufferGeometry[] = []
  const col = new THREE.Color()
  const roofCol = new THREE.Color()
  for (const b of buildings) {
    const r = rng(b.seed)
    const offU = Math.floor(r() * 8) / 8
    const offV = Math.floor(r() * 8) / 8
    col.set(WALLS[b.wall])
    roofCol.copy(col).multiplyScalar(ROOF_DARKEN)
    for (const t of b.tiers) {
      const g = new THREE.BoxGeometry(t.w, t.h, t.d)
      g.translate(t.x, t.y + t.h / 2, t.z)
      const pos = g.attributes.position
      const nor = g.attributes.normal
      const uv = g.attributes.uv
      const colors = new Float32Array(pos.count * 3)
      for (let i = 0; i < pos.count; i++) {
        const up = Math.abs(nor.getY(i)) > 0.5
        if (up) {
          uv.setXY(i, BLANK_UV, BLANK_UV)
        } else {
          const horiz = Math.abs(nor.getX(i)) > 0.5 ? pos.getZ(i) : pos.getX(i)
          uv.setXY(i, horiz / FACADE_TILE + offU, pos.getY(i) / FACADE_TILE + offV)
        }
        const c = up ? roofCol : col
        colors[i * 3] = c.r
        colors[i * 3 + 1] = c.g
        colors[i * 3 + 2] = c.b
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      parts.push(g)
    }
  }
  const merged = mergeGeometries(parts, false)
  parts.forEach((p) => p.dispose())
  return merged
}

// ---------- merged fake shadows ----------
function buildShadows(buildings: SceneryBuilding[]) {
  const parts: THREE.BufferGeometry[] = []
  const m = new THREE.Matrix4()
  const rot = new THREE.Matrix4()
  for (const b of buildings) {
    const len = Math.max(b.w, b.d) + b.h * 0.5
    const wid = Math.min(b.w, b.d) * 0.9
    const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
    // stretch away from the light, then swing the streak into the light's direction
    g.applyMatrix4(m.makeScale(len, 1, wid).setPosition((b.h * 0.5) / 2, 0, 0))
    g.applyMatrix4(rot.makeRotationY(SHADOW_YAW))
    g.translate(b.x, 0, b.z)
    parts.push(g)
  }
  const merged = mergeGeometries(parts, false)
  parts.forEach((p) => p.dispose())
  return merged
}

// ---------- roof props + neon ----------
// Builds the box lists for the two InstancedMeshes. `lit` boxes are shaded, `glow` boxes are
// unlit and above 1.0 so the bloom pass picks them up.
function buildProps(buildings: SceneryBuilding[]) {
  const lit: Part[] = []
  const glow: Part[] = []
  // signs are flickered per frame, so remember where they live in the glow list
  const signRange: [number, number][] = []

  for (const b of buildings) {
    const r = rng(b.seed ^ 0x5bf03)
    const top = b.tiers[b.tiers.length - 1]
    const tw = top.w
    const td = top.d
    const roofY = b.h
    const neon = NEONS[b.neon]

    // --- roof furniture ---
    if (b.roof === 'tank') {
      lit.push({ p: [b.x, roofY + 0.07, b.z], s: [Math.min(0.5, tw * 0.5), 0.14, Math.min(0.5, td * 0.5)], c: PALETTE.void })
      lit.push({ p: [b.x, roofY + 0.33, b.z], s: [Math.min(0.42, tw * 0.42), 0.38, Math.min(0.42, td * 0.42)], c: PALETTE.steel })
      lit.push({ p: [b.x, roofY + 0.55, b.z], s: [Math.min(0.46, tw * 0.46), 0.06, Math.min(0.46, td * 0.46)], c: PALETTE.haze })
    } else if (b.roof === 'ac') {
      const ox = (r() - 0.5) * tw * 0.4
      const oz = (r() - 0.5) * td * 0.4
      lit.push({ p: [b.x + ox, roofY + 0.11, b.z + oz], s: [0.34, 0.22, 0.3], c: PALETTE.steel })
      lit.push({ p: [b.x + ox, roofY + 0.23, b.z + oz], s: [0.24, 0.04, 0.2], c: PALETTE.void })
      glow.push({ p: [b.x + ox + 0.13, roofY + 0.16, b.z + oz + 0.12], s: [0.06, 0.06, 0.06], c: PALETTE.green, k: 1.6 })
    } else if (b.roof === 'antenna') {
      const h = 0.5 + r() * 0.7
      lit.push({ p: [b.x, roofY + 0.06, b.z], s: [0.2, 0.12, 0.2], c: PALETTE.night })
      lit.push({ p: [b.x, roofY + 0.12 + h / 2, b.z], s: [0.06, h, 0.06], c: PALETTE.steel })
      glow.push({ p: [b.x, roofY + 0.14 + h, b.z], s: [0.1, 0.1, 0.1], c: PALETTE.red, k: 2.2 })
    } else if (b.roof === 'stair') {
      lit.push({ p: [b.x + tw * 0.2, roofY + 0.16, b.z - td * 0.2], s: [0.4, 0.32, 0.36], c: PALETTE.dusk })
      glow.push({ p: [b.x + tw * 0.2, roofY + 0.16, b.z - td * 0.2 + 0.19], s: [0.14, 0.18, 0.02], c: PALETTE.yellow, k: 1.4 })
    }

    // --- neon rim along the two camera-facing roof edges ---
    glow.push({ p: [b.x, roofY + 0.03, b.z + td / 2], s: [tw, 0.05, 0.05], c: neon, k: 1.7 })
    glow.push({ p: [b.x + tw / 2, roofY + 0.03, b.z], s: [0.05, 0.05, td], c: neon, k: 1.7 })

    // --- lit doorway on the camera-facing side ---
    const doorOnZ = r() < 0.5
    glow.push({
      p: [b.x + (doorOnZ ? 0 : b.w / 2 + 0.02), 0.19, b.z + (doorOnZ ? b.d / 2 + 0.02 : 0)],
      s: doorOnZ ? [0.3, 0.3, 0.02] : [0.02, 0.3, 0.3],
      c: r() < 0.5 ? PALETTE.cyan : neon,
      k: 1.3,
    })

    // --- vertical sign: stacked glyph blocks, reads as pixel signage at this scale ---
    if (b.sign) {
      const onZ = r() < 0.5
      const n = 2 + Math.floor(r() * 3)
      const glyph = 0.17
      const from = glow.length
      const x = b.x + (onZ ? tw * 0.3 : b.w / 2 + 0.05)
      const z = b.z + (onZ ? b.d / 2 + 0.05 : td * 0.3)
      let y = b.h - 0.35
      for (let i = 0; i < n; i++) {
        glow.push({
          p: [x, y, z],
          s: onZ ? [glyph, glyph, 0.04] : [0.04, glyph, glyph],
          c: neon,
          k: 2.4,
        })
        y -= glyph + 0.07
      }
      signRange.push([from, glow.length])
    }

    // --- hanging sign cantilevered over the sidewalk ---
    if (b.hanging) {
      const onZ = r() < 0.5
      const y = Math.min(b.h - 0.25, 0.9 + r() * 0.5)
      const x = b.x + (onZ ? 0 : b.w / 2 + 0.22)
      const z = b.z + (onZ ? b.d / 2 + 0.22 : 0)
      lit.push({ p: [x, y + 0.16, z], s: onZ ? [0.04, 0.04, 0.44] : [0.44, 0.04, 0.04], c: PALETTE.steel })
      const from = glow.length
      glow.push({ p: [x, y, z], s: onZ ? [0.22, 0.2, 0.05] : [0.05, 0.2, 0.22], c: neon, k: 2.6 })
      signRange.push([from, glow.length])
    }
  }
  return { lit, glow, signRange }
}

function Boxes({ parts, material }: { parts: Part[]; material: THREE.Material }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    const o = new THREE.Object3D()
    const c = new THREE.Color()
    parts.forEach((pt, i) => {
      o.position.set(...pt.p)
      o.scale.set(...pt.s)
      o.updateMatrix()
      m.setMatrixAt(i, o.matrix)
      m.setColorAt(i, c.set(pt.c).multiplyScalar(pt.k ?? 1))
    })
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    m.computeBoundingSphere()
  }, [parts])
  return <instancedMesh ref={ref} args={[UNIT_BOX, material, parts.length]} raycast={() => null} />
}

// Signs blink on a shared stepped clock: a handful of instance colours are rewritten only when
// the step changes, not every frame.
function NeonBoxes({ parts, signRange, mat }: { parts: Part[]; signRange: [number, number][]; mat: THREE.Material }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const step = useRef(-1)
  const base = useMemo(() => parts.map((p) => new THREE.Color(p.c).multiplyScalar(p.k ?? 1)), [parts])

  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    const o = new THREE.Object3D()
    parts.forEach((pt, i) => {
      o.position.set(...pt.p)
      o.scale.set(...pt.s)
      o.updateMatrix()
      m.setMatrixAt(i, o.matrix)
      m.setColorAt(i, base[i])
    })
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    m.computeBoundingSphere()
  }, [parts, base])

  const tmp = useMemo(() => new THREE.Color(), [])
  useFrame(({ clock }) => {
    const m = ref.current
    if (!m || !m.instanceColor) return
    const s = Math.floor(clock.elapsedTime * 4) // steps(4), 0.25s
    if (s === step.current) return
    step.current = s
    signRange.forEach(([from, to], k) => {
      // deterministic per-sign hash → mostly on, with the occasional dead flicker
      const h = Math.abs(Math.sin((s + k * 37) * 12.9898) * 43758.5453) % 1
      const f = h < 0.06 ? 0.2 : h < 0.12 ? 0.6 : 1
      for (let i = from; i < to; i++) m.setColorAt(i, tmp.copy(base[i]).multiplyScalar(f))
    })
    m.instanceColor.needsUpdate = true
  })

  return <instancedMesh ref={ref} args={[UNIT_BOX, mat, parts.length]} raycast={() => null} />
}

// ---------- shared per-variant resources ----------
// Up to nine <Scenery/> live at once (core island + eight outer plates) and every plate draws
// the same filler city at a different offset, so the pack, the merged geometries, the facade
// textures and the materials are built once per variant and shared by every instance.
// Deliberately never disposed: an instance cannot know whether another plate still draws them,
// and there are at most two sets for the whole session (vs. one per mounted plate before).
type Resources = ReturnType<typeof buildResources>

function buildResources(variant: SceneryVariant) {
  const buildings = layoutScenery(variant)
  const tex = makeFacadeTextures()
  return {
    buildings,
    ...buildProps(buildings),
    facades: buildFacades(buildings),
    shadows: buildShadows(buildings),
    facadeMat: new THREE.MeshLambertMaterial({
      map: tex.map,
      emissiveMap: tex.emissiveMap,
      emissive: new THREE.Color('#ffffff'),
      emissiveIntensity: 0.45,
      vertexColors: true,
    }),
    shadowMat: new THREE.MeshBasicMaterial({ color: '#05030f', transparent: true, opacity: 0.5, depthWrite: false }),
    litMat: new THREE.MeshLambertMaterial({ color: '#ffffff' }),
    neonMat: new THREE.MeshBasicMaterial({ toneMapped: false }),
  }
}

const cache = new Map<SceneryVariant, Resources>()

function resourcesFor(variant: SceneryVariant): Resources {
  let r = cache.get(variant)
  if (!r) {
    r = buildResources(variant)
    cache.set(variant, r)
  }
  return r
}

/** `variant` picks which ground the packer had to work around: the core island's landmark lots
 *  and street furniture, or an outer plate's nine leasable super-blocks. */
export function Scenery({ variant = 'core' }: { variant?: SceneryVariant }) {
  const r = useMemo(() => resourcesFor(variant), [variant])

  // stepped window flicker (DESIGN.md: idle 2.4s loop, steps(4))
  useFrame(({ clock }) => {
    const k = Math.floor((clock.elapsedTime % 2.4) / 0.6)
    r.facadeMat.emissiveIntensity = k === 2 ? 0.35 : 0.45
  })

  return (
    <group position={[0, SCENERY_Y, 0]}>
      <mesh geometry={r.facades} material={r.facadeMat} raycast={() => null} receiveShadow />
      <mesh geometry={r.shadows} material={r.shadowMat} position={[0, 0.02, 0]} renderOrder={1} raycast={() => null} />
      <Boxes parts={r.lit} material={r.litMat} />
      <NeonBoxes parts={r.glow} signRange={r.signRange} mat={r.neonMat} />
      <CyberSkyline buildings={r.buildings} />
    </group>
  )
}
