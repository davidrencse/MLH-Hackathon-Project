// One office space per project (src/city/office/projectOffice.ts).
//
// The room a person stands in has to be the lane their card sits in on the staffing board, and
// the rooms have to be real spaces that do not overlap or spill their desks through a wall.
// Neither can be checked in a browser from this workspace, so they are checked here.
//
//   node --import ./scripts/ts-resolve.mjs --test scripts/project-office.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DESK_D, DESK_W, DOOR_W, FRONT_WALK, LEAD_D, MAX_DESKS, SLAB_MARGIN, VOID_GAP, WALL_T,
  deskPlatform, floorRoomSize, officeFloor, officeSize, platformFor, projectPlatforms, projectTeams, seats,
} from '../src/city/office/projectOffice.ts'
import { BENCH, lanesFrom } from '../src/city/office/lanes.ts'

const HACK = '/home/czr/projects/hackathon'
const AGENTS = '/home/czr/projects/hackathon/.agents'

const live = (id, name, role, cwd) => ({ id, name, role, source: 'live', cwd })
const hired = (id, name, role) => ({ id, name, role, source: 'hired', cwd: null })

const CREW = [
  live('cli:1', 'Maya', 'Team Lead', HACK),
  live('cli:2', 'Leo', 'Engineer', HACK),
  live('cli:3', 'Priya', 'Engineer', HACK),
  live('cli:4', 'Kai', 'Engineer', AGENTS),
  hired('p1', 'Morgan', 'Manager'),
]
const lanes = lanesFrom(CREW, [])

test('a project is a room, and it holds exactly the lane it holds on the board', () => {
  const teams = projectTeams(CREW, {}, lanes)
  assert.deepEqual(teams.map((team) => team.name), ['hackathon', '.agents'])
  const hack = teams.find((team) => team.name === 'hackathon')
  assert.deepEqual(hack.people.map((person) => person.name), ['Maya', 'Leo', 'Priya'])
  // Seniors first, so the lead is the one on the back strip.
  assert.equal(hack.people[0].role, 'Team Lead')
  // Everyone in the room answers to its lead, which is what the org panel reads.
  assert.deepEqual(hack.people.slice(1).map((person) => person.reportsTo), ['cli:1', 'cli:1'])
  assert.equal(hack.people[0].reportsTo, undefined)
  // Benched people have no project, so they get no room rather than a room called "Bench".
  assert.ok(!teams.some((team) => team.id === BENCH))
  assert.ok(!teams.some((team) => team.people.some((person) => person.name === 'Morgan')))
})

test('dragging someone to another project moves their desk', () => {
  const teams = projectTeams(CREW, { 'cli:2': AGENTS }, lanes)
  const names = (lane) => teams.find((team) => team.id === lane).people.map((person) => person.name)
  assert.deepEqual(names(HACK), ['Maya', 'Priya'])
  assert.deepEqual(names(AGENTS).sort(), ['Kai', 'Leo'])
  // And benching them empties their seat without inventing a room.
  const benched = projectTeams(CREW, { 'cli:2': BENCH }, lanes)
  assert.deepEqual(benched.find((team) => team.id === HACK).people.map((p) => p.name), ['Maya', 'Priya'])
})

test('a room is big enough for the desks it has to hold, and for its own door', () => {
  for (const headcount of [1, 2, 3, 5, 9, 12, 40]) {
    const size = officeSize(headcount)
    assert.ok(size.innerW > DOOR_W, 'a door has to fit in the front wall')
    assert.ok(size.innerD > LEAD_D + FRONT_WALK, 'the lead strip and the doorway both need floor')
    assert.ok(size.rows >= 1)
    // Past the cap a room stops growing: the overflow is reported, not hidden.
    assert.ok(size.rows <= Math.ceil(MAX_DESKS / 2))
  }
  // One size for the whole floor, taken from the biggest project on it.
  const teams = projectTeams(CREW, {}, lanes)
  assert.deepEqual(floorRoomSize(teams), officeSize(3))
})

test('every desk stands inside its own room, clear of the walls', () => {
  const teams = projectTeams(CREW, {}, lanes)
  const room = floorRoomSize(teams)
  for (const team of teams) {
    const placed = seats(team, room)
    assert.equal(placed.length, Math.min(team.people.length, MAX_DESKS + 1))
    // At most one lead seat, and one exactly when the project has someone senior to fill it —
    // a project of engineers has no lead desk rather than promoting somebody to fill the chair.
    const leads = placed.filter((seat) => seat.kind === 'lead')
    const senior = team.people.some((person) => person.role === 'Team Lead' || person.role === 'Manager')
    assert.equal(leads.length, senior ? 1 : 0)
    // The lead sits on the back strip, behind the desks.
    if (senior) assert.ok(leads[0].z < -room.innerD / 2 + LEAD_D + 0.001)
    for (const seat of placed) {
      const halfW = (seat.kind === 'lead' ? DESK_W * 1.35 : DESK_W) / 2
      assert.ok(Math.abs(seat.x) + halfW <= room.innerW / 2, `${seat.person.name}'s desk pokes through a side wall`)
      assert.ok(Math.abs(seat.z) + DESK_D / 2 <= room.innerD / 2, `${seat.person.name}'s desk pokes through an end wall`)
    }
    // No two people share a desk.
    const spots = placed.map((seat) => `${seat.x}:${seat.z}`)
    assert.equal(new Set(spots).size, spots.length)
    // Rows alternate which way they face, so the room reads as a shared space.
    const desks = placed.filter((seat) => seat.kind === 'desk')
    if (desks.length > 2) assert.ok(new Set(desks.map((seat) => seat.facing)).size === 2)
  }
})

test('an overflowing project fills its room and reports the rest rather than hiding them', () => {
  const crowd = Array.from({ length: MAX_DESKS + 5 }, (_, i) => live(`cli:${100 + i}`, `E${i}`, 'Engineer', HACK))
  const team = projectTeams([live('cli:9', 'Lead', 'Team Lead', HACK), ...crowd], {}, lanesFrom(crowd, []))[0]
  const room = officeSize(team.people.length)
  const placed = seats(team, room)
  assert.equal(placed.length, MAX_DESKS + 1, 'the lead plus a full room of desks')
  assert.ok(team.people.length > placed.length, 'the overflow is left for the caller to report')
})

test('every project is its own platform, with void and not a corridor between them', () => {
  const desks = { w: 11.9, d: 12.8 }
  for (const count of [1, 2, 3, 4, 6, 9]) {
    const teams = Array.from({ length: count }, (_, i) => ({
      id: `p${i}`, name: `P${i}`, people: [{ id: `l${i}`, name: 'L', role: 'Team Lead' }, { id: `e${i}`, name: 'E', role: 'Engineer' }],
    }))
    const floor = officeFloor(teams, desks)
    const platforms = projectPlatforms(floor)
    assert.equal(platforms.length, count, 'one platform per project, no more and no fewer')
    // Separate places: no two slabs touch, and the gap between them is the void, not a walkway.
    for (let a = 0; a < platforms.length; a++)
      for (let b = a + 1; b < platforms.length; b++) {
        const gapX = Math.abs(platforms[a].x - platforms[b].x) - (platforms[a].w + platforms[b].w) / 2
        const gapZ = Math.abs(platforms[a].z - platforms[b].z) - (platforms[a].d + platforms[b].d) / 2
        assert.ok(gapX > 0 || gapZ > 0, `platforms ${a} and ${b} are joined`)
        assert.ok(Math.max(gapX, gapZ) >= VOID_GAP - 1e-9, `platforms ${a} and ${b} are closer than the void`)
      }
    // The terminal desks are their own place too, clear of every project.
    const deck = deskPlatform(floor)
    for (const platform of platforms) {
      const gapZ = Math.abs(platform.z - deck.z) - (platform.d + deck.d) / 2
      const gapX = Math.abs(platform.x - deck.x) - (platform.w + deck.w) / 2
      assert.ok(Math.max(gapX, gapZ) >= VOID_GAP - 1e-9, 'the terminals must not be joined to a project')
    }
    // Everything the camera has to frame fits in the reported bounds.
    for (const platform of floor.platforms) {
      assert.ok(Math.abs(platform.x) + platform.w / 2 <= floor.width / 2 + 1e-9)
      assert.ok(Math.abs(platform.z) + platform.d / 2 <= floor.depth / 2 + 1e-9)
    }
  }
})

test('a room sits on its platform with a walkway all the way round it', () => {
  const teams = projectTeams(CREW, {}, lanes)
  const floor = officeFloor(teams, { w: 11.9, d: 12.8 })
  const slab = platformFor(floor.room)
  for (const platform of projectPlatforms(floor)) {
    assert.deepEqual({ w: platform.w, d: platform.d }, slab)
    // The room's outer wall stops short of the edge, so nobody's desk hangs over the void.
    assert.ok((platform.w - (floor.room.innerW + WALL_T * 2)) / 2 >= SLAB_MARGIN - 1e-9)
    assert.ok((platform.d - (floor.room.innerD + WALL_T * 2)) / 2 >= SLAB_MARGIN - 1e-9)
  }
})

test('an office with no projects is still somewhere: the terminals keep their platform', () => {
  const floor = officeFloor([], { w: 11.9, d: 12.8 })
  assert.ok(Number.isFinite(floor.width) && Number.isFinite(floor.depth))
  assert.ok(floor.width > 0 && floor.depth > 0)
  assert.deepEqual(projectPlatforms(floor), [])
  assert.ok(deskPlatform(floor), 'the terminal platform is always there')
  assert.deepEqual(projectTeams([], {}, []), [])
})
