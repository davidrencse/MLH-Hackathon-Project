// Static street furniture: lamps, vending machines, AC boxes, benches and the platform neon rims.
// All boxes go into 2 InstancedMeshes (lit + glow, matrices/colors set once) + 1 for puddles = 3 draw calls.
import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { PALETTE, UNIT_BOX } from '../materials'
import { MAP } from '../world'
import { CURB, HALF, LAMP_REACH, LAMPS, PROPS, PUDDLES, SLAB_DEPTH } from './layout'
import { makePuddleTexture } from './textures'

type V3 = [number, number, number]
// One box: position, size, color, color multiplier (> 1 on glow parts so bloom picks them up).
interface Part {
  p: V3
  s: V3
  c: string
  k?: number
}

function buildParts() {
  const lit: Part[] = []
  const glow: Part[] = []

  for (const l of LAMPS) {
    const { x, z, ax, az } = l
    lit.push({ p: [x, CURB + 0.05, z], s: [0.18, 0.1, 0.18], c: PALETTE.night })
    lit.push({ p: [x, CURB + 0.5, z], s: [0.1, 1, 0.1], c: PALETTE.steel })
    lit.push({ p: [x + ax * 0.16, CURB + 0.98, z + az * 0.16], s: [ax ? 0.42 : 0.08, 0.08, az ? 0.42 : 0.08], c: PALETTE.steel })
    glow.push({
      p: [x + ax * LAMP_REACH, CURB + 0.9, z + az * LAMP_REACH],
      s: [ax ? 0.24 : 0.14, 0.09, az ? 0.24 : 0.14],
      c: l.color,
      k: 2.4,
    })
  }

  const screens = [PALETTE.pink, PALETTE.cyan, PALETTE.green, PALETTE.yellow]
  PROPS.forEach((p, i) => {
    const y = CURB
    const sz = (a: number, b: number): [number, number] => (p.rot ? [b, a] : [a, b]) // swap x/z sizes
    if (p.kind === 'vending') {
      const [w, d] = sz(0.36, 0.26)
      lit.push({ p: [p.x, y + 0.3, p.z], s: [w, 0.6, d], c: PALETTE.dusk })
      const [sw, sd] = sz(0.26, 0.04)
      // screen on the camera-facing side (+z, or +x when rotated)
      glow.push({ p: [p.x + (p.rot ? 0.14 : 0), y + 0.38, p.z + (p.rot ? 0 : 0.14)], s: [sw, 0.3, sd], c: screens[i % 4], k: 1.6 })
      glow.push({ p: [p.x, y + 0.62, p.z], s: [w, 0.06, d], c: screens[(i + 1) % 4], k: 1.8 })
    } else if (p.kind === 'ac') {
      lit.push({ p: [p.x, y + 0.12, p.z], s: [0.38, 0.24, 0.32], c: PALETTE.steel })
      lit.push({ p: [p.x, y + 0.25, p.z], s: [0.26, 0.04, 0.2], c: PALETTE.void })
      glow.push({ p: [p.x + 0.15, y + 0.17, p.z + 0.13], s: [0.08, 0.08, 0.08], c: PALETTE.green, k: 1.5 })
    } else {
      const [w, d] = sz(0.62, 0.2)
      lit.push({ p: [p.x, y + 0.17, p.z], s: [w, 0.08, d], c: PALETTE.haze })
      const [lw, ld] = sz(0.5, 0.1)
      lit.push({ p: [p.x, y + 0.07, p.z], s: [lw, 0.14, ld], c: PALETTE.void })
      const [bw, bd] = sz(0.62, 0.07)
      lit.push({ p: [p.x - (p.rot ? 0.09 : 0), y + 0.3, p.z - (p.rot ? 0 : 0.09)], s: [bw, 0.2, bd], c: PALETTE.haze })
    }
  })

  // platform rims: cyan neon along the top edge, pink strip lower down the sides
  const L = MAP.size + 0.12
  for (const sgn of [-1, 1]) {
    glow.push({ p: [0, 0.02, sgn * HALF], s: [L, 0.1, 0.1], c: PALETTE.cyan, k: 1.8 })
    glow.push({ p: [sgn * HALF, 0.02, 0], s: [0.1, 0.1, L], c: PALETTE.cyan, k: 1.8 })
    glow.push({ p: [0, -SLAB_DEPTH + 0.28, sgn * HALF], s: [L - 0.04, 0.08, 0.08], c: PALETTE.pink, k: 1.8 })
    glow.push({ p: [sgn * HALF, -SLAB_DEPTH + 0.28, 0], s: [0.08, 0.08, L - 0.04], c: PALETTE.pink, k: 1.8 })
  }
  return { lit, glow }
}

function Boxes({ parts, material, receiveShadow }: { parts: Part[]; material: THREE.Material; receiveShadow?: boolean }) {
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
  return <instancedMesh ref={ref} args={[UNIT_BOX, material, parts.length]} receiveShadow={receiveShadow} />
}

function Puddles() {
  const ref = useRef<THREE.InstancedMesh>(null)
  const { geo, mat } = useMemo(
    () => ({
      geo: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      mat: new THREE.MeshBasicMaterial({ map: makePuddleTexture(), transparent: true, depthWrite: false, toneMapped: false }),
    }),
    [],
  )
  useEffect(
    () => () => {
      mat.map?.dispose()
      mat.dispose()
      geo.dispose()
    },
    [geo, mat],
  )
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    const o = new THREE.Object3D()
    PUDDLES.forEach((p, i) => {
      o.position.set(p.x, p.y, p.z)
      o.rotation.set(0, p.rot, 0)
      o.scale.set(p.w, 1, p.d)
      o.updateMatrix()
      m.setMatrixAt(i, o.matrix)
    })
    m.instanceMatrix.needsUpdate = true
    m.computeBoundingSphere()
  }, [])
  // stepped neon shimmer: one uniform write per frame
  useFrame(({ clock }) => {
    mat.color.setScalar(Math.floor(clock.elapsedTime * 3) % 4 === 0 ? 1.5 : 1.1)
  })
  return <instancedMesh ref={ref} args={[geo, mat, PUDDLES.length]} renderOrder={1} />
}

export function StreetProps({ lit, glow }: { lit: THREE.Material; glow: THREE.Material }) {
  const parts = useMemo(buildParts, [])
  return (
    <>
      <Boxes parts={parts.lit} material={lit} receiveShadow />
      <Boxes parts={parts.glow} material={glow} />
      <Puddles />
    </>
  )
}
