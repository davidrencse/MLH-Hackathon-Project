// The whole fleet uses four draw calls, regardless of the number of airships.
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

const BOX = new THREE.BoxGeometry(1, 1, 1)
const HULL = new THREE.SphereGeometry(1, 10, 7)
const COLORS = ['#f9bed7', '#b1f1df', '#ffe7a0', '#c6ccff', '#ffd0aa', '#d0edac']
const BODY = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true })
const TRIM = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false })
const DARK = new THREE.MeshLambertMaterial({ color: '#263b51', flatShading: true })
const WINDOW = new THREE.MeshBasicMaterial({ color: '#fff3ca', toneMapped: false })
// Cruising altitude. Raised from 15.2 on request: at the old height the fleet flew through the
// skyline rather than over it, and a zeppelin crossing behind a tower read as stuck to it.
//
// It needs more clearance than the roofs suggest. Under the 2:1 iso projection a point's screen
// height is y*sin(60) minus its depth, so a zeppelin on the NEAR side of its circle drops about
// 7 units down the frame relative to one on the far side. At 24 the near half of the fleet still
// sat among the towers. 33 puts the whole circle above the skyline from every angle.
const CRUISE_Y = 33
const FLEET = Array.from({ length: 9 }, (_, i) => ({ radius: 12 + i % 3 * 4, phase: i * Math.PI * 2 / 9, speed: (i % 2 ? -1 : 1) * (0.025 + i % 3 * 0.005), height: CRUISE_Y + i % 3 * 1.1, scale: 1.65 + i % 3 * 0.18 }))
const root = new THREE.Object3D()
const part = new THREE.Object3D()
const matrix = new THREE.Matrix4()

export function Zeppelins() {
  const rig = useMemo(() => {
    const meshes = [new THREE.InstancedMesh(HULL, BODY, 9), new THREE.InstancedMesh(BOX, TRIM, 18), new THREE.InstancedMesh(BOX, DARK, 9 * 8), new THREE.InstancedMesh(BOX, WINDOW, 18)]
    const color = new THREE.Color()
    for (let i = 0; i < 9; i++) {
      meshes[0].setColorAt(i, color.set(COLORS[i % COLORS.length]))
      meshes[1].setColorAt(i * 2, color.set(COLORS[(i + 2) % COLORS.length]))
      meshes[1].setColorAt(i * 2 + 1, color)
    }
    for (const mesh of meshes) { mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; mesh.raycast = () => null }
    return { meshes, reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches }
  }, [])
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => { rig.reduced = media.matches }
    media.addEventListener('change', update)
    return () => { media.removeEventListener('change', update); rig.meshes.forEach(mesh => mesh.dispose()) }
  }, [rig])
  useFrame(({ clock }) => {
    const t = rig.reduced ? 0 : clock.elapsedTime
    const place = (mesh: number, i: number, x: number, y: number, z: number, w: number, h: number, d: number) => {
      part.position.set(x, y, z); part.scale.set(w, h, d); part.updateMatrix()
      rig.meshes[mesh].setMatrixAt(i, matrix.multiplyMatrices(root.matrix, part.matrix))
    }
    for (let i = 0; i < FLEET.length; i++) {
      const cfg = FLEET[i], angle = cfg.phase + t * cfg.speed
      root.position.set(Math.cos(angle) * cfg.radius, cfg.height + Math.sin(t * 0.7 + i) * 0.18, Math.sin(angle) * cfg.radius)
      // Hull's nose is +x: face the tangent of the orbit.
      root.rotation.set(0, -angle - Math.sign(cfg.speed) * Math.PI / 2, Math.sin(t * 0.4 + i) * 0.025)
      root.scale.setScalar(cfg.scale); root.updateMatrix()
      place(0, i, 0, 0, 0, 1.65, 0.64, 0.64)
      place(1, i * 2, 0, 0, 0, 2.4, 0.14, 1.22)
      place(1, i * 2 + 1, -0.85, 0.12, 0, 0.17, 0.92, 0.85)
      place(2, i * 8, 0.1, -0.8, 0, 0.95, 0.32, 0.48)
      place(2, i * 8 + 1, -1.5, 0.2, 0, 0.55, 0.75, 0.08)
      place(2, i * 8 + 2, -1.5, 0, 0, 0.55, 0.08, 0.85)
      place(2, i * 8 + 3, -0.25, -0.58, 0, 0.05, 0.3, 0.05)
      for (let k = 0; k < 4; k++) place(2, i * 8 + 4 + k, 0.67 + k % 2 * 0.28, 0.19, k < 2 ? 0.55 : -0.55, 0.09, 0.15, 0.045)
      place(3, i * 2, 0.1, -0.78, 0.25, 0.64, 0.12, 0.025)
      place(3, i * 2 + 1, 0.1, -0.78, -0.25, 0.64, 0.12, 0.025)
    }
    rig.meshes.forEach(mesh => { mesh.instanceMatrix.needsUpdate = true })
  })
  return <group>{rig.meshes.map(mesh => <primitive key={mesh.uuid} object={mesh} />)}</group>
}
