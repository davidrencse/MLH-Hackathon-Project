// Drones and data packets flying between buildings (3D).
// EFFICIENCY: the whole layer is 10 InstancedMeshes (one per part type → ~10 draw calls for every
// drone, packet and smoke puff), built once in useMemo. One useFrame reads the store with
// useGrid.getState() (no React re-render), composes instance matrices with module-level scratch
// objects (no per-frame allocations) and sets mesh.count. No React state anywhere.
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useGrid } from '../store/grid'
import type { Building } from '../types'
import { flatMat, neonMat, PALETTE, UNIT_BOX } from './materials'
import { dockPoint } from './world'

const FLIGHT_DRONES = 4 // pool: active 'drone' / 'drone-cargo' flights
const PACKETS = 4 // pool: active 'packet' flights
const PATROLS = [
  { r: 8.8, y: 7.6, speed: 0.22, phase: 0 }, // wide ring around the city, above the towers
  { r: 3.8, y: 4.4, speed: -0.45, phase: 2 }, // tight ring around the router, low
]
const MAX_DRONES = FLIGHT_DRONES + 1 + PATROLS.length // + parked drone
const GHOSTS = 3 // trailing ghost cubes per packet
const GHOST_LAG = 0.045 // progress lag between ghosts
const GHOST_SIZE = [0.13, 0.11, 0.09]
const GHOST_GLOW = [1.4, 0.8, 0.4] // additive → dimmer reads as lower opacity
const SMOKE = 8 // recycled smoke puffs
const SMOKE_LIFE = 0.9 // s
const SMOKE_EVERY = 0.08 // s between puffs
const SMOKE_RISE = 0.55 // units/s
const ARC_PEAK = 2.5 // arc peak above the higher dock point
const PARK_LIFT = 1.0 // parked drone hovers this far above the router dock (clear of the DOM label)
const ROTOR_SPEED = 40 // rad/s

// ---------- part transforms (drone local space: +x = nose, body centered at origin) ----------
const Y_AXIS = new THREE.Vector3(0, 1, 0)
const ID_Q = new THREE.Quaternion()
const ONE = new THREE.Vector3(1, 1, 1)
const local = (x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(Y_AXIS, ry),
    new THREE.Vector3(sx, sy, sz),
  )
const L_BODY = local(0, 0, 0, 0.35, 0.12, 0.35)
const L_ARM_A = local(0, 0.03, 0, 0.72, 0.08, 0.09, Math.PI / 4) // two crossed bars = 4 arms
const L_ARM_B = local(0, 0.03, 0, 0.72, 0.08, 0.09, -Math.PI / 4)
const L_LED = local(0.2, 0.05, 0, 0.1, 0.09, 0.1) // pink nose LED
const L_GLOW = local(0, -0.085, 0, 0.28, 0.05, 0.28) // cyan under-glow
const L_TETHER = local(0, -0.22, 0, 0.05, 0.3, 0.05)
const L_CARGO = local(0, -0.45, 0, 0.18, 0.18, 0.18)
const L_HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0)
const R = 0.255 // rotor hub offset (end of each arm)
const ROTOR_POS = [
  new THREE.Vector3(R, 0.09, R),
  new THREE.Vector3(R, 0.09, -R),
  new THREE.Vector3(-R, 0.09, -R),
  new THREE.Vector3(-R, 0.09, R),
]
const ROTOR_SCALE = new THREE.Vector3(0.26, 0.03, 0.08)

// ---------- per-frame scratch (never allocate inside useFrame) ----------
const _M = new THREE.Matrix4() // current drone root
const _L = new THREE.Matrix4()
const _O = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _A = new THREE.Vector3()
const _B = new THREE.Vector3()

type Vec3 = [number, number, number]
const dockCache = new WeakMap<Building, Vec3>()
function dock(b: Building): Vec3 {
  let d = dockCache.get(b)
  if (!d) {
    d = dockPoint(b)
    dockCache.set(b, d)
  }
  return d
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2) // easeInOutCubic
const easeSpeed = (p: number) => (p < 0.5 ? 4 * p * p : (2 - 2 * p) ** 2) // derivative / 3 → 0..1

// Parabolic arc from a to b; at e = 0.5 it is exactly ARC_PEAK above the higher end.
function arc(a: Vec3, b: Vec3, e: number, out: THREE.Vector3) {
  const h = Math.max(a[1], b[1]) + ARC_PEAK - (a[1] + b[1]) / 2
  return out.set(a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e + 4 * h * e * (1 - e), a[2] + (b[2] - a[2]) * e)
}

interface Rig {
  body: THREE.InstancedMesh
  arms: THREE.InstancedMesh
  rotors: THREE.InstancedMesh
  led: THREE.InstancedMesh
  glow: THREE.InstancedMesh
  tether: THREE.InstancedMesh
  cargo: THREE.InstancedMesh
  packet: THREE.InstancedMesh
  ghost: THREE.InstancedMesh
  smoke: THREE.InstancedMesh
  all: THREE.InstancedMesh[]
  ghostMat: THREE.MeshBasicMaterial
  puffs: { x: Float32Array; y: Float32Array; z: Float32Array; age: Float32Array; next: number; timer: number }
  emit: THREE.Vector3
  warm: number // first frames: draw everything once so all shaders compile up front (no hitch mid-demo)
  reduced: boolean
}

function inst(mat: THREE.Material, max: number) {
  const m = new THREE.InstancedMesh(UNIT_BOX, mat, max)
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  m.frustumCulled = false // instances move every frame; the cached bounding sphere would be wrong
  m.count = 0
  return m
}

function createRig(): Rig {
  const ghostMat = new THREE.MeshBasicMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  })
  const r = {
    body: inst(flatMat(PALETTE.steel), MAX_DRONES),
    arms: inst(flatMat(PALETTE.haze), MAX_DRONES * 2),
    rotors: inst(flatMat('#8f8ab8'), MAX_DRONES * 4),
    led: inst(neonMat(PALETTE.pink, 3), MAX_DRONES),
    glow: inst(neonMat(PALETTE.cyan, 2.5), MAX_DRONES),
    tether: inst(neonMat(PALETTE.green, 1.5), FLIGHT_DRONES),
    cargo: inst(neonMat(PALETTE.green, 3), FLIGHT_DRONES),
    packet: inst(neonMat(PALETTE.yellow, 3), PACKETS),
    ghost: inst(ghostMat, PACKETS * GHOSTS),
    smoke: inst(flatMat(PALETTE.grey), SMOKE),
    ghostMat,
    puffs: {
      x: new Float32Array(SMOKE),
      y: new Float32Array(SMOKE),
      z: new Float32Array(SMOKE),
      age: new Float32Array(SMOKE).fill(SMOKE_LIFE),
      next: 0,
      timer: 0,
    },
    emit: new THREE.Vector3(),
    warm: 2,
    reduced: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  }
  const c = new THREE.Color()
  for (let i = 0; i < PACKETS * GHOSTS; i++) r.ghost.setColorAt(i, c.set(PALETTE.yellow).multiplyScalar(GHOST_GLOW[i % GHOSTS]))
  return {
    ...r,
    all: [r.body, r.arms, r.rotors, r.led, r.glow, r.tether, r.cargo, r.packet, r.ghost, r.smoke],
  }
}

function writeDrone(r: Rig, i: number, x: number, y: number, z: number, yaw: number, pitch: number, spin: number, ledOn: boolean) {
  _q.setFromEuler(_e.set(0, yaw, pitch, 'YZX')) // yaw, then nose-down pitch about local z
  _M.compose(_p.set(x, y, z), _q, ONE)
  r.body.setMatrixAt(i, _O.multiplyMatrices(_M, L_BODY))
  r.glow.setMatrixAt(i, _O.multiplyMatrices(_M, L_GLOW))
  r.led.setMatrixAt(i, _O.multiplyMatrices(_M, ledOn ? L_LED : L_HIDDEN))
  r.arms.setMatrixAt(i * 2, _O.multiplyMatrices(_M, L_ARM_A))
  r.arms.setMatrixAt(i * 2 + 1, _O.multiplyMatrices(_M, L_ARM_B))
  for (let k = 0; k < 4; k++) {
    _q.setFromAxisAngle(Y_AXIS, k % 2 ? spin : -spin) // neighbours counter-rotate
    _L.compose(ROTOR_POS[k], _q, ROTOR_SCALE)
    r.rotors.setMatrixAt(i * 4 + k, _O.multiplyMatrices(_M, _L))
  }
}

// Data cube on a tether under the drone written last by writeDrone (swings back with its pitch).
function writeCargo(r: Rig, j: number) {
  r.cargo.setMatrixAt(j, _O.multiplyMatrices(_M, L_CARGO))
  r.tether.setMatrixAt(j, _O.multiplyMatrices(_M, L_TETHER))
}

function writeBox(m: THREE.InstancedMesh, i: number, x: number, y: number, z: number, size: number) {
  m.setMatrixAt(i, _O.compose(_p.set(x, y, z), ID_Q, _s.setScalar(size)))
}

function commit(m: THREE.InstancedMesh, n: number, warm: boolean) {
  m.count = n
  m.visible = n > 0 || warm
  if (n > 0) m.instanceMatrix.needsUpdate = true
}

function update(r: Rig, t: number, dt: number) {
  const s = useGrid.getState()
  const now = Date.now()
  const tm = r.reduced ? 0 : t // ambient loops freeze with prefers-reduced-motion; flights still move
  const rejected = s.task?.phase === 'rejected'
  let nd = 0 // drones written
  let nc = 0 // cargo written
  let np = 0 // packets written
  let flying = false
  let smokeOn = false

  for (const f of s.flights) {
    const from = s.buildings[f.from]
    const to = s.buildings[f.to]
    if (!from || !to) continue
    const a = dock(from)
    const b = dock(to)
    const p = clamp01((now - f.startedAt) / f.durationMs)
    if (f.kind === 'packet') {
      if (np >= PACKETS) continue
      arc(a, b, ease(p), _A)
      writeBox(r.packet, np, _A.x, _A.y, _A.z, 0.15)
      for (let g = 0; g < GHOSTS; g++) {
        arc(a, b, ease(clamp01(p - GHOST_LAG * (g + 1))), _B)
        writeBox(r.ghost, np * GHOSTS + g, _B.x, _B.y, _B.z, GHOST_SIZE[g])
      }
      np++
      continue
    }
    if (nd >= FLIGHT_DRONES) continue
    flying = true
    arc(a, b, ease(p), _A)
    const dx = b[0] - a[0]
    const dz = b[2] - a[2]
    const yaw = dx || dz ? Math.atan2(-dz, dx) : 0 // local +x (nose) → travel direction
    writeDrone(r, nd, _A.x, _A.y, _A.z, yaw, -0.3 * easeSpeed(p), tm * ROTOR_SPEED + nd * 1.3, true)
    if (f.kind === 'drone-cargo') writeCargo(r, nc++)
    if (f.kind === 'drone' && rejected && p < 1) {
      smokeOn = true
      r.emit.set(_A.x - Math.cos(yaw) * 0.3, _A.y, _A.z + Math.sin(yaw) * 0.3) // just behind the tail
    }
    nd++
  }

  // Parked drone: hovers over the router while no delivery drone is out.
  const router = s.buildings.router
  if (!flying && router) {
    const d = dock(router)
    writeDrone(r, nd++, d[0], d[1] + PARK_LIFT + Math.sin(tm * 2) * 0.08, d[2], tm * 0.4, 0, tm * ROTOR_SPEED, true)
  }

  // Ambient patrols: cheap circles, blinking LED.
  for (let k = 0; k < PATROLS.length; k++) {
    const pt = PATROLS[k]
    const ang = pt.phase + tm * pt.speed
    const sg = Math.sign(pt.speed)
    const yaw = Math.atan2(-Math.cos(ang) * sg, -Math.sin(ang) * sg) // tangent of the circle
    const y = pt.y + Math.sin(tm * 1.5 + k) * 0.1
    writeDrone(r, nd++, Math.cos(ang) * pt.r, y, Math.sin(ang) * pt.r, yaw, -0.12, tm * ROTOR_SPEED + k, Math.floor(tm * 2 + k) % 2 === 0)
  }

  // Smoke puffs (ring buffer of 8): emitted behind a rejected drone, rise, swell, then shrink away.
  const pf = r.puffs
  if (smokeOn) {
    pf.timer -= dt
    while (pf.timer <= 0) {
      pf.timer += SMOKE_EVERY
      const i = pf.next
      pf.next = (i + 1) % SMOKE
      pf.x[i] = r.emit.x + (Math.random() - 0.5) * 0.15
      pf.y[i] = r.emit.y + (Math.random() - 0.5) * 0.1
      pf.z[i] = r.emit.z + (Math.random() - 0.5) * 0.15
      pf.age[i] = 0
    }
  } else pf.timer = 0
  let ns = 0
  for (let i = 0; i < SMOKE; i++) {
    if (pf.age[i] >= SMOKE_LIFE) continue
    pf.age[i] += dt
    const u = pf.age[i] / SMOKE_LIFE
    if (u >= 1) continue
    pf.y[i] += SMOKE_RISE * dt
    const size = (0.12 + 0.22 * u) * (u > 0.7 ? (1 - u) / 0.3 : 1)
    writeBox(r.smoke, ns++, pf.x[i], pf.y[i], pf.z[i], size)
  }

  const warm = r.warm > 0
  if (warm) r.warm--
  commit(r.body, nd, warm)
  commit(r.glow, nd, warm)
  commit(r.led, nd, warm)
  commit(r.arms, nd * 2, warm)
  commit(r.rotors, nd * 4, warm)
  commit(r.cargo, nc, warm)
  commit(r.tether, nc, warm)
  commit(r.packet, np, warm)
  commit(r.ghost, np * GHOSTS, warm)
  commit(r.smoke, ns, warm)
}

export function Drones() {
  const rig = useMemo(createRig, [])
  useEffect(
    () => () => {
      for (const m of rig.all) m.dispose() // frees instance buffers; UNIT_BOX + cached materials stay shared
      rig.ghostMat.dispose()
    },
    [rig],
  )
  useFrame((state, delta) => update(rig, state.clock.elapsedTime, Math.min(delta, 0.1)))
  return (
    <group>
      {rig.all.map((m) => (
        <primitive key={m.uuid} object={m} />
      ))}
    </group>
  )
}
