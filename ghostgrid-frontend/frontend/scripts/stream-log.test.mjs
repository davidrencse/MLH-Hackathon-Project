// The work stream's log window (src/city/office/StreamLog.tsx).
//
// Two kinds of check, because the component is mostly markup over a backend shape:
//
//  - **Drift.** The badge beside a name and the word beside a status are lookup tables keyed by
//    something the *backend* defines. A role kind added on the server with no entry here renders
//    `undefined` under somebody's name, which is the same class of bug as the component map that
//    blanked the whole app (see the frontend CLAUDE.md). So both tables are held against their
//    source of truth, and every value they can emit is held against the stylesheet.
//  - **Render.** What the panel actually says before any data arrives, and whether the one
//    control it offers appears only when it can work.
//
//   node --import ./scripts/ts-resolve.mjs --test scripts/stream-log.test.mjs
import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { backend } from '../src/api/backend.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// `ts-resolve.mjs` resolves .ts, not .tsx, so the component and the two lookup tables it exports
// are loaded through vite the same way the other render test loads its components.
let StreamLog
let KIND_WORD
let STATUS_WORD
let standingRoomOnly
let MAX_DESKS
let vite
before(async () => {
  const cells = new Map()
  globalThis.localStorage ??= {
    getItem: (key) => cells.get(key) ?? null,
    setItem: (key, value) => cells.set(key, String(value)),
    removeItem: (key) => cells.delete(key),
  }
  globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
  const module = await vite.ssrLoadModule('/src/city/office/StreamLog.tsx')
  ;({ StreamLog, KIND_WORD, STATUS_WORD, standingRoomOnly } = module)
  ;({ MAX_DESKS } = await vite.ssrLoadModule('/src/city/office/projectOffice.ts'))
})
const BACKEND = join(ROOT, '../../ghostgrid-backend/src')
const read = (path) => readFileSync(join(ROOT, path), 'utf8')

/** The kinds the server can actually send, read from the server rather than restated here. */
function backendRoleKinds() {
  const source = readFileSync(join(BACKEND, 'office/roles.ts'), 'utf8')
  const line = /export const ROLE_KINDS: RoleKind\[\] = \[([^\]]+)\]/.exec(source)
  assert.ok(line, 'ROLE_KINDS moved in ghostgrid-backend/src/office/roles.ts')
  return [...line[1].matchAll(/"([a-z]+)"/g)].map((match) => match[1])
}

/** Statuses a task can hold, from the client type the log entry carries. */
function taskStatuses() {
  const source = read('src/api/backend.ts')
  const block = /export type BackendTaskStatus =([\s\S]*?)\n\n/.exec(source)
  assert.ok(block, 'BackendTaskStatus moved in src/api/backend.ts')
  return [...block[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1])
}

test('every role kind the backend can send has a word in the badge', () => {
  const kinds = backendRoleKinds()
  assert.ok(kinds.length >= 4, `expected the four office kinds, got ${kinds.join(', ')}`)
  for (const kind of kinds)
    assert.equal(typeof KIND_WORD[kind], 'string', `no badge word for role kind "${kind}"`)
  // And nothing invented here that the backend does not have.
  for (const kind of Object.keys(KIND_WORD))
    assert.ok(kinds.includes(kind), `KIND_WORD has "${kind}", which the backend does not define`)
})

test('every task status has a word, so a row never reads "undefined"', () => {
  for (const status of taskStatuses())
    assert.equal(typeof STATUS_WORD[status], 'string', `no word for task status "${status}"`)
})

test('every kind and status the markup keys on has a rule in the stylesheet', () => {
  const css = read('src/city/office/stream-log.css')
  // The badge colour is per role kind; a kind with no rule is legible but silently uncoloured,
  // which is exactly how "intern" would have slipped in unstyled.
  for (const kind of backendRoleKinds())
    assert.match(css, new RegExp(`data-kind='${kind}'`), `stream-log.css has no rule for kind "${kind}"`)
  // Only the statuses the log colours differently need a rule, but each one it names must exist.
  const styled = [...css.matchAll(/data-status='([a-z_]+)'/g)].map((match) => match[1])
  for (const status of styled)
    assert.ok(STATUS_WORD[status], `stream-log.css colours status "${status}", which has no word`)
})

test('the client sends the stream log read and the engineer hire to the routes the backend serves', () => {
  const app = readFileSync(join(BACKEND, 'app.ts'), 'utf8')
  const client = read('src/api/backend.ts')
  for (const [verb, url] of [['GET', '/api/v1/office/log'], ['POST', '/api/v1/office/engineers']]) {
    assert.ok(app.includes(`route("${verb}", "${url}"`), `the backend no longer serves ${verb} ${url}`)
    assert.ok(client.includes(`'${url}'`), `the client no longer calls ${url}`)
  }
  assert.equal(typeof backend.officeLog, 'function')
  assert.equal(typeof backend.hireEngineer, 'function')
})

after(async () => { await vite?.close() })

const render = (props) => renderToStaticMarkup(createElement(StreamLog, {
  projectId: 'project', buildingId: 'claude', ...props,
}))

test('the panel names the stream and offers the one hire that applies to it', () => {
  const html = render({ officeProjectId: 'ship-it', streamName: 'Ship It' })
  assert.match(html, /Ship It/)
  // Engineers are the one unbounded role, so this is the only hire the stream log offers: a lead
  // comes with the stream and is pinned to it, and an intern is hired at an engineer's own desk.
  assert.match(html, /Hire engineer/)
  assert.doesNotMatch(html, /Hire (lead|intern)/i)
})

test('with no stream named it reads the whole building and offers no hire, because there is no stream to hire onto', () => {
  const html = render({})
  assert.match(html, /This office/)
  assert.doesNotMatch(html, /Hire engineer/)
})

test('the orchestrator panel still renders with the log inside it', async () => {
  // The bug this guards is the one that blanked the whole app once already: a child that throws
  // inside a parent takes the parent's subtree with it, so a panel is not proven by rendering the
  // new component alone. The log itself needs a selected stream, which needs a backend read, so
  // it is absent from this markup — what is proven is that adding it did not break the panel.
  const { Orchestrator } = await vite.ssrLoadModule('/src/city/office/Orchestrator.tsx')
  const html = renderToStaticMarkup(createElement(Orchestrator, {
    projectId: 'project', agentId: 'agent', buildingId: 'claude', buildingName: 'Claude Nexus',
  }))
  assert.match(html, /gg-orc/)
  assert.match(html, /Backend staff/)
})

test('the room\u2019s desk ceiling is counted the way the seating counts it', () => {
  const people = (kinds) => kinds.map((roleKind) => ({ roleKind }))
  // A lead stands on their own strip and an intern sits against their engineer, so neither takes
  // one of the room's desks. Counting either would warn about a full room that is not full.
  assert.equal(standingRoomOnly(people(['lead', 'build', 'intern']), 2), 0)
  assert.equal(standingRoomOnly(people(['lead', ...Array(MAX_DESKS).fill('build')])), 0)
  assert.equal(standingRoomOnly(people(['lead', ...Array(MAX_DESKS + 3).fill('build')])), 3)
  // Interns never push an engineer out of a seat, however many an engineer hires.
  assert.equal(standingRoomOnly(people([...Array(MAX_DESKS).fill('build'), ...Array(9).fill('intern')])), 0)
  assert.equal(standingRoomOnly([]), 0)
})

test('before any data arrives it says nothing it does not know', () => {
  const html = render({ officeProjectId: 'ship-it', streamName: 'Ship It' })
  // The empty states belong to a *loaded* empty stream. Claiming "nobody on this stream" while
  // the first read is still in flight would be a lie the operator acts on.
  assert.doesNotMatch(html, /Nothing has run on this stream yet/)
  assert.doesNotMatch(html, /Nobody is on this stream/)
})
