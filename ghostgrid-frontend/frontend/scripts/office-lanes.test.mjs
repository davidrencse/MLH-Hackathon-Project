// The office's project lanes (src/city/office/lanes.ts).
//
// The browser cannot be driven from this workspace, so the part that would be wrong silently —
// which lane each person ends up standing in — is checked here instead, against the shape the
// backend's /api/v1/office/processes really returns.
//
//   node --import ./scripts/ts-resolve.mjs --test scripts/office-lanes.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'
import { crewFromProcesses, crewFromDesks } from '../src/city/office/crew.ts'
import { BENCH, folderOf, laneForId, laneLabel, lanesFrom, laneOf } from '../src/city/office/lanes.ts'

const HACKATHON = '/home/czr/projects/hackathon'
const AGENTS = '/home/czr/projects/hackathon/.agents'

// Exactly what the backend reported on the machine this was written for: eight `claude`
// terminals, seven in one repo and one in a subfolder.
const process_ = (pid, tty, cwd, uptimeSeconds = 5000) => ({
  id: `cli:${pid}`, pid, tty, cwd, uptimeSeconds, runtime: 'claude',
  startedAt: new Date().toISOString(),
})
const EIGHT_CLAUDES = [
  process_(101, 'pts/1', HACKATHON, 51538),
  process_(102, 'pts/2', HACKATHON, 51527),
  process_(103, 'pts/3', HACKATHON, 51530),
  process_(104, 'pts/4', AGENTS, 51157),
  process_(105, 'pts/7', HACKATHON),
  process_(106, 'pts/8', HACKATHON),
  process_(107, 'pts/9', HACKATHON),
  process_(108, 'pts/10', HACKATHON),
]

// A backend office employee (crewFromStaff): a real session, not a terminal. It has no working
// directory, so what places it on a lane is its office project — `stream`.
const employee = (id, role, stream = null, team = 'Platform') => ({
  id, name: id, role, source: 'agent', stream, cwd: null, detail: `${team} · idle`,
})

test('the projects are the folders the terminals are really open in, busiest first', () => {
  const crew = crewFromProcesses(EIGHT_CLAUDES)
  const lanes = lanesFrom(crew, [])
  // Two folders, not eight terminals and not a typed-in name anywhere.
  assert.deepEqual(lanes.map((lane) => lane.name), ['hackathon', '.agents'])
  assert.deepEqual(lanes.map((lane) => lane.id), [HACKATHON, AGENTS])
  // A lane is labelled by its folder and keyed by the full path, so it carries both.
  assert.equal(lanes[0].path, '~/projects/hackathon')
  assert.equal(lanes[0].manual, false)
})

test('an empty machine has no projects at all', () => {
  assert.deepEqual(lanesFrom([], []), [])
  // ...and nothing invented on first load, which is what the store now seeds.
  assert.deepEqual(lanesFrom([employee('a', 'Manager')], []), [])
})

test('two repos that share a folder name stay two lanes', () => {
  const crew = crewFromProcesses([process_(1, 'pts/1', '/a/src'), process_(2, 'pts/2', '/b/src')])
  const lanes = lanesFrom(crew, [])
  assert.equal(lanes.length, 2)
  assert.deepEqual(lanes.map((lane) => lane.id).sort(), ['/a/src', '/b/src'])
})

test('every live terminal starts on its own folder, with nothing assigned by hand', () => {
  const crew = crewFromProcesses(EIGHT_CLAUDES)
  const lanes = lanesFrom(crew, [])
  const placed = crew.map((member) => laneOf(member, {}, lanes))
  assert.equal(placed.filter((lane) => lane === HACKATHON).length, 7)
  assert.equal(placed.filter((lane) => lane === AGENTS).length, 1)
  assert.equal(placed.filter((lane) => lane === BENCH).length, 0)
})

test('a backend employee with no office project starts on the bench', () => {
  const crew = [...crewFromProcesses(EIGHT_CLAUDES), employee('h1', 'Manager'), employee('h2', 'Engineer')]
  const lanes = lanesFrom(crew, [])
  assert.equal(folderOf(employee('h1', 'Manager')), null)
  assert.equal(laneOf(employee('h1', 'Manager'), {}, lanes), BENCH)
})

test('a hand-named lane is kept, and a folder of the same name is not duplicated', () => {
  const crew = crewFromProcesses(EIGHT_CLAUDES)
  const lanes = lanesFrom(crew, ['Pitch deck', HACKATHON])
  assert.deepEqual(lanes.map((lane) => lane.name), ['hackathon', '.agents', 'Pitch deck'])
  assert.equal(lanes.find((lane) => lane.name === 'Pitch deck').manual, true)
  assert.equal(lanes.filter((lane) => lane.id === HACKATHON).length, 1)
})

test('dragging someone off their real folder sticks, and benching them sticks too', () => {
  const crew = crewFromProcesses(EIGHT_CLAUDES)
  const lanes = lanesFrom(crew, ['Pitch deck'])
  const member = crew[0]
  assert.equal(laneOf(member, { [member.id]: 'Pitch deck' }, lanes), 'Pitch deck')
  // An explicit bench must win over the folder, or a benched terminal would snap straight back.
  assert.equal(laneOf(member, { [member.id]: BENCH }, lanes), BENCH)
})

test('an assignment to a lane that no longer exists falls back instead of hiding the person', () => {
  const crew = crewFromProcesses(EIGHT_CLAUDES)
  const lanes = lanesFrom(crew, [])
  // Its terminal closed, or the player closed the lane: the person reappears in their folder.
  assert.equal(laneOf(crew[0], { [crew[0].id]: '/gone' }, lanes), HACKATHON)
  // Someone with no folder of their own lands on the bench, never in a lane nobody can see.
  assert.equal(laneOf(employee('h1', 'Engineer'), { h1: '/gone' }, lanes), BENCH)
})

test("Ghost Grid's own desks are projects too, by their workspace", () => {
  const desks = crewFromDesks([
    { id: 'desk1', name: 'Nova', runtime: 'claude', workspace: '/home/czr/projects/news', buildingId: 'claude', openedAt: '' },
    { id: 'desk2', name: 'Rex', runtime: 'claude-browser', workspace: undefined, buildingId: 'claude', openedAt: '' },
  ])
  const lanes = lanesFrom(desks, [])
  assert.deepEqual(lanes.map((lane) => lane.name), ['news'])
  assert.equal(laneOf(desks[0], {}, lanes), '/home/czr/projects/news')
  // A browser window has no folder, so it waits on the bench rather than inventing a project.
  assert.equal(laneOf(desks[1], {}, lanes), BENCH)
})

// Views that hold people as Employees rather than crew members — the tag over a head in the 3D
// room, the panel that opens when you click them — resolve the lane through `laneForId`. They
// used to read `assign` on its own, which only has an entry for someone dragged by hand, so
// everyone sitting in the folder their terminal is open in was reported as unassigned.
test('a person in a real project is never reported as unassigned, however they are looked up', () => {
  const crew = crewFromProcesses(EIGHT_CLAUDES)
  const lanes = lanesFrom(crew, [])
  const byId = new Map(crew.map((member) => [member.id, member]))
  for (const member of crew) {
    const lane = laneForId(member.id, byId, {}, lanes)
    // The same answer the staffing board gives for the same person.
    assert.equal(lane, laneOf(member, {}, lanes))
    assert.notEqual(lane, BENCH, `${member.name} works in ${member.cwd} and must not read as benched`)
    assert.ok(laneLabel(lane, lanes), 'the lane must have a name to show')
  }
  // And the name shown is the folder name, not the whole path.
  assert.equal(laneLabel(laneForId('cli:101', byId, {}, lanes), lanes), 'hackathon')
})

test('looking someone up by id agrees with dragging them, and the bench still reads as the bench', () => {
  const crew = crewFromProcesses(EIGHT_CLAUDES)
  const lanes = lanesFrom(crew, ['Pitch deck'])
  const byId = new Map(crew.map((member) => [member.id, member]))
  // Dragged onto a hand-named lane.
  assert.equal(laneForId('cli:101', byId, { 'cli:101': 'Pitch deck' }, lanes), 'Pitch deck')
  assert.equal(laneLabel('Pitch deck', lanes), 'Pitch deck')
  // Explicitly benched, which must win over the folder they are really in.
  assert.equal(laneForId('cli:101', byId, { 'cli:101': BENCH }, lanes), BENCH)
  assert.equal(laneLabel(BENCH, lanes), null, 'the bench has no project name')
  // Someone the roster has never heard of has no folder, so they bench rather than throwing.
  assert.equal(laneForId('mgr:claude', byId, {}, lanes), BENCH)
  assert.equal(laneForId('nobody', undefined, {}, lanes), BENCH)
})

test("a backend employee's office project is a lane of its own, beside the folder lanes", () => {
  // folderOf prefers `stream` over `cwd`, so an employee assigned to an office project stands
  // in a lane named for it — the board shows backend work next to terminal work, not instead.
  const crew = [...crewFromProcesses(EIGHT_CLAUDES), employee('e1', 'Engineer', 'checkout-rewrite')]
  const lanes = lanesFrom(crew, [])
  assert.ok(lanes.some((lane) => lane.id === 'checkout-rewrite'), 'the office project is not a lane')
  assert.equal(laneOf(employee('e1', 'Engineer', 'checkout-rewrite'), {}, lanes), 'checkout-rewrite')
  // And the folder lanes are untouched by it.
  assert.ok(lanes.some((lane) => lane.id === HACKATHON))
})
