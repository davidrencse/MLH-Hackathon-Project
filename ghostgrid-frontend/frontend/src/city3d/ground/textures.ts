// Procedural pixel textures for the ground. Each painter returns new textures: the caller owns
// them (create in useMemo, dispose on unmount).
import * as THREE from 'three'
import { PALETTE } from '../materials'
import { MAP, ROAD_INDEXES } from '../world'
import { HALF, isRoadIndex, LAMP_REACH, LAMPS } from './layout'

function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!]
}

function toTexture(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c)
  t.magFilter = THREE.NearestFilter
  t.minFilter = THREE.NearestFilter
  t.generateMipmaps = false
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

// Texels per tile (= per world unit) of the ground texture. Canvas pixel (px, pz) ↔ tile (px/T, pz/T).
export const GROUND_TPU = 8

// One texture for the whole map: asphalt roads with neon lane dashes + crosswalks, concrete
// sidewalks with a slab pattern and lighter curbs, lamp light pools (emissive only).
export function makeGroundTextures() {
  const T = GROUND_TPU
  const S = MAP.size * T
  const [a, g] = canvas2d(S, S)
  const [e, ge] = canvas2d(S, S)
  ge.fillStyle = '#000'
  ge.fillRect(0, 0, S, S)
  const r = rng(11)
  const road = (tx: number, tz: number) => isRoadIndex(tx) || isRoadIndex(tz)
  const out = (i: number) => i < 0 || i >= MAP.size
  const edge = (tx: number, tz: number) => out(tx) || out(tz) || road(tx, tz)

  for (let tz = 0; tz < MAP.size; tz++)
    for (let tx = 0; tx < MAP.size; tx++) {
      const px = tx * T
      const pz = tz * T
      if (road(tx, tz)) {
        g.fillStyle = PALETTE.asphalt
        g.fillRect(px, pz, T, T)
        g.fillStyle = PALETTE.night
        for (let k = 0; k < 3; k++) g.fillRect(px + Math.floor(r() * T), pz + Math.floor(r() * T), 1, 1)
        continue
      }
      // sidewalk: 4×4 slabs in a checker of two close shades + a few dark specks
      g.fillStyle = PALETTE.concrete
      g.fillRect(px, pz, T, T)
      g.fillStyle = rgba(PALETTE.haze, 0.22)
      for (let sz = 0; sz < T; sz += 4)
        for (let sx = 0; sx < T; sx += 4) if (((px + sx) / 4 + (pz + sz) / 4) % 2 === 0) g.fillRect(px + sx, pz + sz, 4, 4)
      g.fillStyle = rgba(PALETTE.void, 0.55)
      if (r() < 0.7) g.fillRect(px + Math.floor(r() * T), pz + Math.floor(r() * T), 1, 1)
      // curb: lighter edge where the tile touches a road or the platform rim (block sides sample it too)
      g.fillStyle = PALETTE.haze
      if (edge(tx - 1, tz)) g.fillRect(px, pz, 1, T)
      if (edge(tx + 1, tz)) g.fillRect(px + T - 1, pz, 1, T)
      if (edge(tx, tz - 1)) g.fillRect(px, pz, T, 1)
      if (edge(tx, tz + 1)) g.fillRect(px, pz + T - 1, T, 1)
    }

  // lane dashes (column roads pink, row roads cyan) + zebra crosswalks next to every intersection
  const paint = (along: 'x' | 'z', tx: number, tz: number) => {
    const px = tx * T
    const pz = tz * T
    // across = offset across the road, s = offset along it
    const rect = (ctx: CanvasRenderingContext2D, across: number, s: number, w: number, l: number) =>
      along === 'z' ? ctx.fillRect(px + across, pz + s, w, l) : ctx.fillRect(px + s, pz + across, l, w)
    const i = along === 'z' ? tz : tx
    const crossEnd = isRoadIndex(i + 1)
    const crossStart = isRoadIndex(i - 1)
    if (crossEnd || crossStart) {
      const s0 = crossEnd ? T - 4 : 1
      g.fillStyle = rgba(PALETTE.ink, 0.5)
      ge.fillStyle = rgba(PALETTE.cyan, 0.5)
      for (const k of [0, 3, 6]) {
        rect(g, k, s0, 2, 3)
        rect(ge, k, s0, 2, 3)
      }
      return
    }
    const c = along === 'z' ? PALETTE.pink : PALETTE.cyan
    g.fillStyle = rgba(c, 0.9)
    ge.fillStyle = c
    rect(g, T / 2 - 1, 2, 2, 4)
    rect(ge, T / 2 - 1, 2, 2, 4)
  }
  for (const c of ROAD_INDEXES)
    for (let i = 0; i < MAP.size; i++) {
      if (isRoadIndex(i)) continue // intersection tile stays plain
      paint('z', c, i)
      paint('x', i, c)
    }

  // dithered light pools under each lamp head (emissive only)
  for (const l of LAMPS) {
    const cx = (l.x + l.ax * LAMP_REACH + HALF) * T
    const cz = (l.z + l.az * LAMP_REACH + HALF) * T
    const R = 5
    for (let dz = -R; dz <= R; dz++)
      for (let dx = -R; dx <= R; dx++) {
        const d2 = dx * dx + dz * dz
        if (d2 > R * R) continue
        const x = Math.floor(cx + dx)
        const z = Math.floor(cz + dz)
        const inner = d2 <= (R * 0.5) ** 2
        if (!inner && (x + z) % 2) continue
        ge.fillStyle = rgba(l.color, inner ? 0.45 : 0.3)
        ge.fillRect(x, z, 1, 1)
      }
  }
  return { map: toTexture(a), emissiveMap: toTexture(e) }
}

// Platform side: dark tech panels with seams, vents and status LEDs. Mapped once across each 16-unit side.
export function makeSlabTextures() {
  const W = MAP.size * 10
  const H = 12
  const [a, g] = canvas2d(W, H)
  const [e, ge] = canvas2d(W, H)
  ge.fillStyle = '#000'
  ge.fillRect(0, 0, W, H)
  g.fillStyle = PALETTE.dusk
  g.fillRect(0, 0, W, 2)
  g.fillStyle = PALETTE.void
  g.fillRect(0, 2, W, 1)
  g.fillStyle = PALETTE.night
  g.fillRect(0, 3, W, 5)
  g.fillStyle = PALETTE.void
  g.fillRect(0, 8, W, 4)
  const r = rng(5)
  const leds = [PALETTE.cyan, PALETTE.green, PALETTE.pink]
  for (let x = 0; x < W; x += 20) {
    g.fillStyle = PALETTE.void
    g.fillRect(x, 3, 1, 5)
    g.fillStyle = PALETTE.haze
    g.fillRect(x + 4, 4, 5, 1)
    g.fillRect(x + 4, 6, 5, 1)
    g.fillStyle = PALETTE.dusk
    g.fillRect(x + 12, 10, 4, 1)
    if (r() < 0.75) {
      const c = leds[Math.floor(r() * leds.length)]
      g.fillStyle = c
      ge.fillStyle = c
      g.fillRect(x + 15, 5, 1, 1)
      ge.fillRect(x + 15, 5, 1, 1)
    }
  }
  return { map: toTexture(a), emissiveMap: toTexture(e) }
}

// Puddle: irregular dark blob with cyan / pink neon reflection streaks (transparent outside).
export function makePuddleTexture() {
  const W = 12
  const H = 8
  const [c, g] = canvas2d(W, H)
  const r = rng(3)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = (x + 0.5 - W / 2) / (W / 2)
      const dy = (y + 0.5 - H / 2) / (H / 2)
      if (dx * dx + dy * dy > 0.85 + r() * 0.3) continue
      g.fillStyle = rgba(PALETTE.dusk, 0.75)
      g.fillRect(x, y, 1, 1)
    }
  g.fillStyle = PALETTE.cyan
  g.fillRect(3, 3, 4, 1)
  g.fillStyle = PALETTE.pink
  g.fillRect(6, 5, 3, 1)
  g.fillStyle = rgba(PALETTE.ink, 0.8)
  g.fillRect(4, 2, 1, 1)
  return toTexture(c)
}
