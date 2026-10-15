// One walled office space per project (see projectOffice.ts for the arithmetic and why the floor
// is keyed on projects). What a room holds, and what it deliberately does not:
//
//   - a real shell: carpet tiles, a dado wall under a chair rail, painted drywall above and a cornice
//     at the back and left, knee-high walls on the two sides the camera looks through, corner
//     posts and a door frame carrying the full height where the walls are cut away;
//   - a nameplate over the door with the project's name, its folder and its headcount;
//   - open desks, facing each other across an aisle. No cubicle partitions: the point of the
//     change is that a project is a room, not a grid of boxes;
//   - the lead at a wider desk on the back strip, with the project's whiteboard behind them;
//   - a meeting table once the room is big enough to need one, and a plant by the door.
//
// People are drawn by a render prop, so this file never imports the room's Person component and
// the two modules stay free of a cycle.
import { Html } from '@react-three/drei/web/Html'
import { useHtmlPortal } from './useHtmlPortal'
import { RoomProps } from './officeProps'
import type { ReactNode } from 'react'
import * as THREE from 'three'
import {
  CORNICE_Y, DADO_H, DESK_W, DOOR_W, GLASS_H, POST_H, SLAB_D, WALL_T,
  projectPlatforms, seats, type OfficeFloor, type ProjectMember, type ProjectTeam, type Seat,
} from './projectOffice'

// A 2008 corporate office, not a nightclub: beige walls, grey loop-pile carpet, laminate desks,
// a drop ceiling of fluorescent panels. The project's colour survives only where a real office
// would have one — the sign at the door, the trim, the chair fabric.
const WALL = '#d8d2c4' // painted drywall
const WALL_LOW = '#c3bcab' // dado below the chair rail
const TRIM = '#9a9284'
const DESK_TOP = '#c3a173' // light maple laminate
const DESK_LEG = '#8e8b85' // grey steel
const CHAIR = '#3f4a55'
const FLUORESCENT = '#fbf6e4'

/**
 * Each project gets its own livery, so two platforms floating in the same dark are telling you
 * they are different places. Picked by a hash of the project id, which is its folder, so a
 * project keeps its colours for as long as it exists. Carpet and fabric stay in the range a
 * commercial office actually carries; the accent is signage only.
 */
const THEMES = [
  { accent: '#2f6f9e', carpet: '#6f6c63', fleck: '#5d5a51', panel: '#8c99a6' },
  { accent: '#2e7d5b', carpet: '#5f6a6b', fleck: '#4f5a5b', panel: '#89a096' },
  { accent: '#8c5a2b', carpet: '#6d6558', fleck: '#5b5446', panel: '#a3968a' },
  { accent: '#7a3b52', carpet: '#6a6166', fleck: '#575055', panel: '#9c8f96' },
  { accent: '#4a5c8c', carpet: '#636a74', fleck: '#525863', panel: '#8f98a8' },
  { accent: '#6b6a2f', carpet: '#6b6b5e', fleck: '#59594d', panel: '#9ba08c' },
] as const

function themeFor(id: string) {
  let hash = 2166136261
  for (const letter of id) hash = (hash ^ letter.charCodeAt(0)) * 16777619 >>> 0
  return THEMES[hash % THEMES.length]!
}

function Block({ position, size, color }: { position: [number, number, number]; size: [number, number, number]; color: string }) {
  return <mesh position={position} scale={size}>
    <boxGeometry args={[1, 1, 1]} />
    <meshLambertMaterial color={color} flatShading />
  </mesh>
}

/** Unlit, so neon reads as light in a dark room instead of a painted box. */
function Neon({ position, size, color, intensity = 1.6 }: { position: [number, number, number]; size: [number, number, number]; color: string; intensity?: number }) {
  return <mesh position={position} scale={size}>
    <boxGeometry args={[1, 1, 1]} />
    <meshBasicMaterial color={new THREE.Color(color).multiplyScalar(intensity)} toneMapped={false} />
  </mesh>
}


function Monitor({ x, y, z, accent, w = 0.54, h = 0.36 }: { x: number; y: number; z: number; accent: string; w?: number; h?: number }) {
  return <group position={[x, y, z]}>
    <Block color="#59506c" position={[0, 0, 0]} size={[w, h, 0.05]} />
    <Block color={accent} position={[0, 0, 0.035]} size={[w - 0.08, h - 0.08, 0.01]} />
    <Block color="#59506c" position={[0, -h / 2 - 0.08, 0]} size={[0.1, 0.16, 0.1]} />
  </group>
}

/**
 * The slab a project floats on. Nothing joins it to the next one: the gap around it is the void,
 * which is what makes each project read as its own place rather than a room off a corridor.
 */
function Platform({ w, d, accent }: { w: number; d: number; accent: string }) {
  return <>
    <Block color="#3a3b3d" position={[0, -SLAB_D / 2, 0]} size={[w, SLAB_D, d]} />
    {/* a narrower underplate, so the slab tapers into the dark instead of ending in a flat box */}
    <Block color="#26272a" position={[0, -SLAB_D - 0.14, 0]} size={[w - 0.9, 0.28, d - 0.9]} />
    {/* deck and a lit rim: the edge is the only thing separating the floor from the void */}
    <Block color="#55565a" position={[0, 0.01, 0]} size={[w, 0.06, d]} />
    {[-1, 1].map((side) => <group key={side}>
      <Block color={accent} position={[side * (w / 2 - 0.05), 0.05, 0]} size={[0.1, 0.07, d]} />
      <Block color={accent} position={[0, 0.05, side * (d / 2 - 0.05)]} size={[w, 0.07, 0.1]} />
    </group>)}
  </>
}

/** The shell. Two walls full height at the back and left; the camera-side walls stay knee-high. */
function Shell({ innerW, innerD, accent, carpet, fleck }: { innerW: number; innerD: number; accent: string; carpet: string; fleck: string }) {
  const halfW = innerW / 2 + WALL_T / 2
  const halfD = innerD / 2 + WALL_T / 2
  const segW = (innerW - DOOR_W) / 2
  const segX = (innerW + DOOR_W) / 4
  // Carpet tiles, laid in a grid like every office of its decade. Two tones, checkered.
  const tile = 1.2
  const cols = Math.max(1, Math.round(innerW / tile))
  const rows = Math.max(1, Math.round(innerD / tile))
  const tw = innerW / cols
  const td = innerD / rows
  // Pools of light on the carpet. The fittings that would cast them are left out: anything
  // overhead ends up between this room and the camera.
  const lightCols = Math.max(1, Math.round(innerW / 4.2))
  const lightRows = Math.max(1, Math.round(innerD / 4.2))
  return <>
    <Block color={TRIM} position={[0, 0.045, 0]} size={[innerW + 0.12, 0.03, innerD + 0.12]} />
    {Array.from({ length: cols * rows }, (_, i) => {
      const cx = i % cols
      const cz = Math.floor(i / cols)
      return <Block key={i} color={(cx + cz) % 2 ? carpet : fleck}
        position={[-innerW / 2 + tw * (cx + 0.5), 0.07, -innerD / 2 + td * (cz + 0.5)]}
        size={[tw - 0.04, 0.04, td - 0.04]} />
    })}
    {Array.from({ length: lightCols * lightRows }, (_, i) => {
      const cx = i % lightCols
      const cz = Math.floor(i / lightCols)
      return <mesh key={`lit${i}`} rotation-x={-Math.PI / 2}
        position={[-innerW / 2 + (innerW / lightCols) * (cx + 0.5), 0.1, -innerD / 2 + (innerD / lightRows) * (cz + 0.5)]}>
        <planeGeometry args={[innerW / lightCols * 0.8, innerD / lightRows * 0.8]} />
        <meshBasicMaterial color={FLUORESCENT} transparent opacity={0.06} depthWrite={false} />
      </mesh>
    })}
    {/* back and left: dado below a chair rail, painted drywall above */}
    <Block color={WALL_LOW} position={[0, DADO_H / 2, -halfD]} size={[innerW + WALL_T * 2, DADO_H, WALL_T]} />
    <Block color={TRIM} position={[0, DADO_H + 0.04, -halfD]} size={[innerW + WALL_T * 2 + 0.04, 0.08, WALL_T + 0.04]} />
    <Block color={WALL} position={[0, DADO_H + GLASS_H / 2, -halfD]} size={[innerW + WALL_T * 2, GLASS_H, WALL_T * 0.9]} />
    <Block color={accent} position={[0, CORNICE_Y, -halfD]} size={[innerW + WALL_T * 2 + 0.04, 0.1, WALL_T + 0.04]} />
    <Block color={WALL_LOW} position={[-halfW, DADO_H / 2, 0]} size={[WALL_T, DADO_H, innerD + WALL_T * 2]} />
    <Block color={TRIM} position={[-halfW, DADO_H + 0.04, 0]} size={[WALL_T + 0.04, 0.08, innerD + WALL_T * 2 + 0.04]} />
    <Block color={WALL} position={[-halfW, DADO_H + GLASS_H / 2, 0]} size={[WALL_T * 0.9, GLASS_H, innerD + WALL_T * 2]} />
    <Block color={accent} position={[-halfW, CORNICE_Y, 0]} size={[WALL_T + 0.04, 0.1, innerD + WALL_T * 2 + 0.04]} />
    {/* camera side: knee high, so nothing stands between the view and a desk */}
    <Block color={WALL_LOW} position={[halfW, 0.42, 0]} size={[WALL_T, 0.68, innerD + WALL_T * 2]} />
    <Block color={TRIM} position={[halfW, 0.79, 0]} size={[WALL_T + 0.06, 0.07, innerD + WALL_T * 2]} />
    {[-1, 1].map((side) => <group key={side}>
      <Block color={WALL_LOW} position={[side * segX, 0.42, halfD]} size={[segW, 0.68, WALL_T]} />
      <Block color={TRIM} position={[side * segX, 0.79, halfD]} size={[segW, 0.07, WALL_T + 0.06]} />
    </group>)}
    {([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([sx, sz]) => (
      <Block key={`${sx}${sz}`} color={TRIM} position={[sx * halfW, POST_H / 2, sz * halfD]} size={[0.24, POST_H, 0.24]} />
    ))}
    {/* door frame: the gap in the front wall, carried to full height */}
    {[-1, 1].map((side) => (
      <Block key={side} color={TRIM} position={[side * DOOR_W / 2, POST_H / 2, halfD]} size={[0.16, POST_H, WALL_T + 0.04]} />
    ))}
  </>
}

/**
 * A stool pulled up beside an engineer's desk: where an intern sits.
 *
 * Deliberately not a desk. An intern is not a junior member of the team with a place of their
 * own — one engineer hired them for one piece of work and stays accountable for it — and the
 * room should show that at a glance rather than in a label.
 */
function Stool({ seat, accent, children }: { seat: Seat; accent: string; children: ReactNode }) {
  return <group position={[seat.x, 0, seat.z]} rotation-y={seat.facing ? 0 : Math.PI}>
    <Block color={CHAIR} position={[0, 0.42, 0]} size={[0.38, 0.09, 0.38]} />
    <Block color={DESK_LEG} position={[0, 0.2, 0]} size={[0.1, 0.42, 0.1]} />
    {/* A laptop on the knees, not a monitor on a desk. */}
    <Block color={DESK_TOP} position={[0, 0.58, -0.16]} size={[0.44, 0.03, 0.3]} />
    <Neon position={[0, 0.71, -0.3]} size={[0.4, 0.26, 0.02]} color={accent} intensity={1.4} />
    <group position={[0, 0, 0.18]}>{children}</group>
  </group>
}

/** An open desk. `facing` flips it so two rows sit across an aisle from each other. */
function Desk({ seat, accent, children }: { seat: Seat; accent: string; children: ReactNode }) {
  const lead = seat.kind === 'lead'
  const w = lead ? DESK_W * 1.35 : DESK_W
  const turn = seat.facing ? 1 : -1
  return <group position={[seat.x, 0, seat.z]} rotation-y={seat.facing ? 0 : Math.PI}>
    <Block color={DESK_TOP} position={[0, 0.72, -0.3]} size={[w, 0.1, 0.62]} />
    <Block color={DESK_LEG} position={[0, 0.4, -0.3]} size={[w - 0.12, 0.56, 0.06]} />
    <Monitor x={lead ? -0.4 : 0} y={1.0} z={-0.52} accent={accent} />
    {lead && <Monitor x={0.42} y={1.0} z={-0.52} accent={accent} />}
    <Block color="#d6c4c5" position={[0, 0.8, -0.14]} size={[0.42, 0.04, 0.16]} />
    {lead && <Block color="#e4d9b7" position={[w / 2 - 0.2, 0.84, -0.3]} size={[0.14, 0.18, 0.14]} />}
    {/* chair */}
    <Block color={CHAIR} position={[0, 0.44, 0.34]} size={[0.46, 0.1, 0.42]} />
    <Block color={CHAIR} position={[0, 0.74, 0.52]} size={[0.46, 0.5, 0.09]} />
    <group position={[0, 0, 0.3]} rotation-y={turn > 0 ? 0 : 0}>{children}</group>
  </group>
}

/** The project's own whiteboard, behind the lead: what the room is for, in one glance. */
function Whiteboard({ innerD, accent }: { innerD: number; accent: string }) {
  const z = -innerD / 2 + 0.1
  return <group position={[0, 0, z]}>
    <Block color="#e8eef2" position={[0, 1.52, 0]} size={[1.5, 0.78, 0.04]} />
    <Block color={accent} position={[-0.3, 1.7, 0.03]} size={[0.62, 0.05, 0.02]} />
    <Block color={accent} position={[-0.42, 1.56, 0.03]} size={[0.38, 0.05, 0.02]} />
    <Block color="#ff627b" position={[0.12, 1.4, 0.03]} size={[0.44, 0.05, 0.02]} />
  </group>
}

function Plant({ x, z }: { x: number; z: number }) {
  return <group position={[x, 0, z]}>
    <Block color="#c38275" position={[0, 0.2, 0]} size={[0.4, 0.4, 0.4]} />
    <Block color="#537c59" position={[0, 0.55, 0]} size={[0.09, 0.55, 0.09]} />
    <Block color="#81b38a" position={[-0.14, 0.78, 0]} size={[0.34, 0.22, 0.26]} />
    <Block color="#6d9d79" position={[0.13, 0.66, 0.08]} size={[0.34, 0.22, 0.26]} />
  </group>
}

/** A table once the room has enough people to hold a meeting in it. */
function MeetingTable({ x, z }: { x: number; z: number }) {
  return <group position={[x, 0, z]}>
    <Block color={DESK_TOP} position={[0, 0.66, 0]} size={[1.25, 0.09, 0.8]} />
    <Block color={DESK_LEG} position={[0, 0.33, 0]} size={[0.18, 0.58, 0.18]} />
    {[-0.5, 0.5].map((sx) => [-0.52, 0.52].map((sz) => (
      <Block key={`${sx}${sz}`} color={CHAIR} position={[sx, 0.4, sz]} size={[0.34, 0.09, 0.32]} />
    )))}
  </group>
}


/** The project's sign, stood on the platform edge where you arrive. */
function Sign({ x, z, neon, rows }: { x: number; z: number; neon: string; rows: number }) {
  return <group position={[x, 0, z]}>
    <Block color="#8e8b85" position={[0, 0.9, 0]} size={[0.16, 1.8, 0.16]} />
    <Block color="#e4e1d6" position={[0, 1.95, 0]} size={[0.4, 1.5, 0.12]} />
    {Array.from({ length: rows }, (_, i) => (
      <Neon key={i} position={[0, 2.5 - i * 0.3, 0.07]} size={[0.18, 0.18, 0.03]} color={neon} intensity={2.1} />
    ))}
  </group>
}

/** The machines the project runs on, humming against the back wall. */
function ServerRack({ x, z, neon }: { x: number; z: number; neon: string }) {
  return <group position={[x, 0, z]}>
    <Block color="#55585c" position={[0, 0.78, 0]} size={[0.68, 1.56, 0.5]} />
    <Block color="#3a3d41" position={[0, 0.78, 0.26]} size={[0.56, 1.42, 0.03]} />
    {[0, 1, 2, 3, 4].map((i) => (
      <Neon key={i} position={[-0.14 + (i % 2) * 0.1, 1.05 - i * 0.19, 0.27]} size={[0.05, 0.03, 0.02]} color={i % 3 ? neon : '#b6f36b'} intensity={2.2} />
    ))}
  </group>
}

/** The corner everyone actually stands in. */
function CoffeeBar({ x, z, neon }: { x: number; z: number; neon: string }) {
  return <group position={[x, 0, z]}>
    <Block color="#b8b2a4" position={[0, 0.42, 0]} size={[1.3, 0.84, 0.56]} />
    <Block color={DESK_TOP} position={[0, 0.86, 0]} size={[1.36, 0.06, 0.62]} />
    <Block color="#d6c4c5" position={[-0.3, 0.98, 0]} size={[0.22, 0.2, 0.22]} />
    <Block color="#8f6a51" position={[0.08, 0.95, 0.02]} size={[0.12, 0.14, 0.12]} />
    <Block color="#8f6a51" position={[0.26, 0.95, 0.02]} size={[0.12, 0.14, 0.12]} />
    <Neon position={[0, 1.22, -0.2]} size={[0.7, 0.04, 0.04]} color={neon} intensity={1.7} />
  </group>
}

function Cabinets({ x, z }: { x: number; z: number }) {
  return <group position={[x, 0, z]}>
    {[0, 1].map((i) => <group key={i} position={[i * 0.56, 0, 0]}>
      <Block color="#9a958a" position={[0, 0.5, 0]} size={[0.52, 1, 0.42]} />
      {[0, 1, 2].map((d) => <Block key={d} color="#6f6880" position={[0, 0.22 + d * 0.3, 0.22]} size={[0.42, 0.2, 0.03]} />)}
    </group>)}
  </group>
}

/** A poster on the back wall. Pure decoration, and the room is colder without it. */
function Poster({ x, innerD, neon }: { x: number; innerD: number; neon: string }) {
  return <group position={[x, 1.75, -innerD / 2 + 0.12]}>
    <Block color="#f0ece1" position={[0, 0, 0]} size={[0.8, 1.05, 0.03]} />
    <Neon position={[0, 0.22, 0.02]} size={[0.5, 0.5, 0.01]} color={neon} intensity={1.3} />
    <Block color="#d6c4c5" position={[0, -0.3, 0.02]} size={[0.56, 0.06, 0.01]} />
    <Block color="#8d86a0" position={[0, -0.42, 0.02]} size={[0.4, 0.04, 0.01]} />
  </group>
}

export interface ProjectOfficesProps {
  /** The whole floor: one platform per project, and the void between them. */
  floor: OfficeFloor
  accent: string
  /** Draws one person at their desk. The room supplies the member; the caller supplies the body. */
  renderPerson: (member: ProjectMember, seat: Seat, team: ProjectTeam) => ReactNode
}

/** Every project as its own office platform, floating apart from the others. */
export function ProjectOffices({ floor, accent, renderPerson }: ProjectOfficesProps) {
  const room = floor.room
  const portal = useHtmlPortal()
  return <group>
    {projectPlatforms(floor).map((platform) => {
      const { team, x, z } = platform
      const placed = seats(team, room)
      const overflow = team.people.length - placed.length
      // The building's accent still rims the platform, so the set reads as one office; the
      // project's own livery is what is going on inside it.
      const theme = themeFor(team.id)
      const half = { w: room.innerW / 2, d: room.innerD / 2 }
      return <group key={team.id} position={[x, 0, z]}>
        <Platform w={platform.w} d={platform.d} accent={accent} />
        <Sign x={platform.w / 2 - 0.5} z={platform.d / 2 - 0.5} neon={theme.accent} rows={Math.min(5, Math.max(2, team.name.length % 5 + 2))} />
        <Shell innerW={room.innerW} innerD={room.innerD} accent={theme.accent} carpet={theme.carpet} fleck={theme.fleck} />
        <ServerRack x={-half.w + 0.45} z={-half.d + 0.5} neon={theme.accent} />
        <CoffeeBar x={half.w - 0.7} z={-half.d + 0.45} neon={theme.accent} />
        <Cabinets x={-half.w + 0.4} z={half.d - 1.1} />
        <Poster x={half.w - 0.9} innerD={room.innerD} neon={theme.accent} />
        {/* Everything an office accumulates against its walls — one merged mesh, see officeProps. */}
        <RoomProps innerW={room.innerW} innerD={room.innerD} accent={theme.accent} seed={team.name.length + team.people.length} />
        <Html portal={portal} position={[0, 2.68, room.innerD / 2 + WALL_T / 2]} center zIndexRange={[8, 0]} style={{ pointerEvents: 'none' }}>
          <div style={{
            font: "9px/1.5 'Press Start 2P', monospace", background: 'var(--gg-void)', color: 'var(--gg-ink)',
            border: `2px solid ${theme.accent}`, padding: '3px 6px', whiteSpace: 'nowrap', textAlign: 'center',
          }}>
            {team.name} · {team.people.length}
            {team.path && <div style={{ fontSize: 7, color: 'var(--gg-mute)', marginTop: 2 }}>{team.path}</div>}
          </div>
        </Html>
        <pointLight position={[0, 2.5, room.innerD / 4]} intensity={4} distance={7} color="#ffe9c4" />
        <Whiteboard innerD={room.innerD} accent={theme.accent} />
        <Plant x={room.innerW / 2 - 0.42} z={room.innerD / 2 - 0.55} />
        {team.people.length > 4 && <MeetingTable x={-room.innerW / 2 + 0.9} z={room.innerD / 2 - 0.75} />}
        {placed.map((seat) => seat.kind === 'intern'
          ? <Stool key={seat.person.id} seat={seat} accent={theme.accent}>
              {renderPerson(seat.person, seat, team)}
            </Stool>
          : <Desk key={seat.person.id} seat={seat} accent={theme.accent}>
              {renderPerson(seat.person, seat, team)}
            </Desk>)}
        {/* A room only holds so many desks; say so rather than hiding the overflow. */}
        {overflow > 0 && (
          <Html portal={portal} position={[0, 0.9, room.innerD / 2 - 0.2]} center zIndexRange={[8, 0]} style={{ pointerEvents: 'none' }}>
            <div style={{ font: "8px 'Press Start 2P', monospace", background: 'var(--gg-void)', color: 'var(--gg-yellow)', border: '2px solid var(--gg-haze)', padding: '2px 5px', whiteSpace: 'nowrap' }}>
              +{overflow} in the hall
            </div>
          </Html>
        )}
      </group>
    })}
  </group>
}
