// Cyberpunk "megastructure" dressing drawn around every building: neon corner pylons, glowing
// floor rings, setback crown, antenna mast with a blinking tip, and a side holo-billboard.
// Emissive-only (no lights). Remove <Megastructure/> in BuildingShell to undo.
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { UNIT_BOX } from './materials'

const COLORS = ['#ff2e97', '#00f0ff', '#ffd23f', '#9b5cff', '#00ff9c']
const DARK = new THREE.MeshLambertMaterial({ color: '#1b1438', flatShading: true })
const matCache = new Map<string, THREE.MeshBasicMaterial>()
const glow = (c: string, o = 1) => {
  const k = c + o
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshBasicMaterial({ color: c, toneMapped: false, transparent: o < 1, opacity: o, depthWrite: o >= 1 }))
  return matCache.get(k)!
}

export function Megastructure({ w, d, h, seed }: { w: number; d: number; h: number; seed: number }) {
  const c = COLORS[seed % COLORS.length]
  const c2 = COLORS[(seed + 2) % COLORS.length]
  const tip = useRef<THREE.Mesh>(null)
  const holo = useRef<THREE.Mesh>(null)
  const rings = useMemo(() => {
    const out: number[] = []
    for (let y = 1.1; y < h - 0.3; y += 1.25) out.push(y)
    return out
  }, [h])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (tip.current) tip.current.visible = Math.floor(t * 1.5 + seed) % 2 === 0
    if (holo.current) (holo.current.material as THREE.MeshBasicMaterial).opacity = 0.45 + 0.35 * Math.abs(Math.sin(t * 2 + seed))
  })
  const hw = w / 2 + 0.04
  const hd = d / 2 + 0.04
  const crownH = Math.max(0.8, h * 0.18)
  const mast = Math.max(1.2, h * 0.35)
  return (
    <group>
      {/* corner neon pylons */}
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
        <mesh key={i} geometry={UNIT_BOX} material={glow(c)} position={[sx * hw, h / 2, sz * hd]} scale={[0.07, h, 0.07]} />
      ))}
      {/* floor rings */}
      {rings.map((y, i) => (
        <group key={i} position={[0, y, 0]}>
          <mesh geometry={UNIT_BOX} material={glow(i % 2 ? c2 : c)} position={[0, 0, hd]} scale={[w + 0.1, 0.05, 0.05]} />
          <mesh geometry={UNIT_BOX} material={glow(i % 2 ? c2 : c)} position={[0, 0, -hd]} scale={[w + 0.1, 0.05, 0.05]} />
          <mesh geometry={UNIT_BOX} material={glow(i % 2 ? c2 : c)} position={[hw, 0, 0]} scale={[0.05, 0.05, d + 0.1]} />
          <mesh geometry={UNIT_BOX} material={glow(i % 2 ? c2 : c)} position={[-hw, 0, 0]} scale={[0.05, 0.05, d + 0.1]} />
        </group>
      ))}
      {/* setback crown + mast */}
      <mesh geometry={UNIT_BOX} material={DARK} position={[0, h + crownH / 2, 0]} scale={[w * 0.62, crownH, d * 0.62]} />
      <mesh geometry={UNIT_BOX} material={glow(c2)} position={[0, h + crownH, 0]} scale={[w * 0.66, 0.06, d * 0.66]} />
      <mesh geometry={UNIT_BOX} material={DARK} position={[0, h + crownH + mast / 2, 0]} scale={[0.08, mast, 0.08]} />
      <mesh ref={tip} geometry={UNIT_BOX} material={glow('#ff004d')} position={[0, h + crownH + mast + 0.08, 0]} scale={[0.18, 0.18, 0.18]} />
      {/* side holo billboard */}
      <mesh ref={holo} geometry={UNIT_BOX} material={glow(c, 0.7).clone()} position={[hw + 0.12, h * 0.62, 0]} scale={[0.04, Math.min(1.6, h * 0.3), d * 0.7]} />
    </group>
  )
}
