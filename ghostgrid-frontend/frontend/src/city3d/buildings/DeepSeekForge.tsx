// DeepSeek Forge: the cheap batch-job factory.
// A wide hall with a sawtooth roof (glowing glazing), two smokestacks with blinking red aviation
// lights and pixel smoke, and a conveyor belt that carries job crates out of the hall into a bin.
// Running sessions = batch jobs: more running sessions → more crates on the belt, brighter crates.
//
// Efficiency: all static clutter is 2 InstancedMeshes (lit props with per-instance color + blue neon),
// the 3 roof teeth are 1 InstancedMesh, crates and smoke are 1 InstancedMesh each. Static matrices are
// written once; animation only mutates refs/materials inside useFrame (no React state, no allocation).
import { useFrame } from '@react-three/fiber'
import { useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { BuildingCtx } from '../BuildingCtx'
import { facadeCols, facadeRows, flatMat, neonMat, PALETTE, signTexture, UNIT_BOX, useFacadeMaterial } from '../materials'

// ---- design space: a 2.6 × 2.6 footprint, roof at 3.5; the model scales in x/z to the real
// footprint and in y by BuildingCtx.height / BASE_H, so the hall, the stacks and the sawtooth
// all grow together. Ground-level clutter (belt, crates, doors, yard) keeps its authored size —
// stretching a conveyor with the roof would look wrong. ----
const DESIGN = 2.6
const BASE_H = 3.5 // roof height this model was authored for
const WALL_H = 2.56 // hall walls (design); the roof slab sits on top
const SLAB_TOP = 2.68 // design roof slab top; the sawtooth teeth rise from here to the roof height

// hall bounds (the camera sees the +x and +z faces)
const HX0 = -1.25
const HX1 = 0.45
const HZ0 = -1.25
const HZ1 = 0.75
const HW = HX1 - HX0
const HD = HZ1 - HZ0
const HCX = (HX0 + HX1) / 2
const HCZ = (HZ0 + HZ1) / 2

const TEETH = 3
const TOOTH_D = 0.55 // teeth cover z ∈ [HZ0, 0.4]; the flat strip in front carries the roof clutter

interface Stack {
  x: number
  z: number
  top: number
}
const STACK_TOPS = [4.6, 4.1] // design heights; scaled by the vertical factor
const STACK_XZ: [number, number][] = [
  [0.88, -0.95],
  [0.88, -0.42],
]
// Stacks thicken with sqrt(v): a chimney scaled only in y turns into a wire.
const stackWidth = (v: number) => 0.28 * Math.sqrt(v)
const stacksFor = (v: number): Stack[] => STACK_XZ.map(([x, z], i) => ({ x, z, top: STACK_TOPS[i] * v }))

// conveyor path: out of the hall door along +x, then a 90° turn toward +z into the output bin
const BELT_X0 = 0.15 // starts inside the hall (hidden by the wall)
const BELT_Z = 0.3
const TURN_X = 1.0
const END_Z = 1.12 // ends inside the bin (hidden), then the crate wraps to the start
const SEG1 = TURN_X - BELT_X0
const PATH_LEN = SEG1 + (END_Z - BELT_Z)
const CRATE = 0.22
const CRATE_Y = 0.32 + CRATE / 2
const MAX_CRATES = 6

const PUFFS = 4 // smoke puffs per stack
const SMOKE_N = PUFFS * STACK_TOPS.length

// ---- shared (module-level) geometry + materials: created once for every Forge ----
// Unit right-triangle prism: x ∈ [-0.5, 0.5], z ∈ [-0.5, 0.5], y ∈ [0, 1]. The slope rises toward +z.
// The vertical face at z = +0.5 is the glazing (material index 1); the rest is roof (index 0).
function makeToothGeometry() {
  const A0 = [-0.5, 0, -0.5]
  const B0 = [-0.5, 0, 0.5]
  const C0 = [-0.5, 1, 0.5]
  const A1 = [0.5, 0, -0.5]
  const B1 = [0.5, 0, 0.5]
  const C1 = [0.5, 1, 0.5]
  // caps, bottom, slope (18 verts) then glazing (6 verts); CCW seen from outside
  const tris = [A0, B0, C0, A1, C1, B1, A0, A1, B1, A0, B1, B0, A0, C0, C1, A0, C1, A1, B0, B1, C1, B0, C1, C0]
  const pos = new Float32Array(tris.length * 3)
  tris.forEach((v, i) => pos.set(v, i * 3))
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.computeVertexNormals() // non-indexed → flat normals
  g.addGroup(0, 18, 0)
  g.addGroup(18, 6, 1)
  return g
}
const TOOTH_GEO = makeToothGeometry()
const PLANE = new THREE.PlaneGeometry(1, 1)

const PROP_MAT = flatMat('#ffffff') // tinted per instance
const NEON_MAT = neonMat(PALETTE.blue, 2.2)
const STACK_MAT = flatMat(PALETTE.steel)
const AVIATION_MAT = neonMat(PALETTE.red, 3)
const SMOKE_MAT = new THREE.MeshBasicMaterial({ color: '#ffffff' }) // tinted per instance

const C_BLUE = new THREE.Color(PALETTE.blue)
const C_GREEN = new THREE.Color(PALETTE.green)
const C_RED = new THREE.Color(PALETTE.red)
const C_YELLOW = new THREE.Color(PALETTE.yellow)
const C_GREY = new THREE.Color(PALETTE.grey)
const C_NIGHT = new THREE.Color(PALETTE.night)
const C_SMOKE_HOT = new THREE.Color(PALETTE.grey).lerp(new THREE.Color(PALETTE.ink), 0.35)
const C_SMOKE_ERR = new THREE.Color(PALETTE.grey).lerp(C_RED, 0.45)

const tmp = new THREE.Object3D()
const tmpColor = new THREE.Color()
const noRaycast = () => {}

type Box = [x: number, y: number, z: number, sx: number, sy: number, sz: number]
type Prop = [x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string, rotX?: number]

const C = PALETTE
// lit props (one InstancedMesh, per-instance color). `v` = vertical factor; `rf` lifts a roof
// prop from the design slab top to the real one so the clutter always sits on the roof.
function propsFor(v: number, stacks: Stack[]): Prop[] {
  const slabTop = SLAB_TOP * v
  const rf = (y: number) => y - SLAB_TOP + slabTop
  const antH = 1.9 * v
  const sw = Math.sqrt(v) // cross-section factor for the thin vertical props
  return [
  [0, 0.03, 0, 2.6, 0.06, 2.6, C.concrete], // yard slab
  [HCX, 1.0 * v, HCZ, HW + 0.16, 0.12, HD + 0.16, C.dusk], // ledge band (overhang)
  [HCX, slabTop - 0.06, HCZ, HW + 0.12, 0.12, HD + 0.12, C.steel], // roof slab (overhang)
  [HX1 + 0.01, 0.34, BELT_Z, 0.04, 0.6, 0.5, C.void], // loading door (+x), the belt runs through it
  [-1.0, 0.3, HZ1 + 0.01, 0.3, 0.56, 0.04, C.void], // side door (+z)
  [0, rf(3.25) + 0.35 * (v - 1), 0, 0.1, 0.7 * v, 0.1, C.steel], // mast under the shell's roof beacon
  [-0.1, rf(2.81), 0.58, 0.3, 0.26, 0.24, C.grey], // AC units
  [0.22, rf(2.78), 0.6, 0.2, 0.2, 0.2, C.grey],
  [-1.0, rf(2.8), 0.55, 0.3, 0.24, 0.26, C.dusk], // water tank stand, tank, cap
  [-1.0, rf(3.1), 0.55, 0.32, 0.36, 0.3, C.haze],
  [-1.0, rf(3.31), 0.55, 0.2, 0.06, 0.18, C.steel],
  [-0.6, rf(2.78), 0.6, 0.1, 0.2, 0.1, C.steel], // dish post + dish (tilted toward the street)
  [-0.6, rf(2.92), 0.62, 0.32, 0.06, 0.32, C.grey, 0.6],
  [-1.12, slabTop + antH / 2 - 0.03, -1.1, 0.08 * sw, antH, 0.08 * sw, C.steel], // antenna
  [stacks[0].x, 0.22 * sw, stacks[0].z, 0.44 * sw, 0.44 * sw, 0.44 * sw, C.dusk], // stack bases + rims
  [stacks[1].x, 0.22 * sw, stacks[1].z, 0.44 * sw, 0.44 * sw, 0.44 * sw, C.dusk],
  [stacks[0].x, stacks[0].top - 0.05 * sw, stacks[0].z, 0.36 * sw, 0.1 * sw, 0.36 * sw, C.dusk],
  [stacks[1].x, stacks[1].top - 0.05 * sw, stacks[1].z, 0.36 * sw, 0.1 * sw, 0.36 * sw, C.dusk],
  [(BELT_X0 + TURN_X + 0.16) / 2, 0.27, BELT_Z, TURN_X + 0.16 - BELT_X0, 0.1, 0.32, C.night], // belt along +x
  [TURN_X, 0.27, (BELT_Z - 0.16 + END_Z) / 2, 0.32, 0.1, END_Z - BELT_Z + 0.16, C.night], // belt along +z
  [0.7, 0.12, BELT_Z, 0.08, 0.22, 0.26, C.dusk], // belt legs
  [TURN_X, 0.12, 0.7, 0.26, 0.22, 0.08, C.dusk],
  [TURN_X, 0.34, 1.12, 0.42, 0.68, 0.34, C.dusk], // output bin (crates vanish into it)
  [-0.55, 0.16, 1.05, 0.32, 0.3, 0.3, C.haze], // finished crates in the front yard
  [-0.55, 0.41, 1.05, 0.22, 0.2, 0.22, C.haze],
  [-0.2, 0.13, 1.08, 0.24, 0.24, 0.24, C.steel],
  ]
}

// blue neon trims (one InstancedMesh, one cached unlit material → bloom)
function neonFor(v: number, stacks: Stack[]): Box[] {
  const wallH = WALL_H * v
  const slabTop = SLAB_TOP * v
  const antTip = slabTop + 1.9 * v
  const sw = Math.sqrt(v)
  return [
  [HX1, wallH / 2, HZ1, 0.1, wallH, 0.1], // vertical corner strips (the 3 corners the camera sees)
  [HX1, wallH / 2, HZ0, 0.1, wallH, 0.1],
  [HX0, wallH / 2, HZ1, 0.1, wallH, 0.1],
  [HCX, slabTop - 0.06, HZ1 + 0.07, HW + 0.14, 0.1, 0.02], // roof slab edge
  [HX1 + 0.07, slabTop - 0.06, HCZ, 0.02, 0.1, HD + 0.14],
  [HCX, 1.0 * v, HZ1 + 0.09, HW + 0.18, 0.1, 0.02], // ledge edge
  [HX1 + 0.09, 1.0 * v, HCZ, 0.02, 0.1, HD + 0.18],
  [HX1 + 0.03, 0.68, BELT_Z, 0.04, 0.08, 0.6], // loading door header
  [stacks[0].x, stacks[0].top * 0.87, stacks[0].z, 0.34 * sw, 0.1, 0.34 * sw], // stack bands
  [stacks[0].x, stacks[0].top * 0.65, stacks[0].z, 0.34 * sw, 0.1, 0.34 * sw],
  [stacks[1].x, stacks[1].top * 0.85, stacks[1].z, 0.34 * sw, 0.1, 0.34 * sw],
  [(HX1 + TURN_X - 0.16) / 2, 0.27, BELT_Z + 0.17, TURN_X - 0.16 - HX1, 0.1, 0.02], // belt side strips
  [TURN_X + 0.17, 0.27, (BELT_Z - 0.16 + 0.95) / 2, 0.02, 0.1, 0.95 - BELT_Z + 0.16],
  [-1.12, antTip, -1.1, 0.14 * sw, 0.14 * sw, 0.14 * sw], // antenna tip
  [HCX, 1.95, HZ1 + 0.02, 1.52, 0.08, 0.03], // sign frame
  [HCX, 1.53, HZ1 + 0.02, 1.52, 0.08, 0.03],
  [TURN_X, 0.66, 1.3, 0.42, 0.08, 0.02], // bin rim
  ]
}

function setBox(m: THREE.InstancedMesh, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0) {
  tmp.position.set(x, y, z)
  tmp.rotation.set(rx, 0, 0)
  tmp.scale.set(sx, sy, sz)
  tmp.updateMatrix()
  m.setMatrixAt(i, tmp.matrix)
}

export function DeepSeekForge() {
  const { building, footprint, height, statusRef, offlineRef } = useContext(BuildingCtx)
  const s = Math.min(footprint.w, footprint.d) / DESIGN
  // vertical factor: hall, stacks and sawtooth all grow with the roof height
  const v = height / BASE_H
  const wallH = WALL_H * v
  const slabTop = SLAB_TOP * v
  const stacks = useMemo(() => stacksFor(v), [v])
  const stackW = stackWidth(v)
  const propBoxes = useMemo(() => propsFor(v, stacks), [v, stacks])
  const neonBoxes = useMemo(() => neonFor(v, stacks), [v, stacks])

  // batch jobs = running sessions (read in useFrame through a ref, never per-frame state)
  let running = 0
  for (const job of building.sessions) if (job.status === 'running') running++
  const runningRef = useRef(running)
  useEffect(() => {
    runningRef.current = running
  }, [running])

  const facade = useFacadeMaterial({ cols: facadeCols(HW * s), rows: facadeRows(wallH), seed: 4, tint: PALETTE.blue })
  const hallMats = useMemo(() => {
    const roof = flatMat(PALETTE.dusk)
    return [facade, facade, roof, roof, facade, facade] // [+x, -x, +y, -y, +z, -z]
  }, [facade])

  // per-building materials (they animate with this building's status)
  const { glazing, crateMat, signMat } = useMemo(
    () => ({
      glazing: new THREE.MeshBasicMaterial({ color: C_BLUE.clone().multiplyScalar(1.8), toneMapped: false }),
      crateMat: new THREE.MeshLambertMaterial({ color: PALETTE.grey, emissive: PALETTE.blue, emissiveIntensity: 0.35 }),
      // signTexture is cached by materials.ts → dispose only the material
      signMat: new THREE.MeshBasicMaterial({ map: signTexture('DEEPSEEK', PALETTE.blue), toneMapped: false }),
    }),
    [],
  )
  useEffect(
    () => () => {
      glazing.dispose()
      crateMat.dispose()
      signMat.dispose()
    },
    [glazing, crateMat, signMat],
  )
  const teethMats = useMemo(() => [flatMat(PALETTE.haze), glazing], [glazing])

  const props = useRef<THREE.InstancedMesh>(null)
  const neon = useRef<THREE.InstancedMesh>(null)
  const teeth = useRef<THREE.InstancedMesh>(null)
  const crates = useRef<THREE.InstancedMesh>(null)
  const smoke = useRef<THREE.InstancedMesh>(null)
  const lights = useRef<THREE.Group>(null)
  const anim = useRef({ belt: 0, drawnBelt: -1, drawnN: -1, smoke: 0 })

  // static instances: written once
  useLayoutEffect(() => {
    const p = props.current
    if (p) {
      propBoxes.forEach((b, i) => {
        setBox(p, i, b[0], b[1], b[2], b[3], b[4], b[5], b[7])
        p.setColorAt(i, tmpColor.set(b[6]))
      })
      p.instanceMatrix.needsUpdate = true
      if (p.instanceColor) p.instanceColor.needsUpdate = true
      p.computeBoundingSphere()
    }
    const n = neon.current
    if (n) {
      neonBoxes.forEach((b, i) => setBox(n, i, b[0], b[1], b[2], b[3], b[4], b[5]))
      n.instanceMatrix.needsUpdate = true
      n.computeBoundingSphere()
    }
    const sm = smoke.current
    if (sm) {
      // create the color attribute up front so the shader compiles once
      for (let i = 0; i < SMOKE_N; i++) sm.setColorAt(i, C_GREY)
      sm.count = 0 // useFrame fills matrices
    }
    const cm = crates.current
    if (cm) cm.count = 0
  }, [propBoxes, neonBoxes])

  // sawtooth teeth: peaks land exactly on the roof height so drones and the beacon line up
  useLayoutEffect(() => {
    const m = teeth.current
    if (!m) return
    const rise = Math.max(0.2, height - slabTop)
    for (let i = 0; i < TEETH; i++) setBox(m, i, HCX, slabTop, HZ0 + TOOTH_D * (i + 0.5), HW, rise, TOOTH_D)
    m.instanceMatrix.needsUpdate = true
    m.computeBoundingSphere()
  }, [height, slabTop])

  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime
    const dt = Math.min(delta, 0.1)
    const status = statusRef.current
    const offline = offlineRef.current && status === 'idle'
    const run = runningRef.current
    const a = anim.current

    // roof glazing (the stacked glowing strips of the sawtooth roof)
    if (offline) glazing.color.copy(C_GREY).multiplyScalar(0.5)
    else if (status === 'error') glazing.color.copy(C_RED).multiplyScalar(Math.floor(t / 0.3) % 2 ? 2.2 : 0.4)
    else if (status === 'needs_approval') glazing.color.copy(C_YELLOW).multiplyScalar(1.1 + 0.8 * (Math.floor(t / 0.4) % 2))
    else if (status === 'working') glazing.color.copy(C_GREEN).multiplyScalar(1.4 + 0.8 * (Math.floor(t * 6) % 2))
    else glazing.color.copy(C_BLUE).multiplyScalar(1.8)

    // sign: dim when offline, stutters on error
    signMat.color.setScalar(offline ? 0.35 : status === 'error' && Math.floor(t / 0.15) % 4 === 0 ? 0.4 : 1.5)

    // red aviation lights on the stacks (fast blink on error, off when offline)
    if (lights.current) lights.current.visible = !offline && t % (status === 'error' ? 0.6 : 1.4) < 0.35

    // crates: count + brightness follow running sessions; speed follows status
    crateMat.emissive.copy(status === 'error' ? C_RED : C_BLUE)
    crateMat.emissiveIntensity = offline ? 0.05 : 0.35 + 0.4 * Math.min(run, 3)
    const cm = crates.current
    if (cm) {
      const speed = offline || status === 'error' ? 0 : status === 'working' ? 0.5 : status === 'needs_approval' ? 0.1 : 0.25
      a.belt = (a.belt + speed * dt) % PATH_LEN
      const n = Math.min(MAX_CRATES, 2 + 2 * run)
      if (a.belt !== a.drawnBelt || n !== a.drawnN) {
        // only rewrite matrices when the belt actually moved or the count changed
        a.drawnBelt = a.belt
        a.drawnN = n
        cm.count = n
        const gap = PATH_LEN / n
        for (let i = 0; i < n; i++) {
          const d = (a.belt + i * gap) % PATH_LEN
          const onFirst = d < SEG1
          setBox(cm, i, onFirst ? BELT_X0 + d : TURN_X, CRATE_Y, onFirst ? BELT_Z : BELT_Z + d - SEG1, CRATE, CRATE, CRATE)
        }
        cm.instanceMatrix.needsUpdate = true
      }
    }

    // smoke: a few grey boxes rise in pixel steps, drift back, fade into the night, then recycle
    const sm = smoke.current
    if (sm) {
      if (offline) {
        sm.count = 0
      } else {
        sm.count = SMOKE_N
        a.smoke = (a.smoke + (status === 'working' ? 0.45 : 0.2) * dt) % 1
        const tint = status === 'error' ? C_SMOKE_ERR : status === 'working' ? C_SMOKE_HOT : C_GREY
        for (let i = 0; i < SMOKE_N; i++) {
          const si = i % stacks.length
          const st = stacks[si]
          const life = (a.smoke + (Math.floor(i / stacks.length) + si * 0.5) / PUFFS) % 1
          const size = (0.16 + 0.24 * life) * (life > 0.8 ? (1 - life) / 0.2 : 1) * Math.sqrt(v)
          setBox(sm, i, st.x - life * 0.35, st.top + 0.12 + Math.floor(life * 14) * 0.12, st.z - life * 0.2, size, size, size)
          sm.setColorAt(i, tmpColor.copy(tint).lerp(C_NIGHT, life))
        }
        sm.instanceMatrix.needsUpdate = true
        if (sm.instanceColor) sm.instanceColor.needsUpdate = true
      }
    }
  })

  return (
    <group scale={[s, 1, s]}>
      {/* factory hall: facade on the walls, flat roof on top */}
      <mesh geometry={UNIT_BOX} material={hallMats} position={[HCX, wallH / 2, HCZ]} scale={[HW, wallH, HD]} castShadow receiveShadow />
      {/* sawtooth roof: 3 prisms, one draw call per material */}
      <instancedMesh ref={teeth} args={[TOOTH_GEO, teethMats, TEETH]} castShadow receiveShadow />
      {/* smokestacks */}
      {stacks.map((st) => (
        <mesh key={st.z} geometry={UNIT_BOX} material={STACK_MAT} position={[st.x, st.top / 2, st.z]} scale={[stackW, st.top, stackW]} castShadow />
      ))}
      {/* static clutter + trims */}
      <instancedMesh ref={props} args={[UNIT_BOX, PROP_MAT, propBoxes.length]} receiveShadow />
      <instancedMesh ref={neon} args={[UNIT_BOX, NEON_MAT, neonBoxes.length]} />
      {/* sign on the +z wall */}
      <mesh geometry={PLANE} material={signMat} position={[HCX, 1.74, HZ1 + 0.015]} scale={[1.44, 0.32, 1]} />
      {/* aviation lights */}
      <group ref={lights}>
        {stacks.map((st) => (
          <mesh key={st.z} geometry={UNIT_BOX} material={AVIATION_MAT} position={[st.x, st.top + 0.08, st.z]} scale={0.14} raycast={noRaycast} />
        ))}
      </group>
      {/* moving parts: matrices change, so skip culling (both are tiny) */}
      <instancedMesh ref={crates} args={[UNIT_BOX, crateMat, MAX_CRATES]} frustumCulled={false} />
      <instancedMesh ref={smoke} args={[UNIT_BOX, SMOKE_MAT, SMOKE_N]} frustumCulled={false} raycast={noRaycast} />
    </group>
  )
}
