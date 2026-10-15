// Custom job roles in the browser (src/city/office/org.ts, projectOffice.ts).
//
// The office's roles are defined on the server and can be anything the operator types, so two
// things the city does with a job title have to survive a name it has never seen: the pixel badge
// that labels a person, and the place the 3D room seats them. Both are pure functions, so they
// are checked here rather than in a browser.
//
//   node --import ./scripts/ts-resolve.mjs --test scripts/office-roles.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'
import { shortRole } from '../src/city/office/org.ts'
import { projectTeams } from '../src/city/office/projectOffice.ts'
import { lanesFrom } from '../src/city/office/lanes.ts'

test('the badge keeps the built-in initials and abbreviates a job it has never seen', () => {
  assert.equal(shortRole('Manager'), 'MGR')
  assert.equal(shortRole('Team Lead'), 'LEAD')
  assert.equal(shortRole('Engineer'), 'ENG')
  // Several words give initials; one word gives its first four letters.
  assert.equal(shortRole('Staff Engineer'), 'SE')
  assert.equal(shortRole('Quality Assurance Lead'), 'QAL')
  assert.equal(shortRole('Architect'), 'ARCH')
  assert.equal(shortRole('QA'), 'QA')
  // A desk with no role at all is a cubicle, not a crash.
  assert.equal(shortRole(''), 'ENG')
})

test('a custom role is seated by what it does in a run, not by its name', () => {
  const REPO = '/home/czr/projects/hackathon'
  const crew = [
    { id: 'a', name: 'Mina', role: 'Principal', roleKind: 'manage', source: 'agent', cwd: REPO },
    { id: 'b', name: 'Omar', role: 'Staff Engineer', roleKind: 'lead', source: 'agent', cwd: REPO },
    { id: 'c', name: 'Yuki', role: 'QA', roleKind: 'build', source: 'agent', cwd: REPO },
  ]
  const lanes = lanesFrom(crew, [])
  const [team] = projectTeams(crew, {}, lanes)
  assert.ok(team, 'the repo lane should hold a team')
  assert.deepEqual(
    team.people.map((person) => [person.name, person.role]),
    [['Mina', 'Manager'], ['Omar', 'Team Lead'], ['Yuki', 'Engineer']],
    'a planner takes the corner office, a lead the lead desk, a builder a cubicle',
  )
  // The lead of the room is the senior person in it, which is what the org panel reads.
  assert.equal(team.lead?.name ?? team.people[0].name, 'Mina')
})

test('a role with no kind at all still gets a desk', () => {
  const REPO = '/home/czr/projects/hackathon'
  const crew = [{ id: 'a', name: 'Nobody', role: 'Chief Vibes Officer', source: 'desk', cwd: REPO }]
  const lanes = lanesFrom(crew, [])
  const [team] = projectTeams(crew, {}, lanes)
  assert.deepEqual(team.people.map((person) => person.role), ['Engineer'])
})
