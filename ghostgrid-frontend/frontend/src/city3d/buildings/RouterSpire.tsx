// Router Spire: the city's brain and tallest landmark (center lot, 2x2 tiles, roof at `height`).
// Tapered stack of setback volumes with cyan neon corners, a vertical ROUTER blade sign, a roof
// landing pad (drones dock at height + 0.6), an antenna mast and a rotating holographic halo.
// Efficiency: UNIT_BOX + cached materials; neon strips and small props are 2 InstancedMeshes
// whose matrices are written once; all animation mutates refs in one useFrame (no React state).
import { useFrame } from '@react-three/fiber'
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import * as THREE from 'three'
import { useGrid } from '../../store/grid'
import { BuildingCtx } from '../BuildingCtx'
import { flatMat, neonMat, PALETTE, signTexture, UNIT_BOX, useFacadeMaterial } from '../materials'

type Vec3 = [number, number, number]
type Part = [number, number, number, number, number, number] // x, y, z, sx, sy, sz

// Cached shared materials. This file only swaps them by reference, it never mutates them.
const STRIP = {
  idle: neonMat(PALETTE.cyan, 2),
  hi: neonMat(PALETTE.cyan, 3.2),
  off: neonMat(PALETTE.cyan, 0.6),
  approval: neonMat(PALETTE.yellow, 2),
  error: neonMat(PALETTE.red, 2.4),
  dark: neonMat(PALETTE.night, 1),
}
type StripKey = keyof typeof STRIP
type HaloKey = 'normal' | 'approval' | 'error'
const HALO: Record<HaloKey, [THREE.Material, THREE.Material]> = {
  normal: [neonMat(PALETTE.cyan, 2.6), neonMat(PALETTE.pink, 2.6)],
  approval: [neonMat(PALETTE.yellow, 2.6), neonMat(PALETTE.yellow, 2.6)],
  error: [neonMat(PALETTE.red, 2.8), neonMat(PALETTE.red, 2.8)],
}
const BEAM_COLOR: Record<HaloKey, THREE.Color> = {
  normal: new THREE.Color(PALETTE.cyan).multiplyScalar(1.4),
  approval: new THREE.Color(PALETTE.yellow).multiplyScalar(1.4),
  error: new THREE.Color(PALETTE.red).multiplyScalar(1.4),
}
const LAMP_ON = neonMat(PALETTE.red, 3)
const LAMP_OFF = neonMat(PALETTE.night, 1)
const PINK = neonMat(PALETTE.pink, 2.2)
const PLANE = new THREE.PlaneGeometry(1, 1)

// Window grid density: about one 4-texel window cell per ~0.45 world units, so windows stay 2x2 px.
const facadeCols = (w: number) => Math.max(2, Math.round(w * 2.2))
const facadeRows = (h: number) => Math.max(2, Math.round(h * 2.4))

function Box({ p, s, m, cast, recv }: { p: Vec3; s: Vec3; m: THREE.Material; cast?: boolean; recv?: boolean }) {
  return <mesh geometry={UNIT_BOX} material={m} position={p} scale={s} castShadow={cast} receiveShadow={recv} />
}

// Static parts of one InstancedMesh: write the matrices once.
function useStaticInstances(ref: RefObject<THREE.InstancedMesh | null>, parts: Part[]) {
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const o = new THREE.Object3D()
    parts.forEach(([x, y, z, sx, sy, sz], i) => {
      o.position.set(x, y, z)
      o.scale.set(sx, sy, sz)
      o.updateMatrix()
      mesh.setMatrixAt(i, o.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [ref, parts])
}

export function RouterSpire() {
  const { footprint, height: H, statusRef, offlineRef } = useContext(BuildingCtx)
  const W = Math.min(footprint.w, footprint.d)

  // Layout: plinth, 3 tapering tiers with overhanging ledges (terraces), wider crown deck on top.
  const L = useMemo(() => {
    const y1a = 0.24
    const y1b = H * 0.47
    const l1h = 0.2
    const y2a = y1b + l1h
    const y2b = H * 0.76
    const l2h = 0.18
    const y3a = y2b + l2h
    const y3b = H - 0.46
    const w2 = W * 0.62
    const bw = 0.4
    const bh = Math.min(1.6, y2b - y2a - 0.2)
    return {
      y1a, y1b, l1h, y2a, y2b, l2h, y3a, y3b, w2,
      w1: W * 0.84,
      l1: W * 0.94,
      l2: W * 0.76,
      w3: W * 0.45,
      wc: W * 0.58,
      // Mast on the rear roof corner: on screen it stands straight above the spire, clear of the dock.
      m: -W * 0.23,
      pad: W * 0.14,
      sign: { x: w2 / 2 + (bw + 0.06) / 2, y: (y2a + y2b) / 2, w: bw, h: bh },
    }
  }, [W, H])
  const { y1a, y1b, l1h, y2a, y2b, l2h, y3a, y3b, w1, l1, w2, l2, w3, wc, m, pad, sign } = L

  const strips = useMemo<Part[]>(() => {
    const s = 0.12
    // Front, left and right vertical corners (the rear corner is never visible from the fixed iso camera).
    const corners = (w: number, ya: number, yb: number): Part[] => {
      const h = w / 2
      const cy = (ya + yb) / 2
      const sy = yb - ya
      return [
        [h, cy, h, s, sy, s],
        [-h, cy, h, s, sy, s],
        [h, cy, -h, s, sy, s],
      ]
    }
    return [
      ...corners(w1, y1a, y1b),
      ...corners(w2, y2a, y2b),
      ...corners(w3, y3a, y3b),
      [0, y1a - 0.07, 0, W + 0.02, 0.08, W + 0.02], // plinth trim
      [0, y1b + 0.07, 0, l1 + 0.03, 0.1, l1 + 0.03], // ledge bands
      [0, y2b + 0.06, 0, l2 + 0.03, 0.1, l2 + 0.03],
      [0, H + 0.05, pad, pad * 2 + 0.1, 0.1, 0.1], // landing pad outline
      [0, H + 0.05, -pad, pad * 2 + 0.1, 0.1, 0.1],
      [pad, H + 0.05, 0, 0.1, 0.1, pad * 2 - 0.1],
      [-pad, H + 0.05, 0, 0.1, 0.1, pad * 2 - 0.1],
      [sign.x + sign.w / 2 + 0.05, sign.y, 0, 0.08, sign.h + 0.12, 0.12], // sign blade edge
    ]
  }, [W, H, y1a, y1b, y2a, y2b, y3a, y3b, w1, w2, w3, l1, l2, pad, sign])

  const props = useMemo<Part[]>(() => {
    const t1 = y1b + l1h // terrace floors
    const t2 = y2b + l2h
    const e1 = (w2 / 2 + l1 / 2) / 2 // middle of each terrace ring
    const e2 = (w3 / 2 + l2 / 2) / 2
    return [
      [e1, t1 + 0.08, -0.32, 0.18, 0.16, 0.22], // AC units + vent stack on terrace 1
      [e1, t1 + 0.08, 0.34, 0.16, 0.16, 0.2],
      [-0.3, t1 + 0.08, e1, 0.22, 0.16, 0.18],
      [0.3, t1 + 0.15, e1, 0.12, 0.3, 0.12],
      [e2, t2 + 0.08, -0.18, 0.16, 0.16, 0.2], // terrace 2
      [-0.12, t2 + 0.08, e2, 0.2, 0.16, 0.16],
      [m, H + 0.15, m, 0.2, 0.3, 0.2], // mast housing, pole, crossbars
      [m, H + 0.9, m, 0.1, 1.2, 0.1],
      [m, H + 0.7, m, 0.34, 0.08, 0.08],
      [m, H + 0.7, m, 0.08, 0.08, 0.34],
      [m, H + 1.1, m, 0.24, 0.08, 0.08],
      [m, H + 1.1, m, 0.08, 0.08, 0.24],
      [-m, H + 0.07, -m, 0.14, 0.14, 0.14], // roof AC (front corner)
      [-m, H + 0.08, m, 0.1, 0.16, 0.1], // dish post (right corner)
    ]
  }, [H, y1b, l1h, y2b, l2h, w2, w3, l1, l2, m])

  const f1 = useFacadeMaterial({ cols: facadeCols(w1), rows: facadeRows(y1b - y1a), seed: 71, tint: PALETTE.cyan })
  const f2 = useFacadeMaterial({ cols: facadeCols(w2), rows: facadeRows(y2b - y2a), seed: 72, tint: PALETTE.cyan })
  const f3 = useFacadeMaterial({ cols: facadeCols(w3), rows: facadeRows(y3b - y3a), seed: 73, tint: PALETTE.pink })

  // Resources owned by this component (disposed on unmount). The sign texture is cached: keep it.
  const own = useMemo(
    () => ({
      ringA: new THREE.TorusGeometry(0.55, 0.06, 4, 24, Math.PI * 1.5),
      ringB: new THREE.TorusGeometry(0.38, 0.06, 4, 20),
      tank: new THREE.CylinderGeometry(0.1, 0.1, 0.28, 6),
      dish: new THREE.CylinderGeometry(0.17, 0.04, 0.07, 8),
      beam: new THREE.MeshBasicMaterial({
        color: BEAM_COLOR.normal,
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
        toneMapped: false,
      }),
      sign: new THREE.MeshBasicMaterial({
        map: signTexture('', PALETTE.cyan),
        color: new THREE.Color(1.8, 1.8, 1.8),
        toneMapped: false,
      }),
    }),
    [],
  )
  useEffect(
    () => () => {
      own.ringA.dispose()
      own.ringB.dispose()
      own.tank.dispose()
      own.dish.dispose()
      own.beam.dispose()
      own.sign.dispose()
    },
    [own],
  )

  const stripRef = useRef<THREE.InstancedMesh>(null)
  const propRef = useRef<THREE.InstancedMesh>(null)
  useStaticInstances(stripRef, strips)
  useStaticInstances(propRef, props)

  const spinA = useRef<THREE.Group>(null)
  const spinB = useRef<THREE.Group>(null)
  const ringA = useRef<THREE.Mesh>(null)
  const ringB = useRef<THREE.Mesh>(null)
  const lamp = useRef<THREE.Mesh>(null)
  const anim = useRef({ frame: 0, approval: false, halo: 'normal' as HaloKey, speed: 0.6 })

  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime
    const dt = Math.min(delta, 0.1)
    const a = anim.current
    const status = statusRef.current
    const working = status === 'working'

    // Any building waiting for approval? Scan the store every 10th frame (no allocation, no re-render).
    if (a.frame++ % 10 === 0) {
      const s = useGrid.getState()
      let found = false
      for (const id of s.order) {
        if (s.buildings[id]?.status === 'needs_approval') {
          found = true
          break
        }
      }
      a.approval = found
    }

    // Halo: red on router error > yellow while any approval is pending > cyan + pink.
    const halo: HaloKey = status === 'error' ? 'error' : a.approval ? 'approval' : 'normal'
    if (halo !== a.halo) {
      a.halo = halo
      if (ringA.current) ringA.current.material = HALO[halo][0]
      if (ringB.current) ringB.current.material = HALO[halo][1]
      own.beam.color.copy(BEAM_COLOR[halo])
    }
    a.speed += ((working ? 3 : 0.6) - a.speed) * Math.min(1, dt * 4) // 0.6 rad/s idle, 3 rad/s working
    if (spinA.current) spinA.current.rotation.y += a.speed * dt
    if (spinB.current) spinB.current.rotation.y -= a.speed * 1.4 * dt
    own.beam.opacity = working ? (Math.floor(t * 6) % 2 ? 0.45 : 0.3) : 0.25

    // Corner neon follows the router status (swap cached materials, steps timing).
    let sk: StripKey = 'idle'
    if (status === 'error') sk = Math.floor(t / 0.3) % 2 ? 'dark' : 'error'
    else if (status === 'needs_approval') sk = 'approval'
    else if (working) sk = Math.floor(t * 4) % 2 ? 'hi' : 'idle'
    else if (offlineRef.current) sk = 'off'
    if (stripRef.current && stripRef.current.material !== STRIP[sk]) stripRef.current.material = STRIP[sk]

    if (lamp.current) lamp.current.material = Math.floor(t / 0.8) % 2 ? LAMP_OFF : LAMP_ON
  })

  return (
    <group>
      {/* plinth, tiers and ledges: the spire tapers toward a wider crown deck */}
      <Box p={[0, y1a / 2, 0]} s={[W, y1a, W]} m={flatMat(PALETTE.concrete)} cast recv />
      <mesh geometry={UNIT_BOX} material={f1} position={[0, (y1a + y1b) / 2, 0]} scale={[w1, y1b - y1a, w1]} castShadow receiveShadow />
      <Box p={[0, y1b + l1h / 2, 0]} s={[l1, l1h, l1]} m={flatMat(PALETTE.dusk)} cast recv />
      <mesh geometry={UNIT_BOX} material={f2} position={[0, (y2a + y2b) / 2, 0]} scale={[w2, y2b - y2a, w2]} castShadow receiveShadow />
      <Box p={[0, y2b + l2h / 2, 0]} s={[l2, l2h, l2]} m={flatMat(PALETTE.dusk)} cast recv />
      <mesh geometry={UNIT_BOX} material={f3} position={[0, (y3a + y3b) / 2, 0]} scale={[w3, y3b - y3a, w3]} castShadow receiveShadow />
      <Box p={[0, (y3b + H) / 2, 0]} s={[wc, H - y3b, wc]} m={flatMat(PALETTE.dusk)} cast recv />
      <Box p={[0, H - 0.2, 0]} s={[wc + 0.03, 0.1, wc + 0.03]} m={PINK} />

      {/* entrance on the +z face */}
      <Box p={[0, y1a + 0.28, w1 / 2 + 0.01]} s={[0.42, 0.56, 0.04]} m={flatMat(PALETTE.void)} />
      <Box p={[0, y1a + 0.62, w1 / 2 + 0.13]} s={[0.6, 0.08, 0.26]} m={flatMat(PALETTE.dusk)} />
      <Box p={[0, y1a + 0.6, w1 / 2 + 0.27]} s={[0.62, 0.1, 0.06]} m={PINK} />

      {/* vertical ROUTER blade sign: sticks out of the +x face of tier 2, text faces +z */}
      <Box p={[sign.x, sign.y, 0]} s={[sign.w + 0.06, sign.h + 0.1, 0.08]} m={flatMat(PALETTE.night)} />
      <mesh geometry={PLANE} material={own.sign} position={[sign.x, sign.y, 0.042]} rotation={[0, 0, -Math.PI / 2]} scale={[sign.h, sign.w, 1]} />

      {/* landing pad (drones dock at H + 0.6; the shell beacon marks its center) */}
      <Box p={[0, H + 0.02, 0]} s={[pad * 2, 0.04, pad * 2]} m={flatMat(PALETTE.night)} recv />

      <instancedMesh ref={stripRef} args={[UNIT_BOX, STRIP.idle, strips.length]} />
      <instancedMesh ref={propRef} args={[UNIT_BOX, flatMat(PALETTE.steel), props.length]} receiveShadow />

      {/* roof clutter: water tank (left corner), dish (right corner) */}
      <mesh geometry={own.tank} material={flatMat(PALETTE.haze)} position={[m, H + 0.14, -m]} />
      <mesh geometry={own.dish} material={flatMat('#8f8ab8')} position={[-m, H + 0.22, m]} rotation={[0, 0, -0.7]} />

      {/* mast lamp, faint light beam and the rotating holographic halo */}
      <mesh ref={lamp} geometry={UNIT_BOX} material={LAMP_ON} position={[m, H + 1.56, m]} scale={[0.14, 0.14, 0.14]} />
      <mesh geometry={UNIT_BOX} material={own.beam} position={[m, H + 2.2, m]} scale={[0.14, 1.4, 0.14]} />
      <group position={[m, H + 2.3, m]}>
        <group ref={spinA}>
          <mesh ref={ringA} geometry={own.ringA} material={HALO.normal[0]} rotation={[Math.PI / 2 - 0.2, 0, 0]} />
        </group>
        <group ref={spinB}>
          <mesh ref={ringB} geometry={own.ringB} material={HALO.normal[1]} rotation={[Math.PI / 2 - 1.1, 0, 0]} />
        </group>
      </group>
    </group>
  )
}
