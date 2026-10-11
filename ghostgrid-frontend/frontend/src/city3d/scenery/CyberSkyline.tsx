// Cyberpunk dressing for the filler skyline: neon corner edges, glowing floor bands, rooftop
// spires with blinking tips, and pulsing holo billboards. One InstancedMesh per material.
// Undo: remove <CyberSkyline/> from Scenery.tsx.
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { NEONS, type SceneryBuilding } from './layout'

type P = { p: [number, number, number]; s: [number, number, number]; c: string }
const BOX = new THREE.BoxGeometry(1, 1, 1)

function rng(seed: number) {
  let a = seed * 9301 + 49297
  return () => ((a = (a * 9301 + 49297) % 233280) / 233280)
}

function build(bs: SceneryBuilding[]) {
  const solid: P[] = [], holo: P[] = [], tips: P[] = []
  for (const b of bs) {
    const r = rng(b.seed + 7)
    const c = NEONS[b.neon % NEONS.length]
    const c2 = NEONS[(b.neon + 3) % NEONS.length]
    for (const t of b.tiers) {
      const hw = t.w / 2 + 0.02, hd = t.d / 2 + 0.02
      if (b.h > 2.2)
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
          solid.push({ p: [t.x + sx * hw, t.y + t.h / 2, t.z + sz * hd], s: [0.05, t.h, 0.05], c })
      solid.push({ p: [t.x, t.y + t.h, t.z + hd], s: [t.w, 0.05, 0.05], c: c2 })
      solid.push({ p: [t.x + hw, t.y + t.h, t.z], s: [0.05, 0.05, t.d], c: c2 })
      if (t.h > 2.5) for (let y = t.y + 1.4; y < t.y + t.h - 0.5; y += 1.6) {
        solid.push({ p: [t.x, y, t.z + hd], s: [t.w, 0.035, 0.035], c })
        solid.push({ p: [t.x + hw, y, t.z], s: [0.035, 0.035, t.d], c })
      }
    }
    const top = b.tiers[b.tiers.length - 1]
    if (b.h > 5) {
      const m = 1 + r() * 2.2
      solid.push({ p: [top.x, b.h + m / 2, top.z], s: [0.06, m, 0.06], c: '#2a2050' })
      tips.push({ p: [top.x, b.h + m + 0.06, top.z], s: [0.14, 0.14, 0.14], c: '#ff004d' })
    }
    if (b.h > 3 && r() < 0.55) {
      const bh = Math.min(2.4, b.h * 0.35), y = b.h * (0.4 + r() * 0.3)
      if (r() < 0.5) holo.push({ p: [b.x, y, b.z + b.d / 2 + 0.12], s: [b.w * 0.75, bh, 0.03], c: r() < 0.5 ? c : c2 })
      else holo.push({ p: [b.x + b.w / 2 + 0.12, y, b.z], s: [0.03, bh, b.d * 0.75], c: r() < 0.5 ? c : c2 })
    }
  }
  return { solid, holo, tips }
}

function Inst({ parts, mat, refOut }: { parts: P[]; mat: THREE.Material; refOut?: (m: THREE.InstancedMesh) => void }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useEffect(() => {
    const m = ref.current!, o = new THREE.Object3D(), col = new THREE.Color()
    parts.forEach((q, i) => {
      o.position.set(...q.p); o.scale.set(...q.s); o.updateMatrix()
      m.setMatrixAt(i, o.matrix); m.setColorAt(i, col.set(q.c))
    })
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    refOut?.(m)
  }, [parts, refOut])
  return <instancedMesh ref={ref} args={[BOX, mat, parts.length]} raycast={() => null} frustumCulled={false} />
}

export function CyberSkyline({ buildings }: { buildings: SceneryBuilding[] }) {
  const d = useMemo(() => build(buildings), [buildings])
  const mats = useMemo(() => ({
    solid: new THREE.MeshBasicMaterial({ toneMapped: false }),
    holo: new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }),
    tip: new THREE.MeshBasicMaterial({ toneMapped: false }),
  }), [])
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    mats.holo.opacity = 0.4 + 0.3 * Math.abs(Math.sin(t * 1.7)) * (Math.floor(t * 8) % 13 === 0 ? 0.2 : 1)
    mats.tip.visible = Math.floor(t * 1.4) % 2 === 0
  })
  return (
    <group>
      {d.solid.length > 0 && <Inst parts={d.solid} mat={mats.solid} />}
      {d.holo.length > 0 && <Inst parts={d.holo} mat={mats.holo} />}
      {d.tips.length > 0 && <Inst parts={d.tips} mat={mats.tip} />}
    </group>
  )
}
