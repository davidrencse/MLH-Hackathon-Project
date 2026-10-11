import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useReducedMotion } from 'framer-motion'
import * as THREE from 'three'
import type { OfficeWorker } from '@/api/backend'
import { DESK_COMMANDS } from './deskCommands'

const BOX = new THREE.BoxGeometry(1, 1, 1)
const MATERIALS = new Map<string, THREE.MeshLambertMaterial>()
function material(color: string) {
  if (!MATERIALS.has(color)) MATERIALS.set(color, new THREE.MeshLambertMaterial({ color, flatShading: true }))
  return MATERIALS.get(color)!
}
function Block({ position, size, color }: { position: [number, number, number]; size: [number, number, number]; color: string }) {
  return <mesh geometry={BOX} material={material(color)} position={position} scale={size} castShadow receiveShadow />
}

function Camera({ width, depth }: { width: number; depth: number }) {
  const { camera, size } = useThree()
  useLayoutEffect(() => {
    camera.position.set(18, 18, 18)
    camera.lookAt(0, 0.7, 0)
    if (camera instanceof THREE.OrthographicCamera) {
      camera.zoom = Math.min(size.width / ((width + depth) * 0.72), size.height / ((width + depth) * 0.42 + 4)) * 0.88
      camera.updateProjectionMatrix()
    }
  }, [camera, size.width, size.height, width, depth])
  return null
}

function Person({ color, host = false, typing = false }: { color: string; host?: boolean; typing?: boolean }) {
  const hands = useRef<THREE.Group>(null)
  const head = useRef<THREE.Group>(null)
  const reduce = useReducedMotion()
  useFrame(({ clock }) => {
    if (!typing || reduce) return
    const tick = Math.floor(clock.elapsedTime * 8)
    if (hands.current) hands.current.rotation.x = tick % 2 ? 0.12 : -0.08
    if (head.current) head.current.rotation.z = Math.sin(Math.floor(tick / 4) * 0.6) * 0.06
  })
  return <group position={[0, host ? 0 : 0.1, 0]}>
    <Block color="#3f3655" position={[-0.14, 0.22, 0]} size={[0.22, 0.4, 0.24]} />
    <Block color="#3f3655" position={[0.14, 0.22, 0]} size={[0.22, 0.4, 0.24]} />
    <Block color="#211b31" position={[-0.14, 0.08, 0.06]} size={[0.26, 0.12, 0.36]} />
    <Block color="#211b31" position={[0.14, 0.08, 0.06]} size={[0.26, 0.12, 0.36]} />
    <Block color={color} position={[0, 0.62, 0]} size={[0.52, 0.48, 0.32]} />
    <Block color={color} position={[-0.34, 0.62, 0.05]} size={[0.18, 0.36, 0.24]} />
    <Block color={color} position={[0.34, 0.62, 0.05]} size={[0.18, 0.36, 0.24]} />
    <group ref={hands} position={[0, 0.62, 0.12]}>
      <Block color="#ffd0a9" position={[-0.3, 0, 0.12]} size={[0.16, 0.12, 0.28]} />
      <Block color="#ffd0a9" position={[0.3, 0, 0.12]} size={[0.16, 0.12, 0.28]} />
    </group>
    <group ref={head} position={[0, 1.02, 0]}>
      <Block color="#ffd0a9" position={[0, 0, 0]} size={[0.46, 0.42, 0.4]} />
      <Block color={host ? '#c38a63' : '#563b47'} position={[0, 0.22, -0.02]} size={[0.5, 0.16, 0.44]} />
      <Block color="#241b30" position={[-0.1, 0.02, 0.21]} size={[0.06, 0.06, 0.02]} />
      <Block color="#241b30" position={[0.1, 0.02, 0.21]} size={[0.06, 0.06, 0.02]} />
      <Block color="#db8c86" position={[0, -0.08, 0.21]} size={[0.1, 0.04, 0.02]} />
    </group>
  </group>
}

const SCREEN = new THREE.PlaneGeometry(1, 1)
function TerminalScreen({ worker, accent }: { worker: OfficeWorker; accent: string }) {
  const reduce = useReducedMotion()
  const screen = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 80
    const texture = new THREE.CanvasTexture(canvas)
    texture.magFilter = texture.minFilter = THREE.NearestFilter
    texture.generateMipmaps = false
    texture.colorSpace = THREE.SRGBColorSpace
    const mat = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
    return { canvas, texture, mat, phase: -1, blink: -1 }
  }, [])
  useEffect(() => () => { screen.texture.dispose(); screen.mat.dispose() }, [screen])
  const offset = useMemo(() => [...worker.id].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 6, [worker.id])
  useFrame(({ clock }) => {
    const phase = reduce ? 0 : (Math.floor(clock.elapsedTime / 1.8) + offset) % 6
    const blink = reduce ? 1 : Math.floor(clock.elapsedTime * 2) % 2
    if (screen.phase === phase && screen.blink === blink) return
    screen.phase = phase; screen.blink = blink
    const context = screen.canvas.getContext('2d')!
    context.fillStyle = '#10282b'; context.fillRect(0, 0, 128, 80)
    context.font = '12px monospace'
    const commands = DESK_COMMANDS[worker.runtime]
    for (let row = 0; row < 4; row++) {
      context.fillStyle = row === 3 ? accent : '#87b6a5'
      context.fillText(commands[(phase + row + 3) % commands.length].replace('…', '...'), 5, 14 + row * 16)
    }
    if (blink) { context.fillStyle = accent; context.fillRect(5, 72, 8, 3) }
    screen.texture.needsUpdate = true
  })
  return <mesh geometry={SCREEN} material={screen.mat} position={[0, 1.48, -0.405]} scale={[0.82, 0.48, 1]} />
}

function Plant({ x, z }: { x: number; z: number }) {
  return <group position={[x, 0, z]}>
    <Block color="#c38275" position={[0, 0.24, 0]} size={[0.48, 0.48, 0.48]} />
    <Block color="#537c59" position={[0, 0.65, 0]} size={[0.1, 0.65, 0.1]} />
    <Block color="#81b38a" position={[-0.18, 0.9, 0]} size={[0.4, 0.26, 0.3]} />
    <Block color="#6d9d79" position={[0.16, 0.76, 0.1]} size={[0.4, 0.26, 0.3]} />
    <Block color="#9ac196" position={[0, 1.1, -0.12]} size={[0.3, 0.3, 0.3]} />
  </group>
}

function Desk({ worker, x, z, selected, accent, onSelect }: {
  worker?: OfficeWorker; x: number; z: number; selected: boolean; accent: string; onSelect: (id: string) => void
}) {
  const screen = worker ? worker.runtime.includes('browser') ? '#9bc6d0' : accent : '#433a59'
  return <group position={[x, 0, z]} onClick={(event) => { if (worker) { event.stopPropagation(); onSelect(worker.id) } }}>
    {selected && <Block color={accent} position={[0, 0.04, 0.1]} size={[2.7, 0.05, 2.4]} />}
    <Block color="#b89083" position={[0, 1, -0.25]} size={[2.2, 0.18, 1.1]} />
    {[-0.86, 0.86].map((x) => <Block key={x} color="#72566d" position={[x, 0.48, -0.25]} size={[0.16, 0.96, 0.7]} />)}
    <Block color="#59506c" position={[0, 1.48, -0.53]} size={[0.96, 0.62, 0.14]} />
    <Block color="#132c30" position={[0, 1.48, -0.44]} size={[0.82, 0.48, 0.04]} />
    {!worker && [0, 1, 2].map((line) => <Block key={line} color={screen} position={[-0.08 + line * 0.05, 1.59 - line * 0.12, -0.41]} size={[0.5 - line * 0.08, 0.04, 0.02]} />)}
    {worker && <TerminalScreen worker={worker} accent={accent} />}
    <Block color="#59506c" position={[0, 1.17, -0.53]} size={[0.12, 0.24, 0.12]} />
    <Block color="#d6c4c5" position={[0, 1.13, 0.01]} size={[0.66, 0.05, 0.26]} />
    <Block color="#e4d9b7" position={[0.78, 1.18, -0.18]} size={[0.18, 0.22, 0.18]} />
    <Block color="#706389" position={[0, 0.4, 0.8]} size={[0.64, 0.16, 0.64]} />
    <Block color="#706389" position={[0, 0.71, 1.04]} size={[0.64, 0.58, 0.16]} />
    <Block color="#3e344f" position={[0, 0.2, 0.8]} size={[0.12, 0.4, 0.12]} />
    {worker && <group position={[0, 0.18, 0.66]} rotation-y={-Math.PI / 4}><Person color={accent} typing /></group>}
  </group>
}

export function OfficeRoom3D({ workers, accent, selected, onSelect }: { workers: OfficeWorker[]; accent: string; selected: string | null; onSelect: (id: string) => void }) {
  const count = Math.max(3, workers.length + (workers.length < 12 ? 1 : 0))
  const columns = Math.min(3, count)
  const rows = Math.ceil(count / columns)
  const width = columns * 3.3 + 2
  const depth = rows * 3.2 + 3.2
  return <div className="native-room-canvas" aria-label="3D isometric office; select a worker using their desk or the buttons below">
    <Canvas orthographic camera={{ position: [18, 18, 18], near: 0.1, far: 100 }} dpr={0.5} shadows gl={{ antialias: false }}>
      <Camera width={width} depth={depth} />
      <OrbitControls target={[0, 0.7, 0]} enablePan={false} enableDamping={false}
        minPolarAngle={0.65} maxPolarAngle={1.1} minAzimuthAngle={0.25} maxAzimuthAngle={1.35}
        minZoom={12} maxZoom={160} />
      <color attach="background" args={['#161026']} />
      <ambientLight intensity={1.4} />
      <directionalLight position={[4, 12, 8]} intensity={2} color="#ffe4c2" castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={12} shadow-camera-bottom={-12} shadow-bias={-0.001} />
      <Block color="#473751" position={[0, -0.22, 0]} size={[width, 0.44, depth]} />
      {Array.from({ length: Math.ceil(depth / 0.5) }, (_, i) => <Block key={i} color={i % 2 ? '#937276' : '#85666f'} position={[0, 0.025, -depth / 2 + i * 0.5 + 0.25]} size={[width - 0.08, 0.05, 0.48]} />)}
      <Block color="#6c536f" position={[-width / 2, 1.65, 0]} size={[0.18, 3.3, depth]} />
      <Block color="#79607e" position={[0, 1.65, -depth / 2]} size={[width, 3.3, 0.18]} />
      <Block color="#b49ca0" position={[-width / 2 + 0.12, 0.15, 0]} size={[0.12, 0.3, depth]} />
      <Block color="#b49ca0" position={[0, 0.15, -depth / 2 + 0.12]} size={[width, 0.3, 0.12]} />
      {/* Cutaway back wall: two night windows, wooden frames and a little moon. */}
      {[-width * 0.22, width * 0.2].map((x) => <group key={x} position={[x, 2, -depth / 2 + 0.14]}>
        <Block color="#c0a79e" position={[0, 0, 0]} size={[2.2, 1.7, 0.12]} />
        <Block color="#222b4c" position={[0, 0, 0.08]} size={[1.96, 1.46, 0.04]} />
        <Block color="#f2dfac" position={[0.55, 0.34, 0.12]} size={[0.3, 0.3, 0.03]} />
        <Block color="#c0a79e" position={[0, 0, 0.14]} size={[0.08, 1.5, 0.06]} />
        <Block color="#c0a79e" position={[0, 0, 0.14]} size={[2, 0.08, 0.06]} />
        <Block color="#c0a79e" position={[0, -0.86, 0.2]} size={[2.4, 0.12, 0.4]} />
      </group>)}
      {/* Small bookcase tucked against the side wall. */}
      {[0.7, 1.4, 2.1].map((y) => <group key={y}>
        <Block color="#c19382" position={[-width / 2 + 0.45, y, -depth / 2 + 1.25]} size={[0.7, 0.12, 1.7]} />
        {[0, 1, 2, 3, 4].map((i) => <Block key={i} color={['#91b9a6', '#d3a380', '#ad98c0'][i % 3]} position={[-width / 2 + 0.4, y + 0.27, -depth / 2 + 0.65 + i * 0.28]} size={[0.36, 0.45, 0.2]} />)}
      </group>)}
      <Plant x={width / 2 - 0.8} z={-depth / 2 + 0.8} />
      <Plant x={-width / 2 + 0.6} z={depth / 2 - 0.6} />
      <group position={[width / 2 - 0.8, 0, depth / 2 - 0.6]}><Person color="#e2a197" host /></group>
      {Array.from({ length: count }, (_, i) => <Desk key={workers[i]?.id ?? `empty_${i}`} worker={workers[i]}
        x={(i % columns - (columns - 1) / 2) * 3.3} z={Math.floor(i / columns) * 3.2 - depth / 2 + 2.3}
        selected={selected === workers[i]?.id} accent={accent} onSelect={onSelect} />)}
    </Canvas>
  </div>
}
