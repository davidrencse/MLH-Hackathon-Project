// Groq Speedway: the low-latency inference track (2×2 lot).
// A squat LPU hall wrapped by an elevated neon racing rail. Light pulses tear around the rail
// (one lap ≈ one inference), chevrons point into the intake tunnel on the +x face, and a stack
// of cooling fins glows on the terrace. Running sessions = traffic: more sessions → more pulses.
// Status drives pulse speed and every emissive color (idle violet, working green, error red stutter).
//
// Efficiency: static boxes are 2 InstancedMeshes (lit props with per-instance color + violet neon),
// pulses are 1 InstancedMesh whose matrices are rewritten only when the lap offset or count changes.
// Animation mutates refs and materials inside useFrame — no React state, no per-frame allocation.
import { useFrame } from '@react-three/fiber'
import { useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { BuildingCtx } from '../BuildingCtx'
import { flatMat, neonMat, PALETTE, signTexture, UNIT_BOX, useFacadeMaterial } from '../materials'

// ---- design space: a 1.6 × 1.6 footprint (2×2 lot); the model scales in x/z to the real footprint ----
const DESIGN = 1.6
const VIOLET = '#b36bff' // CATALOG.groq.accent

// hall bounds (the iso camera sees the +x and +z faces)
const HX0 = -0.6
const HX1 = 0.45
const HZ0 = -0.55
const HZ1 = 0.55
const HW = HX1 - HX0
const HD = HZ1 - HZ0
const HCX = (HX0 + HX1) / 2
const HCZ = (HZ0 + HZ1) / 2

// elevated racing rail: a rectangle the pulses run along
const RAIL_Y = 0.82
const RX = 0.72 // half extent along x
const RZ = 0.74 // half extent along z
const SEG_X = 2 * RX
const SEG_Z = 2 * RZ
const LAP = 2 * (SEG_X + SEG_Z)
const MAX_PULSES = 10
const PULSE_LEN = 0.2

// intake tunnel on the +x face: three chevrons that flash inward
const GATE_Z = 0.16
const GATE = [1.08, 0.86, 0.64] // x positions, outermost first

const FINS = 5 // cooling fins on the terrace

const PLANE = new THREE.PlaneGeometry(1, 1)
const PROP_MAT = flatMat('#ffffff') // tinted per instance
const NEON_MAT = neonMat(VIOLET, 2.2)
const POST_MAT = flatMat(PALETTE.steel)

const C_VIOLET = new THREE.Color(VIOLET)
const C_GREEN = new THREE.Color(PALETTE.green)
const C_RED = new THREE.Color(PALETTE.red)
const C_YELLOW = new THREE.Color(PALETTE.yellow)
const C_GREY = new THREE.Color(PALETTE.grey)

const tmp = new THREE.Object3D()
const tmpColor = new THREE.Color()
const noRaycast = () => {}

type Box = [x: number, y: number, z: number, sx: number, sy: number, sz: number]
type Prop = [x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string]

const C = PALETTE

// Rail corner posts (the four legs that carry the loop).
const POSTS: [number, number][] = [
  [RX, RZ],
  [RX, -RZ],
  [-RX, RZ],
  [-RX, -RZ],
]

// lit props (one InstancedMesh, per-instance color)
const PROPS: Prop[] = [
  [0, 0.035, 0, DESIGN, 0.07, DESIGN, C.concrete], // yard slab
  [HCX, 0.17, HCZ, HW + 0.14, 0.2, HD + 0.14, C.dusk], // plinth under the hall
  [HX1 + 0.01, 0.52, GATE_Z, 0.04, 0.52, 0.42, C.void], // intake tunnel mouth (+x)
  [-0.18, 0.44, HZ1 + 0.01, 0.26, 0.5, 0.04, C.void], // crew door (+z)
  [0.52, 0.1, 0.62, 0.3, 0.2, 0.22, C.haze], // pit crates in the front yard
  [0.52, 0.26, 0.62, 0.2, 0.12, 0.16, C.steel],
  [-0.66, 0.13, 0.5, 0.22, 0.26, 0.22, C.haze], // coolant drum
]

// violet neon trims (one InstancedMesh, one cached unlit material → bloom)
const NEON: Box[] = [
  [RX, RAIL_Y, 0, 0.07, 0.07, SEG_Z], // the rail loop itself
  [-RX, RAIL_Y, 0, 0.07, 0.07, SEG_Z],
  [0, RAIL_Y, RZ, SEG_X, 0.07, 0.07],
  [0, RAIL_Y, -RZ, SEG_X, 0.07, 0.07],
  [HX1 + 0.04, 0.8, GATE_Z, 0.05, 0.07, 0.5], // tunnel header
  [(HX1 + 1.2) / 2, 0.08, GATE_Z - 0.14, 1.2 - HX1, 0.04, 0.03], // pit-lane stripes on the ground
  [(HX1 + 1.2) / 2, 0.08, GATE_Z + 0.14, 1.2 - HX1, 0.04, 0.03],
]

function setBox(m: THREE.InstancedMesh, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0) {
  tmp.position.set(x, y, z)
  tmp.rotation.set(0, ry, 0)
  tmp.scale.set(sx, sy, sz)
  tmp.updateMatrix()
  m.setMatrixAt(i, tmp.matrix)
}

// Point on the rail loop at distance d along the lap, plus the heading to align a pulse with.
function railPoint(d: number): [x: number, z: number, ry: number] {
  const l = ((d % LAP) + LAP) % LAP
  if (l < SEG_X) return [-RX + l, -RZ, 0] // back edge, running +x
  if (l < SEG_X + SEG_Z) return [RX, -RZ + (l - SEG_X), Math.PI / 2] // +x edge, running +z
  if (l < 2 * SEG_X + SEG_Z) return [RX - (l - SEG_X - SEG_Z), RZ, 0] // front edge, running −x
  return [-RX, RZ - (l - 2 * SEG_X - SEG_Z), Math.PI / 2] // −x edge, running −z
}

export function GroqSpeedway() {
  const { building, footprint, height, statusRef, offlineRef } = useContext(BuildingCtx)
  const s = Math.min(footprint.w, footprint.d) / DESIGN

  // traffic = running sessions (read in useFrame through a ref, never per-frame state)
  let running = 0
  for (const job of building.sessions) if (job.status === 'running') running++
  const runningRef = useRef(running)
  useEffect(() => {
    runningRef.current = running
  }, [running])

  // massing derived from the roof height so the slab top lands exactly on `height`
  const hallH = Math.max(1.2, height - 0.95)
  const upperY = hallH + 0.12
  const upperH = Math.max(0.3, height - 0.12 - upperY)

  const facade = useFacadeMaterial({ cols: 5, rows: 6, seed: 11, tint: VIOLET })
  const hallMats = useMemo(() => {
    const roof = flatMat(PALETTE.dusk)
    return [facade, facade, roof, roof, facade, facade] // [+x, -x, +y, -y, +z, -z]
  }, [facade])

  // per-building materials (they animate with this building's status)
  const { pulseMat, finMat, gateMat, signMat } = useMemo(
    () => ({
      pulseMat: new THREE.MeshBasicMaterial({ color: C_VIOLET.clone().multiplyScalar(2.6), toneMapped: false }),
      finMat: new THREE.MeshBasicMaterial({ color: C_VIOLET.clone().multiplyScalar(1.6), toneMapped: false }),
      gateMat: new THREE.MeshBasicMaterial({ color: C_VIOLET.clone().multiplyScalar(2), toneMapped: false }),
      // signTexture is cached by materials.ts → dispose only the material
      signMat: new THREE.MeshBasicMaterial({ map: signTexture('GROQ', VIOLET), toneMapped: false }),
    }),
    [],
  )
  useEffect(
    () => () => {
      pulseMat.dispose()
      finMat.dispose()
      gateMat.dispose()
      signMat.dispose()
    },
    [pulseMat, finMat, gateMat, signMat],
  )

  const props = useRef<THREE.InstancedMesh>(null)
  const neon = useRef<THREE.InstancedMesh>(null)
  const fins = useRef<THREE.InstancedMesh>(null)
  const pulses = useRef<THREE.InstancedMesh>(null)
  const gate = useRef<THREE.Group>(null)
  const anim = useRef({ lap: 0, drawnLap: -1, drawnN: -1 })

  // static instances: written once
  useLayoutEffect(() => {
    const p = props.current
    if (p) {
      PROPS.forEach((b, i) => {
        setBox(p, i, b[0], b[1], b[2], b[3], b[4], b[5])
        p.setColorAt(i, tmpColor.set(b[6]))
      })
      p.instanceMatrix.needsUpdate = true
      if (p.instanceColor) p.instanceColor.needsUpdate = true
      p.computeBoundingSphere()
    }
    const n = neon.current
    if (n) {
      NEON.forEach((b, i) => setBox(n, i, b[0], b[1], b[2], b[3], b[4], b[5]))
      n.instanceMatrix.needsUpdate = true
      n.computeBoundingSphere()
    }
    const pm = pulses.current
    if (pm) pm.count = 0 // useFrame fills matrices
  }, [])

  // cooling fins on the terrace: thin glowing slabs standing along the +z edge
  useLayoutEffect(() => {
    const m = fins.current
    if (!m) return
    const span = HW * 0.74
    for (let i = 0; i < FINS; i++) {
      const x = HCX - span / 2 + (span / (FINS - 1)) * i
      setBox(m, i, x, upperY + 0.26, HZ1 - 0.16, 0.05, 0.5, 0.3)
    }
    m.instanceMatrix.needsUpdate = true
    m.computeBoundingSphere()
  }, [upperY])

  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime
    const dt = Math.min(delta, 0.1)
    const status = statusRef.current
    const offline = offlineRef.current && status === 'idle'
    const run = runningRef.current
    const a = anim.current

    // one emissive tone drives pulses, fins and the gate chevrons
    let tone = C_VIOLET
    let gain = 1
    if (offline) {
      tone = C_GREY
      gain = 0.45
    } else if (status === 'error') {
      tone = C_RED
      gain = Math.floor(t / 0.3) % 2 ? 1.3 : 0.25
    } else if (status === 'needs_approval') {
      tone = C_YELLOW
      gain = 0.7 + 0.5 * (Math.floor(t / 0.4) % 2)
    } else if (status === 'working') {
      tone = C_GREEN
      gain = 1.1 + 0.4 * (Math.floor(t * 8) % 2)
    }
    pulseMat.color.copy(tone).multiplyScalar(2.6 * gain)
    finMat.color.copy(tone).multiplyScalar(1.6 * gain)
    gateMat.color.copy(tone).multiplyScalar(2 * gain)

    // sign: dim when offline, stutters on error
    signMat.color.setScalar(offline ? 0.35 : status === 'error' && Math.floor(t / 0.15) % 4 === 0 ? 0.4 : 1.5)

    // gate chevrons flash inward, one every 0.15s — the intake "accepting requests" tell
    if (gate.current) {
      const step = Math.floor(t / 0.15) % GATE.length
      const lit = !offline && status !== 'error'
      gate.current.children.forEach((c, i) => {
        c.visible = lit && i === step
      })
    }

    // pulses: count follows running sessions, speed follows status (one lap ≈ one inference)
    const pm = pulses.current
    if (pm) {
      if (offline) {
        if (pm.count !== 0) {
          pm.count = 0
          a.drawnN = -1
        }
      } else {
        const speed = status === 'error' ? 0 : status === 'working' ? 3.4 : status === 'needs_approval' ? 0.3 : 0.9
        a.lap = (a.lap + speed * dt) % LAP
        const n = Math.min(MAX_PULSES, 3 + 2 * run)
        if (a.lap !== a.drawnLap || n !== a.drawnN) {
          a.drawnLap = a.lap
          a.drawnN = n
          pm.count = n
          const gap = LAP / n
          for (let i = 0; i < n; i++) {
            const [x, z, ry] = railPoint(a.lap + i * gap)
            setBox(pm, i, x, RAIL_Y, z, PULSE_LEN, 0.1, 0.1, ry)
          }
          pm.instanceMatrix.needsUpdate = true
        }
      }
    }
  })

  return (
    <group scale={[s, 1, s]}>
      {/* LPU hall: facade on the walls, flat roof on top */}
      <mesh
        geometry={UNIT_BOX}
        material={hallMats}
        position={[HCX, 0.27 + hallH / 2, HCZ]}
        scale={[HW, hallH, HD]}
        castShadow
        receiveShadow
      />
      {/* terrace ledge + setback module + roof slab (slab top = height) */}
      <mesh
        geometry={UNIT_BOX}
        material={flatMat(PALETTE.steel)}
        position={[HCX, hallH + 0.33, HCZ]}
        scale={[HW + 0.12, 0.12, HD + 0.12]}
        castShadow
      />
      <mesh
        geometry={UNIT_BOX}
        material={hallMats}
        position={[HCX - 0.1, upperY + upperH / 2, HCZ - 0.14]}
        scale={[HW * 0.62, upperH, HD * 0.6]}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={UNIT_BOX}
        material={flatMat(PALETTE.steel)}
        position={[HCX - 0.1, height - 0.06, HCZ - 0.14]}
        scale={[HW * 0.62 + 0.12, 0.12, HD * 0.6 + 0.12]}
        castShadow
      />
      {/* rail legs */}
      {POSTS.map(([px, pz]) => (
        <mesh key={`${px}:${pz}`} geometry={UNIT_BOX} material={POST_MAT} position={[px, RAIL_Y / 2, pz]} scale={[0.08, RAIL_Y, 0.08]} castShadow />
      ))}
      {/* static clutter + rail trims */}
      <instancedMesh ref={props} args={[UNIT_BOX, PROP_MAT, PROPS.length]} receiveShadow />
      <instancedMesh ref={neon} args={[UNIT_BOX, NEON_MAT, NEON.length]} />
      {/* glowing cooling fins on the terrace */}
      <instancedMesh ref={fins} args={[UNIT_BOX, finMat, FINS]} raycast={noRaycast} />
      {/* intake chevrons: only one is visible per 0.15s step */}
      <group ref={gate}>
        {GATE.map((gx) => (
          <mesh key={gx} geometry={UNIT_BOX} material={gateMat} position={[gx, 0.42, GATE_Z]} scale={[0.1, 0.26, 0.26]} raycast={noRaycast} />
        ))}
      </group>
      {/* sign on the +z hall wall */}
      <mesh geometry={PLANE} material={signMat} position={[HCX, 1.08, HZ1 + 0.015]} scale={[0.82, 0.22, 1]} />
      {/* racing pulses: matrices change every frame, so skip culling (tiny mesh) */}
      <instancedMesh ref={pulses} args={[UNIT_BOX, pulseMat, MAX_PULSES]} frustumCulled={false} raycast={noRaycast} />
    </group>
  )
}
