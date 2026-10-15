// The stuff an office accumulates: the furniture nobody specced, pushed against the walls.
//
// Why a separate module, and why merged: ProjectOffices draws a room from <Block/>, which builds
// a fresh BoxGeometry *and* a fresh material per call. That is fine for the dozen pieces that
// make the shell, but the empty floor needs ~20 props per room and three rooms are on screen, so
// the obvious approach costs a few hundred draw calls on a page that was just taken from 1130 to
// 574. Everything here is static, so the whole set bakes into one merged geometry with vertex
// colours — one draw call per room, plus a second for the few pieces that glow.
//
// Art direction is ProjectOffices': a 2008 corporate office, not a nightclub. Beige, grey loop
// pile, laminate, steel. The project's accent appears only where a real office would have one —
// a chair back, a binder spine, the sign on a door. Nothing here is neon.
//
// HEIGHT IS THE HARD CONSTRAINT HERE. The room is a doll-house cutaway under a fixed iso
// camera: the two full-height walls are the FAR ones (-x and -z), and the near two are knee-high
// so the camera can see in. Height moves a thing UP the screen, so anything tall on the near side
// sits between the camera and the people behind it. Four separate attempts at a ceiling had to be
// torn out for exactly this reason, so:
//
//   * near walls (+x, +z) and open floor: nothing above DESK_TOP_Y. Seating, bins, boxes, rugs.
//   * far walls (-x, -z): up to FAR_MAX, which stays under the cornice and reads as backdrop
//     behind the desks rather than in front of them.
//   * nothing hangs and nothing spans. If a prop should read as lit, light the carpet.
//
// Placement is a perimeter band: props hug the walls and fill the corners, which is where the
// empty floor actually is, and leaves the aisle and the desks in the middle alone.
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// ---- palette: office supply catalogue, not a mood board ----
const P = {
  steel: '#8e8b85',
  darkSteel: '#5d5a56',
  beige: '#c9c2b2',
  paper: '#efe9dc',
  wood: '#a8835c',
  darkWood: '#7d6246',
  fabric: '#49535e',
  plantPot: '#9c6a4a',
  leaf: '#4b7a4e',
  leafDark: '#3c6440',
  black: '#2b2b2e',
  white: '#e8e6e0',
  cardboard: '#b89468',
  red: '#a8382f',
  glass: '#9fb6c4',
  screen: '#1d2733',
}

const DESK_TOP_Y = 0.78 // a desk surface; the near side may not exceed this
const FAR_MAX = 1.45 // tallest a prop may stand against a full-height far wall

interface Piece { x: number; y: number; z: number; w: number; h: number; d: number; c: string }

/** A tiny builder so each prop reads as a list of boxes rather than JSX noise. */
function makeShop(out: Piece[], ox: number, oz: number, flip: number) {
  // `flip` mirrors a prop along x so the same code serves the left and right walls.
  return (x: number, y: number, z: number, w: number, h: number, d: number, c: string) =>
    out.push({ x: ox + x * flip, y, z: oz + z, w, h, d, c })
}

// ---------- individual props ----------
// Each takes a placement helper and draws itself around the origin it was given.

function plant(at: ReturnType<typeof makeShop>, big: boolean) {
  // The small one is a near-side plant, so its tallest leaf has to clear a desk top.
  const s = big ? 1 : 0.6
  at(0, 0.17 * s, 0, 0.42 * s, 0.34 * s, 0.42 * s, P.plantPot)
  at(0, 0.36 * s, 0, 0.46 * s, 0.05 * s, 0.46 * s, P.darkWood)
  at(0, 0.72 * s, 0, 0.09 * s, 0.68 * s, 0.09 * s, P.leafDark)
  for (const [dx, dz, dy] of [[0.2, 0.05, 1.0], [-0.17, -0.12, 0.88], [0.04, -0.2, 1.12]] as const) {
    at(dx * s, dy * s, dz * s, 0.34 * s, 0.1 * s, 0.3 * s, P.leaf)
  }
  if (big) at(0.02, 1.3, 0.02, 0.22, 0.1, 0.2, P.leafDark)
}

function filingCabinet(at: ReturnType<typeof makeShop>, drawers: number, accent: string) {
  const h = 0.3 * drawers
  at(0, h / 2, 0, 0.5, h, 0.46, P.steel)
  for (let i = 0; i < drawers; i++) {
    at(0, 0.15 + i * 0.3, 0.24, 0.44, 0.24, 0.03, P.beige)
    at(0, 0.15 + i * 0.3, 0.27, 0.16, 0.03, 0.02, P.darkSteel)
  }
  // Something is always left on top of the cabinets.
  at(-0.1, h + 0.05, 0, 0.2, 0.1, 0.26, P.paper)
  at(0.14, h + 0.06, 0.02, 0.1, 0.12, 0.1, accent)
}

function bookshelf(at: ReturnType<typeof makeShop>, accent: string) {
  // Three shelves, not five: capped at FAR_MAX so it stays a backdrop against the far wall.
  at(0, 0.71, 0, 0.9, 1.42, 0.34, P.darkWood)
  at(0, 0.71, 0.02, 0.82, 1.34, 0.3, '#6a523c')
  const spines = [P.red, P.paper, accent, P.fabric, P.wood, P.white]
  for (let shelf = 0; shelf < 3; shelf++) {
    const y = 0.26 + shelf * 0.42
    at(0, y - 0.03, 0, 0.84, 0.04, 0.32, P.darkWood)
    for (let i = 0; i < 7; i++) {
      const lean = (shelf + i) % 5 === 0
      at(-0.33 + i * 0.11, y + (lean ? 0.14 : 0.16), 0, 0.09, lean ? 0.26 : 0.3, 0.26, spines[(shelf * 3 + i) % spines.length])
    }
  }
}

function waterCooler(at: ReturnType<typeof makeShop>) {
  at(0, 0.45, 0, 0.34, 0.9, 0.34, P.white)
  at(0, 1.08, 0, 0.3, 0.36, 0.3, P.glass)
  at(0, 0.62, 0.18, 0.1, 0.08, 0.04, P.darkSteel)
  at(0.12, 0.98, 0.18, 0.09, 0.14, 0.09, P.white) // cup stack
}

function printer(at: ReturnType<typeof makeShop>, accent: string) {
  at(0, 0.3, 0, 0.72, 0.6, 0.56, P.steel) // stand
  at(0, 0.78, 0, 0.78, 0.36, 0.6, P.beige)
  at(0, 0.98, 0, 0.6, 0.06, 0.44, P.white) // output tray
  at(0.26, 0.98, 0.18, 0.12, 0.03, 0.1, accent)
  at(-0.2, 1.04, -0.1, 0.3, 0.06, 0.26, P.paper) // the stack nobody collected
}

function sofa(at: ReturnType<typeof makeShop>, accent: string) {
  at(0, 0.2, 0, 1.7, 0.4, 0.74, P.fabric)
  at(0, 0.5, -0.3, 1.7, 0.5, 0.16, P.fabric)
  for (const sx of [-1, 1]) at(sx * 0.82, 0.38, 0, 0.14, 0.36, 0.74, P.fabric)
  for (const sx of [-1, 1]) at(sx * 0.42, 0.44, -0.16, 0.6, 0.12, 0.3, accent) // cushions
  for (const [cx, cz] of [[-0.75, 0.3], [0.75, 0.3], [-0.75, -0.3], [0.75, -0.3]] as const) {
    at(cx, 0.05, cz, 0.08, 0.1, 0.08, P.darkWood)
  }
}

function coffeeTable(at: ReturnType<typeof makeShop>) {
  at(0, 0.36, 0, 0.9, 0.06, 0.56, P.wood)
  for (const [cx, cz] of [[-0.38, 0.22], [0.38, 0.22], [-0.38, -0.22], [0.38, -0.22]] as const) {
    at(cx, 0.17, cz, 0.06, 0.34, 0.06, P.darkSteel)
  }
  at(-0.18, 0.41, 0.04, 0.26, 0.04, 0.2, P.paper) // magazines
  at(0.2, 0.44, -0.04, 0.09, 0.11, 0.09, P.white) // somebody's mug
}

function whiteboard(at: ReturnType<typeof makeShop>, accent: string) {
  at(0, 1.02, 0, 1.5, 0.78, 0.05, P.white)
  at(0, 1.02, 0.03, 1.4, 0.68, 0.02, '#f6f4ee')
  at(0, 0.6, 0, 1.54, 0.06, 0.09, P.steel) // pen tray
  for (const [mx, my, mw] of [[-0.4, 1.2, 0.5], [-0.3, 1.06, 0.34], [0.3, 1.14, 0.42]] as const) {
    at(mx, my, 0.05, mw, 0.035, 0.01, accent)
  }
  at(0.2, 0.9, 0.05, 0.26, 0.035, 0.01, P.red)
}

function pinboard(at: ReturnType<typeof makeShop>, accent: string) {
  at(0, 1.05, 0, 1.1, 0.66, 0.04, P.cardboard)
  at(0, 1.05, 0.025, 1.16, 0.72, 0.02, P.darkWood)
  const notes = [P.paper, '#e8d98a', '#cfe3d0', accent, P.white]
  for (let i = 0; i < 8; i++) {
    const col = i % 4, row = Math.floor(i / 4)
    at(-0.36 + col * 0.24, 1.2 - row * 0.24, 0.04, 0.17, 0.17, 0.01, notes[i % notes.length])
  }
}

function rug(at: ReturnType<typeof makeShop>, accent: string, w: number, d: number) {
  at(0, 0.012, 0, w, 0.024, d, '#6b6358')
  at(0, 0.02, 0, w - 0.3, 0.02, d - 0.3, '#776e61')
  at(0, 0.026, 0, w - 1.1, 0.02, d - 0.9, accent)
}

function crates(at: ReturnType<typeof makeShop>) {
  at(0, 0.18, 0, 0.5, 0.36, 0.44, P.cardboard)
  at(0.04, 0.54, -0.02, 0.46, 0.34, 0.4, P.cardboard)
  at(0, 0.36, 0.23, 0.4, 0.04, 0.02, P.paper) // tape
  at(-0.3, 0.14, 0.26, 0.34, 0.28, 0.3, P.cardboard)
}

function bins(at: ReturnType<typeof makeShop>, accent: string) {
  for (const [i, c] of [P.darkSteel, accent, '#4e6a52'].entries()) {
    at(i * 0.34, 0.22, 0, 0.3, 0.44, 0.3, c)
    at(i * 0.34, 0.45, 0, 0.33, 0.03, 0.33, P.black)
  }
}

function coatRack(at: ReturnType<typeof makeShop>, accent: string) {
  at(0, 0.71, 0, 0.07, 1.42, 0.07, P.darkSteel)
  at(0, 0.04, 0, 0.42, 0.08, 0.42, P.darkSteel)
  at(0, 1.38, 0, 0.44, 0.06, 0.1, P.darkSteel)
  at(-0.16, 1.08, 0.04, 0.22, 0.5, 0.1, accent) // a coat left behind
  at(0.17, 1.2, 0.03, 0.17, 0.28, 0.08, P.fabric)
}

function deskFan(at: ReturnType<typeof makeShop>) {
  at(0, 0.62, 0, 0.3, 0.3, 0.08, P.white)
  at(0, 0.62, 0.03, 0.22, 0.22, 0.03, P.glass)
  at(0, 0.3, 0, 0.06, 0.64, 0.06, P.steel)
  at(0, 0.03, 0, 0.26, 0.06, 0.26, P.white)
}

function extinguisher(at: ReturnType<typeof makeShop>) {
  at(0, 0.56, 0, 0.14, 0.4, 0.14, P.red)
  at(0, 0.8, 0, 0.06, 0.1, 0.06, P.darkSteel)
  at(0, 0.3, 0, 0.1, 0.12, 0.1, P.darkSteel)
}

// ---------- the floor plan of all that ----------
// Rooms are at least 15.8 x 13 (projectOffice.MIN_W/MIN_D) and the desks keep SIDE_WALK = 1.6
// clear of the side walls and FRONT_WALK = 2.6 inside the door, so the safe band for props is
// that perimeter. Pieces are spread along the full length of each wall rather than clustered in
// one corner — at this size a few props by the door leave most of the floor bare.
function layout(innerW: number, innerD: number, accent: string, seed: number) {
  const solid: Piece[] = []
  const hw = innerW / 2
  const hd = innerD / 2
  const wall = 0.36 // how far a prop's centre sits off the wall
  const r = (n: number) => ((seed * 9301 + n * 49297) % 233280) / 233280
  // Lerp along a wall, as a fraction of its usable run.
  const alongZ = (t: number) => -hd + 0.8 + t * (innerD - 2.4)
  const alongX = (t: number) => -hw + 0.9 + t * (innerW - 1.8)

  // ---- far walls first. -z (back) and -x (left) are the full-height pair, so anything with
  // height stands here, where it reads as backdrop behind the desks instead of in front of them.
  filingCabinet(makeShop(solid, -hw + 0.95, -hd + wall, 1), 3, accent)
  filingCabinet(makeShop(solid, -hw + 1.58, -hd + wall, 1), 2, accent)
  pinboard(makeShop(solid, -hw + 1.3, -hd + 0.14, 1), accent)
  bookshelf(makeShop(solid, hw - 1.1, -hd + wall, 1), accent)
  crates(makeShop(solid, hw - 2.1, -hd + 0.5 + r(1) * 0.3, 1))

  plant(makeShop(solid, -hw + wall, alongZ(0.14), 1), true)
  waterCooler(makeShop(solid, -hw + wall, alongZ(0.3), 1))
  printer(makeShop(solid, -hw + 0.45, alongZ(0.46), 1), accent)
  whiteboard(makeShop(solid, -hw + 0.12, alongZ(0.62), 1), accent)
  coatRack(makeShop(solid, -hw + 0.5, alongZ(0.76), 1), accent)
  extinguisher(makeShop(solid, -hw + 0.14, alongZ(0.88), 1))

  // ---- near side: the knee-high walls the camera looks through. Nothing here may rise above a
  // desk, so it is all seating, floor and things that live on the ground.
  bins(makeShop(solid, hw - 0.6, alongZ(0.3), 1), accent)
  deskFan(makeShop(solid, hw - 0.45, alongZ(0.46), 1))
  crates(makeShop(solid, hw - 0.7, alongZ(0.62), 1))
  plant(makeShop(solid, hw - 0.5, alongZ(0.8), 1), false)

  // ---- front band, inside the door: the breakout nobody books. All of it sits low.
  const breakZ = hd - 1.25
  rug(makeShop(solid, alongX(0.24), breakZ, 1), accent, 3.6, 2.5)
  sofa(makeShop(solid, alongX(0.24), breakZ - 0.75, 1), accent)
  coffeeTable(makeShop(solid, alongX(0.24), breakZ + 0.4, 1))
  plant(makeShop(solid, alongX(0.05), breakZ - 0.15, 1), false)
  bins(makeShop(solid, alongX(0.62), hd - 0.55, 1), accent)
  crates(makeShop(solid, alongX(0.78), hd - 0.6, 1))

  // The height rule, enforced rather than described. A prop hugging a far wall may stand up to
  // FAR_MAX; everything else has to clear the sight line to the people, so it stops at a desk top.
  //
  // It CLAMPS and warns rather than throwing: this runs inside the <Canvas>, and an exception
  // there unmounts the whole page rather than dropping one prop — a blank office, not a missing
  // pot plant. A clamped prop looks slightly squat; a thrown one costs the user the screen.
  for (const piece of solid) {
    const againstFarWall = piece.x <= -hw + 1.3 || piece.z <= -hd + 1.3
    const limit = againstFarWall ? FAR_MAX : DESK_TOP_Y
    const top = piece.y + piece.h / 2
    if (top <= limit + 1e-6) continue
    if (import.meta.env?.DEV) {
      console.warn(
        `[officeProps] clamped a prop: top ${top.toFixed(2)} > ${limit} at ` +
        `(${piece.x.toFixed(1)}, ${piece.z.toFixed(1)}). Near-side props must stay under a desk top.`,
      )
    }
    const overshoot = top - limit
    piece.h = Math.max(0.02, piece.h - overshoot)
    piece.y = Math.min(piece.y, limit - piece.h / 2)
  }
  return solid
}

/** One geometry for the lot: every prop is static, so none of this needs its own mesh. */
function bake(pieces: Piece[]) {
  const parts = pieces.map((p) => {
    const g = new THREE.BoxGeometry(p.w, p.h, p.d).translate(p.x, p.y, p.z)
    const colour = new THREE.Color(p.c)
    const count = g.attributes.position.count
    const rgb = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      rgb[i * 3] = colour.r
      rgb[i * 3 + 1] = colour.g
      rgb[i * 3 + 2] = colour.b
    }
    g.setAttribute('color', new THREE.BufferAttribute(rgb, 3))
    return g
  })
  const merged = mergeGeometries(parts, false)
  parts.forEach((g) => g.dispose())
  return merged
}

/**
 * Everything an office collects, for one room. Drawn as a single mesh.
 * `seed` only shifts a couple of pieces, so two rooms of the same size are not identical.
 */
export function RoomProps({ innerW, innerD, accent, seed }: {
  innerW: number
  innerD: number
  accent: string
  seed: number
}) {
  const geometry = useMemo(() => bake(layout(innerW, innerD, accent, seed)), [innerW, innerD, accent, seed])
  const material = useMemo(() => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), [])
  useEffect(() => () => { geometry?.dispose(); material.dispose() }, [geometry, material])
  if (!geometry) return null
  return <mesh geometry={geometry} material={material} raycast={() => null} />
}
