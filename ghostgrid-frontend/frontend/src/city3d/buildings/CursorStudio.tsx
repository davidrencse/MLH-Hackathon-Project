// Split editor studio: window shaft, dark tool rail, oversized pixel pointer and rooftop tabs.
// Geometry scales to its lot; materials and animation stay local to each building.
import { useFrame } from '@react-three/fiber'
import { useContext, useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { BuildingCtx } from '../BuildingCtx'
import { facadeCols, facadeRows, flatMat, PALETTE, signTexture, UNIT_BOX, useFacadeMaterial } from '../materials'

const PLANE = new THREE.PlaneGeometry(1, 1)
const POINTER = ['#.....', '##....', '###...', '####..', '#####.', '###...', '#.##..', '..##..']
const PIXELS = POINTER.flatMap((row, y) => [...row].flatMap((pixel, x) => pixel === '#' ? [{ x, y }] : []))

export function CursorStudio() {
  const { footprint, height: H, statusRef, offlineRef } = useContext(BuildingCtx)
  const W = footprint.w
  const D = footprint.d
  const facade = useFacadeMaterial({ cols: facadeCols(W * 0.7), rows: facadeRows(H - 0.36), seed: 81, tint: PALETTE.cyan })
  const { glow, sign } = useMemo(() => ({
    glow: new THREE.MeshBasicMaterial({ color: PALETTE.cyan, toneMapped: false }),
    sign: new THREE.MeshBasicMaterial({ map: signTexture('CURSOR', PALETTE.ink), toneMapped: false }),
  }), [])
  useEffect(() => () => {
    glow.dispose()
    sign.dispose()
  }, [glow, sign])

  useFrame(() => {
    const status = statusRef.current
    const offline = offlineRef.current && status === 'idle'
    glow.color.set(offline ? PALETTE.grey : status === 'working' ? PALETTE.green : status === 'error' ? PALETTE.red : status === 'needs_approval' ? PALETTE.yellow : PALETTE.cyan)
    glow.color.multiplyScalar(offline ? 0.4 : 1.6)
    sign.color.setScalar(offline ? 0.55 : 1.2)
  })

  const shaftW = W * 0.7
  const shaftD = D * 0.78
  const railX = -W * 0.4
  const panelZ = shaftD / 2 + 0.05
  const px = Math.min(W / 9, H / 22)
  const roof = flatMat(PALETTE.haze)
  const dark = flatMat(PALETTE.void)

  return (
    <group>
      <mesh geometry={UNIT_BOX} material={flatMat(PALETTE.dusk)} position={[0, 0.18, 0]} scale={[W, 0.36, D]} />
      <mesh geometry={UNIT_BOX} material={facade} position={[W * 0.08, H / 2, 0]} scale={[shaftW, H - 0.36, shaftD]} />
      {/* Narrow tool rail rises above the editor shaft, making the split silhouette. */}
      <mesh geometry={UNIT_BOX} material={dark} position={[railX, H / 2, 0]} scale={[W * 0.18, H, D * 0.9]} />
      <mesh geometry={UNIT_BOX} material={glow} position={[railX, H / 2, D * 0.45 + 0.01]} scale={[0.06, H - 0.4, 0.04]} />
      <mesh geometry={UNIT_BOX} material={roof} position={[W * 0.08, H - 0.1, 0]} scale={[shaftW + 0.08, 0.2, shaftD + 0.08]} />
      {/* Editor billboard: white-space around the pointer keeps it legible at pixel resolution. */}
      <mesh geometry={UNIT_BOX} material={dark} position={[W * 0.08, H * 0.58, panelZ]} scale={[px * 8, px * 10, 0.08]} />
      {PIXELS.map(({ x, y }) => (
        <mesh key={`${x}_${y}`} geometry={UNIT_BOX} material={glow}
          position={[W * 0.08 + (x - 2.5) * px, H * 0.58 + (3.5 - y) * px, panelZ + 0.05]}
          scale={[px * 0.94, px * 0.94, 0.03]} />
      ))}
      {/* Three roof tabs echo an editor's file tabs without adding another tall tower. */}
      {[0, 1, 2].map((tab) => (
        <mesh key={tab} geometry={UNIT_BOX} material={tab === 0 ? glow : roof}
          position={[W * 0.08 + (tab - 1) * shaftW / 3, H + 0.1, -D * 0.2]}
          scale={[shaftW / 3 - 0.06, 0.2, D * 0.25]} />
      ))}
      <mesh geometry={PLANE} material={sign} position={[0, 0.55, D / 2 + 0.015]} scale={[W * 0.88, 0.32, 1]} />
      <mesh geometry={UNIT_BOX} material={glow} position={[0, 0.35, D / 2 + 0.02]} scale={[W, 0.06, 0.04]} />
    </group>
  )
}
