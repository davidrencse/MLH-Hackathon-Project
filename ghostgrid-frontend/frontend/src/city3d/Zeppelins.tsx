// Three low-poly cyberpunk zeppelins slowly circling the city. Low segment counts + flat
// shading so they read as chunky pixel-art once the canvas is upscaled. No extra lights:
// glow comes from emissive materials only (keeps the 3-light budget in CityCanvas).
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'

const hullGeo = new THREE.SphereGeometry(1, 8, 6)
const gondolaGeo = new THREE.BoxGeometry(0.9, 0.35, 0.4)
const finGeo = new THREE.BoxGeometry(0.5, 0.6, 0.06)
const stripeGeo = new THREE.BoxGeometry(2.6, 0.12, 1.05)
const screenGeo = new THREE.PlaneGeometry(1.7, 0.55)
const edgeGeo = new THREE.EdgesGeometry(hullGeo)
const beamGeo = new THREE.ConeGeometry(1.1, 6, 6, 1, true)
const lightGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12)

const hullMat = new THREE.MeshLambertMaterial({ color: '#6a5cc4', flatShading: true })
const darkMat = new THREE.MeshLambertMaterial({ color: '#15102e', flatShading: true })

type Cfg = { radius: number; height: number; speed: number; phase: number; color: string; cx: number; cz: number }
const ZEPPS: Cfg[] = [
  { radius: 7, height: 9, speed: 0.06, phase: 0, color: '#ff2e97', cx: 0, cz: 0 },
  { radius: 11, height: 10.5, speed: -0.045, phase: 2.1, color: '#00f0ff', cx: 1, cz: -1 },
  { radius: 14, height: 8, speed: 0.035, phase: 4.2, color: '#ffd23f', cx: -1, cz: 1 },
]

function Zeppelin({ cfg }: { cfg: Cfg }) {
  const ref = useRef<THREE.Group>(null)
  const blink = useRef<THREE.Mesh>(null)
  const glow = useMemo(
    () => new THREE.MeshBasicMaterial({ color: cfg.color, toneMapped: false }),
    [cfg.color],
  )
  const screen = useMemo(
    () => new THREE.MeshBasicMaterial({ color: cfg.color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, toneMapped: false }),
    [cfg.color],
  )
  useFrame(({ clock }) => {
    const g = ref.current
    if (!g) return
    const t = clock.elapsedTime * cfg.speed + cfg.phase
    const x = cfg.cx + Math.cos(t) * cfg.radius
    const z = cfg.cz + Math.sin(t) * cfg.radius
    g.position.set(x, cfg.height + Math.sin(clock.elapsedTime * 0.8 + cfg.phase) * 0.25, z)
    // face direction of travel (tangent)
    const dir = Math.sign(cfg.speed)
    g.rotation.y = -t - (dir * Math.PI) / 2
    g.rotation.z = Math.sin(clock.elapsedTime * 0.6 + cfg.phase) * 0.04
    if (blink.current) blink.current.visible = Math.floor(clock.elapsedTime * 2 + cfg.phase) % 2 === 0
    screen.opacity = 0.6 + 0.3 * Math.abs(Math.sin(clock.elapsedTime * 3 + cfg.phase))
  })
  return (
    <group ref={ref} scale={2.2}>
      <mesh geometry={hullGeo} material={hullMat} scale={[1.6, 0.55, 0.55]} />
      <lineSegments geometry={edgeGeo} scale={[1.62, 0.57, 0.57]}>
        <lineBasicMaterial color={cfg.color} toneMapped={false} />
      </lineSegments>
      <mesh geometry={stripeGeo} material={glow} position={[0, -0.05, 0]} />
      <mesh geometry={stripeGeo} material={glow} position={[0, 0.22, 0]} scale={[0.85, 0.6, 0.95]} />
      <mesh geometry={beamGeo} position={[0.1, -3.8, 0]}>
        <meshBasicMaterial color={cfg.color} transparent opacity={0.13} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh geometry={screenGeo} material={screen} position={[0, 0.05, 0.56]} />
      <mesh geometry={screenGeo} material={screen} position={[0, 0.05, -0.56]} rotation={[0, Math.PI, 0]} />
      <mesh geometry={gondolaGeo} material={darkMat} position={[0.1, -0.62, 0]} />
      <mesh geometry={lightGeo} material={glow} position={[0.1, -0.82, 0]} />
      <mesh geometry={finGeo} material={darkMat} position={[-1.55, 0.25, 0]} />
      <mesh geometry={finGeo} material={darkMat} position={[-1.55, -0.2, 0]} rotation={[0, 0, Math.PI]} />
      <mesh geometry={finGeo} material={darkMat} position={[-1.55, 0, 0]} rotation={[Math.PI / 2, 0, 0]} />
      <mesh ref={blink} geometry={lightGeo} material={glow} position={[1.62, 0, 0]} />
    </group>
  )
}

export function Zeppelins() {
  return (
    <>
      {ZEPPS.map((c, i) => (
        <Zeppelin key={i} cfg={c} />
      ))}
    </>
  )
}
