// Elevated express loop. Static infrastructure and moving train cars are instanced.
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

const BOX = new THREE.BoxGeometry(1, 1, 1)
const materials = [
  new THREE.MeshLambertMaterial({ color: '#2c4158', flatShading: true }),
  new THREE.MeshBasicMaterial({ color: '#42e8ed', toneMapped: false }),
  new THREE.MeshLambertMaterial({ color: '#536d81', flatShading: true }),
  new THREE.MeshLambertMaterial({ color: '#122235', flatShading: true }),
  new THREE.MeshLambertMaterial({ color: '#2e5362', flatShading: true }),
]
const Y = 2.9
const SAMPLES = 512
const r = 20.5
const curve = new THREE.CatmullRomCurve3([
  [-r + 4, Y, -r], [r - 4, Y, -r], [r, Y, -r + 4], [r, Y, r - 4],
  [r - 4, Y, r], [-r + 4, Y, r], [-r, Y, r - 4], [-r, Y, -r + 4],
].map(p => new THREE.Vector3(...p)), true, 'centripetal')
const points = Array.from({ length: SAMPLES + 1 }, (_, i) => curve.getPointAt(i / SAMPLES))
type Part = { x: number; y: number; z: number; w: number; h: number; d: number; yaw: number }
const transform = new THREE.Object3D()
const p = new THREE.Vector3()
const q = new THREE.Vector3()

export function Transit() {
  const rig = useMemo(() => {
    const parts: Part[][] = materials.map(() => [])
    const box = (m: number, x: number, y: number, z: number, w: number, h: number, d: number, yaw = 0) => parts[m].push({ x, y, z, w, h, d, yaw })
    for (let i = 0; i < 160; i++) {
      const a = points[Math.floor(i / 160 * SAMPLES)], b = points[Math.floor((i + 1) / 160 * SAMPLES)]
      const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2, yaw = Math.atan2(-(b.z - a.z), b.x - a.x)
      const length = a.distanceTo(b) + 0.07
      box(0, x, Y - 0.2, z, length, 0.34, 1.35, yaw)
      for (const side of [-1, 1]) box(1, x + Math.sin(yaw) * side * 0.52, Y + 0.01, z + Math.cos(yaw) * side * 0.52, length, 0.045, 0.055, yaw)
      if (i % 8 === 0) {
        box(0, x, Y / 2 - 0.2, z, 0.35, Y - 0.4, 0.35)
        box(2, x, 0.12, z, 0.85, 0.24, 0.85)
      }
    }
    // Four raised stations, solar canopies and pedestrian connections to the districts.
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2, x = Math.cos(a) * r, z = Math.sin(a) * r, yaw = Math.PI / 2 - a
      box(2, x, Y - 0.06, z, 6.5, 0.28, 3.6, yaw)
      box(4, x, Y + 2.1, z, 7, 0.22, 4, yaw)
      box(3, x, Y + 2.25, z, 5.8, 0.08, 2.8, yaw)
      for (const k of [-1, 1]) for (const side of [-1, 1]) box(0, x + Math.sin(a) * k * 2.5 + Math.cos(a) * side * 1.35, Y + 0.95, z - Math.cos(a) * k * 2.5 + Math.sin(a) * side * 1.35, 0.14, 1.9, 0.14)
      box(1, x + Math.cos(a) * 1.81, Y + 0.3, z + Math.sin(a) * 1.81, 5.5, 0.12, 0.08, yaw)
      // Wide district skybridges radiate from the central island.
      box(0, Math.cos(a) * 26, 1.6, Math.sin(a) * 26, 18, 0.3, 1.7, -a)
      for (const side of [-1, 1]) box(1, Math.cos(a) * 26 + Math.sin(a) * side * 0.8, 1.95, Math.sin(a) * 26 - Math.cos(a) * side * 0.8, 18, 0.09, 0.06, -a)
    }
    const staticMeshes = parts.map((list, index) => {
      const mesh = new THREE.InstancedMesh(BOX, materials[index], list.length)
      list.forEach((b, i) => {
        transform.position.set(b.x, b.y, b.z); transform.rotation.set(0, b.yaw, 0); transform.scale.set(b.w, b.h, b.d); transform.updateMatrix(); mesh.setMatrixAt(i, transform.matrix)
      })
      mesh.instanceMatrix.needsUpdate = true; mesh.raycast = () => null
      return mesh
    })
    const cars = new THREE.InstancedMesh(BOX, materials[2], 16)
    const windows = new THREE.InstancedMesh(BOX, materials[3], 32)
    const stripe = new THREE.InstancedMesh(BOX, materials[1], 32)
    for (const m of [cars, windows, stripe]) { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.raycast = () => null }
    return { staticMeshes, cars, windows, stripe, reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches }
  }, [])
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => { rig.reduced = media.matches }
    media.addEventListener('change', update)
    return () => { media.removeEventListener('change', update); [...rig.staticMeshes, rig.cars, rig.windows, rig.stripe].forEach(m => m.dispose()) }
  }, [rig])
  useFrame(({ clock }) => {
    const t = rig.reduced ? 0 : clock.elapsedTime
    for (let train = 0; train < 4; train++) for (let car = 0; car < 4; car++) {
      const direction = train % 2 ? -1 : 1
      const u = ((train * 0.25 + t * 0.036 * direction - car * 0.018 * direction) % 1 + 1) % 1
      const sample = u * SAMPLES, index = Math.floor(sample)
      p.lerpVectors(points[index], points[index + 1], sample - index)
      q.subVectors(points[index + 1], points[index]).multiplyScalar(direction)
      const yaw = Math.atan2(-q.z, q.x), lane = direction * 0.32, i = train * 4 + car
      const x = p.x + Math.sin(yaw) * lane, z = p.z + Math.cos(yaw) * lane
      transform.rotation.set(0, yaw, 0)
      transform.position.set(x, Y + 0.42, z); transform.scale.set(2.25, 0.66, 0.55); transform.updateMatrix(); rig.cars.setMatrixAt(i, transform.matrix)
      for (let side = 0; side < 2; side++) {
        const offset = (side ? 1 : -1) * 0.28
        transform.position.set(x + Math.sin(yaw) * offset, Y + 0.51, z + Math.cos(yaw) * offset); transform.scale.set(1.75, 0.22, 0.025); transform.updateMatrix(); rig.windows.setMatrixAt(i * 2 + side, transform.matrix)
        transform.position.y = Y + 0.24; transform.scale.set(2.2, 0.08, 0.028); transform.updateMatrix(); rig.stripe.setMatrixAt(i * 2 + side, transform.matrix)
      }
    }
    rig.cars.instanceMatrix.needsUpdate = true; rig.windows.instanceMatrix.needsUpdate = true; rig.stripe.instanceMatrix.needsUpdate = true
  })
  return <group>{[...rig.staticMeshes, rig.cars, rig.windows, rig.stripe].map(m => <primitive key={m.uuid} object={m} />)}</group>
}
