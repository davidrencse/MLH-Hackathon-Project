// Library of Babel: a stepped ziggurat of stacked reading halls (lit "book-spine" facades),
// a grand lit entrance on the front (+z) lane, neon cornice trims between tiers, and a slowly
// spinning halo of pages around a glowing knowledge orb on the roof. The orb takes the building's
// status colour. Backed by the local "Medium Library" (news) project — an offline article archive.
// Authored for a ~1.6 footprint (2×2 lot) and scaled uniformly in x/z for other lots.
// Efficiency: shared UNIT_BOX + module-level geometries/materials, one InstancedMesh for the page
// ring, all animation in a single useFrame mutating refs/materials (no per-frame React state).
import { useFrame } from '@react-three/fiber'
import { useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { BuildingStatus } from '../../types'
import { BuildingCtx } from '../BuildingCtx'
import { flatMat, neonMat, PALETTE, signTexture, UNIT_BOX, useFacadeMaterial } from '../materials'

// ---------- module-level shared geometry ----------
const PLANE = new THREE.PlaneGeometry(1, 1)
const ORB = new THREE.IcosahedronGeometry(0.5, 1) // low-poly → crisp pixel highlights
const RING = new THREE.TorusGeometry(0.5, 0.045, 6, 20).rotateX(Math.PI / 2)
const PAGE = new THREE.PlaneGeometry(0.18, 0.24)
const NO_RAYCAST = () => {}
const N_PAGES = 10
const RING_R = 0.62

// ---------- shared materials ----------
const ROOF = flatMat(PALETTE.dusk)
const STONE = flatMat(PALETTE.steel)
const DARK = flatMat(PALETTE.void)
const GOLD = neonMat(PALETTE.yellow, 2.2) // cornice trim
const AMBER = neonMat(PALETTE.orange, 2) // entrance glow
const PAGE_MAT = new THREE.MeshBasicMaterial({ color: PALETTE.ink, side: THREE.DoubleSide, toneMapped: false })
const C = {
  idle: new THREE.Color(PALETTE.cyan),
  working: new THREE.Color(PALETTE.green),
  needs_approval: new THREE.Color(PALETTE.yellow),
  error: new THREE.Color(PALETTE.red),
  offline: new THREE.Color(PALETTE.grey),
}

export function LibraryOfBabel() {
  const { footprint, height: H, statusRef, offlineRef } = useContext(BuildingCtx)
  const k = Math.min(footprint.w, footprint.d) / 1.6

  // "Book-spine" facade: tall thin lit windows read as rows of shelves.
  const wall = useFacadeMaterial({ cols: Math.max(6, Math.round(footprint.w * 4.6)), rows: Math.max(4, Math.round(H * 0.62)), seed: 73, tint: PALETTE.orange })

  // Per-building animated materials (orb/halo colour mutated in useFrame). Disposed on unmount.
  const fx = useMemo(
    () => ({
      orb: new THREE.MeshBasicMaterial({ color: PALETTE.cyan, toneMapped: false }),
      halo: new THREE.MeshBasicMaterial({ color: PALETTE.cyan, toneMapped: false }),
      sign: new THREE.MeshBasicMaterial({ map: signTexture('LIBRARY', PALETTE.yellow), toneMapped: false }),
      glow: new THREE.MeshBasicMaterial({
        color: PALETTE.cyan,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      }),
    }),
    [],
  )
  useEffect(() => () => Object.values(fx).forEach((m) => m.dispose()), [fx])

  const wallMats = useMemo(() => [wall, wall, ROOF, ROOF, wall, wall], [wall]) // [+x,-x,+y,-y,+z,-z]

  // Three stacked tiers → roof at H.
  const t1H = H * 0.42
  const t2H = H * 0.33
  const t3H = H * 0.25
  const T1 = { w: 1.5, h: t1H, y: t1H / 2 }
  const T2 = { w: 1.08, h: t2H, y: t1H + t2H / 2 }
  const T3 = { w: 0.66, h: t3H, y: t1H + t2H + t3H / 2 }
  const orbY = H + 0.42

  const halo = useRef<THREE.Group>(null)
  const pages = useRef<THREE.InstancedMesh>(null)
  const orb = useRef<THREE.Mesh>(null)
  const glow = useRef<THREE.Mesh>(null)
  const anim = useRef({ col: C.idle.clone() })

  // Page ring: fixed matrices, pages stand upright facing outward around the orb.
  useLayoutEffect(() => {
    const im = pages.current
    if (!im) return
    const o = new THREE.Object3D()
    for (let i = 0; i < N_PAGES; i++) {
      const a = (i / N_PAGES) * Math.PI * 2
      o.position.set(Math.cos(a) * RING_R, 0, Math.sin(a) * RING_R)
      o.rotation.set(0, -a + Math.PI / 2, 0)
      o.updateMatrix()
      im.setMatrixAt(i, o.matrix)
    }
    im.instanceMatrix.needsUpdate = true
    im.computeBoundingSphere()
  }, [])

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const dt = Math.min(delta, 0.1)
    const st = statusRef.current as BuildingStatus
    const offline = offlineRef.current && st === 'idle'
    const key = offline ? 'offline' : st
    const target = C[key] ?? C.idle

    const e = 1 - Math.exp(-dt * 4)
    anim.current.col.lerp(target, e)
    const col = anim.current.col

    // orb pulses; blinks fast on error, steady-bright when working
    const flash = Math.floor(t / 0.22) % 2 === 0
    const blink = Math.floor(t / 0.4) % 2 === 0
    let mul = 1.4 + Math.sin(t * 1.6) * 0.3
    if (st === 'working') mul = 2.4
    else if (st === 'error') mul = flash ? 2.8 : 0.4
    else if (st === 'needs_approval') mul = blink ? 2.6 : 0.5
    else if (offline) mul = 0.5

    fx.orb.color.copy(col).multiplyScalar(mul)
    fx.halo.color.copy(col).multiplyScalar(1.4)
    fx.glow.color.copy(col)
    fx.glow.opacity = 0.14 + Math.max(0, Math.sin(t * 1.6)) * 0.12
    PAGE_MAT.color.copy(C.idle).lerp(col, 0.25).multiplyScalar(1.1)

    if (halo.current) halo.current.rotation.y += dt * (offline ? 0.15 : 0.7)
    if (orb.current) {
      orb.current.rotation.y += dt * 0.5
      const s = 1 + Math.sin(t * 2) * 0.05
      orb.current.scale.setScalar(s)
    }
    if (glow.current) glow.current.lookAt(state.camera.position)
  })

  return (
    <group scale={[k, 1, k]}>
      {/* ---- stepped tiers (reading halls) ---- */}
      <mesh geometry={UNIT_BOX} material={wallMats} position={[0, T1.y, 0]} scale={[T1.w, T1.h, T1.w]} castShadow receiveShadow />
      <mesh geometry={UNIT_BOX} material={wallMats} position={[0, T2.y, 0]} scale={[T2.w, T2.h, T2.w]} castShadow receiveShadow />
      <mesh geometry={UNIT_BOX} material={wallMats} position={[0, T3.y, 0]} scale={[T3.w, T3.h, T3.w]} castShadow receiveShadow />

      {/* ---- neon cornice trims where tiers step in ---- */}
      <mesh geometry={UNIT_BOX} material={GOLD} position={[0, t1H, 0]} scale={[T1.w + 0.06, 0.07, T1.w + 0.06]} />
      <mesh geometry={UNIT_BOX} material={GOLD} position={[0, t1H + t2H, 0]} scale={[T2.w + 0.06, 0.07, T2.w + 0.06]} />
      {/* front vertical corner trims on the base tier */}
      <mesh geometry={UNIT_BOX} material={GOLD} position={[T1.w / 2, T1.y, T1.w / 2]} scale={[0.06, T1.h, 0.06]} />
      <mesh geometry={UNIT_BOX} material={GOLD} position={[-T1.w / 2, T1.y, T1.w / 2]} scale={[0.06, T1.h, 0.06]} />

      {/* ---- "LIBRARY" sign on the base front ---- */}
      <mesh geometry={PLANE} material={fx.sign} position={[0, T1.h * 0.72, T1.w / 2 + 0.012]} scale={[1.1, 0.26, 1]} />

      {/* ---- grand entrance: recessed lit doorway + two columns + steps on the +z lane ---- */}
      <mesh geometry={UNIT_BOX} material={AMBER} position={[0, 0.34, T1.w / 2 + 0.015]} scale={[0.5, 0.68, 0.03]} />
      <mesh geometry={UNIT_BOX} material={DARK} position={[0, 0.3, T1.w / 2 + 0.03]} scale={[0.34, 0.56, 0.04]} />
      <mesh geometry={UNIT_BOX} material={STONE} position={[0.33, 0.42, T1.w / 2 + 0.02]} scale={[0.12, 0.84, 0.12]} />
      <mesh geometry={UNIT_BOX} material={STONE} position={[-0.33, 0.42, T1.w / 2 + 0.02]} scale={[0.12, 0.84, 0.12]} />
      <mesh geometry={UNIT_BOX} material={STONE} position={[0, 0.05, T1.w / 2 + 0.18]} scale={[0.9, 0.1, 0.34]} receiveShadow />

      {/* ---- roof: knowledge orb, additive glow, and a spinning halo of pages ---- */}
      <mesh ref={glow} geometry={PLANE} material={fx.glow} position={[0, orbY, 0]} scale={[2.1, 2.1, 1]} raycast={NO_RAYCAST} />
      <mesh ref={orb} geometry={ORB} material={fx.orb} position={[0, orbY, 0]} scale={0.46} raycast={NO_RAYCAST} />
      <group ref={halo} position={[0, orbY, 0]}>
        <mesh geometry={RING} material={fx.halo} raycast={NO_RAYCAST} />
        <instancedMesh ref={pages} args={[PAGE, PAGE_MAT, N_PAGES]} raycast={NO_RAYCAST} />
      </group>
      {/* short plinth under the orb on the top tier */}
      <mesh geometry={UNIT_BOX} material={STONE} position={[0, H + 0.12, 0]} scale={[0.3, 0.24, 0.3]} />
    </group>
  )
}
