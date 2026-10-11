// 3x3 city: eight extra skyline districts around the interactive center island (~9x area).
// Decorative only (no raycast). Undo: remove <OuterDistricts/> from CityCanvas.tsx.
import * as THREE from 'three'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { create } from 'zustand'

// Which outer plots the player has opened (persisted so the city stays expanded on reload).
const KEY = 'gg-open-plots'
export const usePlots = create<{ open: number[]; openPlot: (k: number) => void; reset: () => void }>((set) => ({
  open: JSON.parse(localStorage.getItem(KEY) ?? '[]'),
  openPlot: (k) => set((s) => { const open = [...new Set([...s.open, k])]; localStorage.setItem(KEY, JSON.stringify(open)); return { open } }),
  reset: () => { localStorage.removeItem(KEY); set({ open: [] }) },
}))
const NAMES = ['NEO-KOWLOON', 'SILICON STACKS', 'GPU DOCKS', 'PROMPT ALLEY', 'TOKEN HEIGHTS', 'LATENT DISTRICT', 'EVAL YARDS', 'AGENT ROW']
const LOCKED = new THREE.MeshLambertMaterial({ color: '#08061a', transparent: true, opacity: 0.85 })
const GRIDLINE = new THREE.MeshBasicMaterial({ color: '#3a2f6b', toneMapped: false })
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
      <Rise><Scenery /></Rise>
    </group>
  )
}

// New districts grow out of the ground over ~1.2s.
function Rise({ children }: { children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null)
  const t = useRef(0)
  useFrame((_, dt) => {
    if (!g.current || t.current >= 1) return
    t.current = Math.min(1, t.current + dt / 1.2)
    const e = 1 - Math.pow(1 - t.current, 3)
    g.current.scale.set(1, Math.max(0.001, e), 1)
  })
  return <group ref={g} scale={[1, 0.001, 1]}>{children}</group>
}

function LockedPlot({ dx, dz, k }: { dx: number; dz: number; k: number }) {
  const openPlot = usePlots((s) => s.openPlot)
  return (
    <group position={[dx, 0, dz]}>
      <mesh geometry={BOX} material={LOCKED} position={[0, -0.15, 0]} scale={[S, 0.3, S]} onClick={(e) => { e.stopPropagation(); openPlot(k) }}
        onPointerOver={() => (document.body.style.cursor = 'pointer')} onPointerOut={() => (document.body.style.cursor = '')} />
      {[-12, -6, 0, 6, 12].map((o) => (
        <group key={o}>
          <mesh geometry={BOX} material={GRIDLINE} position={[o, 0.01, 0]} scale={[0.05, 0.02, S]} raycast={() => null} />
          <mesh geometry={BOX} material={GRIDLINE} position={[0, 0.01, o]} scale={[S, 0.02, 0.05]} raycast={() => null} />
        </group>
      ))}
      <Html position={[0, 1, 0]} center zIndexRange={[20, 0]}>
        <button onClick={() => openPlot(k)} style={{ font: "11px/1.4 'Press Start 2P', monospace", background: '#ffec27', color: '#111', border: '2px solid #111', boxShadow: '4px 4px 0 #111', padding: '10px 14px', cursor: 'pointer', whiteSpace: 'nowrap', textAlign: 'center' }}>
          ＋ OPEN PLOT<br /><span style={{ fontSize: 8 }}>{NAMES[k]}</span>
        </button>
      </Html>
    </group>
  )
}

export function OuterDistricts() {
  const open = usePlots((s) => s.open)
  return <group>{OFFSETS.map(([dx, dz], k) => open.includes(k)
    ? <District key={k} dx={dx} dz={dz} k={k} />
    : <LockedPlot key={k} dx={dx} dz={dz} k={k} />)}</group>
}
