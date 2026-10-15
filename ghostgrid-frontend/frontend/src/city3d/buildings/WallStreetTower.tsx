// Wall Street tower: one open-source quant trading project (see wallstreet/roster.ts).
//
// Art-deco setback skyscraper — three tiers stepping back to a stepped crown and a spire, with
// continuous vertical neon ribs running the full height (the thing that reads at map zoom), a
// scrolling ticker band at street level and an index board whose lit bars come from the
// repository's GitHub stars. The tower rises straight off the street: no podium, no plinth.
//
// Efficiency: all geometry is UNIT_BOX; repeated parts are 3 InstancedMeshes (ribs, crown steps,
// index bars) written once. Animation only mutates refs and materials inside one useFrame.
import { useFrame } from '@react-three/fiber'
import { useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { BuildingCtx } from '../BuildingCtx'
import { facadeCols, facadeRows, flatMat, getGlyphTexture, neonMat, PALETTE, signTexture, UNIT_BOX, useFacadeMaterial } from '../materials'

type Box = [x: number, y: number, z: number, sx: number, sy: number, sz: number]

// Limestone + bronze: Wall Street reads as stone against the neon of the core.
const STONE = flatMat('#8995ad')
const STONE_DARK = flatMat('#5a6880')
const BRONZE = flatMat('#8a6f3c')
const RIB_MAT = neonMat('#ffffff', 2.4) // tinted per instance
const BARS = 6 // index board rows

const tmp = new THREE.Object3D()
const tmpColor = new THREE.Color()
const noRaycast = () => {}
const PLANE = new THREE.PlaneGeometry(1, 1)

const C_RED = new THREE.Color(PALETTE.red)
const C_GREEN = new THREE.Color(PALETTE.green)
const C_YELLOW = new THREE.Color(PALETTE.yellow)
const C_GREY = new THREE.Color(PALETTE.grey)

/** Lit bars on the index board: one per order of magnitude of stars, 1..BARS. */
export function starBars(stars: number | undefined): number {
  if (!stars || stars <= 0) return 1
  return Math.max(1, Math.min(BARS, Math.round((Math.log10(stars) - 3) * 3)))
}

function writeBoxes(mesh: THREE.InstancedMesh, boxes: Box[]) {
  boxes.forEach(([x, y, z, sx, sy, sz], i) => {
    tmp.position.set(x, y, z)
    tmp.rotation.set(0, 0, 0)
    tmp.scale.set(sx, sy, sz)
    tmp.updateMatrix()
    mesh.setMatrixAt(i, tmp.matrix)
  })
  mesh.instanceMatrix.needsUpdate = true
  mesh.computeBoundingSphere()
}

export function WallStreetTower() {
  const { footprint, height: H, building, statusRef, offlineRef } = useContext(BuildingCtx)
  const W = footprint.w
  const D = footprint.d
  const repo = building?.repo
  const accent = repo?.accent ?? PALETTE.green
  const lit = starBars(repo?.stats?.stars)
  // No live GitHub read behind this tower → it stands dark, like an unlit exchange.
  const dark = !repo || repo.status === 'static'

  const L = useMemo(() => {
    // three setback tiers, straight off the street
    const t1 = { w: W * 0.94, d: D * 0.94, y1: H * 0.44 }
    const t2 = { w: W * 0.7, d: D * 0.7, y1: H * 0.74 }
    const t3 = { w: W * 0.48, d: D * 0.48, y1: H }
    const tiers = [t1, t2, t3]

    // Vertical ribs: the deco signature. They run the full height of each tier on the two faces
    // the camera sees, so the tower reads as a striped shaft even at full-map zoom.
    const ribs: Box[] = []
    const ribCount = 5
    const ribW = 0.14 // thin pilasters: wide ones turn the whole facade into a light panel
    let y0 = 0
    for (const t of tiers) {
      const h = t.y1 - y0
      for (let i = 0; i < ribCount; i++) {
        const f = (i + 0.5) / ribCount - 0.5
        ribs.push([f * t.w, y0 + h / 2, t.d / 2 + 0.04, ribW, h, 0.06])
        ribs.push([t.w / 2 + 0.04, y0 + h / 2, f * t.d, 0.06, h, ribW])
      }
      y0 = t.y1
    }

    // stepped crown: four shrinking slabs above the top tier, then the spire
    const crown: Box[] = []
    const steps = 3
    for (let i = 0; i < steps; i++) {
      const k = 1 - (i + 1) / (steps + 1.4)
      crown.push([0, H + 0.1 + i * 0.26, 0, t3.w * k, 0.26, t3.d * k])
    }
    const crownTop = H + 0.1 + steps * 0.26
    const spireH = Math.max(1.4, H * 0.18)

    // bronze cornice slab at every setback
    const cornices: Box[] = [
      [0, t1.y1 + 0.07, 0, t1.w + 0.18, 0.16, t1.d + 0.18],
      [0, t2.y1 + 0.07, 0, t2.w + 0.16, 0.14, t2.d + 0.16],
      [0, t3.y1 + 0.05, 0, t3.w + 0.14, 0.12, t3.d + 0.14],
    ]

    // index board on tier 2, bottom-aligned bars so it reads as a chart
    const boardW = t2.w * 0.84
    const barBase = t1.y1 + 0.55
    const barHeight = (i: number) => 0.22 + i * 0.19
    const boardH = barHeight(BARS - 1) + 0.26
    const bars: Box[] = []
    for (let i = 0; i < BARS; i++) {
      const h = barHeight(i)
      bars.push([
        -boardW / 2 + (boardW * (i + 0.5)) / BARS,
        barBase + h / 2,
        t2.d / 2 + 0.08,
        boardW / BARS - 0.07,
        h,
        0.06,
      ])
    }

    return {
      tiers, ribs, crown, cornices, bars,
      crownTop,
      spireH,
      boardW,
      barBase,
      boardH,
      bandY: Math.min(1.1, H * 0.1), // street-level ticker band
      t1, t2, t3,
    }
  }, [W, D, H])

  const fac1 = useFacadeMaterial({
    cols: facadeCols(L.t1.w),
    rows: facadeRows(L.t1.y1),
    seed: 311 + building.lot,
    wall: '#46516a',
    tint: accent,
  })
  const fac2 = useFacadeMaterial({
    cols: facadeCols(L.t2.w),
    rows: facadeRows(L.t2.y1 - L.t1.y1),
    seed: 331 + building.lot,
    wall: '#46516a',
    tint: accent,
  })
  const fac3 = useFacadeMaterial({
    cols: facadeCols(L.t3.w),
    rows: facadeRows(L.t3.y1 - L.t2.y1),
    seed: 351 + building.lot,
    wall: '#4e5873',
    tint: accent,
  })

  // ---- per-building materials (mutated in useFrame, disposed on unmount) ----
  const fx = useMemo(() => {
    const tape = getGlyphTexture().clone()
    tape.needsUpdate = true
    tape.wrapS = tape.wrapT = THREE.RepeatWrapping
    tape.repeat.set(3, 0.3)
    return {
      tape,
      ticker: new THREE.MeshBasicMaterial({ map: tape, color: new THREE.Color(accent), toneMapped: false }),
      bar: new THREE.MeshBasicMaterial({ color: accent, toneMapped: false }),
      beacon: new THREE.MeshBasicMaterial({ color: accent, toneMapped: false }),
      sign: new THREE.MeshBasicMaterial({ map: signTexture(repo?.ticker ?? 'QUANT', PALETTE.ink), toneMapped: false }),
      board: new THREE.MeshBasicMaterial({ color: '#0a1120' }),
      door: new THREE.MeshBasicMaterial({ color: new THREE.Color(accent).multiplyScalar(1.4), toneMapped: false }),
    }
  }, [accent, repo?.ticker])
  useEffect(() => () => Object.values(fx).forEach((m) => m.dispose()), [fx])

  const ribRef = useRef<THREE.InstancedMesh>(null)
  const crownRef = useRef<THREE.InstancedMesh>(null)
  const corniceRef = useRef<THREE.InstancedMesh>(null)
  const barRef = useRef<THREE.InstancedMesh>(null)

  useLayoutEffect(() => {
    if (crownRef.current) writeBoxes(crownRef.current, L.crown)
    if (corniceRef.current) writeBoxes(corniceRef.current, L.cornices)
    if (barRef.current) writeBoxes(barRef.current, L.bars)
    const ribs = ribRef.current
    if (ribs) {
      writeBoxes(ribs, L.ribs)
      for (let i = 0; i < L.ribs.length; i++) ribs.setColorAt(i, tmpColor.set(accent))
      if (ribs.instanceColor) ribs.instanceColor.needsUpdate = true
    }
  }, [L, accent])

  // Index bars: the lit ones are bright, the rest stay dim. The count only changes when the
  // backend payload lands, never per frame.
  useLayoutEffect(() => {
    const bars = barRef.current
    if (!bars) return
    for (let i = 0; i < BARS; i++)
      bars.setColorAt(i, tmpColor.set(i < lit ? '#ffffff' : '#2a3850').multiplyScalar(i < lit ? 1 : 0.5))
    if (bars.instanceColor) bars.instanceColor.needsUpdate = true
  }, [lit])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const status = statusRef.current
    const off = (offlineRef.current && status === 'idle') || dark

    // Ticker tape: scrolls in pixel steps, faster while working, frozen when the tower is dark.
    const speed = off ? 0 : status === 'working' ? 18 : status === 'error' ? 3 : 7
    if (speed > 0) fx.tape.offset.x = -(Math.floor(t * speed) % 64) / 64

    let col = tmpColor.set(accent)
    let k = 1.6
    if (off) {
      col = tmpColor.copy(C_GREY)
      k = 0.45
    } else if (status === 'error') {
      col = tmpColor.copy(C_RED)
      k = Math.floor(t / 0.3) % 2 ? 2.2 : 0.4
    } else if (status === 'needs_approval') {
      col = tmpColor.copy(C_YELLOW)
      k = 1.2 + 0.7 * (Math.floor(t / 0.4) % 2)
    } else if (status === 'working') {
      col = tmpColor.copy(C_GREEN)
      k = Math.floor(t * 6) % 2 ? 2.4 : 1.2
    }
    fx.ticker.color.copy(col).multiplyScalar(k * 1.6)
    fx.bar.color.copy(col).multiplyScalar(k)
    fx.door.color.copy(col).multiplyScalar(k * 0.9)
    // Spire beacon: slow blink, dead when the repository never resolved.
    fx.beacon.color.copy(col).multiplyScalar(off ? 0.3 : Math.floor(t / 0.8) % 2 ? 0.5 : 3)
    fx.sign.color.setScalar(off ? 0.5 : 1.5)
  })

  const tierMesh = (tier: { w: number; d: number; y1: number }, y0: number, mat: THREE.Material, key: string) => (
    <mesh
      key={key}
      geometry={UNIT_BOX}
      material={mat}
      position={[0, (y0 + tier.y1) / 2, 0]}
      scale={[tier.w, tier.y1 - y0, tier.d]}
      castShadow
      receiveShadow
    />
  )

  return (
    <group>
      {/* three setback tiers, straight off the street */}
      {tierMesh(L.t1, 0, fac1, 't1')}
      {tierMesh(L.t2, L.t1.y1, fac2, 't2')}
      {tierMesh(L.t3, L.t2.y1, fac3, 't3')}

      {/* dark stone band at street level + lit entrance on the camera-facing wall */}
      <mesh geometry={UNIT_BOX} material={STONE_DARK} position={[0, L.bandY / 2, 0]} scale={[L.t1.w + 0.08, L.bandY, L.t1.d + 0.08]} receiveShadow />
      <mesh geometry={UNIT_BOX} material={fx.door} position={[0, L.bandY * 0.45, L.t1.d / 2 + 0.07]} scale={[L.t1.w * 0.3, L.bandY * 0.7, 0.05]} />
      <mesh geometry={UNIT_BOX} material={fx.door} position={[L.t1.w / 2 + 0.07, L.bandY * 0.45, 0]} scale={[0.05, L.bandY * 0.7, L.t1.d * 0.3]} />

      {/* scrolling ticker tape above the entrance, on both camera-facing walls */}
      <mesh geometry={PLANE} material={fx.ticker} position={[0, L.bandY + 0.2, L.t1.d / 2 + 0.08]} scale={[L.t1.w * 0.96, 0.26, 1]} raycast={noRaycast} />
      <mesh
        geometry={PLANE}
        material={fx.ticker}
        position={[L.t1.w / 2 + 0.08, L.bandY + 0.2, 0]}
        rotation={[0, Math.PI / 2, 0]}
        scale={[L.t1.d * 0.96, 0.26, 1]}
        raycast={noRaycast}
      />

      {/* vertical neon ribs + bronze cornices at every setback */}
      <instancedMesh ref={ribRef} args={[UNIT_BOX, RIB_MAT, L.ribs.length]} raycast={noRaycast} />
      <instancedMesh ref={corniceRef} args={[UNIT_BOX, BRONZE, L.cornices.length]} castShadow />

      {/* index board: dark panel + bars driven by the repository's stars */}
      <mesh
        geometry={UNIT_BOX}
        material={fx.board}
        position={[0, L.barBase + L.boardH / 2 - 0.1, L.t2.d / 2 + 0.05]}
        scale={[L.boardW + 0.16, L.boardH + 0.42, 0.05]}
      />
      <instancedMesh ref={barRef} args={[UNIT_BOX, fx.bar, BARS]} raycast={noRaycast} />
      <mesh geometry={PLANE} material={fx.sign} position={[0, L.barBase - 0.22, L.t2.d / 2 + 0.09]} scale={[L.boardW * 0.9, 0.28, 1]} raycast={noRaycast} />

      {/* stepped crown + spire */}
      <instancedMesh ref={crownRef} args={[UNIT_BOX, STONE, L.crown.length]} castShadow />
      <mesh geometry={UNIT_BOX} material={BRONZE} position={[0, L.crownTop + L.spireH / 2, 0]} scale={[0.12, L.spireH, 0.12]} />
      <mesh geometry={UNIT_BOX} material={fx.beacon} position={[0, L.crownTop + L.spireH + 0.14, 0]} scale={[0.2, 0.2, 0.2]} raycast={noRaycast} />
    </group>
  )
}
