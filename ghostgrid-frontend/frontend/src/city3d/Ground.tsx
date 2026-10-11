// The floating diorama base: platform slab, roads + raised sidewalks (ONE textured mesh), street
// props, traffic and the build-mode lease pads. About 10 draw calls in total, nothing casts shadows.
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { LeasePads } from './ground/LeasePads'
import { blockSpans, CURB, HALF, SLAB_DEPTH } from './ground/layout'
import { StreetProps } from './ground/StreetProps'
import { makeGroundTextures, makeSlabTextures } from './ground/textures'
import { Traffic } from './ground/Traffic'
import { MAP } from './world'

// Road plane (y = 0) + one raised box per block, merged. UVs come from world x/z so every part
// samples the same map-sized texture; block sides sample their (inset) edge texel = the curb color.
function buildSurface() {
  const S = MAP.size
  const parts: THREE.BufferGeometry[] = [new THREE.PlaneGeometry(S, S).rotateX(-Math.PI / 2)]
  const e = 0.02
  const spans = blockSpans()
  for (const [x0, x1] of spans)
    for (const [z0, z1] of spans) {
      const w = x1 - x0
      const d = z1 - z0
      const g = new THREE.BoxGeometry(w, CURB, d).translate(x0 + w / 2 - HALF, CURB / 2, z0 + d / 2 - HALF)
      const pos = g.attributes.position
      const uv = g.attributes.uv
      for (let i = 0; i < pos.count; i++) {
        const x = Math.min(x1 - HALF - e, Math.max(x0 - HALF + e, pos.getX(i)))
        const z = Math.min(z1 - HALF - e, Math.max(z0 - HALF + e, pos.getZ(i)))
        uv.setXY(i, (x + HALF) / S, 1 - (z + HALF) / S)
      }
      parts.push(g)
    }
  const merged = mergeGeometries(parts, false)
  parts.forEach((p) => p.dispose())
  return merged
}

export function Ground() {
  const r = useMemo(() => {
    const gt = makeGroundTextures()
    const st = makeSlabTextures()
    return {
      surface: buildSurface(),
      slab: new THREE.BoxGeometry(MAP.size, SLAB_DEPTH, MAP.size),
      groundMat: new THREE.MeshLambertMaterial({ map: gt.map, emissiveMap: gt.emissiveMap, emissive: '#ffffff', emissiveIntensity: 1.8 }),
      slabMat: new THREE.MeshLambertMaterial({ map: st.map, emissiveMap: st.emissiveMap, emissive: '#ffffff', emissiveIntensity: 1.6 }),
      // own instancing materials (white × instanceColor) so the shared flatMat/neonMat programs never toggle
      lit: new THREE.MeshLambertMaterial({ color: '#ffffff' }),
      glow: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
    }
  }, [])
  useEffect(
    () => () => {
      for (const m of [r.groundMat, r.slabMat]) {
        m.map?.dispose()
        m.emissiveMap?.dispose()
      }
      for (const x of [r.surface, r.slab, r.groundMat, r.slabMat, r.lit, r.glow]) x.dispose()
    },
    [r],
  )

  return (
    <group>
      {/* top sits just under the road plane, so only the textured sides show */}
      <mesh geometry={r.slab} material={r.slabMat} position={[0, -SLAB_DEPTH / 2 - 0.002, 0]} />
      <mesh geometry={r.surface} material={r.groundMat} receiveShadow />
      <StreetProps lit={r.lit} glow={r.glow} />
      <Traffic lit={r.lit} glow={r.glow} />
      <LeasePads glow={r.glow} />
    </group>
  )
}
