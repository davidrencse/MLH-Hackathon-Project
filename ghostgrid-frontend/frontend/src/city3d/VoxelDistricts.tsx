// The eight outer plates of the 3x3 city grid. Locked, a plate is a flat surveyed lot with an
// OPEN PLOT button; opened, it grows roads, a filler city and nine leasable super-blocks
// (OUTER_LOTS in world.ts), which is what turns the background into places the player can build.
//
// The lots themselves are not drawn here: lotCenter() already returns world coordinates with the
// plate offset applied, so Ground's lease pads, CityBuildings and the labels find them without
// knowing plates exist. This file owns the ground under them.
import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import { usePlots } from '../store/plots'
import { removeLabelAnchor, setLabelAnchor, setLabelElement } from './Labels'
import { flatMat, UNIT_BOX } from './materials'
import { CORE_NAME, MAP, OUTER_LOTS, PLOT_NAMES, PLOT_OFFSETS, ROAD_INDEXES, WALL_ST_PLOT } from './world'
import { CURB } from './ground/layout'
import { Scenery } from './scenery/Scenery'
import { PocketNeighborhoods } from './PocketNeighborhood'

const BASE = flatMat('#14293c'), OPEN_BASE = flatMat('#293e53')
const GRID = new THREE.MeshBasicMaterial({ color: '#2b5066' })
const ROAD = flatMat('#0c1b2b')
const PAD = flatMat('#1c3448')
const RIM = new THREE.MeshBasicMaterial({ color: '#42e8ed', toneMapped: false })

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
    for (const [x, z] of PLOT_OFFSETS) for (const offset of [-12, -6, 0, 6, 12]) {
      ref.current.setMatrixAt(i++, m.makeScale(.03, .01, MAP.size).setPosition(x + offset, .025, z))
      ref.current.setMatrixAt(i++, m.makeScale(MAP.size, .01, .03).setPosition(x, .025, z + offset))
    }
    ref.current.instanceMatrix.needsUpdate = true
    ref.current.computeBoundingSphere()
  }, [])
  return <instancedMesh ref={ref} args={[UNIT_BOX, GRID, PLOT_OFFSETS.length * 10]} raycast={() => null} />
}

// Plate decor — roads, rim and lease pads — as three InstancedMeshes covering EVERY open plate,
// rather than ~25 little meshes per plate.
//
// Measured: VoxelDistricts was 630 of the city's 641 draw calls. Each open plate drew 12 road
// strips, 4 rim bars and 9 lease pads as individual meshes, so nine plates cost ~230 draws for
// geometry that is the same box nine times over. Instancing them is three draws for the lot,
// whatever the player has opened, and the geometry is identical.
//
// Built only from OPEN plates, so a closed plate contributes nothing and opening one rebuilds
// the three buffers once.
interface Decor { p: [number, number, number]; s: [number, number, number] }

function plateDecor(open: readonly number[]) {
  const half = MAP.size / 2
  const roads: Decor[] = []
  const rim: Decor[] = []
  const pads: Decor[] = []
  for (const k of open) {
    const offset = PLOT_OFFSETS[k]
    if (!offset) continue
    const [ox, oz] = offset
    for (const i of ROAD_INDEXES) {
      roads.push({ p: [ox, 0.04, oz + i + 0.5 - half], s: [MAP.size, 0.08, 1] })
      roads.push({ p: [ox + i + 0.5 - half, 0.04, oz], s: [1, 0.08, MAP.size] })
    }
    for (const [x, z, w, d] of [[0, half, MAP.size, 0.08], [0, -half, MAP.size, 0.08],
                                [half, 0, 0.08, MAP.size], [-half, 0, 0.08, MAP.size]] as const) {
      rim.push({ p: [ox + x, 0.03, oz + z], s: [w, 0.06, d] })
    }
    // Lease pads come from the lots a plate actually carries: the Wall St plate's blocks belong
    // to the trading district, so OUTER_LOTS skips it and it advertises no pads.
    for (const l of OUTER_LOTS) {
      if (l.plot !== k) continue
      pads.push({ p: [ox + l.tx + l.w / 2 - half, CURB / 2, oz + l.tz + l.d / 2 - half], s: [l.w, CURB, l.d] })
    }
  }
  return { roads, rim, pads }
}

function DecorInst({ parts, material }: { parts: Decor[]; material: THREE.Material }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const o = new THREE.Object3D()
    parts.forEach((part, i) => {
      o.position.set(...part.p)
      o.scale.set(...part.s)
      o.updateMatrix()
      mesh.setMatrixAt(i, o.matrix)
    })
    mesh.count = parts.length
    mesh.instanceMatrix.needsUpdate = true
    // Static geometry with a real bounding sphere, so three can cull the whole lot when the
    // camera is framed on the core island.
    mesh.computeBoundingSphere()
  }, [parts])
  return <instancedMesh ref={ref} args={[UNIT_BOX, material, Math.max(1, parts.length)]} raycast={() => null} />
}

function PlateDecor({ open }: { open: readonly number[] }) {
  const parts = useMemo(() => plateDecor(open), [open])
  return <group>
    <DecorInst parts={parts.roads} material={ROAD} />
    <DecorInst parts={parts.rim} material={RIM} />
    <DecorInst parts={parts.pads} material={PAD} />
  </group>
}

export function VoxelDistricts() {
  const open = usePlots((s) => s.open)
  const openPlot = usePlots((s) => s.openPlot)
  const districts = useMemo(
    () => PLOT_OFFSETS.flatMap(([x, z], seed) => (open.includes(seed) ? [] : [{ x, z, seed }])),
    [open],
  )
  return <group>
    <PocketNeighborhoods districts={districts} />
    <PlotGrid />
    <PlateDecor open={open} />
    {PLOT_OFFSETS.map(([x, z], k) => <group key={k} position={[x, 0, z]}>
      <mesh geometry={UNIT_BOX} material={open.includes(k) ? OPEN_BASE : BASE} position={[0, -.17, 0]} scale={[MAP.size, .34, MAP.size]}
        onClick={(event) => { event.stopPropagation(); if (!open.includes(k)) openPlot(k) }}
        onPointerOver={() => { if (!open.includes(k)) document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { document.body.style.cursor = '' }} />
      {open.includes(k) && (
        /* Roads, rim and pads are drawn once for every plate by <PlateDecor/> below. */
        <Rise><Scenery variant={k === WALL_ST_PLOT ? 'wallst' : 'outer'} /></Rise>
      )}
    </group>)}
  </group>
}

// Plot buttons and district nameplates are plain DOM driven by the shared label projector: no
// per-button React root (drei <Html> unmounted its roots mid-render) and the projector hides them
// off-screen and under the HUD panels instead of letting them draw half-covered.
//
// A closed plate gets the OPEN PLOT button, which carries its name. An open one gets a nameplate
// instead, and the core island gets one too, so all nine cells of the grid stay labelled — the
// button only names a plate while it is still shut.
export function PlotLabels() {
  const open = usePlots((s) => s.open)
  const openPlot = usePlots((s) => s.openPlot)
  const closed = useMemo(() => PLOT_OFFSETS.map((offset, k) => ({ offset, k })).filter(({ k }) => !open.includes(k)), [open])
  // Anchored over each plate's near corner rather than its centre: the centre is where the
  // Router Spire and the tallest towers are, and a plate is 34 units wide, so the corner reads
  // as that plate's own sign instead of floating over whatever is tallest.
  const named = useMemo(
    () => [
      { id: 'name:core', label: CORE_NAME, x: 0, z: 0, core: true },
      ...PLOT_OFFSETS.flatMap(([x, z], k) =>
        open.includes(k) ? [{ id: `name:${k}`, label: PLOT_NAMES[k], x, z, core: false }] : [],
      ),
    ],
    [open],
  )
  useEffect(() => {
    for (const { offset: [x, z], k } of closed) setLabelAnchor(`plot:${k}`, x, 4, z)
    return () => { for (const { k } of closed) removeLabelAnchor(`plot:${k}`) }
  }, [closed])
  useEffect(() => {
    for (const n of named) setLabelAnchor(n.id, n.x + 13, 4.5, n.z + 13)
    return () => { for (const n of named) removeLabelAnchor(n.id) }
  }, [named])
  return <div className="pointer-events-none absolute inset-0 z-[11] overflow-hidden">
    {closed.map(({ k }) => (
      <button
        key={k}
        type="button"
        ref={(el) => setLabelElement(`plot:${k}`, el)}
        data-anchor="center"
        style={{ visibility: 'hidden' }}
        className="gg-voxel-plot pointer-events-auto absolute left-0 top-0"
        aria-label={`Open plot: ${PLOT_NAMES[k]}`}
        onClick={() => openPlot(k)}
      ><span>＋ OPEN PLOT</span><small>{PLOT_NAMES[k]}</small></button>
    ))}
    {named.map((n) => (
      <div
        key={n.id}
        ref={(el) => setLabelElement(n.id, el)}
        data-anchor="center"
        data-core={n.core || undefined}
        style={{ visibility: 'hidden' }}
        className="gg-plot-name absolute left-0 top-0"
      >{n.label}</div>
    ))}
  </div>
}
