// What the city does on its first page load (src/api/live.ts), against a stub backend.
//
// This is the decision that used to invent the whole city: every building was bound to a
// credential-free "Mock Runtime" provider, so a tower with no key still streamed output and still
// reported itself as running a model. Buildings now get an agent only when their own vendor is
// configured, and an agent left behind on the retired mock provider is never routed to.
//
// Each test re-imports the module under a fresh URL, because `bootstrap()` caches its answer for
// the lifetime of the page.
//
//   node --test scripts/bootstrap.test.mjs
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test, { after, before, beforeEach } from 'node:test'

/** Set per test: [method, pathname] -> (req) => [status, body] */
let routes = new Map()
const seen = []

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const key = `${req.method} ${url.pathname}`
  seen.push(key)
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    const handler = routes.get(key) ?? routes.get(`${req.method} *`)
    const [status, payload] = handler ? handler(body ? JSON.parse(body) : null, url) : [404, { error: { code: 'NOT_FOUND', message: key } }]
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(payload ?? {}))
  })
})

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  process.env.VITE_GG_API_URL = `http://127.0.0.1:${server.address().port}`
  process.env.VITE_GG_LIVE = '1' // never probe; this test is about what bootstrap decides
})
after(() => server.close())
beforeEach(() => { routes = new Map(); seen.length = 0 })

let bootstrapCount = 0
/** A fresh copy of the module, so its one-shot cache does not leak between tests. */
const freshBootstrap = async () => (await import(`../src/api/live.ts?bootstrap=${bootstrapCount++}`)).bootstrap

/** The reads every bootstrap makes, with the providers and agents a test wants to start from. */
function stubBackend({ providers = [], agents = [], testAnswers = {} }) {
  routes.set('GET /api/v1/projects', () => [200, { items: [{ id: 'f0b9a1d2-0000-4000-8000-000000000001' }], total: 1 }])
  routes.set('GET /api/v1/providers', () => [200, { items: providers, total: providers.length }])
  routes.set('GET /api/v1/agents', () => [200, { items: agents, total: agents.length }])
  routes.set('GET /api/v1/tasks', () => [200, { items: [], total: 0 }])
  routes.set('GET /api/v1/sessions', () => [200, { items: [], total: 0 }])
  routes.set('POST /api/v1/providers', (body) => {
    const created = { id: `provider-${body.type}`, ...body }
    providers.push(created)
    return [201, created]
  })
  routes.set('POST /api/v1/agents', (body) => [201, { id: `agent-${body.buildingId}`, ...body }])
  for (const provider of providers)
    routes.set(`POST /api/v1/providers/${provider.id}/test`, () => [200, { available: testAnswers[provider.type] ?? false }])
  // Vendor providers created during the run answer by type, which is how a test says "this key works".
  routes.set('POST *', (body, url) => {
    const match = /^\/api\/v1\/providers\/provider-([a-z-]+)\/test$/.exec(url.pathname)
    if (match) return [200, { available: testAnswers[match[1]] ?? false }]
    return [404, { error: { code: 'NOT_FOUND', message: url.pathname } }]
  })
}

test('no credential-free stand-in is created, and an unconfigured building gets no agent', async () => {
  stubBackend({ providers: [], agents: [], testAnswers: {} }) // every vendor key missing
  const bootstrap = await freshBootstrap()
  const { agents } = await bootstrap()

  assert.equal(
    seen.some((call) => call === 'POST /api/v1/providers' && false), false,
    'a provider was created for a building with no key',
  )
  // The mock runtime is the thing that must never come back.
  const created = seen.filter((call) => call === 'POST /api/v1/providers')
  assert.ok(created.length <= 3, `expected at most the three vendor providers, got ${created.length}`)
  assert.deepEqual(Object.keys(agents), [], 'buildings were given agents with no provider behind them')
})

test('a building whose vendor answers gets an agent on that vendor, and only it', async () => {
  stubBackend({ providers: [], agents: [], testAnswers: { claude: true } })
  const bootstrap = await freshBootstrap()
  const { agents, agentToBuilding } = await bootstrap()

  assert.deepEqual(Object.keys(agents), ['claude'])
  assert.equal(agentToBuilding[agents.claude], 'claude')
})

test('an agent left on the retired mock provider is never reported', async () => {
  // The upgrade case: a city bootstrapped before the mock binding was removed still has these
  // rows, and they still execute. Reporting one would run a stand-in under a configured building.
  stubBackend({
    providers: [{ id: 'old-mock', type: 'mock', name: 'Mock Runtime' }],
    agents: [
      { id: 'agent-codex', buildingId: 'codex', providerId: 'old-mock' },
      { id: 'agent-groq', buildingId: 'groq', providerId: 'provider-openai-compatible' },
    ],
    testAnswers: {},
  })
  const bootstrap = await freshBootstrap()
  const { agents } = await bootstrap()

  assert.equal(agents.codex, undefined, 'a mock-bound agent was reported to the city')
})

test('an existing agent on a real provider is reused rather than replaced', async () => {
  stubBackend({
    providers: [{ id: 'provider-claude', type: 'claude', name: 'Claude Agent SDK' }],
    agents: [{ id: 'agent-claude', buildingId: 'claude', providerId: 'provider-claude' }],
    testAnswers: { claude: true },
  })
  const bootstrap = await freshBootstrap()
  const { agents } = await bootstrap()

  assert.equal(agents.claude, 'agent-claude')
  assert.ok(!seen.includes('DELETE /api/v1/agents/agent-claude'), 'a usable agent was deleted and recreated')
})
