// Gate towers and the elevated lines that run straight through them.
//
// Every static box in here goes into one of four instanced meshes (shell / glow / dark / pulse),
// and the trains add two more, so the whole superstructure layer costs six draw calls no matter
// how many gates are configured in megastructure.ts.
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { GATES, gatePoint, LINTEL, PIER, SKY_LINES, type Gate, type SkyLine } from './megastructure'
import { UNIT_BOX } from './materials'

const SHELL = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true })
const GLOW = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false })
const DARK = new THREE.MeshLambertMaterial({ color: '#070f1c' })
const CAR = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true })
const CAR_GLOW = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false })

const TRAINS = 2 // per line
const CARS = 4 // per train
const CAR_LEN = 2.3
const CAR_GAP = 0.45
const FADE = 2.2 // world units at each end over which a car scales away into the tunnel

type Box = { x: number; y: number; z: number; w: number; h: number; d: number; color: string }
type Bucket = { shell: Box[]; glow: Box[]; dark: Box[]; pulse: Box[] }

const transform = new THREE.Object3D()
const tint = new THREE.Color()

function install(mesh: THREE.InstancedMesh, boxes: Box[]) {
  transform.rotation.set(0, 0, 0)
  boxes.forEach((b, i) => {
    transform.position.set(b.x, b.y, b.z)
    transform.scale.set(b.w, b.h, b.d)
    transform.updateMatrix()
    mesh.setMatrixAt(i, transform.matrix)
    mesh.setColorAt(i, tint.set(b.color))
  })
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.computeBoundingSphere()
  mesh.raycast = () => null
}

// One gate: two piers on neighbouring road intersections, a lintel bridging them, and setbacks
// stepping into a mast above. The track threads the gap between the piers and passes under the
// lintel, so a train genuinely runs through the building rather than past it.
function buildGate(gate: Gate, line: SkyLine, out: Bucket) {
  const push = (list: Box[], along: number, y: number, across: number, w: number, h: number, d: number, color: string) => {
    const { x, z } = gatePoint(line, gate.at, along, across)
    // w/d arrive as (along, across); swap them into world x/z for a line running along x.
    list.push(line.axis === 'z' ? { x, y, z, w: d, h, d: w, color } : { x, y, z, w, h, d, color })
  }

  // Lit window grid wrapped around all four faces of a slab. Without this the big flat walls
  // read as blank cardboard at this distance.
  const facade = (halfAlong: number, halfAcross: number, base: number, height: number, bright: string) => {
    const rows = Math.max(1, Math.floor((height - 0.5) / 1.05))
    const down = Math.max(2, Math.round(halfAlong * 1.5)) // windows per along-facing face
    const wide = Math.max(2, Math.round(halfAcross * 1.5)) // windows per across-facing face
    const spread = (i: number, n: number, half: number) => (n === 1 ? 0 : -half + 0.55 + (i * (half * 2 - 1.1)) / (n - 1))
    for (let row = 0; row < rows; row++) {
      const y = base + 0.75 + row * 1.05
      for (let i = 0; i < wide; i++) {
        const lit = (row * 5 + i * 3) % 7 < 5
        const color = lit ? ((row + i) % 4 === 0 ? bright : '#a8e4f2') : '#152a40'
        for (const front of [-1, 1]) push(out.glow, front * (halfAlong + 0.04), y, spread(i, wide, halfAcross), 0.06, 0.52, 0.52, color)
      }
      for (let i = 0; i < down; i++) {
        const lit = (row * 3 + i * 5) % 7 < 5
        const color = lit ? ((row + i) % 5 === 0 ? bright : '#a8e4f2') : '#152a40'
        for (const side of [-1, 1]) push(out.glow, spread(i, down, halfAlong), y, side * (halfAcross + 0.04), 0.52, 0.52, 0.06, color)
      }
    }
  }

  const span = gate.reach + PIER.across / 2 + LINTEL.overhang // lintel half-width
  const depth = PIER.along + 1 // wall thickness along the track
  const face = depth / 2 + 0.04 // just proud of the wall, so neon never z-fights
  const inner = gate.reach - PIER.across / 2 // inside face of each pier
  // The opening is sized to the train, not to the gap between the piers: a hole punched through
  // a solid wall reads as "through the building", two legs and a bridge do not.
  const mouth = { half: 1.7, bottom: line.y - 1.5, top: line.y + 1.7 }
  const arcade = 3.6 // street level stays open underneath

  for (const side of [-1, 1]) {
    const across = side * gate.reach
    // Pier: plinth, shaft, capital, corner ribs.
    push(out.shell, 0, 0.4, across, PIER.along + 0.8, 0.8, PIER.across + 0.8, '#44596e')
    push(out.shell, 0, mouth.top / 2 + 0.8, across, PIER.along, mouth.top - 0.8, PIER.across, gate.wall)
    push(out.shell, 0, mouth.top - 0.3, across, PIER.along + 0.6, 0.7, PIER.across + 0.6, '#55718b')
    for (const rib of [-1, 1])
      push(out.shell, rib * (PIER.along / 2 - 0.18), mouth.top / 2 + 0.8, across, 0.3, mouth.top - 1.4, PIER.across + 0.14, '#67839c')
    facade(PIER.along / 2, PIER.across / 2, 0.8, mouth.top - 1.4, gate.accent)
    // Vertical sign running the full height of the outward face.
    push(out.glow, 0, mouth.top / 2 + 1.1, across + side * (PIER.across / 2 + 0.06), 0.55, mouth.top - 2.4, 0.05, gate.sign)
  }

  // Curtain wall between the piers: open arcade at street level, then solid up to the opening.
  const curtain = mouth.bottom - arcade
  push(out.shell, 0, arcade + curtain / 2, 0, depth, curtain, inner * 2, gate.wall)
  push(out.shell, 0, arcade - 0.18, 0, depth + 0.4, 0.5, inner * 2 + 0.4, '#55718b')
  facade(depth / 2, inner, arcade, curtain, gate.accent)
  for (const side of [-1, 1]) {
    // Arcade columns so the street below reads as covered, not as a floating slab.
    push(out.shell, 0, arcade / 2, side * (inner - 0.45), PIER.along * 0.7, arcade, 0.7, '#3d5370')
    // Shoulders: the wall either side of the opening, narrowing it down to the track.
    const width = inner - mouth.half
    push(out.shell, 0, (mouth.bottom + mouth.top) / 2, side * (mouth.half + width / 2), depth, mouth.top - mouth.bottom, width, gate.wall)
    facade(depth / 2, width / 2, mouth.bottom, mouth.top - mouth.bottom, gate.accent)
  }

  // The opening itself. The bore stays hollow — lined on four sides, open end to end — so the
  // track runs clean through it and a train is visible inside instead of vanishing into a panel.
  const bore = mouth.top - mouth.bottom
  push(out.dark, 0, mouth.top - 0.09, 0, depth - 0.2, 0.18, mouth.half * 2, '#050b14')
  push(out.dark, 0, mouth.bottom + 0.09, 0, depth - 0.2, 0.18, mouth.half * 2, '#050b14')
  for (const side of [-1, 1]) push(out.dark, 0, mouth.bottom + bore / 2, side * (mouth.half - 0.09), depth - 0.2, bore, 0.18, '#050b14')
  // Bore lighting: a strip along the soffit, so the inside of the tunnel is lit as the train passes.
  push(out.glow, 0, mouth.top - 0.28, 0, depth - 0.5, 0.07, 0.5, gate.accent)
  for (const front of [-1, 1]) {
    for (const side of [-1, 1]) {
      push(out.pulse, front * face, (mouth.bottom + mouth.top) / 2, side * (mouth.half + 0.16), 0.08, mouth.top - mouth.bottom + 0.5, 0.3, gate.accent)
      push(out.pulse, front * face, mouth.bottom + (side > 0 ? mouth.top - mouth.bottom : 0), 0, 0.08, 0.3, mouth.half * 2 + 0.6, gate.accent)
    }
    // Marquee band above the mouth, bright enough to bloom.
    push(out.glow, front * (face + 0.05), mouth.top + 0.9, 0, 0.06, 0.6, span * 1.5, gate.sign)
  }

  // Lintel: the deep beam the mouth is cut into.
  push(out.shell, 0, mouth.top + LINTEL.height / 2 + 0.3, 0, depth, LINTEL.height + 0.6, span * 2, gate.wall)
  push(out.shell, 0, mouth.top + 0.18, 0, depth + 0.55, 0.42, span * 2 + 0.55, '#55718b')
  push(out.shell, 0, mouth.top + LINTEL.height + 0.52, 0, depth + 0.45, 0.36, span * 2 + 0.45, '#44596e')

  // Setbacks above the lintel, each stepped in from the last so the mass narrows into a spire.
  let y = mouth.top + LINTEL.height + 0.7
  let half = span
  for (const [height, inset] of gate.tiers) {
    half = Math.max(1, half - inset)
    const tierDepth = depth + 0.9 - inset * 0.25
    push(out.shell, 0, y + height / 2, 0, tierDepth, height, half * 2, gate.wall)
    push(out.shell, 0, y + height - 0.1, 0, tierDepth + 0.5, 0.38, half * 2 + 0.5, '#55718b')
    for (const rib of [-1, 1])
      push(out.shell, 0, y + height / 2, rib * (half - 0.2), tierDepth + 0.12, height, 0.3, '#67839c')
    facade(tierDepth / 2, half, y, height, gate.accent)
    // Belt course: one unbroken neon line per setback, the strongest read at a distance.
    for (const front of [-1, 1]) push(out.glow, front * (tierDepth / 2 + 0.06), y + 0.3, 0, 0.05, 0.14, half * 1.9, gate.accent)
    y += height
  }

  // Crown: service block, mast, beacon.
  push(out.shell, 0, y + 0.55, 0, depth * 0.6, 1.1, half * 1.2, '#38506a')
  push(out.shell, 0, y + 2.9, 0, 0.28, 4.4, 0.28, '#67839c')
  push(out.pulse, 0, y + 5.4, 0, 0.55, 0.55, 0.55, gate.accent)
  for (const side of [-1, 1]) push(out.glow, 0, y + 1.2, side * half * 0.8, 0.24, 0.24, 0.24, gate.sign)
}

// The viaduct itself: one long deck, rails, columns on the road grid, tunnel heads at the rim.
function buildLine(line: SkyLine, out: Bucket) {
  const push = (list: Box[], along: number, y: number, across: number, w: number, h: number, d: number, color: string) => {
    const x = line.axis === 'z' ? line.at + across : along
    const z = line.axis === 'z' ? along : line.at + across
    list.push(line.axis === 'z' ? { x, y, z, w: d, h, d: w, color } : { x, y, z, w, h, d, color })
  }
  push(out.shell, 0, line.y - 0.25, 0, line.reach * 2, 0.5, 1.9, '#33506a')
  push(out.shell, 0, line.y - 0.62, 0, line.reach * 2, 0.3, 1.1, '#24394f')
  for (const side of [-1, 1]) {
    push(out.glow, 0, line.y + 0.03, side * 0.62, line.reach * 2, 0.07, 0.08, line.accent)
    // Under-deck light strip: the glow that sells an elevated line at night.
    push(out.glow, 0, line.y - 0.52, side * 0.52, line.reach * 2, 0.06, 0.06, line.accent)
  }
  for (let along = -line.reach + 2.5; along <= line.reach - 2.5; along += 5) {
    push(out.shell, along, (line.y - 0.5) / 2, 0, 0.62, line.y - 0.5, 0.62, '#2d4762')
    push(out.shell, along, 0.17, 0, 1.2, 0.34, 1.2, '#44596e')
    push(out.shell, along, line.y - 0.75, 0, 1.5, 0.3, 1.5, '#3b5873')
  }
  // Tunnel heads swallow the ends of the line so trains never pop in over open ground.
  for (const end of [-1, 1]) {
    const along = end * (line.reach - 1.9)
    push(out.shell, along, line.y + 1.1, 0, 3.8, 4.6, 4.4, '#2a4258')
    push(out.shell, along, line.y + 3.5, 0, 4.3, 0.5, 4.9, '#4a637d')
    push(out.dark, along - end * 1.95, line.y + 0.75, 0, 0.12, 2.5, 2.4, '#060d18')
    push(out.glow, along - end * 2.05, line.y + 2.15, 0, 0.05, 0.18, 2.6, line.accent)
  }
}

export function Megastructures() {
  const rig = useMemo(() => {
    const out: Bucket = { shell: [], glow: [], dark: [], pulse: [] }
    for (const line of SKY_LINES) buildLine(line, out)
    for (const gate of GATES) buildGate(gate, SKY_LINES[gate.line], out)

    const statics = [
      new THREE.InstancedMesh(UNIT_BOX, SHELL, out.shell.length),
      new THREE.InstancedMesh(UNIT_BOX, GLOW, out.glow.length),
      new THREE.InstancedMesh(UNIT_BOX, DARK, out.dark.length),
    ]
    install(statics[0], out.shell)
    install(statics[1], out.glow)
    install(statics[2], out.dark)

    // Pulse shares one material so every portal rim and beacon breathes together — one colour
    // write per frame instead of one per instance.
    const pulseMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false })
    const pulse = new THREE.InstancedMesh(UNIT_BOX, pulseMat, out.pulse.length)
    install(pulse, out.pulse)

    const count = SKY_LINES.length * TRAINS * CARS
    const bodies = new THREE.InstancedMesh(UNIT_BOX, CAR, count)
    const trim = new THREE.InstancedMesh(UNIT_BOX, CAR_GLOW, count * 3)
    for (const mesh of [bodies, trim]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.frustumCulled = false
      mesh.raycast = () => null
    }
    let slot = 0
    for (const line of SKY_LINES)
      for (let t = 0; t < TRAINS * CARS; t++) {
        bodies.setColorAt(slot, tint.set(t % CARS === 0 ? '#53708c' : '#3d5873'))
        trim.setColorAt(slot * 3, tint.set('#bdf0f7'))
        trim.setColorAt(slot * 3 + 1, tint.set('#bdf0f7'))
        trim.setColorAt(slot * 3 + 2, tint.set(line.accent).multiplyScalar(1.5))
        slot++
      }
    return { statics, pulse, pulseMat, bodies, trim, reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches }
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => { rig.reduced = media.matches }
    media.addEventListener('change', update)
    return () => {
      media.removeEventListener('change', update)
      for (const mesh of [...rig.statics, rig.pulse, rig.bodies, rig.trim]) mesh.dispose()
      rig.pulseMat.dispose()
    }
  }, [rig])

  useFrame(({ clock }) => {
    const t = rig.reduced ? 4 : clock.elapsedTime
    rig.pulseMat.color.setHSL(0.5 + 0.08 * Math.sin(t * 0.7), 0.85, 0.6 + 0.12 * Math.sin(t * 2.1))
    let slot = 0
    for (const line of SKY_LINES) {
      const span = line.reach * 2
      for (let i = 0; i < TRAINS; i++)
        for (let car = 0; car < CARS; car++) {
          // Wrap over the full deck; the ends are inside the tunnel heads, where FADE shrinks
          // the car to nothing so it never appears out of thin air.
          const offset = i * (span / TRAINS) + car * (CAR_LEN + CAR_GAP) + t * line.speed * span
          const along = ((offset % span) + span) % span - line.reach
          const edge = Math.min(1, Math.max(0, (line.reach - Math.abs(along)) / FADE))
          const k = edge * edge * (3 - 2 * edge)
          const lead = car === 0 ? 1 : -1
          const x = line.axis === 'z' ? line.at : along
          const z = line.axis === 'z' ? along : line.at
          const yaw = line.axis === 'z' ? Math.PI / 2 : 0
          transform.rotation.set(0, yaw, 0)
          transform.position.set(x, line.y + 0.45, z)
          transform.scale.set(CAR_LEN * k, 0.74 * k, 0.62 * k)
          transform.updateMatrix()
          rig.bodies.setMatrixAt(slot, transform.matrix)
          for (let side = 0; side < 2; side++) {
            transform.scale.set(CAR_LEN * 0.82 * k, 0.2 * k, 0.03)
            transform.position.set(
              x + (line.axis === 'z' ? (side ? 0.33 : -0.33) : 0),
              line.y + 0.55,
              z + (line.axis === 'z' ? 0 : side ? 0.33 : -0.33),
            )
            transform.updateMatrix()
            rig.trim.setMatrixAt(slot * 3 + side, transform.matrix)
          }
          // Head/tail lamp on the end car, so the direction of travel reads at a glance.
          transform.scale.set(0.08, 0.16 * k, 0.4 * k)
          const nose = lead * Math.sign(line.speed) * (CAR_LEN / 2)
          transform.position.set(line.axis === 'z' ? x : x + nose, line.y + 0.5, line.axis === 'z' ? z + nose : z)
          transform.updateMatrix()
          rig.trim.setMatrixAt(slot * 3 + 2, transform.matrix)
          slot++
        }
    }
    rig.bodies.instanceMatrix.needsUpdate = true
    rig.trim.instanceMatrix.needsUpdate = true
  })

  return <group>{[...rig.statics, rig.pulse, rig.bodies, rig.trim].map((mesh) => <primitive key={mesh.uuid} object={mesh} />)}</group>
}
