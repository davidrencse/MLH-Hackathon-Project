// The office floor plan: rooms that do not overlap, furniture that fits inside its walls, and a
// workspace hierarchy you can read at a glance — the manager's office is the biggest, a lead's
// cubicle is bigger than an engineer's. OfficeRoom3D only draws what these functions return, so
// checking them here checks the room without a WebGL context.
//
//   node --import ./scripts/ts-resolve.mjs --test scripts/office-floorplan.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  bullpen, cubicleOf, floorPlan, leadsOf, roomFor, roomSize, workspaces,
  DESK_D, DESK_W, DOOR_W, ENG_COLS, FRONT_WALK, MAX_ENG, MAX_LEADS, ROOM_GAP, WALL_T,
} from '../src/city/office/floorplan.ts'

const EPS = 1e-9

const team = (id, { managers = 1, leads = 1, engineers = 2 } = {}) => ({
  id,
  name: id,
  people: [
    ...Array.from({ length: managers }, (_, i) => ({ id: `${id}-m${i}`, name: `M${i}`, role: 'Manager' })),
    ...Array.from({ length: leads }, (_, i) => ({ id: `${id}-l${i}`, name: `L${i}`, role: 'Team Lead' })),
    ...Array.from({ length: engineers }, (_, i) => ({ id: `${id}-e${i}`, name: `E${i}`, role: 'Engineer' })),
  ],
})
const floor = (count, shape) => Array.from({ length: count }, (_, i) => team(`t${i}`, shape))

/** Footprints overlap when they share floor, touching edges excepted. */
const overlaps = (a, b) =>
  Math.abs(a.x - b.x) < (a.w + b.w) / 2 - EPS && Math.abs(a.z - b.z) < (a.d + b.d) / 2 - EPS

const area = (space) => space.w * space.d

// Every shape of team the player can actually build, crossed with every floor size.
const SHAPES = [
  { managers: 1, leads: 1, engineers: 2 }, // the seeded HQ
  { managers: 1, leads: 1, engineers: 0 },
  { managers: 0, leads: 0, engineers: 0 },
  { managers: 1, leads: 1, engineers: MAX_ENG },
  { managers: 1, leads: MAX_LEADS, engineers: MAX_ENG },
  { managers: 2, leads: 2, engineers: 5 }, // a second manager
]
const COUNTS = [1, 2, 3, 4, 5, 6, 9]

test('a room holds the team it was cut for, walls included', () => {
  const room = roomFor(1, 1)
  assert.ok(room.innerW > 0 && room.innerD > 0)
  assert.equal(room.w, room.innerW + WALL_T * 2)
  assert.equal(room.d, room.innerD + WALL_T * 2)
  // More leads widen a room; more rows of cubicles deepen it.
  assert.ok(roomFor(2, 1).innerW > room.innerW)
  assert.ok(roomFor(1, 2).innerD > room.innerD)
  assert.equal(roomFor(1, 2).innerW, room.innerW)
})

test('one room size serves the whole floor, cut to the biggest team on it', () => {
  const mixed = [team('a', { leads: 1, engineers: 1 }), team('b', { leads: MAX_LEADS, engineers: MAX_ENG })]
  const size = roomSize(mixed)
  assert.deepEqual(size, roomSize([mixed[1]]))
  assert.ok(size.innerW > roomSize([mixed[0]]).innerW)
})

test('an empty floor still has a plan instead of NaN', () => {
  const plan = floorPlan([], bullpen(0))
  for (const value of [plan.width, plan.depth, plan.cols, plan.rows, plan.room.w, plan.room.d]) {
    assert.ok(Number.isFinite(value), `${value} is not a finite number`)
  }
  assert.equal(plan.rows, 0)
  assert.ok(plan.cols >= 1) // dividing by a zero column count is what produced NaN
  // A team with nobody in it is still a room, not a hole in the floor.
  assert.ok(Number.isFinite(floorPlan([team('empty', { managers: 0, leads: 0, engineers: 0 })], bullpen(0)).depth))
})

test('rooms never overlap each other, whatever the floor', () => {
  for (const count of COUNTS) {
    for (const shape of SHAPES) {
      const teams = floor(count, shape)
      const plan = floorPlan(teams, bullpen(4))
      const rooms = teams.map((_, i) => ({ ...plan.roomAt(i), w: plan.room.w, d: plan.room.d }))
      for (let i = 0; i < rooms.length; i++) {
        for (let j = i + 1; j < rooms.length; j++) {
          assert.ok(!overlaps(rooms[i], rooms[j]), `${count} rooms: ${i} overlaps ${j}`)
        }
      }
    }
  }
})

test('rooms stay on the floor slab and a corridor clear of the open-plan desks', () => {
  for (const count of COUNTS) {
    for (const workers of [0, 1, 6, 12]) {
      const teams = floor(count, { leads: 2, engineers: 4 })
      const desks = bullpen(workers)
      const plan = floorPlan(teams, desks)
      for (let i = 0; i < count; i++) {
        const room = { ...plan.roomAt(i), w: plan.room.w, d: plan.room.d }
        assert.ok(room.x - room.w / 2 >= -plan.width / 2 - EPS, `room ${i} hangs off the left edge`)
        assert.ok(room.x + room.w / 2 <= plan.width / 2 + EPS, `room ${i} hangs off the right edge`)
        assert.ok(room.z + room.d / 2 <= plan.depth / 2 + EPS, `room ${i} hangs off the front edge`)
        // Desks are laid out from the back of the slab; the rooms begin a corridor after them.
        for (let d = 0; d < desks.count; d++) {
          const desk = { ...desks.deskAt(d, plan.depth), w: DESK_W, d: DESK_D }
          assert.ok(!overlaps(room, desk), `${count} rooms / ${workers} workers: room ${i} sits on desk ${d}`)
        }
      }
    }
  }
})

test('every workspace fits inside its own room', () => {
  for (const shape of SHAPES) {
    const teams = floor(2, shape)
    const room = roomSize(teams)
    for (const seat of workspaces(teams[0], room)) {
      assert.ok(seat.x - seat.w / 2 >= -room.innerW / 2 - EPS, `${seat.kind} pokes through the left wall`)
      assert.ok(seat.x + seat.w / 2 <= room.innerW / 2 + EPS, `${seat.kind} pokes through the right wall`)
      assert.ok(seat.z - seat.d / 2 >= -room.innerD / 2 - EPS, `${seat.kind} pokes through the back wall`)
      assert.ok(seat.z + seat.d / 2 <= room.innerD / 2 + EPS, `${seat.kind} pokes through the front wall`)
    }
  }
})

test('no two people are given the same floor', () => {
  for (const shape of SHAPES) {
    const teams = floor(1, shape)
    const room = roomSize(teams)
    const seats = workspaces(teams[0], room)
    for (let i = 0; i < seats.length; i++) {
      for (let j = i + 1; j < seats.length; j++) {
        assert.ok(!overlaps(seats[i], seats[j]), `${seats[i].kind} overlaps ${seats[j].kind}`)
      }
    }
  }
})

test('the doorway stays walkable', () => {
  for (const shape of SHAPES) {
    const teams = floor(1, shape)
    const room = roomSize(teams)
    const doorway = { x: 0, z: room.innerD / 2 - FRONT_WALK / 2, w: DOOR_W, d: FRONT_WALK }
    for (const seat of workspaces(teams[0], room)) {
      assert.ok(!overlaps(doorway, seat), `${seat.kind} is parked in the doorway`)
    }
  }
})

test('rank reads as floor space: the office is biggest, a lead outranks an engineer', () => {
  const teams = floor(1, { managers: 1, leads: 2, engineers: 4 })
  const seats = workspaces(teams[0], roomSize(teams))
  const office = seats.find((s) => s.kind === 'office')
  const lead = seats.find((s) => s.kind === 'lead')
  const cubicle = seats.find((s) => s.kind === 'cubicle')
  assert.ok(office && lead && cubicle)
  assert.ok(area(lead) > area(cubicle), 'a lead must get more room than an engineer')
  assert.ok(area(office) >= area(lead), 'the manager must not be the cramped one')
  assert.ok(lead.w > cubicle.w, 'a lead cubicle should be visibly wider, not just deeper')
  // Seniors share the back of the room; cubicles sit in front of them.
  assert.equal(lead.z, office.z)
  assert.ok(cubicle.z > lead.z)
})

test('the reporting line a room draws is the one the org panel draws', () => {
  const [staffed] = floor(1, { managers: 1, leads: 2, engineers: 3 })
  const seats = workspaces(staffed, roomSize([staffed]))
  const manager = seats.find((s) => s.kind === 'office')
  const leads = seats.filter((s) => s.kind === 'lead')
  assert.equal(manager.reportsTo, undefined)
  for (const lead of leads) assert.equal(lead.reportsTo, manager.person.id)
  for (const seat of seats.filter((s) => s.kind === 'cubicle')) assert.equal(seat.reportsTo, leads[0].person.id)

  // With nobody senior to report to, a cubicle reports to the manager, then to no one.
  const [leaderless] = floor(1, { managers: 1, leads: 0, engineers: 2 })
  const noLead = workspaces(leaderless, roomSize([leaderless]))
  assert.equal(noLead.find((s) => s.kind === 'cubicle').reportsTo, `${leaderless.id}-m0`)
  const [alone] = floor(1, { managers: 0, leads: 0, engineers: 1 })
  assert.equal(workspaces(alone, roomSize([alone])).find((s) => s.kind === 'cubicle').reportsTo, undefined)
})

test('nobody is silently dropped, and an overflowing team is capped rather than spilling', () => {
  // A second manager has no private office to give, so they get a cubicle instead of vanishing.
  const [two] = floor(1, { managers: 2, leads: 1, engineers: 1 })
  assert.equal(leadsOf(two).length, 1)
  assert.equal(cubicleOf(two).length, 2) // the spare manager and the engineer
  const seats = workspaces(two, roomSize([two]))
  assert.equal(seats.filter((s) => s.kind === 'office').length, 1)
  assert.equal(seats.length, two.people.length)
  const spare = seats.find((s) => s.kind === 'cubicle' && s.role === 'Manager')
  assert.ok(spare, 'the spare manager should still get a desk, with their rank intact')

  // Past the caps the room stops seating people rather than growing without limit.
  const [crowded] = floor(1, { managers: 1, leads: MAX_LEADS + 2, engineers: MAX_ENG + 5 })
  const room = roomSize([crowded])
  const packed = workspaces(crowded, room)
  assert.equal(packed.filter((s) => s.kind === 'lead').length, MAX_LEADS)
  assert.equal(packed.filter((s) => s.kind === 'cubicle').length, MAX_ENG)
  for (const seat of packed) {
    assert.ok(Math.abs(seat.x) + seat.w / 2 <= room.innerW / 2 + EPS, 'an overflow seat broke the wall')
    assert.ok(Math.abs(seat.z) + seat.d / 2 <= room.innerD / 2 + EPS, 'an overflow seat broke the wall')
  }
})

test('cubicles fill in rows of three before starting another row', () => {
  const [full] = floor(1, { managers: 1, leads: 1, engineers: ENG_COLS * 2 })
  const cubicles = workspaces(full, roomSize([full])).filter((s) => s.kind === 'cubicle')
  const firstRow = cubicles.slice(0, ENG_COLS)
  assert.equal(new Set(firstRow.map((s) => s.z)).size, 1, 'a row should share one depth')
  assert.equal(new Set(firstRow.map((s) => s.x)).size, ENG_COLS, 'a row should not stack people')
  assert.ok(cubicles[ENG_COLS].z > firstRow[0].z, 'the next row belongs in front of the first')
})

test('rooms lay out in rows rather than one long corridor', () => {
  for (const [count, cols] of [[1, 1], [2, 2], [4, 2], [5, 3], [9, 3]]) {
    const plan = floorPlan(floor(count, {}), bullpen(0))
    assert.equal(plan.cols, cols, `${count} rooms should sit in ${cols} columns`)
    assert.ok(plan.cols * plan.rows >= count, 'every room needs a slot')
  }
  // Nine rooms in a single column is what the camera then has to zoom out to cover.
  const nine = floorPlan(floor(9, { leads: 1, engineers: 2 }), bullpen(0))
  const oneColumnDepth = bullpen(0).d + 9 * (nine.room.d + ROOM_GAP) + 0.4
  assert.ok(nine.depth < oneColumnDepth * 0.5, 'nine rooms should not be a nine-room corridor')
})

test('the open-plan desks keep a seat for the next worker and never fewer than three', () => {
  assert.equal(bullpen(0).count, 3)
  assert.equal(bullpen(5).count, 6) // one spare desk to add to
  assert.equal(bullpen(12).count, 12) // a full floor stops adding one
  assert.equal(bullpen(4).columns, 3)
  for (const workers of [0, 4, 12]) {
    const desks = bullpen(workers)
    assert.equal(desks.rows, Math.ceil(desks.count / desks.columns))
    const seats = Array.from({ length: desks.count }, (_, i) => ({ ...desks.deskAt(i, 40), w: DESK_W, d: DESK_D }))
    for (let i = 0; i < seats.length; i++) {
      for (let j = i + 1; j < seats.length; j++) {
        assert.ok(!overlaps(seats[i], seats[j]), `desk ${i} overlaps desk ${j}`)
      }
    }
  }
})

test('the ranks the floor plan knows are the ranks the org chart starts with', () => {
  // floorplan.ts spells the ranks out rather than importing org.ts, so that a node test can load
  // it without React. This is the guard against the two drifting apart.
  //
  // org.ts used to declare `Role` as a union of the three ranks, and this test read that union.
  // Roles are operator-definable now (the backend holds the definitions), so `Role` is just
  // `string` and the three the office starts with live in BUILTIN_ROLES — which is what the
  // floor plan's fixed desk layout is actually drawn for.
  const union = (source, name) =>
    [...(new RegExp(`export type ${name} =([^\\n]*)`).exec(source)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])
  const org = readFileSync(new URL('../src/city/office/org.ts', import.meta.url), 'utf8')
  const builtins = [...(/export const BUILTIN_ROLES = \[([^\]]*)\]/.exec(org)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])
  const ranks = union(readFileSync(new URL('../src/city/office/floorplan.ts', import.meta.url), 'utf8'), 'Rank')
  assert.ok(builtins.length >= 3, 'could not read BUILTIN_ROLES out of org.ts')
  assert.deepEqual(ranks, builtins)
})
