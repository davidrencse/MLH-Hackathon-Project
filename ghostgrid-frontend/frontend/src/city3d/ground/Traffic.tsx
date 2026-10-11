// Voxel traffic: every car body + cabin in ONE InstancedMesh, every head/tail light in another.
// Matrices are rewritten in useFrame (no React state); colors are set once.
import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'
import { PALETTE, UNIT_BOX } from '../materials'
import { MAP } from '../world'
import { CARS, HALF } from './layout'

const LEN = 0.52
const WID = 0.28
const BODY_H = 0.16
const BODY_Y = 0.13
const CAB_Y = 0.27
const LANE = 0.22
const o = new THREE.Object3D()

export function Traffic({ lit, glow }: { lit: THREE.Material; glow: THREE.Material }) {
  const bodies = useRef<THREE.InstancedMesh>(null)
  const lights = useRef<THREE.InstancedMesh>(null)

  useLayoutEffect(() => {
    const b = bodies.current
    const l = lights.current
    if (!b || !l) return
    const c = new THREE.Color()
    CARS.forEach((car, i) => {
      b.setColorAt(i * 2, c.set(car.color))
      b.setColorAt(i * 2 + 1, c.set(PALETTE.void))
      l.setColorAt(i * 2, c.set(PALETTE.ink).multiplyScalar(2.6))
      l.setColorAt(i * 2 + 1, c.set(PALETTE.red).multiplyScalar(2.2))
    })
    if (b.instanceColor) b.instanceColor.needsUpdate = true
    if (l.instanceColor) l.instanceColor.needsUpdate = true
  }, [])

  useFrame(({ clock }) => {
    const b = bodies.current
    const l = lights.current
    if (!b || !l) return
    const t = clock.elapsedTime
    const put = (m: THREE.InstancedMesh, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
      o.position.set(x, y, z)
      o.scale.set(sx, sy, sz)
      o.updateMatrix()
      m.setMatrixAt(i, o.matrix)
    }
    for (let i = 0; i < CARS.length; i++) {
      const car = CARS[i]
      const s = (((car.phase + car.speed * t) % MAP.size) - HALF) * car.dir
      const k = Math.max(0, Math.min(1, (HALF - Math.abs(s)) / 0.5)) // shrink into the platform edge
      const alongX = car.axis === 'x'
      const fx = alongX ? car.dir : 0
      const fz = alongX ? 0 : car.dir
      const x = alongX ? s : car.road - car.dir * LANE
      const z = alongX ? car.road + car.dir * LANE : s
      o.rotation.set(0, alongX ? 0 : -Math.PI / 2, 0) // local +x = travel axis
      put(b, i * 2, x, BODY_Y * k, z, LEN * k, BODY_H * k, WID * k)
      put(b, i * 2 + 1, x - fx * 0.05 * k, CAB_Y * k, z - fz * 0.05 * k, 0.28 * k, 0.12 * k, 0.22 * k)
      const h = (LEN / 2 + 0.01) * k
      put(l, i * 2, x + fx * h, BODY_Y * k, z + fz * h, 0.06 * k, 0.07 * k, 0.22 * k)
      put(l, i * 2 + 1, x - fx * h, BODY_Y * k, z - fz * h, 0.06 * k, 0.07 * k, 0.22 * k)
    }
    b.instanceMatrix.needsUpdate = true
    l.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      <instancedMesh ref={bodies} args={[UNIT_BOX, lit, CARS.length * 2]} frustumCulled={false} receiveShadow />
      <instancedMesh ref={lights} args={[UNIT_BOX, glow, CARS.length * 2]} frustumCulled={false} />
    </>
  )
}
