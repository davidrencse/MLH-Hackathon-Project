import * as THREE from 'three'

// Brushed panels, recessed seams, bolt heads, and grime. Deterministic and local.
export function makeIndustrialTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')!
  let seed = 41
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  ctx.fillStyle = '#d5dce2'
  ctx.fillRect(0, 0, 64, 64)
  for (let y = 0; y < 64; y++) {
    ctx.fillStyle = `rgba(30,45,65,${0.02 + random() * 0.07})`
    ctx.fillRect(0, y, 64, 1)
  }
  for (let y = 0; y < 64; y += 16) for (let x = 0; x < 64; x += 16) {
    ctx.fillStyle = '#7e8b9d'
    ctx.fillRect(x, y, 16, 1)
    ctx.fillRect(x, y, 1, 16)
    ctx.fillStyle = '#eef5f8'
    ctx.fillRect(x + 1, y + 1, 15, 1)
    ctx.fillStyle = '#64768a'
    ctx.fillRect(x + 3, y + 3, 1, 1)
    ctx.fillRect(x + 13, y + 13, 1, 1)
    ctx.fillStyle = '#a2b0bb'
    if (random() > 0.5) ctx.fillRect(x + 4, y + 11, 7, 1)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  return texture
}
