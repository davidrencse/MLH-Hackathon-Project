// Tiny 8-bit citizens that wander the roads. Grab one (press + drag), fling it, and it yells "OUCH!" on landing.
import { Html } from '@react-three/drei'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { ROADS } from './ground/layout'

const COUNT = 36
const SHIRTS = ['#ff004d', '#29adff', '#00e436', '#ffec27', '#ff77a8', '#ffa300', '#83769c']
const SKIN = ['#ffccaa', '#e0a37a', '#ab5236', '#7e4a2e']
const body = new THREE.BoxGeometry(0.16, 0.2, 0.12)
const head = new THREE.BoxGeometry(0.13, 0.13, 0.13)
const leg = new THREE.BoxGeometry(0.06, 0.12, 0.06)
const legMat = new THREE.MeshLambertMaterial({ color: '#1d2b53', flatShading: true })
const G = 18
const GROUND = 0.12
const ROAD_LEN = 15

function sayOuch() {
  try {
    const u = new SpeechSynthesisUtterance(Math.random() < 0.5 ? 'Ouch!' : 'Ow!')
    u.pitch = 1.6 + Math.random() * 0.4
    u.rate = 1.3
    window.speechSynthesis.speak(u)
  } catch {
    /* no speech */
  }
}

type State = 'walk' | 'held' | 'fly'
function Citizen({ seed }: { seed: number }) {
  const ref = useRef<THREE.Group>(null)
  const legs = useRef<THREE.Mesh[]>([])
  const { camera, controls, gl } = useThree() as unknown as {
    camera: THREE.Camera
    controls: { enabled: boolean } | null
    gl: THREE.WebGLRenderer
  }
  const [ouch, setOuch] = useState(0)
  const r = (n: number) => {
    const x = Math.sin(seed * 9301 + n * 49297) * 233280
    return x - Math.floor(x)
  }
  const mats = useMemo(
    () => ({
      shirt: new THREE.MeshLambertMaterial({ color: SHIRTS[seed % SHIRTS.length], flatShading: true }),
      skin: new THREE.MeshLambertMaterial({ color: SKIN[seed % SKIN.length], flatShading: true }),
    }),
    [seed],
  )
  const s = useRef({
    mode: 'walk' as State,
    alongX: r(1) < 0.5,
    lane: ROADS[Math.floor(r(2) * ROADS.length)] + (r(3) - 0.5) * 0.6,
    t: (r(4) - 0.5) * 2 * ROAD_LEN,
    dir: r(5) < 0.5 ? 1 : -1,
    speed: 0.6 + r(6) * 0.8,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    last: new THREE.Vector3(),
    spin: 0,
  })
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.2), [])
  const ray = useMemo(() => new THREE.Raycaster(), [])
  const ndc = useMemo(() => new THREE.Vector2(), [])
  const hit = useMemo(() => new THREE.Vector3(), [])

  const onMove = (e: PointerEvent) => {
    const st = s.current
    if (st.mode !== 'held') return
    const rect = gl.domElement.getBoundingClientRect()
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
    ray.setFromCamera(ndc, camera)
    if (ray.ray.intersectPlane(plane, hit)) st.pos.copy(hit)
  }
  const onUp = () => {
    const st = s.current
    if (st.mode !== 'held') return
    st.mode = 'fly'
    st.vel.y = Math.max(st.vel.y, 4)
    st.spin = (Math.random() - 0.5) * 20
    if (controls) controls.enabled = true
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    const st = s.current
    st.mode = 'held'
    st.last.copy(st.pos)
    if (controls) controls.enabled = false
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  useFrame(({ clock }, dt) => {
    const g = ref.current
    if (!g) return
    dt = Math.min(dt, 0.05)
    const st = s.current
    if (st.mode === 'walk') {
      st.t += st.dir * st.speed * dt
      if (Math.abs(st.t) > ROAD_LEN) st.dir *= -1
      if (st.alongX) st.pos.set(st.t, GROUND, st.lane)
      else st.pos.set(st.lane, GROUND, st.t)
      const yaw = st.alongX ? (st.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : st.dir > 0 ? 0 : Math.PI
      g.rotation.set(0, yaw, 0)
      const k = Math.floor(clock.elapsedTime * 8 + seed) % 2 ? 0.5 : -0.5
      legs.current.forEach((m, i) => m && (m.rotation.x = i ? k : -k))
    } else if (st.mode === 'held') {
      st.vel.copy(st.pos).sub(st.last).divideScalar(Math.max(dt, 0.001)).clampLength(0, 25)
      st.last.copy(st.pos)
      g.rotation.z = Math.sin(clock.elapsedTime * 20) * 0.4
      legs.current.forEach((m, i) => m && (m.rotation.x = Math.sin(clock.elapsedTime * 25 + i * 3)))
    } else {
      st.vel.y -= G * dt
      st.pos.addScaledVector(st.vel, dt)
      g.rotation.x += st.spin * dt
      if (st.pos.y <= GROUND) {
        st.pos.y = GROUND
        st.mode = 'walk'
        if (st.alongX) {
          st.t = THREE.MathUtils.clamp(st.pos.x, -ROAD_LEN, ROAD_LEN)
          st.lane = st.pos.z
        } else {
          st.t = THREE.MathUtils.clamp(st.pos.z, -ROAD_LEN, ROAD_LEN)
          st.lane = st.pos.x
        }
        setOuch((n) => n + 1)
        sayOuch()
      }
    }
    g.position.copy(st.pos)
  })

  return (
    <group ref={ref} onPointerDown={onDown} onPointerOver={() => (document.body.style.cursor = 'grab')} onPointerOut={() => (document.body.style.cursor = '')}>
      <mesh geometry={leg} material={legMat} position={[-0.04, 0.06, 0]} ref={(m) => m && (legs.current[0] = m)} />
      <mesh geometry={leg} material={legMat} position={[0.04, 0.06, 0]} ref={(m) => m && (legs.current[1] = m)} />
      <mesh geometry={body} material={mats.shirt} position={[0, 0.22, 0]} />
      <mesh geometry={head} material={mats.skin} position={[0, 0.39, 0]} />
      {/* bigger invisible hitbox so tiny people are easy to grab */}
      <mesh position={[0, 0.25, 0]}>
        <boxGeometry args={[0.45, 0.6, 0.45]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {ouch > 0 && <Ouch key={ouch} />}
    </group>
  )
}

function Ouch() {
  const [show, setShow] = useState(true)
  useMemo(() => setTimeout(() => setShow(false), 1100), [])
  if (!show) return null
  return (
    <Html position={[0, 0.8, 0]} center style={{ pointerEvents: 'none' }}>
      <div style={{ font: "12px 'Press Start 2P', monospace", color: '#fff', background: '#ff004d', padding: '4px 6px', boxShadow: '3px 3px 0 #000', whiteSpace: 'nowrap' }}>
        OUCH!
      </div>
    </Html>
  )
}

export function Citizens() {
  return (
    <>
      {Array.from({ length: COUNT }, (_, i) => (
        <Citizen key={i} seed={i + 1} />
      ))}
    </>
  )
}
