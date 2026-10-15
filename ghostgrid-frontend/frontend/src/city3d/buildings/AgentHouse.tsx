// Personal agent house (Agent Row): the player's own agents — Grok Bot, Dots, Muse.
//
// Deliberately domestic next to the towers: a two-storey block with a stepped roof, a porch
// canopy, a garden strip and a big avatar board on the camera-facing wall showing the agent's
// 8x8 glyph. The glyph breathes while the agent is idle and flashes while it works, so the
// neighbourhood reads as "someone is home".
//
// Efficiency: UNIT_BOX everywhere, one InstancedMesh for the glyph pixels and one for the
// garden/fence props, matrices written once; animation only mutates materials in one useFrame.
import { useFrame } from '@react-three/fiber'
import { useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { personalAgentFor } from '../../agents/personal'
import { BuildingCtx } from '../BuildingCtx'
import { facadeCols, facadeRows, flatMat, PALETTE, signTexture, UNIT_BOX, useFacadeMaterial } from '../materials'

type Box = [x: number, y: number, z: number, sx: number, sy: number, sz: number]

const WALL = flatMat('#3b4a63')
const ROOF = flatMat('#2a3546')
const PORCH = flatMat('#51677b')
const HEDGE = flatMat('#2f5d4a')
const PLANE = new THREE.PlaneGeometry(1, 1)
const tmp = new THREE.Object3D()
const tmpColor = new THREE.Color()
const noRaycast = () => {}

const C_RED = new THREE.Color(PALETTE.red)
const C_GREEN = new THREE.Color(PALETTE.green)
const C_YELLOW = new THREE.Color(PALETTE.yellow)
const C_GREY = new THREE.Color(PALETTE.grey)

function writeBoxes(mesh: THREE.InstancedMesh, boxes: Box[]) {
  boxes.forEach(([x, y, z, sx, sy, sz], i) => {
    tmp.position.set(x, y, z)
    tmp.scale.set(sx, sy, sz)
    tmp.updateMatrix()
    mesh.setMatrixAt(i, tmp.matrix)
  })
  mesh.instanceMatrix.needsUpdate = true
  mesh.computeBoundingSphere()
}

export function AgentHouse() {
  const { footprint, height: H, building, statusRef, offlineRef } = useContext(BuildingCtx)
  const W = footprint.w
  const D = footprint.d
  const agent = personalAgentFor(building.id)
  const accent = agent?.accent ?? PALETTE.cyan

  const L = useMemo(() => {
    const bodyW = W * 0.78
    const bodyD = D * 0.78
    const bodyH = H * 0.72
    const roofH = H - bodyH

    // stepped roof: three shrinking slabs
    const roof: Box[] = []
    for (let i = 0; i < 3; i++) {
      const k = 1 - i * 0.22
      roof.push([0, bodyH + (roofH * (i + 0.5)) / 3, 0, bodyW * k + 0.12, roofH / 3, bodyD * k + 0.12])
    }

    // garden: hedges along the two street-facing edges + a path to the porch
    const garden: Box[] = []
    const gy = 0.12
    for (const t of [-0.34, 0, 0.34])
      garden.push(
        [t * bodyW, gy, bodyD / 2 + 0.45, bodyW * 0.22, 0.24, 0.18],
        [bodyW / 2 + 0.45, gy, t * bodyD, 0.18, 0.24, bodyD * 0.22],
      )

    // avatar board on the +z wall
    const board = Math.min(bodyW * 0.62, bodyH * 0.52)
    const px = board / 8
    const boardY = bodyH * 0.62

    const pixels: Box[] = []
    const rows = agent?.glyph ?? []
    rows.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) {
        if (row[c] !== '#') continue
        pixels.push([
          (c - 3.5) * px,
          boardY + (3.5 - r) * px,
          bodyD / 2 + 0.08,
          px * 0.92,
          px * 0.92,
          0.04,
        ])
      }
    })

    return { bodyW, bodyD, bodyH, roofH, roof, garden, board, boardY, pixels }
  }, [W, D, H, agent])

  const facade = useFacadeMaterial({
    cols: facadeCols(L.bodyW),
    rows: facadeRows(L.bodyH),
    seed: 701 + building.lot,
    wall: '#2b3850',
    tint: accent,
  })

  const fx = useMemo(
    () => ({
      glyph: new THREE.MeshBasicMaterial({ color: accent, toneMapped: false }),
      porchLight: new THREE.MeshBasicMaterial({ color: accent, toneMapped: false }),
      board: new THREE.MeshBasicMaterial({ color: '#0b1222' }),
      sign: new THREE.MeshBasicMaterial({ map: signTexture(agent?.short ?? 'AGENT', PALETTE.ink), toneMapped: false }),
    }),
    [accent, agent?.short],
  )
  useEffect(() => () => Object.values(fx).forEach((m) => m.dispose()), [fx])

  const pixelRef = useRef<THREE.InstancedMesh>(null)
  const roofRef = useRef<THREE.InstancedMesh>(null)
  const gardenRef = useRef<THREE.InstancedMesh>(null)

  useLayoutEffect(() => {
    if (pixelRef.current) writeBoxes(pixelRef.current, L.pixels)
    if (roofRef.current) writeBoxes(roofRef.current, L.roof)
    if (gardenRef.current) writeBoxes(gardenRef.current, L.garden)
  }, [L])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const status = statusRef.current
    const off = offlineRef.current && status === 'idle'
    let col = tmpColor.set(accent)
    let k = 1.6
    if (off) {
      col = tmpColor.copy(C_GREY)
      k = 0.4
    } else if (status === 'error') {
      col = tmpColor.copy(C_RED)
      k = Math.floor(t / 0.3) % 2 ? 2.4 : 0.4
    } else if (status === 'needs_approval') {
      col = tmpColor.copy(C_YELLOW)
      k = 1.2 + 0.8 * (Math.floor(t / 0.4) % 2)
    } else if (status === 'working') {
      col = tmpColor.copy(C_GREEN)
      k = Math.floor(t * 6) % 2 ? 2.8 : 1.3
    } else {
      // idle: the avatar breathes in slow pixel steps
      k = 1.3 + 0.5 * (Math.floor(t * 2) % 4 === 0 ? 1 : 0)
    }
    fx.glyph.color.copy(col).multiplyScalar(k)
    fx.porchLight.color.copy(col).multiplyScalar(k * 0.8)
    fx.sign.color.setScalar(off ? 0.5 : 1.4)
  })

  return (
    <group>
      {/* house body + stepped roof */}
      <mesh geometry={UNIT_BOX} material={flatMat('#30405a')} position={[0, 0.1, 0]} scale={[W, 0.2, D]} receiveShadow />
      <mesh
        geometry={UNIT_BOX}
        material={facade}
        position={[0, L.bodyH / 2 + 0.1, 0]}
        scale={[L.bodyW, L.bodyH, L.bodyD]}
        castShadow
        receiveShadow
      />
      <instancedMesh ref={roofRef} args={[UNIT_BOX, ROOF, L.roof.length]} castShadow />

      {/* porch canopy + light over the door */}
      <mesh geometry={UNIT_BOX} material={PORCH} position={[0, 0.95, L.bodyD / 2 + 0.22]} scale={[L.bodyW * 0.5, 0.09, 0.44]} castShadow />
      <mesh geometry={UNIT_BOX} material={WALL} position={[0, 0.5, L.bodyD / 2 + 0.03]} scale={[L.bodyW * 0.26, 0.8, 0.06]} />
      <mesh geometry={UNIT_BOX} material={fx.porchLight} position={[0, 0.88, L.bodyD / 2 + 0.42]} scale={[0.1, 0.1, 0.1]} raycast={noRaycast} />

      {/* avatar board: dark panel + the agent's glyph in its own accent */}
      <mesh geometry={UNIT_BOX} material={fx.board} position={[0, L.boardY, L.bodyD / 2 + 0.05]} scale={[L.board + 0.16, L.board + 0.16, 0.05]} />
      <instancedMesh ref={pixelRef} args={[UNIT_BOX, fx.glyph, Math.max(1, L.pixels.length)]} raycast={noRaycast} />
      <mesh
        geometry={PLANE}
        material={fx.sign}
        position={[0, L.boardY - L.board / 2 - 0.2, L.bodyD / 2 + 0.09]}
        scale={[L.board * 0.95, 0.24, 1]}
        raycast={noRaycast}
      />

      {/* garden hedges along the two street edges */}
      <instancedMesh ref={gardenRef} args={[UNIT_BOX, HEDGE, L.garden.length]} receiveShadow />
    </group>
  )
}
