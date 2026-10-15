// The office floor, as arithmetic. OfficeRoom3D draws what this module decides, so the layout can
// be checked without a WebGL context (see scripts/office-floorplan.test.mjs).
//
// Plan view throughout: `x` runs left-to-right, `z` runs away from the camera, and every footprint
// is a centre plus a full width and depth. Nothing here touches three.js or React.
//
// The ranks are spelled out here rather than imported from ./org, so a node test can load this
// module without pulling React and the `@/` aliases in behind it. OfficeRoom3D passes real
// `Office` values to these functions, so a new member of org.ts's `Role` stops compiling there —
// and scripts/office-floorplan.test.mjs checks the two lists still agree.
export type Rank = 'Manager' | 'Team Lead' | 'Engineer' | 'Intern'
export interface Staffer {
  id: string
  name: string
  role: Rank
  /**
   * Interns only: the id of the engineer who hired them.
   *
   * An intern is not a junior member of the team — they belong to one engineer, who is
   * accountable for their work. The room says so by sitting them at that engineer's desk
   * instead of giving them a cubicle of their own somewhere else on the floor.
   */
  hiredBy?: string
}
export interface Team { id: string; name: string; people: Staffer[] }

export const WALL_T = 0.16
export const MGR_W = 2.8, MGR_D = 2.6 // the manager's private office
export const LEAD_W = 2.8, LEAD_D = 2.6 // a lead's cubicle: the same footprint, screens not walls
export const ENG_W = 1.95, ENG_D = 2.0 // a standard cubicle
export const INTERN_W = 0.95, INTERN_D = 1.0 // a stool pulled up to an engineer's desk
export const ENG_COLS = 3
export const MAX_LEADS = 3
export const MAX_ENG = ENG_COLS * 3
export const WALK = 0.6 // between the senior strip at the back and the first row of cubicles
export const FRONT_WALK = 0.95 // floor left clear inside the door
export const ROOM_GAP = 1.5 // corridor between two rooms
export const DOOR_W = 1.7
/** The footprint one open-plan desk claims, screens and chair included. */
export const DESK_W = 2.7, DESK_D = 2.4
const SENIOR_D = Math.max(MGR_D, LEAD_D)

export const leadsOf = (team: Team) => team.people.filter((p) => p.role === 'Team Lead')

/**
 * Who sits where. Filtering by rank alone dropped anyone the ranks could not place — a second
 * manager, or a fourth lead past the cap — so the crew is whoever is left over by identity.
 */
export function seating(team: Team) {
  const manager = team.people.find((p) => p.role === 'Manager')
  const leads = leadsOf(team).slice(0, MAX_LEADS)
  const seated = new Set([manager?.id, ...leads.map((lead) => lead.id)])
  // Interns are seated beside the engineer who hired them, not placed on the floor in their
  // own right, so they are held back from the cubicle rows here.
  const interns = team.people.filter((p) => p.role === 'Intern')
  const internIds = new Set(interns.map((person) => person.id))
  return {
    manager,
    leads,
    interns,
    crew: team.people.filter((p) => !seated.has(p.id) && !internIds.has(p.id)),
  }
}

/** Everyone who gets a standard cubicle rather than an office or a lead's corner. */
export const cubicleOf = (team: Team) => seating(team).crew

export interface RoomSize {
  /** Inside the walls, which is what the furniture has to fit in. */
  innerW: number
  innerD: number
  /** Outside the walls, which is what the floor plan spaces out. */
  w: number
  d: number
}

/** A room sized to hold one manager, `leads` leads and `engRows` rows of cubicles. */
export function roomFor(leads: number, engRows: number): RoomSize {
  const innerW = Math.max(MGR_W + Math.max(1, leads) * LEAD_W, ENG_COLS * ENG_W)
  const innerD = SENIOR_D + WALK + Math.max(1, engRows) * ENG_D + FRONT_WALK
  return { innerW, innerD, w: innerW + WALL_T * 2, d: innerD + WALL_T * 2 }
}

/** One room size for the whole floor, cut to the biggest team on it, so the plan reads as a plan. */
export function roomSize(teams: Team[]): RoomSize {
  return roomFor(
    Math.min(MAX_LEADS, Math.max(1, ...teams.map((team) => leadsOf(team).length))),
    Math.max(1, ...teams.map((team) => Math.ceil(Math.min(cubicleOf(team).length, MAX_ENG) / ENG_COLS))),
  )
}

export type WorkspaceKind = 'office' | 'lead' | 'cubicle' | 'intern'
export interface Workspace {
  person: Staffer
  kind: WorkspaceKind
  role: Rank
  /** Who they answer to, so the room and the org panel draw the same reporting line. */
  reportsTo?: string
  /** Centre and footprint, local to the room's centre. */
  x: number
  z: number
  w: number
  d: number
}

/**
 * Where everyone in one team sits: the manager's office and the leads' cubicles across the back,
 * the standard cubicles in rows of three in front of them.
 */
export function workspaces(team: Team, room: RoomSize): Workspace[] {
  const { manager, leads, interns } = seating(team)
  const crew = cubicleOf(team).slice(0, MAX_ENG)
  const seniorW = MGR_W + Math.max(1, leads.length) * LEAD_W
  const seniorZ = -room.innerD / 2 + SENIOR_D / 2
  const crewZ = -room.innerD / 2 + SENIOR_D + WALK + ENG_D / 2
  const out: Workspace[] = []
  if (manager) {
    out.push({ person: manager, kind: 'office', role: 'Manager', x: -seniorW / 2 + MGR_W / 2, z: seniorZ, w: MGR_W, d: MGR_D })
  }
  leads.forEach((person, i) => out.push({
    person, kind: 'lead', role: 'Team Lead', reportsTo: manager?.id,
    x: -seniorW / 2 + MGR_W + LEAD_W / 2 + i * LEAD_W, z: seniorZ, w: LEAD_W, d: LEAD_D,
  }))
  crew.forEach((person, i) => out.push({
    person, kind: 'cubicle', role: person.role, reportsTo: leads[0]?.id ?? manager?.id,
    x: (i % ENG_COLS - (ENG_COLS - 1) / 2) * ENG_W,
    z: crewZ + Math.floor(i / ENG_COLS) * ENG_D,
    w: ENG_W, d: ENG_D,
  }))
  // Each intern on a stool at the front edge of their engineer's cubicle. Several interns on one
  // engineer fan out along that desk rather than stacking in one spot. An intern whose engineer
  // is not on this floor is not drawn at all: the desk they belong at is not here.
  const byPerson = new Map(out.map((space) => [space.person.id, space]))
  const taken = new Map<string, number>()
  for (const intern of interns) {
    const desk = intern.hiredBy ? byPerson.get(intern.hiredBy) : undefined
    if (!desk) continue
    const seat = taken.get(desk.person.id) ?? 0
    taken.set(desk.person.id, seat + 1)
    out.push({
      person: intern, kind: 'intern', role: 'Intern', reportsTo: desk.person.id,
      x: desk.x + (seat % 2 === 0 ? -1 : 1) * (desk.w / 2 - INTERN_W / 2),
      z: desk.z + desk.d / 2 + INTERN_D / 2,
      w: INTERN_W, d: INTERN_D,
    })
  }
  return out
}

/** The open-plan desks at the back of the floor: real terminals, one per desk. */
export function bullpen(workers: number) {
  const count = Math.max(3, workers + (workers < 12 ? 1 : 0))
  const columns = Math.min(3, count)
  const rows = Math.ceil(count / columns)
  return {
    count, columns, rows,
    w: columns * 3.3 + 2,
    d: rows * 3.2 + 3.2,
    deskAt: (i: number, depth: number) => ({
      x: (i % columns - (columns - 1) / 2) * 3.3,
      z: Math.floor(i / columns) * 3.2 - depth / 2 + 2.3,
    }),
  }
}

export interface FloorPlan {
  room: RoomSize
  cols: number
  rows: number
  width: number
  depth: number
  /** Centre of room `i`, in floor coordinates. */
  roomAt: (i: number) => { x: number; z: number }
}

/**
 * The whole floor: open-plan desks across the back, then the rooms, one corridor from the desks
 * and from each other. Rooms go in rows of up to three — two columns turned a six-office floor
 * into a long corridor that the camera had to zoom out twice as far to see.
 */
export function floorPlan(teams: Team[], desks: { w: number; d: number }): FloorPlan {
  const room = roomSize(teams)
  // `Math.min(3, teams.length)` would be 0 on an empty floor, and every later division NaN.
  const cols = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(teams.length))))
  const rows = Math.ceil(teams.length / cols)
  const strideX = room.w + ROOM_GAP
  const strideZ = room.d + ROOM_GAP
  const width = Math.max(desks.w, cols * strideX + 1.2)
  const depth = desks.d + rows * strideZ + 0.4
  return {
    room, cols, rows, width, depth,
    roomAt: (i) => ({
      x: ((i % cols) - (cols - 1) / 2) * strideX,
      z: -depth / 2 + desks.d + ROOM_GAP + Math.floor(i / cols) * strideZ + room.d / 2,
    }),
  }
}
