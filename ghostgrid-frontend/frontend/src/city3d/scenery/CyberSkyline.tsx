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
    // A hero tower carries fewer, fatter neon runs. The 0.05 strips below are thinner than a
    // rendered pixel at this scale (the canvas draws at 1/PIXEL_SIZE), so on a 10-unit tower
    // they break into dotted static instead of reading as an edge.
    const edge = b.tower ? 0.1 : 0.05
    const bandStep = b.tower ? 3.2 : 1.6
    for (const [ti, t] of b.tiers.entries()) {
      const hw = t.w / 2 + 0.02, hd = t.d / 2 + 0.02
      // On a tower only the shaft gets corner runs; lighting every setback stacked four more
      // sets of lines into the same silhouette.
      if (b.h > 2.2 && (!b.tower || ti === 0))
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
          solid.push({ p: [t.x + sx * hw, t.y + t.h / 2, t.z + sz * hd], s: [edge, t.h, edge], c })
      solid.push({ p: [t.x, t.y + t.h, t.z + hd], s: [t.w, edge, edge], c: c2 })
      solid.push({ p: [t.x + hw, t.y + t.h, t.z], s: [edge, edge, t.d], c: c2 })
      if (t.h > 2.5) for (let y = t.y + 1.4; y < t.y + t.h - 0.5; y += bandStep) {
        solid.push({ p: [t.x, y, t.z + hd], s: [t.w, edge * 0.7, edge * 0.7], c })
        solid.push({ p: [t.x + hw, y, t.z], s: [edge * 0.7, edge * 0.7, t.d], c })
      }
    }
    const top = b.tiers[b.tiers.length - 1]
    if (b.h > 5) {
      const m = b.tower ? 1.4 + r() * 1.2 : 1 + r() * 2.2
      solid.push({ p: [top.x, b.h + m / 2, top.z], s: [b.tower ? 0.1 : 0.06, m, b.tower ? 0.1 : 0.06], c: '#2a2050' })
      tips.push({ p: [top.x, b.h + m + 0.06, top.z], s: [0.14, 0.14, 0.14], c: '#ff004d' })
      // A tall mast carries a second lamp halfway up, the way a real aircraft-warning mast does.
      if (b.tower) tips.push({ p: [top.x, b.h + m * 0.55, top.z], s: [0.1, 0.1, 0.1], c: '#ff004d' })
    }
    // ---- crown: what makes a hero tower read as a skyscraper and not a tall box ----
    if (b.tower) {
      const hw = top.w / 2 + 0.03
      const hd = top.d / 2 + 0.03
      // One fat neon ring around the crown, in the tower's own colour: the single brightest
      // thing on the building, so the eye reads a top.
      solid.push({ p: [top.x, b.h - 0.16, top.z + hd], s: [top.w + 0.08, 0.18, 0.1], c })
      solid.push({ p: [top.x, b.h - 0.16, top.z - hd], s: [top.w + 0.08, 0.18, 0.1], c })
      solid.push({ p: [top.x + hw, b.h - 0.16, top.z], s: [0.1, 0.18, top.d + 0.08], c })
      solid.push({ p: [top.x - hw, b.h - 0.16, top.z], s: [0.1, 0.18, top.d + 0.08], c })
      // Two blades, not four: a pair reads as a crown, four reads as a hairbrush.
      const fin = 0.5 + r() * 0.45
      for (const sx of [-1, 1])
        solid.push({ p: [top.x + sx * hw, b.h + fin / 2, top.z], s: [0.12, fin, 0.12], c: c2 })
      // A lit shelf on the widest setback only, to catch the eye at the taper.
      if (b.tiers.length > 1) {
        const t = b.tiers[1]
        solid.push({ p: [t.x, t.y + 0.05, t.z], s: [t.w + 0.34, 0.1, t.d + 0.34], c: c2 })
      }
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
    // Static boxes, so a real bounding sphere lets three skip a whole plate's neon when the
    // camera is framed on the core. With culling off, all nine plates drew every frame.
    m.computeBoundingSphere()
    refOut?.(m)
  }, [parts, refOut])
  return <instancedMesh ref={ref} args={[BOX, mat, parts.length]} raycast={() => null} />
}

// Every plate of the 3x3 city draws the same two filler layouts, so the box lists and the three
// animated materials are shared per layout instead of rebuilt per mounted plate. Not disposed:
// the sets outlive any one plate and there are at most two of them (see Scenery.tsx).
const built = new WeakMap<SceneryBuilding[], ReturnType<typeof build>>()
const matsFor = new WeakMap<SceneryBuilding[], { solid: THREE.Material; holo: THREE.MeshBasicMaterial; tip: THREE.Material }>()

export function CyberSkyline({ buildings }: { buildings: SceneryBuilding[] }) {
  const d = useMemo(() => {
    let v = built.get(buildings)
    if (!v) built.set(buildings, (v = build(buildings)))
    return v
  }, [buildings])
  const mats = useMemo(() => {
    let v = matsFor.get(buildings)
    if (!v)
      matsFor.set(
        buildings,
        (v = {
          solid: new THREE.MeshBasicMaterial({ toneMapped: false }),
          holo: new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }),
          tip: new THREE.MeshBasicMaterial({ toneMapped: false }),
        }),
      )
    return v
  }, [buildings])
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
