// Shared, instanced toy-town outskirts: little cottages, warm windows and lollipop trees.
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

const BOX = new THREE.BoxGeometry(1, 1, 1)
const LEAF = new THREE.IcosahedronGeometry(1, 0)
const WALL = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true })
const ROOF = new THREE.MeshLambertMaterial({ color: '#52797a', flatShading: true })
const WINDOW = new THREE.MeshBasicMaterial({ color: '#ffe4ad', toneMapped: false })
const WOOD = new THREE.MeshLambertMaterial({ color: '#977a62' })
const GREEN = new THREE.MeshLambertMaterial({ color: '#9ac5a4', flatShading: true })
const GRASS = new THREE.MeshLambertMaterial({ color: '#527b70' })
const COLORS = ['#d6aaa9', '#adc8c0', '#d5c49f', '#b2bdd3', '#c5bdce', '#d6b89e']
const noRaycast = () => null

export type PocketDistrict = { x: number; z: number; seed: number }

export function PocketNeighborhoods({ districts }: { districts: PocketDistrict[] }) {
  const meshes = useMemo(() => {
    const parts = [
      new THREE.InstancedMesh(BOX, WALL, 49 * districts.length),
      new THREE.InstancedMesh(BOX, ROOF, 49 * districts.length),
      new THREE.InstancedMesh(BOX, WINDOW, 49 * 4 * districts.length),
      new THREE.InstancedMesh(BOX, WOOD, 49 * districts.length),
      new THREE.InstancedMesh(LEAF, GREEN, 49 * districts.length),
      new THREE.InstancedMesh(BOX, GRASS, 49 * districts.length),
    ]
    const transform = new THREE.Object3D()
    const color = new THREE.Color()
    const place = (part: number, i: number, x: number, y: number, z: number, w: number, h: number, d: number) => {
      transform.position.set(x, y, z)
      transform.scale.set(w, h, d)
      transform.updateMatrix()
      parts[part].setMatrixAt(i, transform.matrix)
    }
    for (let i = 0; i < 49 * districts.length; i++) {
      const district = districts[Math.floor(i / 49)]
      const seed = district.seed
      const x = district.x + (i % 49 % 7 - 3) * 4.5
      const z = district.z + (Math.floor(i % 49 / 7) - 3) * 4.5
      const h = 1.3 + ((i * 7 + seed * 3) % 5) * 0.36
      place(0, i, x, h / 2, z, 1.9, h, 1.8)
      parts[0].setColorAt(i, color.set(COLORS[(i + seed) % COLORS.length]))
      place(1, i, x, h + 0.15, z, 2.15, 0.3, 2.05)
      for (let k = 0; k < 2; k++) {
        place(2, i * 4 + k, x - 0.48 + k * 0.95, h * 0.64, z + 0.91, 0.3, 0.42, 0.035)
        place(2, i * 4 + 2 + k, x + 0.96, h * 0.64, z - 0.45 + k * 0.9, 0.035, 0.42, 0.3)
      }
      place(3, i, x + 1.5, 0.65, z - 1.2, 0.15, 1.3, 0.15)
      place(4, i, x + 1.5, 1.65, z - 1.2, 0.72, 0.95, 0.72)
      place(5, i, x, 0.025, z, 3.7, 0.05, 3.7)
    }
    for (const mesh of parts) {
      mesh.instanceMatrix.needsUpdate = true
      mesh.raycast = noRaycast
    }
    return parts
  }, [districts])
  useEffect(() => () => { meshes.forEach(mesh => mesh.dispose()) }, [meshes])
  return <group>{meshes.map(mesh => <primitive key={mesh.uuid} object={mesh} />)}</group>
}
