// Contract tests for the backend↔frontend transport (src/api/http.ts).
//
// Runs against a throwaway HTTP server that answers the way the real backend —
// or a broken proxy in front of it — can answer: error envelopes, 503s, HTML
// where JSON was promised, silence, an SSE stream. Node is given the base URL
// through VITE_GG_API_URL, which env.ts also reads outside Vite.
//
//   node --test scripts/pipeline.test.mjs
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test, { after, before } from 'node:test'

let handler = () => {}
const hits = []
const server = createServer((req, res) => {
  hits.push(`${req.method} ${req.url}`)
  handler(req, res)
})

let http

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  process.env.VITE_GG_API_URL = `http://127.0.0.1:${server.address().port}`
  http = await import('../src/api/http.ts')
})

after(() => server.close())

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

test('the backend error envelope survives as code, message and requestId', async () => {
  handler = (_req, res) =>
    json(res, 403, { error: { code: 'FORBIDDEN', message: 'Browser origin is not allowed', requestId: 'req-7' } })
  const error = await http.request('GET', '/api/v1/tasks').then(
    () => null,
    (e) => e,
  )
  assert.equal(error.status, 403)
  assert.equal(error.code, 'FORBIDDEN')
  assert.equal(error.requestId, 'req-7')
  assert.equal(error.message, 'Browser origin is not allowed')
  assert.equal(error.kind, 'rejected')
  assert.equal(http.isBackendError(error), true)
})

test('a 4xx is the request, not the connection: a retry would hide it', () => {
  const kinds = { offline: true, timeout: true, server: true, malformed: true, rejected: false, aborted: false }
  for (const [kind, degrade] of Object.entries(kinds))
    assert.equal(http.shouldDegrade(Object.assign(new Error('x'), { kind })), degrade, kind)
  // Anything that is not a classified backend failure is treated as unreachable.
  assert.equal(http.shouldDegrade(new TypeError('unexpected')), true)
})

test('a transient 503 is retried, and Retry-After is honoured', async () => {
  let calls = 0
  handler = (_req, res) => {
    if (++calls < 3) {
      res.writeHead(503, { 'content-type': 'application/json', 'retry-after': '0' })
      res.end(JSON.stringify({ error: { code: 'REQUEST_ERROR', message: 'restarting' } }))
      return
    }
    json(res, 200, { items: [{ id: 'a' }], total: 1 })
  }
  const page = await http.request('GET', '/api/v1/agents')
  assert.equal(calls, 3)
  assert.equal(page.total, 1)
})

test('a write is never retried on its own: the backend may have applied it', async () => {
  let calls = 0
  handler = (_req, res) => {
    calls++
    json(res, 500, { error: { code: 'REQUEST_ERROR', message: 'boom' } })
  }
  const error = await http.request('POST', '/api/v1/tasks', { body: { prompt: 'x' } }).then(
    () => null,
    (e) => e,
  )
  assert.equal(calls, 1)
  assert.equal(error.kind, 'server')
})

test('an HTML page where JSON was promised is a malformed answer, not a task', async () => {
  handler = (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<!doctype html><title>dev server</title>')
  }
  const error = await http.request('GET', '/api/v1/tasks/abc', { retries: 0 }).then(
    () => null,
    (e) => e,
  )
  assert.equal(error.kind, 'malformed')
  assert.match(error.message, /JSON was expected/)
})

test('an artifact body is text, and text is allowed to be text', async () => {
  handler = (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('line one\n')
  }
  assert.equal(await http.request('GET', '/api/v1/artifacts/x/content', { expect: 'text' }), 'line one\n')
})

test('silence is a timeout, with the kind that permits degrading', async () => {
  handler = () => {} // never answers
  const error = await http.request('GET', '/api/v1/status', { timeoutMs: 120, retries: 0 }).then(
    () => null,
    (e) => e,
  )
  assert.equal(error.kind, 'timeout')
  assert.equal(http.shouldDegrade(error), true)
})

test('a connection dropped mid-request is offline, not a rejection', async () => {
  handler = (req) => req.socket.destroy() // the backend died while answering
  const error = await http.request('GET', '/health', { retries: 0 }).then(
    () => null,
    (e) => e,
  )
  assert.equal(error.kind, 'offline')
  assert.equal(http.shouldDegrade(error), true)
})

test('concurrent identical GETs share one request', async () => {
  let calls = 0
  handler = (_req, res) => {
    calls++
    setTimeout(() => json(res, 200, { items: [], total: 0 }), 30)
  }
  await Promise.all([
    http.request('GET', '/api/v1/events', { query: { limit: 1000 } }),
    http.request('GET', '/api/v1/events', { query: { limit: 1000 } }),
    http.request('GET', '/api/v1/events', { query: { limit: 1000 } }),
  ])
  assert.equal(calls, 1)
  // …and the next call after they settle is a fresh one.
  await http.request('GET', '/api/v1/events', { query: { limit: 1000 } })
  assert.equal(calls, 2)
})

test('a query is encoded, never interpolated', async () => {
  handler = (_req, res) => json(res, 200, { items: [], total: 0 })
  hits.length = 0
  await http.request('GET', '/api/v1/events', { query: { agentId: 'a b&limit=1', limit: 5, empty: undefined } })
  assert.equal(hits[0], 'GET /api/v1/events?agentId=a+b%26limit%3D1&limit=5')
})

test('a body that is not a page is a malformed answer, never an empty page', () => {
  // This used to assert the opposite: anything unreadable became `{items: [], total: 0}`.
  // That is the one substitution that survived deleting the mock backend, and it was the
  // worst-placed one — the list routes are most of the read surface, so a renamed envelope
  // or a proxy answering for the backend read as "the city is empty" with a green badge.
  for (const body of [undefined, 'garbage', { items: null }]) {
    assert.throws(() => http.asPage(body, '/api/v1/agents'), (error) => {
      assert.equal(error.kind, 'malformed', 'an unreadable page was not classified as malformed')
      assert.match(error.message, /\/api\/v1\/agents/, 'the failure does not say which route answered wrongly')
      return true
    })
    assert.throws(() => http.asEventPage(body, 42, '/api/v1/events'), (error) => error.kind === 'malformed')
  }

  // A page that *is* a page still passes, and still drops non-object rows inside it.
  assert.deepEqual(http.asPage({ items: [{ id: 'a' }, 'nonsense'] }, '/p'), { items: [{ id: 'a' }], total: 1 })
  assert.deepEqual(http.asEventPage({ items: [] }, 42, '/p'), { items: [], nextCursor: 42 })
})

test('an SSE response yields data frames and skips heartbeat comments', async () => {
  handler = (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(': heartbeat\n\n')
    res.write('id: 1\nevent: agent.output\ndata: {"seq":1,"type":"agent.output"}\n\n')
    res.write('id: 2\nevent: task.completed\r\ndata: {"seq":2,\ndata: "type":"task.completed"}\n\n')
    res.end()
  }
  const controller = new AbortController()
  const response = await http.openStream('/api/v1/events/stream', { signal: controller.signal, lastEventId: 0 })
  const frames = []
  for await (const data of http.readEventStream(response)) frames.push(JSON.parse(data))
  assert.deepEqual(frames, [
    { seq: 1, type: 'agent.output' },
    { seq: 2, type: 'task.completed' },
  ])
})

test('a stream that goes silent past the heartbeat window ends instead of hanging', async () => {
  handler = (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('data: {"seq":1}\n\n') // then nothing, and no close
  }
  const controller = new AbortController()
  const response = await http.openStream('/api/v1/events/stream', { signal: controller.signal })
  const error = await (async () => {
    try {
      for await (const data of http.readEventStream(response, { stallMs: 150 })) void data
      return null
    } catch (e) {
      return e
    }
  })()
  controller.abort()
  assert.equal(error.kind, 'timeout')
})

test('a stream opened against a rejected request reports the rejection', async () => {
  handler = (_req, res) => json(res, 401, { error: { code: 'UNAUTHORIZED', message: 'A valid bearer token is required' } })
  const controller = new AbortController()
  const error = await http.openStream('/api/v1/events/stream', { signal: controller.signal }).then(
    () => null,
    (e) => e,
  )
  assert.equal(error.status, 401)
  assert.equal(error.kind, 'rejected')
  assert.equal(error.code, 'UNAUTHORIZED')
})
