// Codex Tower: dense office/server tower that writes code.
// Voxel build: podium -> lower window shaft -> overhanging ledge -> set-back upper shaft -> roof cap
// with server racks, cooling fans and an antenna. A vertical neon "CODEX" blade sign hangs off the
// screen-left corner; one floating holo screen per session stacks beside the screen-right corner.
// Efficiency: 5 main meshes + 4 InstancedMeshes (neon trims + sign letters, props, status LEDs,
// fan blades) + at most 6 session panels. All animation mutates refs/materials in one useFrame.
import { useFrame } from '@react-three/fiber'
import { useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Session } from '../../types'
import { BuildingCtx } from '../BuildingCtx'
import { facadeCols, facadeRows, flatMat, neonMat, PALETTE, UNIT_BOX, useFacadeMaterial } from '../materials'

interface Part {
  p: [number, number, number]
  s: [number, number, number]
  c: string
  ry?: number
  k?: number // color multiplier
}

const Q = Math.PI / 4 // rotation that makes a box face the iso camera
const S = Math.SQRT1_2
const MAX_PANELS = 6
const PANEL_STEP = 0.58

// Shared, cached materials (never mutated here). Instance colors tint the white ones.
const TRIM_MAT = neonMat('#ffffff', 2)
const PROP_MAT = flatMat('#ffffff')
const BLADE_MAT = flatMat('#8f8ab8')
const PODIUM_MAT = flatMat(PALETTE.dusk)
const LEDGE_MAT = flatMat(PALETTE.steel)
const ROOF_MAT = flatMat(PALETTE.haze)

const C_GREEN = new THREE.Color(PALETTE.green)
const C_CYAN = new THREE.Color(PALETTE.cyan)
const C_YELLOW = new THREE.Color(PALETTE.yellow)
const C_RED = new THREE.Color(PALETTE.red)
const C_GREY = new THREE.Color(PALETTE.grey)
const C_INK = new THREE.Color(PALETTE.ink)

const tmp = new THREE.Object3D()
const tmpColor = new THREE.Color()
const noRaycast = () => {}

// 3x5 pixel font for the blade sign.
const FONT: Record<string, string[]> = {
  C: ['###', '#..', '#..', '#..', '###'],
  O: ['###', '#.#', '#.#', '#.#', '###'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
}

function applyParts(mesh: THREE.InstancedMesh, parts: Part[], withColor: boolean) {
  parts.forEach((pt, i) => {
    tmp.position.set(pt.p[0], pt.p[1], pt.p[2])
    tmp.rotation.set(0, pt.ry ?? 0, 0)
    tmp.scale.set(pt.s[0], pt.s[1], pt.s[2])
    tmp.updateMatrix()
    mesh.setMatrixAt(i, tmp.matrix)
    if (withColor) mesh.setColorAt(i, tmpColor.set(pt.c).multiplyScalar(pt.k ?? 1))
  })
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.computeBoundingSphere()
}

function setBlades(mesh: THREE.InstancedMesh, fans: [number, number][], y: number, angle: number, rs = 1) {
  for (let f = 0; f < fans.length; f++) {
    for (let b = 0; b < 2; b++) {
      tmp.position.set(fans[f][0], y, fans[f][1])
      tmp.rotation.set(0, angle + b * (Math.PI / 2) + f * 0.4, 0)
      tmp.scale.set(0.5 * rs, 0.04, 0.1 * rs)
      tmp.updateMatrix()
      mesh.setMatrixAt(f * 2 + b, tmp.matrix)
    }
  }
  mesh.instanceMatrix.needsUpdate = true
}

// Small "code lines" screen texture: grey background, white lines (tinted by material color).
function makeScreenTexture() {
  const c = document.createElement('canvas')
  c.width = 6
  c.height = 16
  const g = c.getContext('2d')!
  g.fillStyle = '#5a5a5a'
  g.fillRect(0, 0, 6, 16)
  g.fillStyle = '#ffffff'
  const lines: [number, number][] = [[0, 4], [1, 3], [1, 4], [2, 2], [0, 5], [1, 2], [2, 3], [0, 3]] // [indent, length]
  lines.forEach(([ind, len], i) => g.fillRect(ind, i * 2, len, 1))
  const t = new THREE.CanvasTexture(c)
  t.magFilter = THREE.NearestFilter
  t.minFilter = THREE.NearestFilter
  t.generateMipmaps = false
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(1, 0.25)
  return t
}

export function CodexTower() {
  const { footprint, height: H, building, statusRef, offlineRef } = useContext(BuildingCtx)
  const W = footprint.w
  const D = footprint.d

  // ---- layout (pure numbers; recomputed only if the lot or height changes) ----
  const L = useMemo(() => {
    // authored for a 2.6 x 5 tower; the roof cluster and the blade sign scale with the real one
    const rs = Math.sqrt(Math.max(1, W / 2.6))
    const podH = 0.4
    const lw = W * 0.84
    const ld = D * 0.84
    const lowTop = H * 0.62
    const lh = lowTop - podH
    const edW = W * 0.94
    const edD = D * 0.94
    const edH = 0.14
    const upB = lowTop + edH
    const uw = W * 0.66
    const ud = D * 0.66
    const uh = H - 0.04 - upB // top hides inside the roof cap (no z-fighting)

    const trims: Part[] = []
    const props: Part[] = []
    const leds: Part[] = []
    const box = (arr: Part[], p: Part['p'], s: Part['s'], c: string, ry?: number, k?: number) => arr.push({ p, s, c, ry, k })
    const G = PALETTE.green

    // neon vertical corners on both shafts
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      box(trims, [(sx * lw) / 2, podH + lh / 2, (sz * ld) / 2], [0.1, lh, 0.1], G)
      box(trims, [(sx * uw) / 2, upB + uh / 2, (sz * ud) / 2], [0.1, uh, 0.1], G)
    }
    // neon rings: podium edge (pink), ledge edge, roof edge
    const ring = (w: number, d: number, y: number, c: string) => {
      const t = 0.08
      box(trims, [0, y, d / 2], [w + t, t, t], c)
      box(trims, [0, y, -d / 2], [w + t, t, t], c)
      box(trims, [w / 2, y, 0], [t, t, d], c)
      box(trims, [-w / 2, y, 0], [t, t, d], c)
    }
    ring(W, D, podH, PALETTE.pink)
    ring(edW, edD, lowTop + edH / 2, G)
    ring(uw + 0.06, ud + 0.06, H, G)
    // lobby glow on the two camera-facing podium faces
    box(trims, [0, 0.2, D / 2 + 0.01], [W * 0.5, 0.16, 0.02], PALETTE.cyan, 0, 0.6)
    box(trims, [W / 2 + 0.01, 0.2, 0], [0.02, 0.16, D * 0.5], PALETTE.cyan, 0, 0.6)

    // ---- vertical "CODEX" blade sign, camera-facing, off the screen-left (-x,+z) corner ----
    const off = 0.42
    const bx = -lw / 2 - off
    const bz = ld / 2 + off
    const toW = (lx: number, ly: number, lz: number): [number, number, number] => [bx + (lx + lz) * S, ly, bz + (lz - lx) * S]
    const rows = 5 * 5 + 4 // 5 letters, 1-row gaps
    // one font pixel: the blade fills the lower shaft (clamped so small lots stay readable)
    const px = Math.max(0.08, Math.min(0.26, (lowTop - 1.1) / rows))
    const plateH = rows * px + 2 * px
    const plateW = Math.max(0.56, px * 5.6)
    const y0 = 0.6
    const yc = y0 + plateH / 2
    const cornerX = 2 * off * S // corner position along the blade's local x
    box(props, toW(0, yc, 0), [plateW, plateH, 0.06], PALETTE.void, Q)
    box(props, toW((plateW / 2 + cornerX) / 2, 1.1, 0), [cornerX - plateW / 2 + 0.06, 0.08, 0.08], PALETTE.steel, Q)
    box(props, toW((plateW / 2 + cornerX) / 2, lowTop - 0.15, 0), [cornerX - plateW / 2 + 0.06, 0.08, 0.08], PALETTE.steel, Q)
    box(trims, toW(plateW / 2, yc, 0), [0.08, plateH, 0.08], PALETTE.pink, Q)
    box(trims, toW(-plateW / 2, yc, 0), [0.08, plateH, 0.08], PALETTE.pink, Q)
    const textTop = y0 + plateH - px
    'CODEX'.split('').forEach((ch, li) => {
      FONT[ch].forEach((line, r) => {
        for (let c = 0; c < 3; c++) {
          if (line[c] !== '#') continue
          const y = textTop - (li * 6 + r + 0.5) * px
          box(trims, toW((c - 1) * px, y, 0.05), [px, px, 0.04], G, Q)
        }
      })
    })

    // ---- roof: server racks (LED faces on +x), cooling fans, antenna ----
    const rackX = -uw / 2 + 0.3 * rs
    for (const rz of [-0.3, 0.06, 0.42]) {
      const z = rz * rs
      box(props, [rackX, H + 0.25 * rs, z], [0.3 * rs, 0.5 * rs, 0.32 * rs], PALETTE.night)
      box(leds, [rackX + 0.165 * rs, H + 0.36 * rs, z], [0.03, 0.08 * rs, 0.24 * rs], '#fff')
      box(leds, [rackX + 0.165 * rs, H + 0.18 * rs, z], [0.03, 0.08 * rs, 0.24 * rs], '#fff')
    }
    const fans: [number, number][] = [
      [uw / 2 - 0.5 * rs, -0.38 * rs],
      [uw / 2 - 0.5 * rs, 0.36 * rs],
    ]
    for (const [fx, fz] of fans) box(props, [fx, H + 0.07 * rs, fz], [0.6 * rs, 0.14 * rs, 0.6 * rs], PALETTE.steel)
    const ant: [number, number] = [-uw / 2 + 0.2 * rs, -ud / 2 + 0.2 * rs]
    const antH = 1.5 * Math.sqrt(Math.max(1, H / 5))
    box(props, [ant[0], H + antH / 2, ant[1]], [0.1 * rs, antH, 0.1 * rs], PALETTE.steel)
    box(props, [ant[0], H + antH * 0.73, ant[1]], [0.4 * rs, 0.08, 0.08], PALETTE.steel)
    box(leds, [ant[0], H + antH + 0.08, ant[1]], [0.16 * rs, 0.16 * rs, 0.16 * rs], '#fff')

    // ---- AC units on the two visible terraces of the ledge ----
    const tr = (uw / 2 + edW / 2) / 2
    for (const v of [-0.35, 0.35]) {
      const o = v * rs
      box(props, [tr, upB + 0.09 * rs, o], [0.26 * rs, 0.18 * rs, 0.32 * rs], PALETTE.grey)
      box(props, [o, upB + 0.09 * rs, tr], [0.32 * rs, 0.18 * rs, 0.26 * rs], PALETTE.grey)
    }

    // ---- holo projector beside the screen-right (+x,-z) corner ----
    const hr = (edW / 2) * Math.SQRT2 + 0.37 // clears the ledge corner
    const hx = hr * S
    const hz = -hr * S
    box(props, [hx, 0.07, hz], [0.5, 0.14, 0.3], PALETTE.steel, Q)
    box(trims, [hx, 0.15, hz], [0.4, 0.04, 0.2], PALETTE.cyan, Q, 0.8)

    return { podH, lw, ld, lh, lowTop, edW, edD, edH, upB, uw, ud, uh, trims, props, leds, fans, hx, hz, rs }
  }, [W, D, H])

  // ---- materials ----
  const lowFacade = useFacadeMaterial({ cols: facadeCols(L.lw), rows: facadeRows(L.lh), seed: 21, tint: PALETTE.green })
  const upFacade = useFacadeMaterial({ cols: facadeCols(L.uw), rows: facadeRows(L.uh), seed: 22, tint: PALETTE.green })

  const ledMat = useMemo(() => new THREE.MeshBasicMaterial({ color: PALETTE.cyan, toneMapped: false }), [])
  const holo = useMemo(() => {
    const run = makeScreenTexture()
    const still = run.clone() // shares the image source on the GPU
    const mk = (map: THREE.Texture, c: THREE.Color, k: number) =>
      new THREE.MeshBasicMaterial({ map, color: c.clone().multiplyScalar(k), toneMapped: false })
    const mats: Record<Session['status'], THREE.MeshBasicMaterial> = {
      running: mk(run, C_GREEN, 1.8),
      queued: mk(still, C_CYAN, 0.7),
      done: mk(still, C_INK, 0.45),
      error: mk(still, C_RED, 1.6),
    }
    return { run, still, mats }
  }, [])
  useEffect(
    () => () => {
      ledMat.dispose()
      holo.run.dispose()
      holo.still.dispose()
      Object.values(holo.mats).forEach((m) => m.dispose())
    },
    [ledMat, holo],
  )

  // ---- instanced meshes: set matrices once ----
  const trimRef = useRef<THREE.InstancedMesh>(null)
  const propRef = useRef<THREE.InstancedMesh>(null)
  const ledRef = useRef<THREE.InstancedMesh>(null)
  const bladeRef = useRef<THREE.InstancedMesh>(null)
  const holoRef = useRef<THREE.Group>(null)
  const fanAngle = useRef(0)

  useLayoutEffect(() => {
    if (trimRef.current) applyParts(trimRef.current, L.trims, true)
    if (propRef.current) applyParts(propRef.current, L.props, true)
    if (ledRef.current) applyParts(ledRef.current, L.leds, false)
    if (bladeRef.current) {
      setBlades(bladeRef.current, L.fans, H + 0.16 * L.rs, fanAngle.current, L.rs)
      bladeRef.current.computeBoundingSphere()
    }
  }, [L, H])

  // ---- per-frame animation (refs + material mutation only) ----
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime
    const st = statusRef.current
    const off = offlineRef.current && st === 'idle'

    // cooling fans: fast while working, stutter on error, stopped when offline
    const speed = off
      ? 0
      : st === 'working'
        ? 16
        : st === 'error'
          ? Math.floor(t / 0.3) % 2
            ? 0
            : 9
          : st === 'needs_approval'
            ? 1.5
            : 4
    if (speed > 0 && bladeRef.current) {
      fanAngle.current += speed * Math.min(dt, 0.1)
      setBlades(bladeRef.current, L.fans, H + 0.16 * L.rs, fanAngle.current, L.rs)
    }

    // rack LEDs + antenna tip follow the building status
    let col = C_CYAN
    let k = 1.2
    if (off) {
      col = C_GREY
      k = 0.6
    } else if (st === 'working') {
      col = C_GREEN
      k = Math.floor(t * 6) % 2 ? 2.6 : 0.8
    } else if (st === 'error') {
      col = C_RED
      k = Math.floor(t / 0.3) % 2 ? 2.4 : 0.3
    } else if (st === 'needs_approval') {
      col = C_YELLOW
      k = Math.floor(t / 0.4) % 2 ? 2.2 : 1
    }
    ledMat.color.copy(col).multiplyScalar(k)

    // session screens: running = scrolling code + pulse, error = blink
    holo.run.offset.y = -Math.floor(t * 8) / 16
    holo.mats.running.color.copy(C_GREEN).multiplyScalar(Math.floor(t / 0.35) % 2 ? 2.2 : 1.4)
    holo.mats.error.color.copy(C_RED).multiplyScalar(Math.floor(t / 0.3) % 2 ? 1.8 : 0.35)
    if (holoRef.current) holoRef.current.position.y = (Math.floor(t * 1.5) % 2) * 0.06
  })

  // panel set re-renders only when building.sessions changes
  const sessions = (building?.sessions ?? []).slice(0, MAX_PANELS)
  const n = sessions.length
  const holoScale = Math.sqrt(Math.max(1, H / 5))
  const holoMid = 2.3 * holoScale

  return (
    <group>
      {/* podium */}
      <mesh geometry={UNIT_BOX} material={PODIUM_MAT} position={[0, L.podH / 2, 0]} scale={[W, L.podH, D]} castShadow receiveShadow />
      {/* lower window shaft */}
      <mesh
        geometry={UNIT_BOX}
        material={lowFacade}
        position={[0, L.podH + L.lh / 2, 0]}
        scale={[L.lw, L.lh, L.ld]}
        castShadow
        receiveShadow
      />
      {/* overhanging ledge / terrace */}
      <mesh
        geometry={UNIT_BOX}
        material={LEDGE_MAT}
        position={[0, L.lowTop + L.edH / 2, 0]}
        scale={[L.edW, L.edH, L.edD]}
        castShadow
        receiveShadow
      />
      {/* set-back upper shaft */}
      <mesh
        geometry={UNIT_BOX}
        material={upFacade}
        position={[0, L.upB + L.uh / 2, 0]}
        scale={[L.uw, L.uh, L.ud]}
        castShadow
        receiveShadow
      />
      {/* roof cap: top face sits exactly at the building height */}
      <mesh geometry={UNIT_BOX} material={ROOF_MAT} position={[0, H - 0.04, 0]} scale={[L.uw + 0.06, 0.08, L.ud + 0.06]} receiveShadow />

      <instancedMesh ref={trimRef} args={[UNIT_BOX, TRIM_MAT, L.trims.length]} raycast={noRaycast} />
      <instancedMesh ref={propRef} args={[UNIT_BOX, PROP_MAT, L.props.length]} />
      <instancedMesh ref={ledRef} args={[UNIT_BOX, ledMat, L.leds.length]} raycast={noRaycast} />
      <instancedMesh ref={bladeRef} args={[UNIT_BOX, BLADE_MAT, L.fans.length * 2]} raycast={noRaycast} />

      {/* session holo screens, camera-facing column beside the screen-right corner */}
      <group position={[L.hx, 0, L.hz]} rotation={[0, Q, 0]}>
        <group ref={holoRef}>
          {sessions.map((s, i) => (
            <mesh
              key={s.id}
              geometry={UNIT_BOX}
              material={holo.mats[s.status]}
              position={[0, holoMid + ((n - 1) / 2 - i) * PANEL_STEP * holoScale, (i % 2) * 0.14]}
              scale={[0.6 * holoScale, 0.4 * holoScale, 0.04]}
            />
          ))}
        </group>
      </group>
    </group>
  )
}
