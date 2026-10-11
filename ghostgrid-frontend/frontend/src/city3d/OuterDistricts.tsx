// 3x3 city: eight extra skyline districts around the interactive center island (~9x area).
// Decorative only (no raycast). Undo: remove <OuterDistricts/> from CityCanvas.tsx.
import * as THREE from 'three'
import { MAP, ROAD_INDEXES } from './world'
import { Scenery } from './scenery/Scenery'

const S = MAP.size
const GAP = 1.2 // canal between districts
const SLAB = new THREE.MeshLambertMaterial({ color: '#0c0920' })
const ROAD = new THREE.MeshBasicMaterial({ color: '#16112e' })
const RIM = new THREE.MeshBasicMaterial({ color: '#ff2e97', toneMapped: false })
const RIM2 = new THREE.MeshBasicMaterial({ color: '#00f0ff', toneMapped: false })
const BOX = new THREE.BoxGeometry(1, 1, 1)
const OFFSETS: [number, number][] = []
for (const i of [-1, 0, 1]) for (const j of [-1, 0, 1]) if (i || j) OFFSETS.push([i * (S + GAP), j * (S + GAP)])

function District({ dx, dz, k }: { dx: number; dz: number; k: number }) {
  const rim = k % 2 ? RIM : RIM2
  return (
    <group position={[dx, 0, dz]}>
      <mesh geometry={BOX} material={SLAB} position={[0, -0.15, 0]} scale={[S, 0.3, S]} raycast={() => null} />
      {ROAD_INDEXES.map((i) => (
        <group key={i}>
          <mesh geometry={BOX} material={ROAD} position={[0, 0.005, i + 0.5 - S / 2]} scale={[S, 0.01, 1]} raycast={() => null} />
          <mesh geometry={BOX} material={ROAD} position={[i + 0.5 - S / 2, 0.005, 0]} scale={[1, 0.01, S]} raycast={() => null} />
        </group>
      ))}
      {[[0, S / 2, S, 0.08], [0, -S / 2, S, 0.08], [S / 2, 0, 0.08, S], [-S / 2, 0, 0.08, S]].map(([x, z, w, d], i) => (
        <mesh key={i} geometry={BOX} material={rim} position={[x, 0.02, z]} scale={[w, 0.06, d]} raycast={() => null} />
      ))}
      <Scenery />
    </group>
  )
}

export function OuterDistricts() {
  return <group>{OFFSETS.map(([dx, dz], k) => <District key={k} dx={dx} dz={dz} k={k} />)}</group>
}
