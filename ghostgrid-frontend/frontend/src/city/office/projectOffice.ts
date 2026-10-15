// One office space per project, as arithmetic.
//
// The old floor gave every org-chart team a room and sat its people in cubicles. A project is the
// unit that actually means something here — it is the lane on the staffing board, which is the
// folder a terminal is really open in — so the floor is keyed on projects instead, and a project
// gets a room of its own with open desks rather than partitions.
//
// Plan view throughout: `x` runs left-to-right, `z` runs away from the camera, every footprint is
// a centre plus a full width and depth. Nothing here touches three.js or React, so the floor can
// be checked without a WebGL context (see scripts/project-office.test.mjs).
import { BENCH, laneOf, type Lane, type Staffed } from './lanes'

export type Rank = 'Manager' | 'Team Lead' | 'Engineer' | 'Intern'

export interface ProjectMember {
  id: string
  name: string
  role: Rank
  /** Who this person answers to inside the room, for the org panel and the drag handler. */
  reportsTo?: string
  /**
   * Interns only: the id of the engineer who hired them.
   *
   * An intern belongs to one engineer rather than to the team, so the room pulls a stool up to
   * that engineer's desk instead of giving them a desk of their own. An intern whose engineer
   * is not in this room has nowhere to sit and is not drawn.
   */
  hiredBy?: string
}
export interface ProjectTeam {
  /** The lane id: a working directory, or a hand-typed name. */
  id: string
  name: string
  /** `~/projects/hackathon`, when the project is a real folder. */
  path?: string
  people: ProjectMember[]
}

// ---- room dimensions -------------------------------------------------------------------------
export const WALL_T = 0.22
export const DOOR_W = 3.2
export const ROOM_GAP = 1.6 // corridor between two rooms
export const DESK_W = 2.4, DESK_D = 2.1 // one open desk, chair included
export const DESK_GAP_X = 1.0, DESK_GAP_Z = 1.5 // aisles between desks
export const DESK_COLS = 4 // desks per row
export const LEAD_D = 3.6 // the strip at the back of the room the lead's desk stands on
export const FRONT_WALK = 2.6 // floor left clear inside the door
export const SIDE_WALK = 1.6 // clearance at the room's left and right walls
export const MAX_DESKS = 16 // past this a room is full; the rest of the project stands in the hall
/** A project's room is a place you walk into, so even a team of one gets a floor this big. */
export const MIN_W = 15.8, MIN_D = 13
/**
 * Wall heights, back at the originals. The room is a doll-house cutaway seen from a fixed iso
 * camera: height pushes a thing UP the screen, and the two full-height walls are the far ones, so
 * tall walls rise over the floor and cover the desks they are behind. Raising these is what put a
 * roof over the room. There is no ceiling at all, for the same reason.
 */
export const DADO_H = 1.3, GLASS_H = 1.0, CORNICE_Y = 2.42, POST_H = 2.36

export interface OfficeSize {
  innerW: number
  innerD: number
  rows: number
}

/** Enough room for `desks` open desks in rows of DESK_COLS, plus the lead's strip at the back. */
export function officeSize(desks: number): OfficeSize {
  const seats = Math.max(1, Math.min(desks, MAX_DESKS))
  const rows = Math.ceil(seats / DESK_COLS)
  const innerW = DESK_COLS * DESK_W + (DESK_COLS - 1) * DESK_GAP_X + SIDE_WALK * 2
  const innerD = LEAD_D + rows * DESK_D + (rows - 1) * DESK_GAP_Z + FRONT_WALK
  // A door has to fit in the front wall, and a room never shrinks below a place worth walking into.
  return { innerW: Math.max(innerW, DOOR_W + 1, MIN_W), innerD: Math.max(innerD, MIN_D), rows }
}

/** One room size for the whole floor, so the rooms line up into streets. */
export function floorRoomSize(teams: ProjectTeam[]): OfficeSize {
  const widest = teams.reduce((most, team) => Math.max(most, team.people.length), 1)
  return officeSize(widest)
}

export type SeatKind = 'lead' | 'desk' | 'intern'
export interface Seat {
  kind: SeatKind
  person: ProjectMember
  x: number
  z: number
  /** true when the desk faces the camera-side wall, so two rows face each other across an aisle. */
  facing: boolean
}

/**
 * Where each person sits. The lead takes the back strip facing the room, because they are the one
 * handing work out; everyone else takes an open desk, rows alternating which way they face so the
 * room reads as a shared space rather than a grid of identical stations.
 */
export function seats(team: ProjectTeam, size: OfficeSize): Seat[] {
  const lead = team.people.find((person) => person.role === 'Team Lead')
    ?? team.people.find((person) => person.role === 'Manager')
  const interns = team.people.filter((person) => person.role === 'Intern')
  const internIds = new Set(interns.map((person) => person.id))
  // Interns take no desk of their own: they are seated against the engineer who hired them
  // below, so they must not consume one of the room's MAX_DESKS places here.
  const rest = team.people.filter((person) => person.id !== lead?.id && !internIds.has(person.id)).slice(0, MAX_DESKS)
  const out: Seat[] = []
  const backZ = -size.innerD / 2 + LEAD_D / 2
  if (lead) out.push({ kind: 'lead', person: lead, x: 0, z: backZ, facing: true })

  const firstRowZ = -size.innerD / 2 + LEAD_D + DESK_D / 2
  const spanX = (DESK_COLS - 1) * (DESK_W + DESK_GAP_X)
  rest.forEach((person, i) => {
    const col = i % DESK_COLS
    const row = Math.floor(i / DESK_COLS)
    out.push({
      kind: 'desk',
      person,
      x: col * (DESK_W + DESK_GAP_X) - spanX / 2,
      z: firstRowZ + row * (DESK_D + DESK_GAP_Z),
      facing: row % 2 === 0,
    })
  })

  // A stool at the side of the hiring engineer's desk, alternating sides so a second intern on
  // the same engineer sits opposite the first rather than inside them.
  const byId = new Map(out.map((seat) => [seat.person.id, seat]))
  const taken = new Map<string, number>()
  for (const intern of interns) {
    const desk = intern.hiredBy ? byId.get(intern.hiredBy) : undefined
    if (!desk) continue
    const seat = taken.get(desk.person.id) ?? 0
    taken.set(desk.person.id, seat + 1)
    out.push({
      kind: 'intern',
      person: intern,
      x: desk.x + (seat % 2 === 0 ? -1 : 1) * (DESK_W / 2 + 0.34),
      z: desk.z + Math.floor(seat / 2) * 0.9,
      facing: desk.facing,
    })
  }
  return out
}

export const SLAB_D = 0.7 // platform thickness
export const SLAB_MARGIN = 2.2 // walkway between a room's wall and the edge of its platform
/**
 * Void between two platforms. Enough to read as a gap you could fall down — these are separate
 * places, not neighbouring rooms — but tight enough that two of them fit on screen at once. The
 * player pans the view rather than zooming out to find the next office.
 */
export const VOID_GAP = 2.4

export type PlatformKind = 'project' | 'desks'
export interface Platform {
  /** The lane id, or `__desks__` for the terminal floor. */
  id: string
  kind: PlatformKind
  team?: ProjectTeam
  /** Centre of the slab. */
  x: number
  z: number
  /** Slab footprint. */
  w: number
  d: number
}
export interface OfficeFloor {
  /** One room size for every project platform, so the places read as a set. */
  room: OfficeSize
  platforms: Platform[]
  cols: number
  /** Bounds the camera has to frame, void included. */
  width: number
  depth: number
}

/** The slab a room of this size needs under it. */
export const platformFor = (room: OfficeSize) => ({
  w: room.innerW + WALL_T * 2 + SLAB_MARGIN * 2,
  d: room.innerD + WALL_T * 2 + SLAB_MARGIN * 2,
})

/**
 * Every project gets a platform of its own, floating in the dark with nothing joining it to the
 * next one.
 *
 * This is the point of the layout and the thing that is easy to get wrong: a project is a
 * separate place, not a room off a shared corridor. The platforms are laid out on a grid with a
 * void between them rather than a walkway, and the terminal desks get a platform of their own at
 * the back, so the real machine's terminals read as somewhere you also go rather than as the
 * floor everything else stands on.
 */
export function officeFloor(teams: ProjectTeam[], desks: { w: number; d: number }): OfficeFloor {
  const room = floorRoomSize(teams)
  const slab = platformFor(room)
  const cols = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(Math.max(teams.length, 1)))))
  const rows = Math.ceil(teams.length / cols)
  const strideX = slab.w + VOID_GAP
  const strideZ = slab.d + VOID_GAP
  // The terminal desks sit on their own slab across the back.
  const deskSlab = { w: Math.max(desks.w, slab.w), d: desks.d }
  const gridD = rows * strideZ - VOID_GAP
  const depth = deskSlab.d + VOID_GAP + Math.max(gridD, 0) + 1
  const backZ = -depth / 2 + deskSlab.d / 2
  const platforms: Platform[] = [
    { id: '__desks__', kind: 'desks', x: 0, z: backZ, w: deskSlab.w, d: deskSlab.d },
    ...teams.map((team, i): Platform => ({
      id: team.id,
      kind: 'project',
      team,
      x: ((i % cols) - (cols - 1) / 2) * strideX,
      z: -depth / 2 + deskSlab.d + VOID_GAP + Math.floor(i / cols) * strideZ + slab.d / 2,
      w: slab.w,
      d: slab.d,
    })),
  ]
  const width = Math.max(deskSlab.w, cols * strideX - VOID_GAP) + 1
  return { room, platforms, cols, width, depth }
}

/** Just the project platforms, in order. */
export const projectPlatforms = (floor: OfficeFloor) =>
  floor.platforms.filter((platform): platform is Platform & { team: ProjectTeam } => platform.kind === 'project' && !!platform.team)

/** Where the terminal desks stand. */
export const deskPlatform = (floor: OfficeFloor) => floor.platforms.find((platform) => platform.kind === 'desks')!

// ---- turning the staffing board into teams ----------------------------------------------------

/**
 * Rank a crew member carries into the room. The room draws four kinds of place — a corner
 * office, a lead's desk, a cubicle, and a stool beside an engineer — so an office with custom
 * roles is mapped onto those by what the role *does* in a run, falling back to a cubicle for a
 * desk with no role at all. An intern is never the fallback: it has to be hired into.
 */
const RANKS: Rank[] = ['Manager', 'Team Lead', 'Engineer', 'Intern']
const BY_KIND: Record<string, Rank> = { manage: 'Manager', lead: 'Team Lead', build: 'Engineer', intern: 'Intern' }
const rankOf = (role: string, kind?: string): Rank =>
  (RANKS as string[]).includes(role) ? role as Rank : (kind ? BY_KIND[kind] : undefined) ?? 'Engineer'
const ORDER: Record<Rank, number> = { Manager: 0, 'Team Lead': 1, Engineer: 2, Intern: 3 }

export interface BoardMember extends Staffed {
  name: string
  role: string
  roleKind?: string
  /** Who they report to. For an intern, the engineer who hired them. */
  managerId?: string | null
}

/**
 * One team per project, built from exactly what the staffing board shows: a person's lane decides
 * their room, so dragging someone to another project moves their desk. Benched people get no room
 * — an empty floor is the honest answer when nobody is on a project.
 *
 * Projects keep the lane order they are given (busiest folder first), so the room a person expects
 * to be on the left stays on the left between renders.
 */
export function projectTeams(
  crew: BoardMember[],
  assign: Record<string, string>,
  lanes: Lane[],
): ProjectTeam[] {
  const byLane = new Map<string, ProjectMember[]>()
  for (const member of crew) {
    const lane = laneOf(member, assign, lanes)
    if (lane === BENCH) continue
    const people = byLane.get(lane) ?? []
    const role = rankOf(member.role, member.roleKind)
    // Only an intern carries a hiring engineer: for everyone else the reporting line is the
    // room's lead, set below, and a stray `hiredBy` would seat them at somebody's elbow.
    people.push({ id: member.id, name: member.name, role, hiredBy: role === 'Intern' ? member.managerId ?? undefined : undefined })
    byLane.set(lane, people)
  }
  // Every lane gets a room, staffed or not: adding a project is the only way to open an office,
  // so a project with nobody hired onto it yet has to show up as an empty one.
  return lanes
    .map((lane) => {
      const people = (byLane.get(lane.id) ?? []).sort((a, b) => ORDER[a.role] - ORDER[b.role] || a.name.localeCompare(b.name))
      // Everyone in the room answers to its lead, which is what the org panel reads.
      const lead = people.find((person) => person.role === 'Team Lead') ?? people.find((person) => person.role === 'Manager')
      return {
        id: lane.id,
        name: lane.name,
        path: lane.path,
        people: people.map((person) => person.id === lead?.id ? person : { ...person, reportsTo: lead?.id }),
      }
    })
}
