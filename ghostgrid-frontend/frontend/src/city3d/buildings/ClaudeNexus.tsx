// Claude Nexus: terraced research ziggurat (3 setback tiers, cream terraces, dark-blue glass atrium)
// with a rotating holographic blueprint on the roof and session "thought orbs" orbiting it.
// Efficiency: ~10 draw calls (5 in the shadow pass). Repeated parts are InstancedMeshes whose
// matrices are written once; only the hologram group, the octahedron and <= 4 orbs move, all
// from ONE useFrame that mutates refs/material colors (no React state, no allocations per frame).
import { useFrame } from '@react-three/fiber'
import { useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { BuildingCtx } from '../BuildingCtx'
import { flatMat, neonMat, PALETTE, UNIT_BOX, useFacadeMaterial } from '../materials'

const ORANGE = PALETTE.orange
const CREAM = '#ffe6c7'
const GLASS = '#141c52' // dark blue atrium wall
const PLINTH = '#2d2160'
const STEEL = PALETTE.steel
const TANK = '#5d4f99'

const C_ORANGE = new THREE.Color(ORANGE)
const C_CREAM = new THREE.Color(CREAM)
const C_RED = new THREE.Color(PALETTE.red)
const C_YELLOW = new THREE.Color(PALETTE.yellow)
const C_GREY = new THREE.Color(PALETTE.grey)

// Shared, never disposed (module singletons like UNIT_BOX).
const CYL8 = new THREE.CylinderGeometry(0.5, 0.5, 1, 8)
const OCTA = new THREE.OctahedronGeometry(1, 0)
const PLANE = new THREE.PlaneGeometry(1, 1)
const SOLID_MAT = flatMat('#ffffff') // per-instance colors tint it
const ORB_MAT = neonMat('#ffffff', 1) // per-instance HDR colors

const REDUCED = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Scratch objects (render loop is single-threaded; reused by every instance).
const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _c = new THREE.Color()

type V3 = [number, number, number]
interface Part {
  p: V3
  s: V3
  c?: string
  rx?: number
  ry?: number
}

// Static instanced parts: matrices (and colors) written once in a layout effect.
function Parts({ geo, mat, parts, shadow = false }: { geo: THREE.BufferGeometry; mat: THREE.Material; parts: Part[]; shadow?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    parts.forEach((pt, i) => {
      _q.setFromEuler(_e.set(pt.rx ?? 0, pt.ry ?? 0, 0))
      m.setMatrixAt(i, _m.compose(_p.set(pt.p[0], pt.p[1], pt.p[2]), _q, _s.set(pt.s[0], pt.s[1], pt.s[2])))
      if (pt.c) m.setColorAt(i, _c.set(pt.c))
    })
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    m.computeBoundingSphere()
  }, [parts])
  return <instancedMesh ref={ref} args={[geo, mat, parts.length]} castShadow={shadow} receiveShadow={shadow} />
}

// "CLAUDE" in a 3x5 pixel font: 25x7 texels, so it stays legible at the 1/3-res pixel scale.
const GLYPHS: Record<string, string> = {
  C: '111100100100111',
  L: '100100100100111',
  A: '010101111101101',
  U: '101101101101111',
  D: '110101101101110',
  E: '111100110100111',
}
const SIGN_TEXT = 'CLAUDE'
const SIGN_TEX_W = SIGN_TEXT.length * 4 + 1
const SIGN_TEX_H = 7
let signMats: { on: THREE.MeshBasicMaterial; dim: THREE.MeshBasicMaterial } | null = null
function getSignMats() {
  if (signMats) return signMats
  const cv = document.createElement('canvas')
  cv.width = SIGN_TEX_W
  cv.height = SIGN_TEX_H
  const g = cv.getContext('2d')!
  g.fillStyle = PALETTE.void
  g.fillRect(0, 0, SIGN_TEX_W, SIGN_TEX_H)
  g.fillStyle = ORANGE
  for (let i = 0; i < SIGN_TEXT.length; i++) {
    const bits = GLYPHS[SIGN_TEXT[i]]
    for (let k = 0; k < 15; k++) if (bits[k] === '1') g.fillRect(1 + i * 4 + (k % 3), 1 + Math.floor(k / 3), 1, 1)
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.colorSpace = THREE.SRGBColorSpace
  signMats = {
    on: new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, color: new THREE.Color(2.4, 2.4, 2.4) }),
    dim: new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, color: new THREE.Color(0.35, 0.35, 0.35) }),
  }
  return signMats
}

// All geometry as numbers, derived from the lot footprint (3x3 lot = 2.6, 2x2 lot = 1.6) and roof height.
function layout(fw: number, fd: number, H: number) {
  const k = Math.min(1, Math.max(0.62, fw / 2.6)) // prop scale
  const P = 0.14 // plinth
  const SL = 0.12 // slab thickness
  const y1 = H * 0.34
  const T1 = y1 + 0.1
  const y2 = H * 0.66
  const T2 = y2 + 0.1
  const tiers = [
    { w: fw * 0.92, d: fd * 0.92, y0: P, y1 },
    { w: fw * 0.68, d: fd * 0.68, y0: T1, y1: y2 },
    { w: fw * 0.46, d: fd * 0.46, y0: T2, y1: H - 0.06 }, // glass atrium, top hidden in the roof slab
  ]
  const slabs = [
    { w: tiers[0].w + 0.14, d: tiers[0].d + 0.14, top: T1 },
    { w: tiers[1].w + 0.14, d: tiers[1].d + 0.14, top: T2 },
    { w: tiers[2].w + 0.16, d: tiers[2].d + 0.16, top: H }, // main roof: top exactly at H
  ]
  const cols = tiers.map((t) => Math.max(3, Math.round(t.w / 0.3)))
  const rows = tiers.map((t) => Math.max(3, Math.round((t.y1 - t.y0) / 0.3)))

  // terrace ring centers (between a tier's slab edge and the next tier's wall)
  const ax = (slabs[0].w / 2 + tiers[1].w / 2) / 2
  const az = (slabs[0].d / 2 + tiers[1].d / 2) / 2
  const bx = (slabs[1].w / 2 + tiers[2].w / 2) / 2
  const bz = (slabs[1].d / 2 + tiers[2].d / 2) / 2
  const mastTop = H + 0.35 // tip stays below the shell's name label
  const mastLen = mastTop - T1

  const ac: V3 = [0.24 * k, 0.16 * k, 0.2 * k]
  const solid: Part[] = [
    { p: [0, P / 2, 0], s: [fw, P, fd], c: PLINTH },
    ...slabs.map((sl): Part => ({ p: [0, sl.top - SL / 2, 0], s: [sl.w, SL, sl.d], c: CREAM })),
    // AC units on the terraces
    { p: [-ax, T1 + ac[1] / 2, -az], s: ac, c: STEEL },
    { p: [ax, T1 + ac[1] / 2, -az * 0.3], s: ac, c: STEEL },
    { p: [-ax * 0.3, T1 + ac[1] / 2, az], s: ac, c: STEEL },
    { p: [-bx * 0.2, T2 + ac[1] / 2, bz], s: ac, c: STEEL },
    // radio mast on the left terrace corner (silhouette spike) + cross bar
    { p: [-ax, T1 + mastLen / 2, az], s: [0.1, mastLen, 0.1], c: STEEL },
    { p: [-ax, mastTop - 0.45, az], s: [0.4 * k, 0.08, 0.08], c: STEEL },
    // dish post (right terrace corner) and water tank base (right corner, upper terrace)
    { p: [ax, T1 + 0.09, -az], s: [0.1, 0.18, 0.1], c: STEEL },
    { p: [bx, T2 + 0.03, -bz], s: [0.38 * k, 0.06, 0.38 * k], c: STEEL },
  ]
  const tankH = 0.42 * k
  const cyl: Part[] = [
    { p: [bx, T2 + 0.06 + tankH / 2, -bz], s: [0.32 * k, tankH, 0.32 * k], c: TANK },
    { p: [bx, T2 + 0.06 + tankH + 0.03, -bz], s: [0.36 * k, 0.06, 0.36 * k], c: CREAM },
    { p: [ax, T1 + 0.24, -az], s: [0.38 * k, 0.05, 0.38 * k], c: CREAM, rx: 0.6 }, // dish
  ]

  // corner sign on tier 2, facing the camera (normal +x+z); square texels at the 30deg view
  const signW = Math.min(2.2, fw * 0.85)
  const signH = (signW * (SIGN_TEX_H / SIGN_TEX_W)) / 0.866
  const signY = (T1 + y2) / 2 + 0.02
  const signPos: V3 = [tiers[1].w / 2 + 0.1, signY, tiers[1].d / 2 + 0.1]
  const R45 = Math.PI / 4
  const off = (signW / 2 + 0.05) * Math.SQRT1_2

  const trim: Part[] = []
  for (const t of tiers) {
    const h = t.y1 - t.y0
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) trim.push({ p: [(sx * t.w) / 2, t.y0 + h / 2, (sz * t.d) / 2], s: [0.1, h, 0.1] })
  }
  for (const sl of slabs) trim.push({ p: [0, sl.top - SL + 0.035, 0], s: [sl.w + 0.04, 0.07, sl.d + 0.04] }) // glowing slab underline
  trim.push(
    { p: [0, P + 0.2, tiers[0].d / 2 + 0.015], s: [0.34 * k, 0.4, 0.05] }, // doors
    { p: [tiers[0].w / 2 + 0.015, P + 0.2, 0], s: [0.05, 0.4, 0.34 * k] },
    { p: [-ax, mastTop + 0.05, az], s: [0.15, 0.15, 0.15] }, // mast tip
    { p: [signPos[0], signY + signH / 2 + 0.05, signPos[2]], s: [signW + 0.2, 0.1, 0.06], ry: R45 }, // sign frame
    { p: [signPos[0], signY - signH / 2 - 0.05, signPos[2]], s: [signW + 0.2, 0.1, 0.06], ry: R45 },
    { p: [signPos[0] + off, signY, signPos[2] - off], s: [0.1, signH + 0.2, 0.06], ry: R45 },
    { p: [signPos[0] - off, signY, signPos[2] + off], s: [0.1, signH + 0.2, 0.06], ry: R45 },
  )

  // holographic blueprint: flat 3x3 lattice above the roof (the shell's beacon sits in the center cell)
  const S = Math.min(slabs[2].w, slabs[2].d) * 0.86
  const holo: Part[] = []
  for (let i = 0; i < 4; i++) {
    const o = -S / 2 + (i * S) / 3
    holo.push({ p: [0, 0, o], s: [S + 0.1, 0.07, 0.1] }, { p: [o, 0, 0], s: [0.1, 0.07, S + 0.1] })
  }

  return {
    tiers,
    cols,
    rows,
    solid,
    cyl,
    trim,
    holo,
    S,
    octa: 0.14 * k,
    signPos,
    signW,
    signH,
    orbR: Math.hypot(slabs[2].w, slabs[2].d) / 2 + 0.16,
    orbY: H + 0.12,
    orbSize: 0.16 * Math.max(k, 0.85),
  }
}

export function ClaudeNexus() {
  const { footprint, height, building, statusRef, offlineRef } = useContext(BuildingCtx)
  const L = useMemo(() => layout(footprint.w, footprint.d, height), [footprint.w, footprint.d, height])

  const fac1 = useFacadeMaterial({ cols: L.cols[0], rows: L.rows[0], seed: 41, tint: CREAM })
  const fac2 = useFacadeMaterial({ cols: L.cols[1], rows: L.rows[1], seed: 42, tint: CREAM })
  const fac3 = useFacadeMaterial({ cols: L.cols[2], rows: L.rows[2], seed: 43, wall: GLASS, tint: ORANGE })
  const facades = [fac1, fac2, fac3]

  // Per-building materials (their color is animated, so they cannot be the shared cached ones).
  const trimMat = useMemo(() => new THREE.MeshBasicMaterial({ color: C_ORANGE.clone().multiplyScalar(1.8), toneMapped: false }), [])
  const holoMat = useMemo(() => new THREE.MeshBasicMaterial({ color: C_ORANGE.clone().multiplyScalar(1.5), toneMapped: false }), [])
  useEffect(
    () => () => {
      trimMat.dispose()
      holoMat.dispose()
    },
    [trimMat, holoMat],
  )
  const sign = getSignMats()

  const sessions = building?.sessions
  const orbStatuses = useMemo(() => (sessions ?? []).slice(0, 4).map((s) => s.status), [sessions])

  const holoRef = useRef<THREE.Group>(null)
  const octaRef = useRef<THREE.Mesh>(null)
  const orbsRef = useRef<THREE.InstancedMesh>(null)
  const signRef = useRef<THREE.Mesh>(null)
  const anim = useRef({ holo: 0, orb: 0 })

  // Create the orb color buffer before the first draw (avoids a shader recompile later).
  useLayoutEffect(() => {
    const m = orbsRef.current
    if (!m) return
    for (let i = 0; i < 4; i++) m.setColorAt(i, C_ORANGE)
  }, [])

  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime
    const dt = REDUCED ? 0 : Math.min(delta, 0.1)
    const status = statusRef.current
    const offline = offlineRef.current && status === 'idle'
    const working = status === 'working'
    const blinkOn = Math.floor(t / 0.3) % 2 === 0 // steps(2), 0.6s loop
    const pulseOn = Math.floor(t / 0.4) % 2 === 0

    // neon trims: Claude orange when idle/working, status colors otherwise
    if (offline) trimMat.color.copy(C_GREY).multiplyScalar(0.6)
    else if (status === 'error') trimMat.color.copy(C_RED).multiplyScalar(blinkOn ? 2.6 : 0.35)
    else if (status === 'needs_approval') trimMat.color.copy(C_YELLOW).multiplyScalar(pulseOn ? 2.4 : 1.1)
    else trimMat.color.copy(C_ORANGE).multiplyScalar(working ? 2.8 : 1.8)

    // sign flickers off on error, goes dark without an API key
    if (signRef.current) signRef.current.material = offline || (status === 'error' && !blinkOn) ? sign.dim : sign.on

    // hologram: faster + brighter while working
    const a = anim.current
    a.holo += dt * (offline ? 0 : working ? 2.6 : status === 'error' ? 0.2 : 0.6)
    if (holoRef.current) holoRef.current.rotation.y = a.holo
    if (octaRef.current) {
      octaRef.current.rotation.set(a.holo * 1.7, a.holo * 3, 0)
      octaRef.current.position.y = 0.22 + (REDUCED ? 0 : Math.sin(t * 2.2) * 0.05)
    }
    if (offline) holoMat.color.copy(C_GREY).multiplyScalar(0.5)
    else if (status === 'error') holoMat.color.copy(C_RED).multiplyScalar(blinkOn ? 2 : 0.3)
    else if (status === 'needs_approval') holoMat.color.copy(C_YELLOW).multiplyScalar(1.8)
    else if (working) holoMat.color.copy(C_CREAM).multiplyScalar(Math.floor(t * 12) % 7 === 0 ? 1.2 : 3.2)
    else holoMat.color.copy(C_ORANGE).multiplyScalar(1.5)

    // session thought orbs (<= 4): orbit the roof, running ones pulse
    const orbs = orbsRef.current
    const n = orbStatuses.length
    if (!orbs || n === 0) return
    a.orb += dt * (working ? 1.8 : 0.7)
    for (let i = 0; i < n; i++) {
      const ang = a.orb + (i / n) * Math.PI * 2
      const st = orbStatuses[i]
      const on = st === 'running' && Math.floor(t * 2.5 + i) % 2 === 0
      _p.set(Math.cos(ang) * L.orbR, L.orbY + (REDUCED ? 0 : Math.sin(t * 2 + i * 1.7) * 0.06), Math.sin(ang) * L.orbR)
      _q.setFromEuler(_e.set(a.orb * 2 + i, a.orb * 3, 0))
      orbs.setMatrixAt(i, _m.compose(_p, _q, _s.setScalar(L.orbSize * (on ? 1.4 : 1))))
      let col = C_ORANGE
      let k = 0.7 // queued
      if (offline) {
        col = C_GREY
        k = 0.5
      } else if (st === 'running') k = on ? 3.4 : 1.7
      else if (st === 'error') {
        col = C_RED
        k = 2.2
      } else if (st === 'done') {
        col = C_CREAM
        k = 1
      }
      orbs.setColorAt(i, _c.copy(col).multiplyScalar(k))
    }
    orbs.instanceMatrix.needsUpdate = true
    if (orbs.instanceColor) orbs.instanceColor.needsUpdate = true
  })

  return (
    <group>
      {L.tiers.map((t, i) => (
        <mesh
          key={i}
          geometry={UNIT_BOX}
          material={facades[i]}
          position={[0, (t.y0 + t.y1) / 2, 0]}
          scale={[t.w, t.y1 - t.y0, t.d]}
          castShadow
          receiveShadow
        />
      ))}
      <Parts geo={UNIT_BOX} mat={SOLID_MAT} parts={L.solid} shadow />
      <Parts geo={CYL8} mat={SOLID_MAT} parts={L.cyl} shadow />
      <Parts geo={UNIT_BOX} mat={trimMat} parts={L.trim} />
      <mesh ref={signRef} geometry={PLANE} material={sign.on} position={L.signPos} rotation={[0, Math.PI / 4, 0]} scale={[L.signW, L.signH, 1]} />
      <group ref={holoRef} position={[0, height + 0.24, 0]}>
        <Parts geo={UNIT_BOX} mat={holoMat} parts={L.holo} />
        <mesh ref={octaRef} geometry={OCTA} material={holoMat} position={[L.S / 2, 0.22, L.S / 2]} scale={L.octa} />
      </group>
      <instancedMesh
        ref={orbsRef}
        args={[UNIT_BOX, ORB_MAT, 4]}
        count={orbStatuses.length}
        visible={orbStatuses.length > 0}
        frustumCulled={false}
      />
    </group>
  )
}
