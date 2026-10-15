// The office org chart's reporting tree (src/city/office/orgTree.ts).
//
// The chart's whole job is the reporting line, and no reporting line is stored — it is derived
// from the roles in a team. The browser cannot be driven from this workspace, so the derivation
// is checked here: every person has to appear exactly once, and nobody may be dropped.
//
//   node --import ./scripts/ts-resolve.mjs --test scripts/office-org.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'
import { treeOf } from '../src/city/office/orgTree.ts'
import { crewFromProcesses } from '../src/city/office/crew.ts'

const person = (name, role) => ({ id: name, name, role, source: 'agent', stream: null, cwd: null, detail: '' })

/** Every member in the tree, so nobody can be silently lost between levels. */
const flatten = (nodes) => nodes.flatMap((node) => [node.member.name, ...flatten(node.reports)])
const named = (nodes) => nodes.map((node) => node.member.name)
const find = (nodes, name) => {
  for (const node of nodes) {
    if (node.member.name === name) return node
    const hit = find(node.reports, name)
    if (hit) return hit
  }
  return null
}

test('the seeded team reads manager -> lead -> engineers', () => {
  // The shape `newOffice()` and the HQ seed both produce.
  const tree = treeOf([
    person('Morgan', 'Manager'), person('Priya', 'Team Lead'),
    person('Kai', 'Engineer'), person('Zoe', 'Engineer'),
  ])
  assert.deepEqual(named(tree), ['Morgan'])
  assert.deepEqual(named(tree[0].reports), ['Priya'])
  assert.deepEqual(named(tree[0].reports[0].reports), ['Kai', 'Zoe'])
})

test('a team with a manager but no lead still shows its engineers', () => {
  // This is the case that used to render a manager with nothing under them.
  const people = [person('Morgan', 'Manager'), person('Kai', 'Engineer'), person('Zoe', 'Engineer')]
  const tree = treeOf(people)
  assert.deepEqual(named(tree), ['Morgan'])
  assert.deepEqual(named(tree[0].reports), ['Kai', 'Zoe'])
  assert.deepEqual(flatten(tree).sort(), ['Kai', 'Morgan', 'Zoe'])
})

test('nobody is dropped, whatever the mix of roles', () => {
  const mixes = [
    [],
    [person('Kai', 'Engineer')],
    [person('Priya', 'Team Lead')],
    [person('Morgan', 'Manager')],
    [person('Kai', 'Engineer'), person('Zoe', 'Engineer')],
    [person('Priya', 'Team Lead'), person('Kai', 'Engineer')],
    [person('Morgan', 'Manager'), person('Dana', 'Manager'), person('Kai', 'Engineer'), person('Zoe', 'Engineer')],
    [person('Morgan', 'Manager'), person('Priya', 'Team Lead'), person('Sam', 'Team Lead'),
      person('Kai', 'Engineer'), person('Zoe', 'Engineer'), person('Theo', 'Engineer')],
  ]
  for (const people of mixes) {
    const flat = flatten(treeOf(people)).sort()
    assert.deepEqual(flat, people.map((p) => p.name).sort(), `lost somebody from ${people.length} people`)
    assert.equal(new Set(flat).size, flat.length, 'somebody appears twice')
  }
})

test('two leads split the engineers between them instead of stacking on one', () => {
  const tree = treeOf([
    person('Morgan', 'Manager'), person('Priya', 'Team Lead'), person('Sam', 'Team Lead'),
    person('Kai', 'Engineer'), person('Zoe', 'Engineer'), person('Theo', 'Engineer'),
  ])
  assert.deepEqual(named(find(tree, 'Priya').reports), ['Kai', 'Theo'])
  assert.deepEqual(named(find(tree, 'Sam').reports), ['Zoe'])
})

test('a second manager is a sibling, not a report of the first', () => {
  const tree = treeOf([person('Morgan', 'Manager'), person('Dana', 'Manager'), person('Priya', 'Team Lead')])
  assert.deepEqual(named(tree), ['Morgan', 'Dana'])
  assert.deepEqual(named(find(tree, 'Dana').reports), [])
})

test("eight live terminals read as one lead with seven reports", () => {
  // crewFromProcesses makes the oldest terminal the lead and the rest engineers, so the machine
  // branch is a tree without anybody having to hire a manager for it.
  const crew = crewFromProcesses(Array.from({ length: 8 }, (_, i) => ({
    id: `cli:${i}`, pid: 100 + i, tty: `pts/${i}`, cwd: '/home/czr/projects/hackathon',
    runtime: 'claude', uptimeSeconds: 5000 - i, startedAt: '',
  })))
  const tree = treeOf(crew)
  assert.equal(tree.length, 1)
  assert.equal(tree[0].member.role, 'Team Lead')
  assert.equal(tree[0].reports.length, 7)
  assert.equal(flatten(tree).length, 8)
})
