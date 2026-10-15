// Holographic "FOR LEASE" pads on empty buildable lots.
// Always: dim dashed outline. Build mode: pulsing cyan/pink outline + translucent holo volume,
// hover highlights + label, click places the building. 2 InstancedMeshes (+1 Html label on hover).
import { Html } from '@react-three/drei/web/Html'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { toast } from 'sonner'
import { CATALOG } from '../../constants'
import { useGrid, useOccupiedLots } from '../../store/grid'
import { usePlots } from '../../store/plots'
import { PALETTE, UNIT_BOX } from '../materials'
import { BUILDABLE_LOTS, leasableLots, lotCenter, lotFootprint } from '../world'
import { CURB } from './layout'

const DASHES = 4 // dashes per side
const PER_LOT = DASHES * 4 + 2 // outline dashes + the "+" glyph
const HOLO_H = 0.5

function LeaseLabel({ lot }: { lot: number }) {
  const mode = useGrid((s) => s.buildMode)
  const credits = useGrid((s) => s.credits)
  // A fixed portal target stops drei <Html> from re-creating its root when R3F connects events.
  const gl = useThree((s) => s.gl)
  const portal = useMemo(() => ({ current: gl.domElement.parentElement as HTMLElement }), [gl])
  if (!mode) return null
  const entry = CATALOG[mode.type]
  const ok = credits >= entry.cost
  const [x, , z] = lotCenter(lot)
  return (
    <Html portal={portal} position={[x, 1.3, z]} center zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
      <div
        className="font-pixel whitespace-nowrap border-2 px-1.5 py-1 text-[8px] leading-none"
        style={{
          color: PALETTE.ink,
          borderColor: ok ? PALETTE.cyan : PALETTE.red,
          background: 'rgba(11,8,32,0.9)',
          boxShadow: '2px 2px 0 rgba(0,0,0,.6)',
        }}
      >
        <div>LOT {lot} · FOR LEASE</div>
        <div className="mt-1" style={{ color: ok ? PALETTE.green : PALETTE.red }}>
          {ok ? `BUILD ${(mode.name || entry.label).toUpperCase()} · ${entry.cost} BP` : `NEED ${entry.cost} BP`}
        </div>
      </div>
    </Html>
  )
}

export function LeasePads({ glow }: { glow: THREE.Material }) {
  const buildMode = useGrid((s) => !!s.buildMode)
  const occupied = useOccupiedLots()
  // Lots on an unopened outer plate have no ground yet, so they get no pad: leasableLots()
  // is the core island plus the plates the player has grown (store/plots.ts).
  const openPlots = usePlots((s) => s.open)
  const empty = useMemo(() => leasableLots(openPlots).filter((l) => !occupied.includes(l)), [occupied, openPlots])

  const dashRef = useRef<THREE.InstancedMesh>(null)
  const holoRef = useRef<THREE.InstancedMesh>(null)
  const emptyRef = useRef(empty)
  const onRef = useRef(buildMode)
  const hoverRef = useRef<number | null>(null)
  const dirty = useRef(true)
  const [hover, setHover] = useState<number | null>(null)

  const holoMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  )
  useEffect(
    () => () => {
      holoMat.dispose()
      document.body.style.cursor = ''
    },
    [holoMat],
  )
  const col = useMemo(() => new THREE.Color(), [])

  useEffect(() => {
    onRef.current = buildMode
    dirty.current = true
    if (!buildMode) {
      hoverRef.current = null
      setHover(null)
      document.body.style.cursor = ''
    }
  }, [buildMode])

  // matrices only change when a lot gets built on / freed
  useLayoutEffect(() => {
    const m = dashRef.current
    const h = holoRef.current
    if (!m || !h) return
    emptyRef.current = empty
    const o = new THREE.Object3D()
    const dim = new THREE.Color(PALETTE.cyan).multiplyScalar(0.45)
    const put = (i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
      o.position.set(x, y, z)
      o.scale.set(sx, sy, sz)
      o.updateMatrix()
      m.setMatrixAt(i, o.matrix)
      m.setColorAt(i, dim)
    }
    empty.forEach((lot, k) => {
      const [x, , z] = lotCenter(lot)
      const f = lotFootprint(lot)
      const W = f.w + 0.2
      const D = f.d + 0.2
      const y = CURB + 0.03
      let i = k * PER_LOT
      for (let j = 0; j < DASHES; j++) {
        const t = (j + 0.5) / DASHES - 0.5
        put(i++, x + t * W, y, z - D / 2, (W / DASHES) * 0.62, 0.06, 0.1)
        put(i++, x + t * W, y, z + D / 2, (W / DASHES) * 0.62, 0.06, 0.1)
        put(i++, x - W / 2, y, z + t * D, 0.1, 0.06, (D / DASHES) * 0.62)
        put(i++, x + W / 2, y, z + t * D, 0.1, 0.06, (D / DASHES) * 0.62)
      }
      put(i++, x, y, z, 0.5, 0.06, 0.12)
      put(i++, x, y, z, 0.12, 0.06, 0.5)
      o.position.set(x, CURB + HOLO_H / 2, z)
      o.scale.set(W, HOLO_H, D)
      o.updateMatrix()
      h.setMatrixAt(k, o.matrix)
      h.setColorAt(k, dim)
    })
    m.count = empty.length * PER_LOT
    h.count = empty.length
    m.instanceMatrix.needsUpdate = true
    h.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    if (h.instanceColor) h.instanceColor.needsUpdate = true
    m.computeBoundingSphere()
    h.computeBoundingSphere()
    dirty.current = true
  }, [empty])

  // colors: rewritten every frame only while build mode is on; once when it turns off
  useFrame(({ clock }) => {
    const m = dashRef.current
    const h = holoRef.current
    if (!m || !h) return
    const on = onRef.current
    if (!on && !dirty.current) return
    dirty.current = false
    const step = Math.floor(clock.elapsedTime / 0.4) % 2
    emptyRef.current.forEach((lot, k) => {
      const hovered = on && hoverRef.current === lot
      if (!on) col.set(PALETTE.cyan).multiplyScalar(0.45)
      else if (hovered) col.set(PALETTE.yellow).multiplyScalar(2.6)
      else col.set((k + step) % 2 ? PALETTE.pink : PALETTE.cyan).multiplyScalar(1.3 + 0.9 * step)
      for (let i = k * PER_LOT; i < (k + 1) * PER_LOT; i++) m.setColorAt(i, col)
      h.setColorAt(k, col.multiplyScalar(hovered ? 0.6 : 0.4))
    })
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    if (h.instanceColor) h.instanceColor.needsUpdate = true
  })

  const lotOf = (e: ThreeEvent<MouseEvent | PointerEvent>) =>
    e.instanceId === undefined ? null : (emptyRef.current[e.instanceId] ?? null)

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    const lot = lotOf(e)
    if (lot !== hoverRef.current) {
      hoverRef.current = lot
      setHover(lot)
    }
    document.body.style.cursor = lot === null ? '' : 'pointer'
  }
  const onOut = () => {
    hoverRef.current = null
    setHover(null)
    document.body.style.cursor = ''
  }
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    const lot = lotOf(e)
    const s = useGrid.getState()
    if (lot === null || !s.buildMode) return
    const entry = CATALOG[s.buildMode.type]
    const name = s.buildMode.name || entry.label
    const id = s.placeBuilding(lot)
    if (id) toast.success(`Built ${useGrid.getState().buildings[id]?.name ?? name} on lot ${lot}`)
    else if (s.credits < entry.cost) toast.error(`Not enough build points: ${name} needs ${entry.cost} BP`)
    else toast.error(`Lot ${lot} is not available`)
  }

  return (
    <>
      <instancedMesh ref={dashRef} args={[UNIT_BOX, glow, BUILDABLE_LOTS.length * PER_LOT]} frustumCulled={false} />
      <instancedMesh
        ref={holoRef}
        args={[UNIT_BOX, holoMat, BUILDABLE_LOTS.length]}
        visible={buildMode}
        frustumCulled={false}
        renderOrder={2}
        onPointerMove={buildMode ? onMove : undefined}
        onPointerOut={buildMode ? onOut : undefined}
        onClick={buildMode ? onClick : undefined}
      />
      {buildMode && hover !== null && <LeaseLabel lot={hover} />}
    </>
  )
}
