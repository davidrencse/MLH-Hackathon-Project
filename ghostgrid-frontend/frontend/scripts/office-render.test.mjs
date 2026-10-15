// What the staffing board and the org chart actually render.
//
// The browser cannot be driven from this workspace, so these components were redesigned without
// anyone seeing them. Vite transforms the TSX and React renders it to a string here, which is
// how the duplicated folder path on every card, the "team · HQ team" stutter and the empty
// office's "Everyone is on a project" bench were all caught. Markup, not pixels — but it is the
// difference between checking the logic and checking the thing.
//
//   node --import ./scripts/ts-resolve.mjs --test scripts/office-render.test.mjs
import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const HACK = '/home/czr/projects/hackathon'
const AGENTS = '/home/czr/projects/hackathon/.agents'

// Eight `claude` terminals, seven in one repo and one in a subfolder: the machine this was
// designed against, and the shape /api/v1/office/processes really returns.
const PROCESSES = [
  [101, 'pts/1', HACK], [102, 'pts/2', HACK], [103, 'pts/3', HACK], [104, 'pts/4', AGENTS],
  [105, 'pts/7', HACK], [106, 'pts/8', HACK], [107, 'pts/9', HACK], [108, 'pts/10', HACK],
].map(([pid, tty, cwd]) => ({ id: `cli:${pid}`, pid, tty, cwd, uptimeSeconds: 5000, runtime: 'claude', startedAt: '' }))

// Two windows Ghost Grid opened itself: one terminal hired onto the hackathon folder, and one
// browser with no folder at all, which benches. There is no invented headcount to fixture any
// more — an employee is a CLI you hired, so every member here is a real process.
const DESKS = [
  { id: 'desk-1', name: 'Ada', runtime: 'claude', workspace: HACK },
  { id: 'desk-2', name: 'Bo', runtime: 'claude-browser' },
]

const cells = new Map()
let vite
let ProjectBoard
let OrgChart
let live
let desks

before(async () => {
  // Modules read these at import time; jsdom is not a dependency, and this is all they need.
  globalThis.localStorage = {
    getItem: (k) => cells.get(k) ?? null,
    setItem: (k, v) => cells.set(k, String(v)),
    removeItem: (k) => cells.delete(k),
  }
  globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} })

  vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
  const crew = await vite.ssrLoadModule('/src/city/office/crew.ts')
  ;({ ProjectBoard } = await vite.ssrLoadModule('/src/city/office/ProjectBoard.tsx'))
  ;({ OrgChart } = await vite.ssrLoadModule('/src/city/office/OrgChart.tsx'))
  live = crew.crewFromProcesses(PROCESSES)
  desks = crew.crewFromDesks(DESKS)
})

after(async () => { await vite?.close() })

const board = (crew, selected = null) =>
  renderToStaticMarkup(createElement(ProjectBoard, { crew, selected, onSelect: () => {} }))

const chart = (Component = OrgChart) => renderToStaticMarkup(createElement(Component, {
  buildingName: 'Claude Nexus',
  roster: { live, desks },
  selected: null,
  onSelect: () => {},
}))

/**
 * The chart as it renders for a browser that has these hand-named projects saved.
 *
 * zustand serves `getInitialState()` under SSR, so mutating the store after it is built changes
 * nothing here — the seed has to be in localStorage before org.ts runs. Invalidating the module
 * graph is what makes it run again with a fresh store.
 */
async function chartWith(projects) {
  cells.set('gg-org', JSON.stringify({ projects, assign: {} }))
  try {
    vite.moduleGraph.invalidateAll()
    const fresh = await vite.ssrLoadModule('/src/city/office/OrgChart.tsx')
    return chart(fresh.OrgChart)
  } finally {
    cells.delete('gg-org')
    vite.moduleGraph.invalidateAll()
  }
}

/** Every card's detail line, in document order. */
const details = (html) => [...html.matchAll(/gg-sb-card-detail">\s*([^<]*?)\s*<\/span>/g)].map((m) => m[1])
const count = (html, needle) => html.split(needle).length - 1

test('a folder appears once, in its lane header, not again on every card in it', () => {
  const html = board([...live, ...desks])
  // The lane says where it is...
  assert.match(html, /<h3>hackathon<\/h3>/)
  assert.match(html, /gg-sb-lane-path" title="\/home\/czr\/projects\/hackathon">~\/projects\/hackathon</)
  // ...and its seven cards say only which terminal and for how long.
  const inLane = details(html).filter((d) => d.startsWith('live · pts/'))
  assert.equal(inLane.length, 8)
  for (const detail of inLane) {
    assert.doesNotMatch(detail, /projects\/hackathon/, `card repeats its own lane's folder: ${detail}`)
    assert.match(detail, /^live · pts\/\d+ · \d/)
  }
})

test('a desk says it is a desk, and says its folder only once', () => {
  const html = board([...live, ...desks])
  // The source prefix adds what the detail does not, and must not repeat the detail's own words.
  assert.ok(details(html).includes('desk · ghost grid desk'), details(html).join(' | '))
  assert.ok(details(html).includes('desk · browser window'))
  // The desk hired onto the hackathon folder stands in that lane, so its card does not repeat it.
  for (const detail of details(html).filter((d) => d.startsWith('desk · ghost grid'))) {
    assert.doesNotMatch(detail, /projects\/hackathon/, `card repeats its own lane's folder: ${detail}`)
  }
})

test('only the selected card carries a move control', () => {
  const crew = [...live, ...desks]
  assert.equal(count(board(crew), 'gg-sb-move'), 0, 'an unselected board should show no dropdowns')
  const selected = board(crew, live[0].id)
  assert.equal(count(selected, 'gg-sb-move'), 1)
  // It opens on the lane that person is actually standing in.
  assert.match(selected, /<option value="\/home\/czr\/projects\/hackathon" selected="">hackathon<\/option>/)
  assert.equal(count(selected, 'data-selected="true"'), 1)
})

test('the lane meter counts one block per person, coloured by role', () => {
  const html = board([...live, ...desks])
  // hackathon: the lead terminal, six more terminals and the desk hired onto that folder.
  assert.match(html, /gg-sb-mix-text">1 LEAD · 7 ENG</)
  assert.match(html, /gg-sb-mix-text">1 ENG</) // the bench: the browser window, which has no folder
  assert.equal(count(html, 'gg-sb-mix-bar'), 3) // hackathon, .agents, bench
})

test('an office with nobody in it shows one invitation and no empty furniture', () => {
  const html = board([])
  // Matched exactly: the container is class="gg-sb-lanes", which contains "gg-sb-lane".
  assert.equal(count(html, 'class="gg-sb-lane"'), 0, 'an empty office should not draw a bench')
  assert.equal(count(html, 'data-bench'), 0)
  assert.equal(count(html, 'gg-sb-none'), 1)
  assert.match(html, /Nobody is working here yet/)
  // The old copy told an office with no staff that everyone was already busy.
  assert.doesNotMatch(html, /Everyone is on a project/)
})

test('a bench with nobody on it only claims everyone is busy when somebody exists', () => {
  const html = board(live) // every live terminal sits in its own folder, so the bench is empty
  assert.match(html, /Everyone is on a project/)
})

test('the board lays out lanes, never a sideways-scrolling row of columns', () => {
  const html = board([...live, ...desks])
  assert.match(html, /class="gg-sb-lanes"/)
  assert.equal(count(html, 'gg-sb-column'), 0)
})

test('the org chart nests reports inside their lead, so the tree is real', () => {
  const html = chart()
  assert.match(html, /class="gg-oc-tree"/)
  // The lead's <li> has to contain its own <ul> of engineers; a flat list would not.
  const lead = html.indexOf('>LEAD</span><b>')
  const nested = html.indexOf('<ul>', lead)
  const engineer = html.indexOf('>ENG</span>', lead)
  assert.ok(lead > -1 && nested > -1 && nested < engineer, 'engineers are not nested under their lead')
  // Nobody lost: 7 engineers in hackathon under its lead, 1 in .agents, 1 on the bench.
  assert.equal(count(html, '>ENG</span>'), 9)
  assert.equal(count(html, '>LEAD</span>'), 1)
  assert.equal(count(html, 'gg-oc-person'), 10) // 8 terminals + 2 desks
})

test('naming a project is the only way to open an office', () => {
  const html = chart()
  // The chart used to offer a free-standing "New office" button over a roster of invented people.
  // An office is a project now, so the only creative control is naming one.
  assert.doesNotMatch(html, /New office/)
  assert.match(html, /Add project/)
  assert.match(html, /aria-label="New project name"/)
  // And no invented-staff controls survive it.
  for (const gone of ['+ Hire', 'Promote to lead', 'Remove from team']) {
    assert.ok(!html.includes(gone), `the chart still offers "${gone}"`)
  }
})

test('a project nobody is hired onto yet is still an office, and can be closed again', async () => {
  const html = await chartWith(['Payments'])
  // Payments has no terminal in it, and still gets a branch: an office waiting for its first
  // hire, which is the point of being able to name one.
  assert.match(html, /<\/svg>Payments<\/h3>/)
  assert.match(html, /Nobody hired onto this yet/)
  // A project the player named can be closed. A folder lane cannot: the next scan of the machine
  // would just bring it back, so offering to close it would be a lie.
  assert.match(html, /title="Close Payments"/)
  assert.ok(!html.includes('title="Close hackathon"'), 'a folder lane should not offer to close')
  assert.equal(count(html, 'gg-oc-live-tag'), 2) // hackathon and .agents are tagged live instead
})

test('the org chart detail strip stays out of the tree until someone is picked', () => {
  const html = chart()
  assert.equal(count(html, 'gg-oc-detail'), 0)
})
