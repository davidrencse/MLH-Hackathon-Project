// The policy in src/api/client.ts: what the city does when the backend will not serve a read.
//
// This is the rule the whole app's honesty rests on. There is no local substitute for a backend
// answer any more — the mock that used to stand in here is gone — so a read the backend did not
// serve rejects, and the caller shows the failure. What the backend *did* answer is passed
// through untouched, including when the answer is "nothing". These tests pin both halves, and
// that a rejection is classified before it is rethrown: a contract break is published as a
// pipeline fault, a bad connection is not, and a rejected token moves the connection badge.
//
//   node --test scripts/client-policy.test.mjs
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test, { after, before, beforeEach } from 'node:test'

let answer = () => [200, { items: [], total: 0 }]
const seen = []
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  seen.push(`${req.method} ${url.pathname}`)
  const [status, body, headers = {}] = answer(url, req)
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(typeof body === 'string' ? body : JSON.stringify(body ?? {}))
})

let api
let onPipelineFault

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  process.env.VITE_GG_API_URL = `http://127.0.0.1:${server.address().port}`
  process.env.VITE_GG_LIVE = '1' // the backend is reachable; this is about what it answers
  process.env.VITE_GG_PROJECT_ID = 'f0b9a1d2-0000-4000-8000-000000000001'
  const client = await import('../src/api/client.ts')
  api = client.api
  onPipelineFault = client.onPipelineFault
})
after(() => server.close())
beforeEach(() => { seen.length = 0 })

/**
 * Collects faults published while `work` runs, and whether it rejected.
 *
 * Subscribing replays the last fault on purpose — a panel that mounts after one happened still has
 * to show it — so anything already published before this call is dropped.
 */
async function withFaults(work) {
  const faults = []
  const stop = onPipelineFault((fault) => faults.push(fault))
  const replayed = faults.length
  try {
    const value = await work().then(
      (v) => ({ ok: true, value: v }),
      (error) => ({ ok: false, error }),
    )
    return { ...value, faults: faults.slice(replayed) }
  } finally {
    stop()
  }
}

test('a 4xx is reported as a contract fault, and reaches the caller as a failure', async () => {
  answer = () => [400, { error: { code: 'VALIDATION_ERROR', message: 'agentId: Invalid UUID', requestId: 'req-1' } }]
  const { ok, error, faults } = await withFaults(() => api.listAgents())

  // Nothing is invented for the UI, and nothing is quietly emptied for it either: a read that
  // was refused is a failure the caller has to render, not a city with no agents in it.
  assert.equal(ok, false, 'a rejected read resolved')
  assert.equal(error.status, 400)
  assert.equal(error.kind, 'rejected')
  assert.ok(faults.length >= 1, 'the backend rejected the request and nobody was told')
  assert.equal(faults[0].status, 400)
  assert.match(faults[0].message, /Invalid UUID/)
})

test('a 5xx fails too, but as a bad connection rather than a contract fault', async () => {
  answer = () => [503, { error: { code: 'UNAVAILABLE', message: 'backend restarting', requestId: 'req-2' } }]
  const { ok, error, faults } = await withFaults(() => api.listAgents())
  assert.equal(ok, false, 'a 5xx resolved as if it were data')
  assert.equal(error.kind, 'server')
  // A 503 is the connection having a bad moment, not a contract break.
  assert.equal(faults.length, 0, 'a transient failure was reported as a contract fault')
})

test('an empty backend is an empty city, not a seeded one', async () => {
  answer = () => [200, { items: [], total: 0 }]
  assert.deepEqual(await api.listAgents(), [])
  assert.deepEqual(await api.getLogs('claude', 5), [], 'a building with no events showed seeded log lines')
  assert.deepEqual(await api.listRequests(), [], 'the request log invented rows')
  // A zero-filled series of real days is not invention — the chart has an x axis either way — so
  // what matters is that every figure on it is zero.
  const usage = await api.getUsage(7)
  assert.equal(usage.totals.requests, 0, 'the usage chart invented traffic')
  assert.equal(usage.totals.costUsd, 0, 'the usage chart invented spend')
  for (const point of usage.points) {
    assert.equal(point.requests, 0, `${point.date} invented requests`)
    assert.equal(point.tokens, 0, `${point.date} invented tokens`)
  }
})

test('the request log is the backend’s, not a list this browser kept of its own calls', async () => {
  answer = () => [200, { items: [], total: 0 }]
  // A playground run against a backend that cannot execute it fails; it must not leave a row
  // behind to stand in for the call, because only the backend’s events say what really ran.
  await api.runPlayground('claude', 'hello', { temperature: 0.2, maxTokens: 64 }, () => {}).catch(() => {})
  const rows = await api.listRequests()
  assert.deepEqual(rows, [], 'the request log carried a row the backend never reported')
  assert.ok(seen.some((call) => call.includes('/api/v1/events')), 'the request log was not read from the backend')
})

test('the playground has no offline answer, so it fails instead of inventing one', async () => {
  answer = () => [500, { error: { code: 'EXECUTION_FAILED', message: 'provider is down', requestId: 'req-3' } }]
  await assert.rejects(
    () => api.runPlayground('claude', 'hello', { temperature: 0.2, maxTokens: 64 }, () => {}),
    'a failed playground run returned canned text',
  )
})

// Last: this one marks the backend unavailable, which every later call would then fail against.
test('a rejected app is reported on the connection badge, not retried forever', async () => {
  answer = () => [401, { error: { code: 'UNAUTHORIZED', message: 'bad token', requestId: 'req-4' } }]
  const { ok } = await withFaults(() => api.listAgents())
  assert.equal(ok, false, 'a 401 resolved as if it were data')
  const status = await api.status()
  assert.equal(status.live, false, 'a backend that rejected the app still reads as live')
  assert.match(status.message, /rejected|401/i)

  // And with the badge down, a read fails immediately instead of going out to a backend that
  // has already said no.
  seen.length = 0
  await assert.rejects(() => api.listAgents(), /unreachable/i, 'a known-dead backend was called anyway')
  assert.deepEqual(seen, [], 'a call went out after the backend was marked unavailable')
})
