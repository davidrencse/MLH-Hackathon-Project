// Wraps every 3D building: places it on its lot, handles hover/click, and draws the shared
// status visuals (roof beacon, approval "!", error shake, selection frame, name label).
// Building art components only draw geometry; they read BuildingCtx for size and status.
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import * as THREE from 'three'
import { openLibrarySite } from '../api/config'
import { useGrid } from '../store/grid'
import { useIsOffline } from '../store/keys'
import type { Building } from '../types'
import { BuildingCtx } from './BuildingCtx'
import { removeLabelAnchor, setLabelAnchor } from './Labels'
import { neonMat, PALETTE, signTexture, STATUS_EMISSIVE, UNIT_BOX } from './materials'
import { BUILDING_HEIGHT, lotCenter, lotFootprint } from './world'

const BEACON_MATS = Object.fromEntries(Object.entries(STATUS_EMISSIVE).map(([k, c]) => [k, neonMat(c, 3)]))
const DARK_MAT = new THREE.MeshBasicMaterial({ color: '#1a1040' })
const FRAME_MAT = neonMat(PALETTE.pink, 2.2)
// Fake shadow (no real-time shadow maps): a dark quad stretched away from the moon light.
const SHADOW_MAT = new THREE.MeshBasicMaterial({ color: '#05030f', transparent: true, opacity: 0.55, depthWrite: false })
const PLANE = new THREE.PlaneGeometry(1, 1)
const SHADOW_YAW = Math.atan2(0.614, 0.789) // moon at (-9,16,7) → shadow falls toward (+0.79, −0.61)
const HOVER_MAT = neonMat(PALETTE.cyan, 1.4)

function ApprovalMarker({ y }: { y: number }) {
  const ref = useRef<THREE.Sprite>(null)
  const mat = useMemo(() => new THREE.SpriteMaterial({ map: signTexture('!', '#0b0820', PALETTE.yellow), toneMapped: false }), [])
  useFrame(({ clock }) => {
    if (ref.current) ref.current.position.y = y + (Math.floor(clock.elapsedTime / 0.4) % 2) * 0.15
  })
  return <sprite ref={ref} material={mat} position={[0, y, 0]} scale={[0.9, 0.9, 1]} />
}

export function BuildingShell({ building, children }: { building: Building; children: ReactNode }) {
  const navigate = useNavigate()
  const offline = useIsOffline(building.id)
  const selected = useGrid((s) => s.selected === building.id)
  const [hovered, setHovered] = useState(false)

  const statusRef = useRef(building.status)
  const offlineRef = useRef(offline)
  const selectedRef = useRef(selected)
  const hoveredRef = useRef(hovered)
  statusRef.current = building.status
  offlineRef.current = offline
  selectedRef.current = selected
  hoveredRef.current = hovered

  const inner = useRef<THREE.Group>(null)
  const beacon = useRef<THREE.Mesh>(null)
  const [x, , z] = lotCenter(building.lot)
  const footprint = lotFootprint(building.lot)
  const height = BUILDING_HEIGHT[building.type]

  const ctx = useMemo(
    () => ({ building, footprint, height, statusRef, offlineRef, selectedRef, hoveredRef }),
    // footprint is derived from lot; building object identity changes when it updates
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [building, height],
  )

  // name plate anchor (rendered as DOM by Labels.tsx)
  useEffect(() => {
    setLabelAnchor(building.id, x, height + 1.35, z)
    return () => removeLabelAnchor(building.id)
  }, [building.id, x, z, height])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const status = statusRef.current
    if (inner.current) {
      // error shake: ±0.05 world units, steps(3)
      inner.current.position.x = status === 'error' ? ((Math.floor(t * 18) % 3) - 1) * 0.05 : 0
    }
    if (beacon.current) {
      const key = offlineRef.current && status === 'idle' ? 'offline' : status
      const blinkOff = (status === 'error' && Math.floor(t / 0.3) % 2 === 1) || (status === 'idle' && Math.floor(t / 1.2) % 2 === 1)
      beacon.current.material = blinkOff ? DARK_MAT : BEACON_MATS[key]
    }
  })

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (building.type === 'router') return
    if (useGrid.getState().buildMode) return
    // Clicking the Library opens the hosted Library of Babel web app instead of a panel.
    if (building.type === 'library') {
      openLibrarySite()
      return
    }
    if (building.type === 'codex' || building.type === 'claude') {
      navigate(`/office/${encodeURIComponent(building.id)}`)
      return
    }
    useGrid.getState().selectBuilding(building.id)
  }
  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    if (building.type === 'router') return
    setHovered(true)
    document.body.style.cursor = 'pointer'
  }
  const onOut = () => {
    setHovered(false)
    document.body.style.cursor = ''
  }

  const fw = footprint.w + 0.3
  const fd = footprint.d + 0.3
  const frameMat = selected ? FRAME_MAT : HOVER_MAT
  const showFrame = selected || hovered

  return (
    <group position={[x, 0, z]}>
      <group ref={inner} onClick={onClick} onPointerOver={onOver} onPointerOut={onOut}>
        <BuildingCtx.Provider value={ctx}>{children}</BuildingCtx.Provider>
      </group>

      {/* fake shadow: footprint + a streak away from the light, length ∝ height */}
      <group rotation-y={SHADOW_YAW} position={[0, 0.07, 0]}>
        <mesh
          geometry={PLANE}
          material={SHADOW_MAT}
          rotation-x={-Math.PI / 2}
          position={[(height * 0.5) / 2, 0, 0]}
          scale={[Math.max(footprint.w, footprint.d) + height * 0.5, Math.min(footprint.w, footprint.d) * 0.9, 1]}
          renderOrder={1}
        />
      </group>

      {/* roof beacon */}
      <mesh ref={beacon} geometry={UNIT_BOX} position={[0, height + 0.25, 0]} scale={[0.22, 0.22, 0.22]} />

      {building.status === 'needs_approval' && <ApprovalMarker y={height + 2.1} />}

      {showFrame && (
        <group position={[0, 0.03, 0]}>
          <mesh geometry={UNIT_BOX} material={frameMat} position={[0, 0, -fd / 2]} scale={[fw, 0.04, 0.08]} />
          <mesh geometry={UNIT_BOX} material={frameMat} position={[0, 0, fd / 2]} scale={[fw, 0.04, 0.08]} />
          <mesh geometry={UNIT_BOX} material={frameMat} position={[-fw / 2, 0, 0]} scale={[0.08, 0.04, fd]} />
          <mesh geometry={UNIT_BOX} material={frameMat} position={[fw / 2, 0, 0]} scale={[0.08, 0.04, fd]} />
        </group>
      )}

    </group>
  )
}
