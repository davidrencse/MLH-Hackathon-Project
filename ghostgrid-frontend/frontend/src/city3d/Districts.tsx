// Ground dressing for the zoned quarters in DISTRICTS (world.ts): paved floor, lit boundary,
// gateway arch with a holo name plate, and per-mood furniture — ticker tape and billboard pylons
// on a trading floor, lanterns and hedges on a residential row.
// Decoration only: nothing raycasts, so the buildings stay the city's only hit targets.
//
// EFFICIENCY: baked once into three InstancedMeshes plus one mesh per holo panel (each needs its
// own text map). Per frame only the ticker offsets and holo opacity move. Materials are local to
// this file so mutating them cannot leak into the shared flatMat()/neonMat() caches.
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { blockSpans, CURB } from './ground/layout'
import { signTexture, UNIT_BOX } from './materials'
import { blockCenter, DISTRICTS, districtEdges, districtLots, districtMedian, MAP, plateOffset } from './world'

const HALF = MAP.size / 2
const PLANE = new THREE.PlaneGeometry(1, 1)

/** A box in an instanced bucket. Colour is per-instance, so one material covers every accent. */
interface Box {
  p: [number, number, number]
  s: [number, number, number]
  c: THREE.Color
}

/** Pixel text on an additive quad. Owns its map, so these stay plain meshes. */
interface Panel {
  p: [number, number, number]
  yaw: number
  w: number
  h: number
  mat: THREE.MeshBasicMaterial
}

type Bucket = 'pave' | 'trim' | 'neon' // lit paving, lit structure, unlit neon

// Neon has to clear the bloom threshold (0.75) to glow; painted lines have to stay under it.
const NEON = 1.9
const PAINT = 0.42
const tint = (hex: string, k: number) => new THREE.Color(hex).multiplyScalar(k)

const PAVE = { neon: '#16222f', quiet: '#1b2436' }
const STRUCT = '#101a28'
const HEDGE = '#2f5b48'
const LANTERN = '#ffcd70'

// Billboard copy. No price or dollar figure: real spend lives on the Office security pages only.
const ADS = ['LONG', 'SHORT', 'VOLUME', 'PAPER ONLY']

// Candle-bar tape. One canvas, cloned per band — repeat lives on the texture and bands differ
// in length.
let tapeSource: THREE.CanvasTexture | null = null
function tape() {
  if (tapeSource) return tapeSource
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 16
  const g = c.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, c.width, c.height)
  let s = 20260113
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  g.fillStyle = '#fff'
  for (let x = 2; x < c.width - 2; x += 4) {
    if (r() < 0.14) continue
    const h = 3 + Math.floor(r() * 9)
    const y = Math.floor((c.height - h) / 2)
    g.fillRect(x, y, 2, h) // body
    g.fillRect(x, Math.max(0, y - 2), 1, h + 4) // wick
  }
  tapeSource = new THREE.CanvasTexture(c)
  tapeSource.magFilter = tapeSource.minFilter = THREE.NearestFilter
  tapeSource.generateMipmaps = false
  tapeSource.wrapS = tapeSource.wrapT = THREE.RepeatWrapping
  tapeSource.colorSpace = THREE.SRGBColorSpace
  return tapeSource
}

/** Additive pixel-text material, same idiom as the Transit station plates. */
function holoMat(text: string, color: string) {
  const map = signTexture(text, color, '#04121c')
  const mat = new THREE.MeshBasicMaterial({
    map,
    toneMapped: false,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const image = map.image as HTMLCanvasElement
  return { mat, aspect: image.width / image.height }
}

// ---------- layout ----------
function build() {
  const boxes: Record<Bucket, Box[]> = { pave: [], trim: [], neon: [] }
  const panels: Panel[] = []
  const bands: Panel[] = []
  const spans = blockSpans()

  const box = (bucket: Bucket, c: THREE.Color, x: number, y: number, z: number, w: number, h: number, d: number) =>
    boxes[bucket].push({ p: [x, y, z], s: [w, h, d], c })

  for (const d of DISTRICTS) {
    const { x0, x1, z0, z1, ix, iz } = districtEdges(d)
    // A district can stand on an outer plate (the trading district does), and the two places
    // below work in raw tiles rather than going through the helpers above.
    const [ox, oz] = plateOffset(d.plot)
    const neon = tint(d.accent, NEON)
    const paint = tint(d.accent, PAINT)
    const struct = new THREE.Color(STRUCT)
    // Outward direction of each core-facing edge, and the boundary-avenue centre lines the
    // district's street furniture stands on.
    const { nx, nz, mx, mz } = districtMedian(d)

    // (1) Paving: one plate per block, not one over the whole rectangle, so the roads crossing
    // the district stay roads.
    for (const [a, b] of spans) {
      if (a < d.tx0 || b > d.tx1) continue
      for (const [c, e] of spans) {
        if (c < d.tz0 || e > d.tz1) continue
        box('pave', new THREE.Color(PAVE[d.mood]), (a + b) / 2 - HALF + ox, CURB + 0.012, (c + e) / 2 - HALF + oz, b - a - 0.08, 0.02, e - c - 0.08)
      }
    }

    // (2) Boundary: neon rail on a core-facing edge, painted line on the far one. An axis the
    // quarter straddles faces the city on neither end, so both are painted caps.
    const w = x1 - x0
    const dd = z1 - z0
    const cx = (x0 + x1) / 2
    const cz = (z0 + z1) / 2
    if (ix === null) for (const x of [x0, x1]) box('neon', paint, x, CURB + 0.03, cz, 0.1, 0.05, dd)
    else {
      box('neon', neon, ix, CURB + 0.03, cz, 0.1, 0.05, dd)
      box('neon', paint, ix === x0 ? x1 : x0, CURB + 0.03, cz, 0.1, 0.05, dd)
    }
    if (iz === null) for (const z of [z0, z1]) box('neon', paint, cx, CURB + 0.03, z, w, 0.05, 0.1)
    else {
      box('neon', neon, cx, CURB + 0.03, iz, w, 0.05, 0.1)
      box('neon', paint, cx, CURB + 0.03, iz === z0 ? z1 : z0, w, 0.05, 0.1)
    }

    // (3) Ticker tape outside each core-facing edge, facing out. Trading floors only.
    if (d.mood === 'neon') {
      const BAND_H = 0.5
      const addBand = (x: number, z: number, yaw: number, length: number) => {
        const map = tape().clone()
        map.needsUpdate = true
        map.repeat.set(length / 1.1, 1)
        bands.push({
          p: [x, CURB + BAND_H / 2, z],
          yaw,
          w: length,
          h: BAND_H,
          mat: new THREE.MeshBasicMaterial({
            map,
            color: tint(d.accent, 1.5),
            toneMapped: false,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        })
      }
      if (ix !== null) addBand(ix + nx * 0.03, cz, nx > 0 ? Math.PI / 2 : -Math.PI / 2, dd)
      if (iz !== null) addBand(cx, iz + nz * 0.03, nz > 0 ? 0 : Math.PI, w)
    }

    // (4) Gateway arch on the gate block's core-facing edge. A corner quarter faces the core on
    // both axes and takes z, the face the default camera looks at; a flank strip has only one.
    // The name plate is duplicated back to back so it still reads from behind.
    const [gcx, gcz] = blockCenter(d.gate[0], d.gate[1], d.plot)
    const axis = iz !== null ? 'z' : 'x'
    const gc = axis === 'z' ? gcz : gcx
    // Same edge the boundary furniture stands on, so the arch opens onto its own avenue. Taking
    // the edge nearer the origin instead put it on the far side for a district on an outer plate.
    const gn = (axis === 'z' ? nz : nx) || -1 // which way the arch faces
    const edge = gc + gn * 2 // the gate block's edge on that side
    // Arch-local: `a` runs along the arch, `o` points out of the district.
    const archBox = (b: Bucket, c: THREE.Color, a: number, y: number, o: number, aw: number, h: number, ow: number) =>
      axis === 'z'
        ? box(b, c, gcx + a, y, edge + gn * o, aw, h, ow)
        : box(b, c, edge + gn * o, y, gcz + a, ow, h, aw)
    const archAt = (a: number, y: number, o: number): [number, number, number] =>
      axis === 'z' ? [gcx + a, y, edge + gn * o] : [edge + gn * o, y, gcz + a]
    const outYaw = axis === 'z' ? (gn > 0 ? 0 : Math.PI) : gn > 0 ? Math.PI / 2 : -Math.PI / 2

    const H = d.mood === 'neon' ? 4.6 : 3.2
    for (const sa of [-1, 1]) {
      archBox('trim', struct, sa * 2, CURB + H / 2, 0, 0.34, H, 0.5)
      archBox('neon', neon, sa * 2, CURB + H / 2, 0.27, 0.1, H * 0.9, 0.04)
    }
    archBox('trim', struct, 0, CURB + H + 0.35, 0, 4.7, 0.7, 0.56)
    archBox('neon', neon, 0, CURB + H - 0.02, 0, 4.7, 0.07, 0.6)
    archBox('neon', neon, 0, CURB + H + 0.72, 0, 4.7, 0.07, 0.6)
    // Threshold strip on the road under the arch: the district starts here.
    archBox('neon', paint, 0, 0.03, 0.5, 4.7, 0.05, 0.12)

    const name = holoMat(d.short, d.accent)
    const nameW = 3.6
    for (const back of [false, true]) {
      panels.push({
        p: archAt(0, CURB + H + 0.35, back ? -0.33 : 0.33),
        yaw: outYaw + (back ? Math.PI : 0),
        w: nameW,
        h: nameW / name.aspect,
        mat: name.mat,
      })
    }
    const tagline = holoMat(d.tagline, d.accent)
    const tagW = 2
    panels.push({
      p: archAt(0, CURB + H - 0.62, 0.33),
      yaw: outYaw,
      w: tagW,
      h: tagW / tagline.aspect,
      mat: tagline.mat,
    })

    // (5) Furniture on the boundary-avenue medians and the gateway plaza — the only ground a
    // quarter reliably has left, since its blocks are lots and a mast on a lot would stand
    // inside the tower there. One median per core-facing edge.
    const medians: { run: 'x' | 'z'; at: number; out: number }[] = []
    if (mx !== null) medians.push({ run: 'z', at: mx, out: nx })
    if (mz !== null) medians.push({ run: 'x', at: mz, out: nz })
    // Fractions along each median. Heights and skews are mismatched on purpose — matched
    // billboards read as a fence.
    const SLOTS = [
      { t: 0.1, h: 7.4, skew: 0.3 },
      { t: 0.3, h: 5.6, skew: -0.22 },
      { t: 0.5, h: 8.8, skew: 0.18 },
      { t: 0.7, h: 6.4, skew: -0.3 },
      { t: 0.9, h: 7.9, skew: 0.26 },
    ]
    const ads = d.mood === 'neon' ? ADS.map((text) => holoMat(text, d.accent)) : []
    let slot = 0
    for (const { run, at, out } of medians) {
      for (const { t, h, skew } of SLOTS) {
        const x = run === 'x' ? x0 + t * w : at
        const z = run === 'x' ? at : z0 + t * dd
        // Clear of the arch.
        if (Math.abs(x - gcx) < 2.8 && Math.abs(z - gcz) < 2.8) continue
        const yaw = (run === 'x' ? (out > 0 ? 0 : Math.PI) : out > 0 ? Math.PI / 2 : -Math.PI / 2) + skew
        if (d.mood === 'neon') {
          // 0.14 wide: Traffic's lanes sit at road centre +/- 0.22, so the mast fits the gap.
          box('trim', struct, x, CURB + h / 2, z, 0.14, h, 0.14)
          box('neon', neon, x, CURB + h + 0.1, z, 0.18, 0.18, 0.18)
          const ad = ads[slot % ads.length]
          const panelW = 2.8
          panels.push({ p: [x, CURB + h - 0.95, z], yaw, w: panelW, h: panelW / ad.aspect, mat: ad.mat })
        } else {
          box('trim', struct, x, CURB + 0.55, z, 0.1, 1.1, 0.1)
          box('neon', tint(LANTERN, NEON), x, CURB + 1.16, z, 0.24, 0.18, 0.24)
        }
        slot++
      }
    }
    if (d.mood === 'neon') {
      // Plaza floor strips, on the one block with no tower on it.
      for (let i = -1; i <= 1; i++) archBox('neon', paint, i * 1.3, CURB + 0.03, -2.6, 0.1, 0.05, 2.8)
    } else {
      // Hedge U around the garden plaza, open toward the arch.
      const hedge = new THREE.Color(HEDGE)
      for (const sa of [-1, 1]) archBox('trim', hedge, sa * 1.4, CURB + 0.16, -1.4, 0.4, 0.32, 2.4)
      archBox('trim', hedge, 0, CURB + 0.16, -2.8, 3.2, 0.32, 0.4)
    }
    // (6) Skybridges across the district's own streets. Derived from the lots, not hand-placed,
    // so a tower added to the quarter gets its bridges for free.
    if (d.mood === 'neon') {
      const lots = districtLots(d).map((l) => ({
        id: l.id,
        x0: l.tx - HALF + ox,
        x1: l.tx + l.w - HALF + ox,
        z0: l.tz - HALF + oz,
        z1: l.tz + l.d - HALF + oz,
      }))
      // Link footprints a road's width apart that face each other over at least 1.5 tiles;
      // less than that and the deck reads as a lump on the facade.
      type Span = [number, number, number, number] // aLo, aHi, bLo, bHi
      const gap = (aLo: number, aHi: number, bLo: number, bHi: number) =>
        bLo > aHi ? bLo - aHi : aLo > bHi ? aLo - bHi : 0
      const mid = (...[aLo, aHi, bLo, bHi]: Span) => (Math.max(aLo, bLo) + Math.min(aHi, bHi)) / 2
      const facing = (...[aLo, aHi, bLo, bHi]: Span) => Math.min(aHi, bHi) - Math.max(aLo, bLo)
      for (let i = 0; i < lots.length; i++) {
        for (let j = i + 1; j < lots.length; j++) {
          const a = lots[i]
          const b = lots[j]
          const gx = gap(a.x0, a.x1, b.x0, b.x1)
          const gz = gap(a.z0, a.z1, b.z0, b.z1)
          const y = CURB + 3.4 + ((a.id * 31 + b.id * 17) % 5) * 0.5
          if (gx > 0.5 && gx < 2.5 && gz === 0 && facing(a.z0, a.z1, b.z0, b.z1) > 1.5) {
            const x = (Math.min(a.x1, b.x1) + Math.max(a.x0, b.x0)) / 2
            const z = mid(a.z0, a.z1, b.z0, b.z1)
            box('trim', struct, x, y, z, gx + 0.5, 0.18, 1.1)
            for (const sz of [-1, 1]) box('neon', neon, x, y + 0.14, z + sz * 0.56, gx + 0.5, 0.06, 0.06)
          } else if (gz > 0.5 && gz < 2.5 && gx === 0 && facing(a.x0, a.x1, b.x0, b.x1) > 1.5) {
            const z = (Math.min(a.z1, b.z1) + Math.max(a.z0, b.z0)) / 2
            const x = mid(a.x0, a.x1, b.x0, b.x1)
            box('trim', struct, x, y, z, 1.1, 0.18, gz + 0.5)
            for (const sx of [-1, 1]) box('neon', neon, x + sx * 0.56, y + 0.14, z, 0.06, 0.06, gz + 0.5)
          }
        }
      }
    }
  }

  return { boxes, panels, bands }
}

// ---------- rendering ----------
function Inst({ parts, material }: { parts: Box[]; material: THREE.Material }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const o = new THREE.Object3D()
    parts.forEach((b, i) => {
      o.position.set(...b.p)
      o.scale.set(...b.s)
      o.updateMatrix()
      mesh.setMatrixAt(i, o.matrix)
      mesh.setColorAt(i, b.c)
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [parts])
  return <instancedMesh ref={ref} args={[UNIT_BOX, material, parts.length]} raycast={() => null} />
}

export function Districts() {
  const rig = useMemo(() => {
    const { boxes, panels, bands } = build()
    return {
      boxes,
      panels,
      bands,
      mats: {
        pave: new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }),
        trim: new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }),
        neon: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
      },
    }
  }, [])

  useEffect(
    () => () => {
      for (const m of Object.values(rig.mats)) m.dispose()
      for (const p of new Set(rig.panels.map((p) => p.mat))) p.dispose()
      for (const b of rig.bands) {
        b.mat.map?.dispose()
        b.mat.dispose()
      }
    },
    [rig],
  )

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    // Stepped scroll, like the facade glyphs: pixel art must not slide between pixels.
    const step = -Math.floor(t * 12) / 48
    for (const b of rig.bands) if (b.mat.map) b.mat.map.offset.x = step
    // Pulse plus an occasional dropped frame, so signage reads as projected light, not paint.
    const flicker = Math.floor(t * 9) % 17 === 0 ? 0.25 : 1
    const opacity = (0.6 + 0.25 * Math.abs(Math.sin(t * 1.4))) * flicker
    for (const p of rig.panels) p.mat.opacity = opacity
  })

  return (
    <group>
      {(Object.keys(rig.boxes) as Bucket[]).map((k) =>
        rig.boxes[k].length > 0 ? <Inst key={k} parts={rig.boxes[k]} material={rig.mats[k]} /> : null,
      )}
      {[...rig.bands, ...rig.panels].map((p, i) => (
        <mesh
          key={i}
          geometry={PLANE}
          material={p.mat}
          position={p.p}
          rotation-y={p.yaw}
          scale={[p.w, p.h, 1]}
          raycast={() => null}
        />
      ))}
    </group>
  )
}
