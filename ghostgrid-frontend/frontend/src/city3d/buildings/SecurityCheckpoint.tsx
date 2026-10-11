// Security Checkpoint: low armored bastion (sloped glacis + slit-window block), a corner watchtower with a
// sweeping searchlight, and a barrier gate across the front lane.
// Layout is authored for the 3x3 lot (footprint 2.6) and scales uniformly in x/z for other sizes.
// The camera looks from +x+z, so the tower sits at the back-right and the gate lane runs along the front (+z).
// Efficiency: shared UNIT_BOX + cached materials, module-level geometries, one InstancedMesh for the
// tank-trap teeth, all animation in one useFrame by mutating refs/materials (no React state per frame).
import { useFrame } from '@react-three/fiber'
import { useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { BuildingStatus } from '../../types'
import { BuildingCtx } from '../BuildingCtx'
import { flatMat, neonMat, PALETTE, signTexture, UNIT_BOX, useFacadeMaterial } from '../materials'

// ---------- module-level shared geometry (created once) ----------

// Flat-shaded square frustum: unit-square base on y=0, top at y=1. topRatio 0 gives a pyramid.
function prism(topRatio: number) {
  const g = new THREE.CylinderGeometry(topRatio / Math.SQRT2, 1 / Math.SQRT2, 1, 4, 1)
  g.rotateY(Math.PI / 4)
  g.translate(0, 0.5, 0)
  const flat = g.toNonIndexed()
  flat.computeVertexNormals() // per-face normals → flat Lambert look
  g.dispose()
  return flat
}
const FRUSTUM = prism(0.76)
const PYRAMID = prism(0)
const PLANE = new THREE.PlaneGeometry(1, 1)

// Searchlight cone: apex at the origin, opens toward +z, length 1 (scaled uniformly at runtime).
const BEAM_SPREAD = 0.16 // cone radius per unit of length
const BEAM_OFS = 0.18 // apex sits in front of the lamp lens
const BEAM_GEO = new THREE.ConeGeometry(BEAM_SPREAD, 1, 8, 1, true).translate(0, -0.5, 0).rotateX(-Math.PI / 2)
const POOL_GEO = new THREE.CircleGeometry(1, 10).rotateX(-Math.PI / 2)
const NO_RAYCAST = () => {}

// Hazard stripes: white/black diagonal pixels, tinted yellow (or red) through material.color.
let hazardCanvas: HTMLCanvasElement | null = null
const hazardTexCache = new Map<string, THREE.CanvasTexture>()
function hazardTexture(rx: number, ry: number) {
  const key = `${rx}:${ry}`
  const hit = hazardTexCache.get(key)
  if (hit) return hit
  if (!hazardCanvas) {
    hazardCanvas = document.createElement('canvas')
    hazardCanvas.width = hazardCanvas.height = 8
    const g = hazardCanvas.getContext('2d')!
    g.fillStyle = '#000'
    g.fillRect(0, 0, 8, 8)
    g.fillStyle = '#fff'
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if ((x + y) % 8 < 4) g.fillRect(x, y, 1, 1)
  }
  const t = new THREE.CanvasTexture(hazardCanvas)
  t.magFilter = THREE.NearestFilter
  t.minFilter = THREE.NearestFilter
  t.generateMipmaps = false
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  t.repeat.set(rx, ry)
  hazardTexCache.set(key, t)
  return t
}
const hazardMatCache = new Map<string, THREE.MeshBasicMaterial>()
function hazardMat(rx: number, ry: number) {
  const key = `${rx}:${ry}`
  let m = hazardMatCache.get(key)
  if (!m) {
    m = new THREE.MeshBasicMaterial({ map: hazardTexture(rx, ry), color: PALETTE.yellow })
    hazardMatCache.set(key, m)
  }
  return m
}

// ---------- shared materials + colors ----------
const STEEL = flatMat(PALETTE.steel)
const DARK = flatMat(PALETTE.night)
const DISH = flatMat('#8f8ab8')
const NEON_Y = neonMat(PALETTE.yellow, 2)
const NEON_R = neonMat(PALETTE.red, 1.8)
const TIP_ON = neonMat(PALETTE.red, 3)
const C_YELLOW = new THREE.Color(PALETTE.yellow)
const C_RED = new THREE.Color(PALETTE.red)
const C_GREEN = new THREE.Color(PALETTE.green)
const C_GREY = new THREE.Color(PALETTE.grey)
const C_BEAM = new THREE.Color(PALETTE.ink)

// ---------- layout (local units for a 2.6 × 2.6 footprint; roof = ctx.height) ----------
const BASE_H = 1 // sloped armor glacis height
const FR = { z: -0.3, w: 2.6, d: 1.75, top: 0.76 } // glacis: center z, base size, top/base ratio
const UP = { x: -0.1, z: -0.32, w: 1.4, d: 1 } // slit-window block on the glacis (covers the lot center)
const TW = { x: 0.9, z: -0.9, s: 0.5, cab: 0.8 } // watchtower shaft + lookout cab
const LANE = { z0: 0.63, z1: 1.3 } // gate lane along the front edge
const LANE_TOP = 0.04
const GX = 0.8 // gate post x
const HINGE_Z = 1.18
const ARM_X = GX - 0.16 // arm hangs on the -x side of the post
const ARM_LEN = 0.6
const ARM_UP = 1.35 // raised angle (rad)
const POOL_Y = 0.08
const SWEEP_MID = -0.575
const SWEEP_AMP = 0.925
const PITCH_IDLE = 0.85
const MERLONS: [number, number][] = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
]
const TEETH: [number, number][] = [
  [-1.15, 1.2],
  [-0.85, 1.2],
  [-0.55, 1.2],
  [-0.25, 1.2],
  [0.05, 1.2],
  [0.35, 1.2],
  [1.15, 1.2],
]

export function SecurityCheckpoint() {
  const { footprint, height: H, statusRef, offlineRef } = useContext(BuildingCtx)
  const k = Math.min(footprint.w, footprint.d) / 2.6
  const wall = useFacadeMaterial({ cols: 7, rows: 4, seed: 41, tint: PALETTE.cyan })
  const cabWall = useFacadeMaterial({ cols: 4, rows: 1, seed: 47, tint: PALETTE.cyan })

  const mats = useMemo(() => {
    const roof = flatMat(PALETTE.dusk)
    return {
      block: [wall, wall, roof, roof, wall, wall], // [+x, -x, +y, -y, +z, -z]
      cab: [cabWall, cabWall, STEEL, STEEL, cabWall, cabWall],
    }
  }, [wall, cabWall])

  // Per-building materials that animate (colors/opacity mutated in useFrame). Disposed on unmount.
  const fx = useMemo(
    () => ({
      arm: new THREE.MeshBasicMaterial({ map: hazardTexture(2.5, 0.5), color: PALETTE.yellow, toneMapped: false }),
      lamp: new THREE.MeshBasicMaterial({ color: PALETTE.yellow, toneMapped: false }),
      lens: new THREE.MeshBasicMaterial({ color: PALETTE.ink, toneMapped: false }),
      beam: new THREE.MeshBasicMaterial({
        color: PALETTE.ink,
        transparent: true,
        opacity: 0.15,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        fog: false,
      }),
      pool: new THREE.MeshBasicMaterial({
        color: PALETTE.ink,
        transparent: true,
        opacity: 0.24,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
      sign: new THREE.MeshBasicMaterial({ map: signTexture('SECURITY', PALETTE.yellow), toneMapped: false }),
    }),
    [],
  )
  useEffect(() => () => Object.values(fx).forEach((m) => m.dispose()), [fx])

  const blockH = H - BASE_H
  const blockY = (BASE_H + H) / 2
  const shaftTop = H + 0.8
  const capY = shaftTop + 0.47
  const pivY = capY + 0.17 // searchlight pivot (≈3.64 for height 2.2)

  // Searchlight aim at the gate (used while needs_approval).
  const aim = useMemo(() => {
    const dx = ARM_X - TW.x
    const dz = (LANE.z0 + HINGE_Z) / 2 - TW.z
    return { yaw: Math.atan2(dx, dz), pitch: Math.atan2(pivY - POOL_Y, Math.hypot(dx, dz)) }
  }, [pivY])

  const arm = useRef<THREE.Group>(null)
  const light = useRef<THREE.Group>(null)
  const beam = useRef<THREE.Mesh>(null)
  const pool = useRef<THREE.Mesh>(null)
  const dish = useRef<THREE.Group>(null)
  const tip = useRef<THREE.Mesh>(null)
  const teeth = useRef<THREE.InstancedMesh>(null)
  const anim = useRef({ prev: statusRef.current as BuildingStatus, raiseUntil: -1, yaw: SWEEP_MID, pitch: PITCH_IDLE })

  // Tank-trap teeth: matrices set once.
  useLayoutEffect(() => {
    const im = teeth.current
    if (!im) return
    const o = new THREE.Object3D()
    TEETH.forEach(([x, z], i) => {
      o.position.set(x, LANE_TOP, z)
      o.scale.set(0.18, 0.22, 0.18)
      o.updateMatrix()
      im.setMatrixAt(i, o.matrix)
    })
    im.instanceMatrix.needsUpdate = true
    im.computeBoundingSphere()
  }, [])

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const dt = Math.min(delta, 0.1)
    const st = statusRef.current
    const offline = offlineRef.current && st === 'idle'
    const a = anim.current
    if (a.prev === 'needs_approval' && st === 'idle') a.raiseUntil = t + 2.2 // approved → open the gate
    a.prev = st
    const raised = st !== 'error' && t < a.raiseUntil
    const blink = Math.floor(t / 0.4) % 2 === 0
    const flash = Math.floor(t / 0.25) % 2 === 0

    // barrier arm: eased swing up after an approval; stays down and flashes red on error
    const g = arm.current
    if (g) g.rotation.x += ((raised ? ARM_UP : 0) - g.rotation.x) * (1 - Math.exp(-dt * 6))
    if (st === 'error') fx.arm.color.copy(C_RED).multiplyScalar(flash ? 2.4 : 0.3)
    else fx.arm.color.copy(C_YELLOW)

    // warning lamps
    if (st === 'needs_approval') fx.lamp.color.copy(C_YELLOW).multiplyScalar(blink ? 3 : 0.12)
    else if (st === 'error') fx.lamp.color.copy(C_RED).multiplyScalar(flash ? 3 : 0.12)
    else if (raised) fx.lamp.color.copy(C_GREEN).multiplyScalar(2.4)
    else fx.lamp.color.copy(offline ? C_GREY : C_YELLOW).multiplyScalar(0.4)

    // searchlight: slow sweep; locks on the gate (yellow) when approval is needed; red + fast on error
    let yawT = SWEEP_MID + SWEEP_AMP * Math.sin(t * (st === 'error' ? 2 : 0.45))
    let pitchT = PITCH_IDLE
    let col = offline ? C_GREY : C_BEAM
    let op = offline ? 0.07 : 0.15
    if (st === 'needs_approval') {
      yawT = aim.yaw
      pitchT = aim.pitch
      col = C_YELLOW
      op = 0.26
    } else if (st === 'error') {
      col = C_RED
      op = 0.24
    }
    const e = 1 - Math.exp(-dt * 3.5)
    a.yaw += (yawT - a.yaw) * e
    a.pitch += (pitchT - a.pitch) * e
    fx.beam.color.lerp(col, e)
    fx.beam.opacity += (op - fx.beam.opacity) * e
    fx.pool.color.copy(fx.beam.color)
    fx.pool.opacity = fx.beam.opacity * 1.6
    fx.lens.color.copy(fx.beam.color).multiplyScalar(2.5)

    const drop = pivY - POOL_Y
    const sinP = Math.sin(a.pitch)
    const len = Math.max(0.1, drop / sinP - BEAM_OFS) // beam ends on the ground
    if (light.current) light.current.rotation.set(a.pitch, a.yaw, 0, 'YXZ')
    if (beam.current) beam.current.scale.setScalar(len)
    if (pool.current) {
      const reach = drop / Math.tan(a.pitch)
      const r = BEAM_SPREAD * len
      pool.current.position.set(TW.x + Math.sin(a.yaw) * reach, POOL_Y, TW.z + Math.cos(a.yaw) * reach)
      pool.current.rotation.y = a.yaw
      pool.current.scale.set(r, 1, r / sinP)
    }

    if (dish.current && !offline) dish.current.rotation.y += dt * 1.4
    if (tip.current) tip.current.material = Math.floor(t / 0.9) % 2 ? DARK : TIP_ON
  })

  return (
    <group scale={[k, 1, k]}>
      {/* ---- bastion: sloped armor glacis + slit-window block (roof at height) ---- */}
      <mesh geometry={FRUSTUM} material={STEEL} position={[0, 0, FR.z]} scale={[FR.w, BASE_H, FR.d]} castShadow receiveShadow />
      <mesh geometry={UNIT_BOX} material={mats.block} position={[UP.x, blockY, UP.z]} scale={[UP.w, blockH, UP.d]} castShadow receiveShadow />
      <mesh geometry={PLANE} material={fx.sign} position={[UP.x, H - 0.24, UP.z + UP.d / 2 + 0.012]} scale={[1.15, 0.26, 1]} />
      {/* hazard skirt at the glacis foot */}
      <mesh geometry={UNIT_BOX} material={hazardMat(11, 0.4)} position={[0, 0.09, FR.z + FR.d / 2 + 0.025]} scale={[FR.w, 0.1, 0.05]} />

      {/* neon trims: glacis top edges + block front corners */}
      <mesh geometry={UNIT_BOX} material={NEON_Y} position={[0, BASE_H, FR.z + (FR.d * FR.top) / 2]} scale={[FR.w * FR.top, 0.08, 0.08]} />
      <mesh geometry={UNIT_BOX} material={NEON_Y} position={[(FR.w * FR.top) / 2, BASE_H, FR.z]} scale={[0.08, 0.08, FR.d * FR.top]} />
      <mesh geometry={UNIT_BOX} material={NEON_Y} position={[UP.x + UP.w / 2, blockY, UP.z + UP.d / 2]} scale={[0.09, blockH, 0.09]} />
      <mesh geometry={UNIT_BOX} material={NEON_Y} position={[UP.x - UP.w / 2, blockY, UP.z + UP.d / 2]} scale={[0.09, blockH, 0.09]} />

      {/* roof: corner merlons, warning lamps on the front pair, AC unit, rotating radar dish */}
      {MERLONS.map(([mx, mz]) => {
        const x = UP.x + mx * (UP.w / 2 - 0.13)
        const z = UP.z + mz * (UP.d / 2 - 0.13)
        return (
          <group key={`${mx}${mz}`}>
            <mesh geometry={UNIT_BOX} material={STEEL} position={[x, H + 0.1, z]} scale={[0.26, 0.2, 0.26]} />
            {mz > 0 && <mesh geometry={UNIT_BOX} material={fx.lamp} position={[x, H + 0.27, z]} scale={[0.14, 0.14, 0.14]} />}
          </group>
        )
      })}
      <mesh geometry={UNIT_BOX} material={STEEL} position={[0.12, H + 0.11, -0.52]} scale={[0.34, 0.22, 0.28]} />
      <mesh geometry={UNIT_BOX} material={flatMat(PALETTE.void)} position={[0.12, H + 0.225, -0.52]} scale={[0.22, 0.02, 0.18]} />
      <mesh geometry={UNIT_BOX} material={STEEL} position={[-0.45, H + 0.12, -0.3]} scale={[0.08, 0.24, 0.08]} />
      <group ref={dish} position={[-0.45, H + 0.3, -0.3]}>
        <mesh geometry={UNIT_BOX} material={DISH} rotation={[-0.6, 0, 0]} scale={[0.34, 0.3, 0.06]} />
      </group>

      {/* ---- watchtower: shaft, hazard collar, red corner neon, lookout cab, cap, antenna ---- */}
      <mesh geometry={UNIT_BOX} material={flatMat(PALETTE.dusk)} position={[TW.x, shaftTop / 2, TW.z]} scale={[TW.s, shaftTop, TW.s]} castShadow />
      <mesh geometry={UNIT_BOX} material={hazardMat(2.4, 1)} position={[TW.x, BASE_H + 0.17, TW.z]} scale={[TW.s + 0.06, 0.24, TW.s + 0.06]} />
      <mesh
        geometry={UNIT_BOX}
        material={NEON_R}
        position={[TW.x + TW.s / 2, (BASE_H + 0.3 + shaftTop) / 2, TW.z + TW.s / 2]}
        scale={[0.08, shaftTop - BASE_H - 0.3, 0.08]}
      />
      <mesh geometry={UNIT_BOX} material={mats.cab} position={[TW.x, shaftTop + 0.21, TW.z]} scale={[TW.cab, 0.42, TW.cab]} castShadow />
      <mesh geometry={UNIT_BOX} material={STEEL} position={[TW.x, capY, TW.z]} scale={[TW.cab + 0.14, 0.1, TW.cab + 0.14]} receiveShadow />
      <mesh geometry={UNIT_BOX} material={STEEL} position={[TW.x + 0.3, capY + 0.35, TW.z - 0.3]} scale={[0.08, 0.6, 0.08]} />
      <mesh ref={tip} geometry={UNIT_BOX} material={TIP_ON} position={[TW.x + 0.3, capY + 0.7, TW.z - 0.3]} scale={[0.13, 0.13, 0.13]} />

      {/* searchlight: housing + lens + additive cone (pivot yaw/pitch in useFrame), light pool on the ground */}
      <group ref={light} position={[TW.x, pivY, TW.z]}>
        <mesh geometry={UNIT_BOX} material={STEEL} scale={[0.26, 0.2, 0.3]} />
        <mesh geometry={UNIT_BOX} material={fx.lens} position={[0, 0, 0.16]} scale={[0.2, 0.15, 0.04]} />
        <mesh ref={beam} geometry={BEAM_GEO} material={fx.beam} position={[0, 0, BEAM_OFS]} raycast={NO_RAYCAST} />
      </group>
      <mesh ref={pool} geometry={POOL_GEO} material={fx.pool} raycast={NO_RAYCAST} />

      {/* ---- gate lane: asphalt, hazard stop line, tank-trap teeth ---- */}
      <mesh
        geometry={UNIT_BOX}
        material={flatMat(PALETTE.asphalt)}
        position={[0, LANE_TOP / 2, (LANE.z0 + LANE.z1) / 2]}
        scale={[FR.w, LANE_TOP, LANE.z1 - LANE.z0]}
        receiveShadow
      />
      <mesh geometry={UNIT_BOX} material={hazardMat(0.6, 1.8)} position={[GX - 0.45, LANE_TOP + 0.01, 0.86]} scale={[0.14, 0.02, 0.44]} />
      <instancedMesh ref={teeth} args={[PYRAMID, STEEL, TEETH.length]} receiveShadow />

      {/* ---- gate: striped post + lamp, rest post, barrier arm on a hinge pivot ---- */}
      <mesh geometry={UNIT_BOX} material={hazardMat(0.8, 2.4)} position={[GX, 0.28, HINGE_Z]} scale={[0.2, 0.56, 0.2]} castShadow />
      <mesh geometry={UNIT_BOX} material={fx.lamp} position={[GX, 0.63, HINGE_Z]} scale={[0.14, 0.14, 0.14]} />
      <mesh geometry={UNIT_BOX} material={STEEL} position={[ARM_X, 0.18, LANE.z0 + 0.08]} scale={[0.12, 0.36, 0.12]} />
      <group ref={arm} position={[ARM_X, 0.42, HINGE_Z]}>
        <mesh geometry={UNIT_BOX} material={fx.arm} position={[0, 0, -ARM_LEN / 2]} scale={[0.12, 0.12, ARM_LEN]} />
        <mesh geometry={UNIT_BOX} material={DARK} position={[0, 0, 0.14]} scale={[0.16, 0.18, 0.12]} />
      </group>
    </group>
  )
}
