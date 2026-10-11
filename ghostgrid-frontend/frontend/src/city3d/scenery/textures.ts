// Facade textures shared by every filler building: one tiling window grid, sampled with
// world-aligned UVs so windows are the same size on a 1-unit shack and a 6-unit tower.
//
// The wall colour comes from the mesh's vertex colours, so these textures only carry the
// window pattern: `map` darkens the glass, `emissiveMap` lights the lit ones.
import * as THREE from 'three'
import { PALETTE } from '../materials'

/** World units covered by one repeat of the texture (8 cells → a window every 0.5 units). */
export const FACADE_TILE = 4
const CELLS = 8
const CELL = 4 // texels per cell
const SIZE = CELLS * CELL

function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function tiling(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c)
  t.magFilter = THREE.NearestFilter
  t.minFilter = THREE.NearestFilter
  t.generateMipmaps = false
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

// Cell (0,0) is left blank in both maps: roofs and undersides sample its first texel so they
// come out as plain wall instead of a stray window.
export function makeFacadeTextures() {
  const a = document.createElement('canvas')
  const e = document.createElement('canvas')
  a.width = a.height = e.width = e.height = SIZE
  const g = a.getContext('2d')!
  const ge = e.getContext('2d')!
  g.fillStyle = '#ffffff' // white = keep the vertex colour
  g.fillRect(0, 0, SIZE, SIZE)
  ge.fillStyle = '#000000'
  ge.fillRect(0, 0, SIZE, SIZE)

  const r = rng(7)
  const lit = [PALETTE.ink, PALETTE.ink, PALETTE.ink, PALETTE.yellow, PALETTE.cyan, PALETTE.pink, PALETTE.orange]
  for (let cy = 0; cy < CELLS; cy++)
    for (let cx = 0; cx < CELLS; cx++) {
      if (cx === 0 && cy === 0) continue // reserved blank cell
      const x = cx * CELL + 1
      const y = cy * CELL + 1
      const on = r() < 0.5
      // glass reads darker than the wall whether or not it is lit
      g.fillStyle = on ? 'rgba(255,255,255,1)' : 'rgba(90,86,119,1)'
      g.fillRect(x, y, 2, 2)
      if (on) {
        ge.fillStyle = lit[Math.floor(r() * lit.length)]
        ge.fillRect(x, y, 2, 2)
        // half the lit windows are only half-full → more texture in the skyline
        if (r() < 0.45) {
          ge.fillStyle = '#000000'
          ge.fillRect(x, y + 1, 2, 1)
        }
      }
    }
  return { map: tiling(a), emissiveMap: tiling(e) }
}
