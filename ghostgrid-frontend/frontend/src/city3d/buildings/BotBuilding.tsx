// Custom Bot building (player-built, 2x2 lot). The main roof slab ends exactly at `height`
// so drones and the shell's beacon line up. Look is parametric by building.bot:
//  - shared base: plinth → windowed module → overhanging ledge (terrace with AC units) → setback
//    module → roof slab, neon corner edges + bands, shop sign, rooftop "connection" antenna
//    (tip blinks cyan when bot.endpoint is set, slow grey blink while it waits for a backend)
//  - trading: holographic K-line billboard · webhook: rotating dish + ping ring
//  - scraper: swinging crane with a data block · custom: twisting stacked-cube tower
// Efficiency: all static boxes of one building = 2 InstancedMeshes (lit + neon, per-instance color),
// moving parts are a few meshes on the shared UNIT_BOX, animated in useFrame by mutating refs.
// No React state per frame, no allocation per frame. 7–11 draw calls per bot.
import { useFrame } from '@react-three/fiber'
import { useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { BotKind } from '../../types'
import { BuildingCtx } from '../BuildingCtx'
import { facadeCols, facadeRows, flatMat, neonMat, PALETTE, signTexture, UNIT_BOX, useFacadeMaterial } from '../materials'

type V3 = [number, number, number]
interface Box {
  p: V3 // center
  s: V3 // size
  c: string // color
  ry?: number // rotation around y
}

const MUTE = '#8f8ab8' // --gg-mute
const FLAT_WHITE = flatMat('#ffffff') // tinted per instance
const NEON_WHITE = neonMat('#ffffff', 2) // tinted per instance → bloom
const UNIT_PLANE = new THREE.PlaneGeometry(1, 1)
const TIP_ON = neonMat(PALETTE.cyan, 3)
const TIP_WAIT = neonMat(PALETTE.grey, 1.5)
const DARK = flatMat(PALETTE.night)
const BLOCK_WORK = neonMat(PALETTE.green, 2.5)
const BLOCK_ERR = neonMat(PALETTE.red, 2.5)
const PING_ERR = new THREE.Color(PALETTE.red).multiplyScalar(2)
const C_GREEN = new THREE.Color(PALETTE.green)
const C_RED = new THREE.Color(PALETTE.red)
const C_YELLOW = new THREE.Color(PALETTE.yellow)

const KIND_SIGN: Record<BotKind, string> = { trading: 'TRADE', webhook: 'HOOK', scraper: 'SCRAPE', custom: 'BOT' }
const CORNERS = [
  [1, 1],
  [1, -1],
  [-1, 1],
] as const // the three vertical corners the iso camera sees

// K-line billboard, local coords of a group on the roof turned 45° to face the camera.
const R45 = Math.PI / 4
const C45 = Math.cos(R45)
const BB = { w: 1.9, y: 0.95, h: 0.95 } // width, bottom above roof (clears the name label), height
const N = 10 // candles
const SLOT = 1.7 / N
const CH_Y0 = BB.y + 0.12
const CH_H = BB.h - 0.24

// Twisting tower cubes (custom kind): size + center y above the roof.
const CUBES = [0.42, 0.34, 0.26, 0.18].map((s, i, a) => ({ s, y: 0.08 + a.slice(0, i).reduce((t, v) => t + v, 0) + s / 2 }))

// Unit circle in the xz plane for the webhook ping ring, shared by every bot.
const RING_GEO = (() => {
  const pts: number[] = []
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2
    pts.push(Math.cos(a), 0, Math.sin(a))
  }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
})()

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _c = new THREE.Color()

function hash(s: string) {
  let h = 7
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h >>> 0
}

function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

// Massing derived from the lot footprint and roof height.
function layout(W: number, D: number, H: number) {
  const wA = W * 0.875
  const dA = D * 0.875
  const yA = H * 0.5 // top of module A
  const terrace = yA + 0.12 // top of the ledge
  const wB = W * 0.69
  const dB = D * 0.69
  const ox = -W * 0.0625 // module B sits toward the back → front terrace
  const oz = -D * 0.0625
  return {
    wA, dA, yA, terrace, wB, dB, ox, oz,
    hA: yA - 0.16,
    hB: H - 0.12 - terrace,
    ax: ox - wB * 0.36, // connection antenna: screen-left roof corner
    az: oz + dB * 0.36,
    px: ox + wB * 0.3, // kind prop: screen-right roof corner
    pz: oz - dB * 0.3,
    bx: ox - 0.2, // billboard: back of the roof
    bz: oz - 0.2,
  }
}

function staticBoxes(W: number, D: number, H: number, kind: BotKind, accent: string) {
  const { wA, dA, yA, terrace, wB, dB, ox, oz, ax, az, px, pz, bx, bz } = layout(W, D, H)
  const second = accent.toLowerCase() === PALETTE.cyan ? PALETTE.pink : PALETTE.cyan
  const flats: Box[] = [
    { p: [0, 0.08, 0], s: [W, 0.16, D], c: PALETTE.concrete }, // plinth
    { p: [0, yA + 0.06, 0], s: [wA + 0.12, 0.12, dA + 0.12], c: PALETTE.steel }, // overhanging ledge
    { p: [ox, H - 0.06, oz], s: [wB + 0.12, 0.12, dB + 0.12], c: PALETTE.steel }, // roof slab, top = H
    { p: [wA / 2 + 0.02, 0.38, dA * 0.18], s: [0.08, 0.44, 0.34], c: PALETTE.void }, // door (+x face)
    { p: [wA * 0.43, terrace + 0.11, dA * 0.1], s: [0.24, 0.22, 0.3], c: PALETTE.haze }, // terrace AC units
    { p: [-wA * 0.12, terrace + 0.09, dA * 0.43], s: [0.3, 0.18, 0.22], c: PALETTE.haze },
    { p: [ox + wB * 0.32, H + 0.07, oz + dB * 0.32], s: [0.22, 0.14, 0.22], c: PALETTE.dusk }, // roof vent
    { p: [ax, H + 0.05, az], s: [0.2, 0.1, 0.2], c: PALETTE.steel }, // antenna foot, mast, crossbar
    { p: [ax, H + 0.36, az], s: [0.1, 0.6, 0.1], c: PALETTE.steel },
    { p: [ax, H + 0.44, az], s: [0.3, 0.08, 0.08], c: PALETTE.steel },
  ]
  const neons: Box[] = [
    { p: [0, yA - 0.05, 0], s: [wA + 0.04, 0.1, dA + 0.04], c: accent }, // band under the ledge
    { p: [ox, H - 0.16, oz], s: [wB + 0.04, 0.08, dB + 0.04], c: second }, // band under the roof
    { p: [wA / 2 + 0.1, 0.66, dA * 0.18], s: [0.2, 0.08, 0.44], c: accent }, // door awning
  ]
  for (const [sx, sz] of CORNERS) {
    neons.push({ p: [(sx * wA) / 2, (0.16 + yA - 0.1) / 2, (sz * dA) / 2], s: [0.1, yA - 0.26, 0.1], c: accent })
    neons.push({
      p: [ox + (sx * wB) / 2, (terrace + H - 0.2) / 2, oz + (sz * dB) / 2],
      s: [0.1, H - 0.2 - terrace, 0.1],
      c: second,
    })
  }

  if (kind === 'trading') {
    // local billboard coords → world (rotation 45° around y)
    const at = (lx: number, ly: number, lz: number): V3 => [bx + (lx + lz) * C45, H + ly, bz + (lz - lx) * C45]
    for (const lx of [-0.45, 0.45]) flats.push({ p: at(lx, BB.y / 2, 0), s: [0.1, BB.y, 0.1], c: PALETTE.steel, ry: R45 })
    flats.push({ p: at(0, BB.y / 2, 0), s: [0.9, 0.08, 0.08], c: PALETTE.steel, ry: R45 }) // brace
    flats.push({ p: at(0, BB.y + BB.h / 2, -0.03), s: [BB.w, BB.h, 0.06], c: PALETTE.void, ry: R45 }) // screen
    const midY = BB.y + BB.h / 2
    neons.push(
      { p: at(0, BB.y, 0), s: [BB.w + 0.08, 0.08, 0.1], c: accent, ry: R45 },
      { p: at(0, BB.y + BB.h, 0), s: [BB.w + 0.08, 0.08, 0.1], c: accent, ry: R45 },
      { p: at(-BB.w / 2, midY, 0), s: [0.08, BB.h, 0.1], c: accent, ry: R45 },
      { p: at(BB.w / 2, midY, 0), s: [0.08, BB.h, 0.1], c: accent, ry: R45 },
    )
    flats.push(
      { p: [px, H + 0.17, pz], s: [0.3, 0.34, 0.3], c: PALETTE.dusk }, // water tank + lid
      { p: [px, H + 0.38, pz], s: [0.34, 0.08, 0.34], c: PALETTE.steel },
    )
  } else if (kind === 'webhook') {
    flats.push({ p: [px, H + 0.17, pz], s: [0.12, 0.34, 0.12], c: PALETTE.steel }) // dish mast
  } else if (kind === 'scraper') {
    flats.push(
      { p: [px, H + 0.05, pz], s: [0.26, 0.1, 0.26], c: PALETTE.steel }, // crane foot + mast
      { p: [px, H + 0.43, pz], s: [0.12, 0.86, 0.12], c: PALETTE.steel },
    )
  } else {
    flats.push({ p: [px, H + 0.04, pz], s: [0.46, 0.08, 0.46], c: PALETTE.steel }) // tower plinth
  }
  return { flats, neons }
}

// Static boxes → one InstancedMesh (1 draw call). Matrices and colors are written once per `items`.
function Boxes({ items, material, shadows = false }: { items: Box[]; material: THREE.Material; shadows?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    items.forEach((b, i) => {
      _q.setFromEuler(_e.set(0, b.ry ?? 0, 0))
      mesh.setMatrixAt(i, _m.compose(_p.set(...b.p), _q, _s.set(...b.s)))
      mesh.setColorAt(i, _c.set(b.c))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [items])
  return (
    <instancedMesh
      key={items.length}
      ref={ref}
      args={[UNIT_BOX, material, items.length]}
      castShadow={shadows}
      receiveShadow={shadows}
    />
  )
}

// ---------- trading: candlestick chart ----------
interface Sim {
  O: Float32Array
  C: Float32Array
  Hi: Float32Array
  Lo: Float32Array
  step: () => void
}

// Seeded mean-reverting random walk in 0..1; step() shifts every candle one slot left.
function makeSim(seed: number): Sim {
  const r = rng(seed)
  const O = new Float32Array(N)
  const C = new Float32Array(N)
  const Hi = new Float32Array(N)
  const Lo = new Float32Array(N)
  let last = 0.5
  const step = () => {
    const o = last
    const c = Math.min(0.95, Math.max(0.05, o + (r() - 0.5) * 0.32 + (0.5 - o) * 0.15))
    O.copyWithin(0, 1)
    C.copyWithin(0, 1)
    Hi.copyWithin(0, 1)
    Lo.copyWithin(0, 1)
    O[N - 1] = o
    C[N - 1] = c
    Hi[N - 1] = Math.min(1, Math.max(o, c) + r() * 0.1)
    Lo[N - 1] = Math.max(0, Math.min(o, c) - r() * 0.1)
    last = c
  }
  for (let i = 0; i < N; i++) step()
  return { O, C, Hi, Lo, step }
}

// Instances: 0..N-1 bodies, N..2N-1 wicks, 2N = last-price tag right of the frame.
function writeChart(mesh: THREE.InstancedMesh, s: Sim) {
  const Y = (v: number) => CH_Y0 + v * CH_H
  for (let i = 0; i < N; i++) {
    const x = -0.85 + SLOT * (i + 0.5)
    const y0 = Y(Math.min(s.O[i], s.C[i]))
    const y1 = Y(Math.max(s.O[i], s.C[i]))
    mesh.setMatrixAt(i, _m.makeScale(0.11, Math.max(0.08, y1 - y0), 0.04).setPosition(x, (y0 + y1) / 2, 0.03))
    const w0 = Y(s.Lo[i])
    const w1 = Y(s.Hi[i])
    mesh.setMatrixAt(N + i, _m.makeScale(0.05, Math.max(0.02, w1 - w0), 0.03).setPosition(x, (w0 + w1) / 2, 0.02))
    const col = s.C[i] >= s.O[i] ? C_GREEN : C_RED
    mesh.setColorAt(i, col)
    mesh.setColorAt(N + i, col)
  }
  mesh.setMatrixAt(2 * N, _m.makeScale(0.16, 0.1, 0.06).setPosition(BB.w / 2 + 0.12, Y(s.C[N - 1]), 0))
  mesh.setColorAt(2 * N, C_YELLOW)
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
}

function KLine({ seed }: { seed: number }) {
  const { statusRef } = useContext(BuildingCtx)
  const ref = useRef<THREE.InstancedMesh>(null)
  const acc = useRef(0)
  const sim = useMemo(() => makeSim(seed), [seed])
  useLayoutEffect(() => {
    if (ref.current) writeChart(ref.current, sim)
  }, [sim])
  useFrame((_, dt) => {
    const st = statusRef.current
    if (st === 'error') return // chart freezes while the bot is in error
    acc.current += Math.min(dt, 0.5)
    if (acc.current < (st === 'working' ? 0.25 : 0.5)) return
    acc.current = 0
    sim.step()
    if (ref.current) writeChart(ref.current, sim)
  })
  return <instancedMesh ref={ref} args={[UNIT_BOX, NEON_WHITE, 2 * N + 1]} frustumCulled={false} />
}

// ---------- webhook: rotating dish + ping ring ----------
function Dish({ accent }: { accent: string }) {
  const { statusRef } = useContext(BuildingCtx)
  const spin = useRef<THREE.Group>(null)
  const { ring, ringMat, ping } = useMemo(() => {
    const ping = new THREE.Color(accent).multiplyScalar(2)
    const ringMat = new THREE.LineBasicMaterial({ color: ping, transparent: true, toneMapped: false, depthWrite: false })
    const ring = new THREE.LineLoop(RING_GEO, ringMat)
    ring.raycast = () => {} // hover/click stays on the building body
    return { ring, ringMat, ping }
  }, [accent])
  useEffect(() => () => ringMat.dispose(), [ringMat])
  useFrame(({ clock }, dt) => {
    const st = statusRef.current
    const fast = st === 'working'
    if (spin.current) spin.current.rotation.y += dt * (fast ? 2 : 0.5)
    const period = fast ? 0.7 : 1.6
    const k = Math.floor(((clock.elapsedTime % period) / period) * 6) / 6 // steps(6)
    ring.scale.setScalar(0.25 + k * 0.9)
    ring.position.y = 0.55 + k * 0.3
    ringMat.opacity = 1 - k
    ringMat.color.copy(st === 'error' ? PING_ERR : ping)
  })
  // dish plate tilted 0.6 rad; its normal is (0, 0.825, 0.565)
  return (
    <>
      <group ref={spin} position={[0, 0.34, 0]}>
        <mesh geometry={UNIT_BOX} material={flatMat(MUTE)} position={[0, 0.06, 0]} rotation={[0.6, 0, 0]} scale={[0.52, 0.08, 0.52]} />
        <mesh geometry={UNIT_BOX} material={flatMat(PALETTE.steel)} position={[0, 0.19, 0.09]} rotation={[0.6, 0, 0]} scale={[0.08, 0.3, 0.08]} />
        <mesh geometry={UNIT_BOX} material={neonMat(accent, 2.5)} position={[0, 0.32, 0.18]} scale={0.13} />
      </group>
      <primitive object={ring} />
    </>
  )
}

// ---------- scraper: swinging crane with a data block ----------
function Crane({ accent }: { accent: string }) {
  const { statusRef } = useContext(BuildingCtx)
  const pivot = useRef<THREE.Group>(null)
  const block = useRef<THREE.Mesh>(null)
  const phase = useRef(0)
  const idle = neonMat(accent, 2.5)
  useFrame((_, dt) => {
    const st = statusRef.current
    if (st !== 'error') phase.current += dt * (st === 'working' ? 1.8 : 0.6)
    // base angle points the jib at the roof center, swing ±0.9 rad
    if (pivot.current) pivot.current.rotation.y = -0.75 * Math.PI + Math.sin(phase.current) * 0.9
    const m = st === 'working' ? BLOCK_WORK : st === 'error' ? BLOCK_ERR : idle
    if (block.current && block.current.material !== m) block.current.material = m
  })
  return (
    <group ref={pivot} position={[0, 0.9, 0]}>
      <mesh geometry={UNIT_BOX} material={flatMat(PALETTE.dusk)} scale={[0.2, 0.18, 0.2]} />
      <mesh geometry={UNIT_BOX} material={flatMat(accent)} position={[0.32, 0.02, 0]} scale={[0.95, 0.1, 0.1]} />
      <mesh geometry={UNIT_BOX} material={flatMat(PALETTE.night)} position={[-0.24, -0.02, 0]} scale={[0.18, 0.16, 0.16]} />
      <mesh geometry={UNIT_BOX} material={flatMat(MUTE)} position={[0.72, -0.17, 0]} scale={[0.07, 0.3, 0.07]} />
      <mesh ref={block} geometry={UNIT_BOX} material={idle} position={[0.72, -0.4, 0]} scale={0.18} />
    </group>
  )
}

// ---------- custom: twisting stacked-cube tower ----------
function Twister({ accent }: { accent: string }) {
  const { statusRef } = useContext(BuildingCtx)
  const refs = useRef<(THREE.Mesh | null)[]>([])
  const phase = useRef(0)
  useFrame((_, dt) => {
    phase.current += dt * (statusRef.current === 'working' ? 1.6 : 0.35)
    for (let i = 0; i < CUBES.length; i++) {
      const m = refs.current[i]
      if (m) m.rotation.y = (i % 2 ? -1 : 1) * phase.current * (1 + i * 0.4) + i * 0.4
    }
  })
  return (
    <>
      {CUBES.map((c, i) => (
        <mesh
          key={i}
          ref={(m) => {
            refs.current[i] = m
          }}
          geometry={UNIT_BOX}
          material={i % 2 ? neonMat(accent, 1 + i * 0.4) : flatMat(PALETTE.dusk)}
          position={[0, c.y, 0]}
          scale={c.s}
        />
      ))}
    </>
  )
}

export function BotBuilding() {
  const { building, footprint, height: H } = useContext(BuildingCtx)
  const kind: BotKind = building.bot?.kind ?? 'custom'
  const accent = building.bot?.color ?? PALETTE.pink
  const hasEndpoint = !!building.bot?.endpoint?.trim()
  const seed = useMemo(() => hash(building.id) % 9973, [building.id])
  const W = footprint.w
  const D = footprint.d
  const L = layout(W, D, H)

  const { flats, neons } = useMemo(() => staticBoxes(W, D, H, kind, accent), [W, D, H, kind, accent])
  const facadeA = useFacadeMaterial({ cols: facadeCols(W * 0.875), rows: facadeRows(H * 0.5 - 0.16), seed, tint: accent })
  const facadeB = useFacadeMaterial({ cols: facadeCols(W * 0.69), rows: facadeRows(H * 0.5 - 0.24), seed: seed + 1, tint: accent })

  // shop sign on the +z face: the bot's own short name, falling back to its kind
  // (texture is cached in materials.ts; only the material is ours)
  const signMat = useMemo(
    () => new THREE.MeshBasicMaterial({ map: signTexture(building.short || KIND_SIGN[kind], accent), toneMapped: false }),
    [building.short, kind, accent],
  )
  useEffect(() => () => signMat.dispose(), [signMat])
  const signPx = (signMat.map?.image as { width: number } | undefined)?.width ?? 48
  const signW = Math.min(L.wA - 0.36, 0.24 * (signPx / 16))

  // connection antenna: cyan blink with an endpoint, slow grey blink while waiting for a backend
  const tip = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const on = hasEndpoint ? Math.floor(t * 2.5) % 3 !== 0 : Math.floor(t / 1.2) % 2 === 0
    const m = on ? (hasEndpoint ? TIP_ON : TIP_WAIT) : DARK
    if (tip.current && tip.current.material !== m) tip.current.material = m
  })

  return (
    <group>
      <Boxes items={flats} material={FLAT_WHITE} shadows />
      <Boxes items={neons} material={NEON_WHITE} />
      <mesh
        geometry={UNIT_BOX}
        material={facadeA}
        position={[0, 0.16 + L.hA / 2, 0]}
        scale={[L.wA, L.hA, L.dA]}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={UNIT_BOX}
        material={facadeB}
        position={[L.ox, L.terrace + L.hB / 2, L.oz]}
        scale={[L.wB, L.hB, L.dB]}
        castShadow
        receiveShadow
      />
      <mesh geometry={UNIT_PLANE} material={signMat} position={[0, 0.48, L.dA / 2 + 0.012]} scale={[signW, 0.24, 1]} />
      <mesh ref={tip} geometry={UNIT_BOX} material={TIP_WAIT} position={[L.ax, H + 0.72, L.az]} scale={0.16} />

      {kind === 'trading' && (
        <group position={[L.bx, H, L.bz]} rotation={[0, R45, 0]}>
          <KLine seed={seed} />
        </group>
      )}
      {kind !== 'trading' && (
        <group position={[L.px, H, L.pz]}>
          {kind === 'webhook' && <Dish accent={accent} />}
          {kind === 'scraper' && <Crane accent={accent} />}
          {kind === 'custom' && <Twister accent={accent} />}
        </group>
      )}
    </group>
  )
}
