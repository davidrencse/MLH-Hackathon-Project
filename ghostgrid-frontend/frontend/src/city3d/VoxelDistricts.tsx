import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import { usePlots } from './OuterDistricts'
import { removeLabelAnchor, setLabelAnchor, setLabelElement } from './Labels'
import { flatMat, UNIT_BOX } from './materials'
import { MAP, ROAD_INDEXES } from './world'
import { Scenery } from './scenery/Scenery'
import { PocketNeighborhoods } from './PocketNeighborhood'

const NAMES = ['Neo-Kowloon', 'Silicon Stacks', 'GPU Docks', 'Prompt Alley', 'Token Heights', 'Latent District', 'Eval Yards', 'Agent Row']
const OFFSETS: [number, number][] = []
for (const x of [-1, 0, 1]) for (const z of [-1, 0, 1]) if (x || z) OFFSETS.push([x * (MAP.size + 1.2), z * (MAP.size + 1.2)])
const BASE = flatMat('#14293c'), OPEN_BASE = flatMat('#293e53')
const GRID = new THREE.MeshBasicMaterial({ color: '#2b5066' })
const ROAD = flatMat('#0c1b2b')

function Rise({ children }: { children: ReactNode }) {
  const group = useRef<THREE.Group>(null), progress = useRef(0)
  useFrame((_, dt) => {
    if (!group.current || progress.current >= 1) return
    progress.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : Math.min(1, progress.current + dt / 1.2)
    group.current.scale.y = Math.max(.001, 1 - (1 - progress.current) ** 3)
  })
  return <group ref={group} scale={[1, .001, 1]}>{children}</group>
}

function PlotGrid() {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    if (!ref.current) return
    const m = new THREE.Matrix4(); let i = 0
    for (const [x, z] of OFFSETS) for (const offset of [-12, -6, 0, 6, 12]) {
      ref.current.setMatrixAt(i++, m.makeScale(.03, .01, MAP.size).setPosition(x + offset, .025, z))
      ref.current.setMatrixAt(i++, m.makeScale(MAP.size, .01, .03).setPosition(x, .025, z + offset))
    }
    ref.current.instanceMatrix.needsUpdate = true
    ref.current.computeBoundingSphere()
  }, [])
  return <instancedMesh ref={ref} args={[UNIT_BOX, GRID, OFFSETS.length * 10]} raycast={() => null} />
}

export function VoxelDistricts() {
  const open = usePlots((s) => s.open)
  const openPlot = usePlots((s) => s.openPlot)
  const districts = useMemo(() => OFFSETS.flatMap(([x, z], seed) => open.includes(seed) ? [] : [{ x, z, seed }]), [open])
  return <group>
    <PocketNeighborhoods districts={districts} />
    <PlotGrid />
    {OFFSETS.map(([x, z], k) => <group key={k} position={[x, 0, z]}>
      <mesh geometry={UNIT_BOX} material={open.includes(k) ? OPEN_BASE : BASE} position={[0, -.17, 0]} scale={[MAP.size, .34, MAP.size]}
        onClick={(event) => { event.stopPropagation(); if (!open.includes(k)) openPlot(k) }} />
      {open.includes(k) ? <>
        {ROAD_INDEXES.map((i) => <group key={i}>
          <mesh geometry={UNIT_BOX} material={ROAD} position={[0, .04, i + .5 - MAP.size / 2]} scale={[MAP.size, .08, 1]} raycast={() => null} />
          <mesh geometry={UNIT_BOX} material={ROAD} position={[i + .5 - MAP.size / 2, .04, 0]} scale={[1, .08, MAP.size]} raycast={() => null} />
        </group>)}
        <Rise><Scenery /></Rise>
      </> : null}
    </group>)}
  </group>
}

// Plot buttons are plain DOM driven by the shared label projector: no per-button React root
// (drei <Html> unmounted its roots mid-render) and the projector hides them off-screen and
// under the HUD panels instead of letting them draw half-covered.
export function PlotLabels() {
  const open = usePlots((s) => s.open)
  const openPlot = usePlots((s) => s.openPlot)
  const closed = useMemo(() => OFFSETS.map((offset, k) => ({ offset, k })).filter(({ k }) => !open.includes(k)), [open])
  useEffect(() => {
    for (const { offset: [x, z], k } of closed) setLabelAnchor(`plot:${k}`, x, 4, z)
    return () => { for (const { k } of closed) removeLabelAnchor(`plot:${k}`) }
  }, [closed])
  return <div className="pointer-events-none absolute inset-0 z-[11] overflow-hidden">
    {closed.map(({ k }) => (
      <button
        key={k}
        type="button"
        ref={(el) => setLabelElement(`plot:${k}`, el)}
        data-anchor="center"
        style={{ visibility: 'hidden' }}
        className="gg-voxel-plot pointer-events-auto absolute left-0 top-0"
        aria-label={`Open plot: ${NAMES[k]}`}
        onClick={() => openPlot(k)}
      ><span>＋ OPEN PLOT</span><small>{NAMES[k]}</small></button>
    ))}
  </div>
}
