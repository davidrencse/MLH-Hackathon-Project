// The machine scan (GET /api/v1/office/processes) walks every entry in /proc with sync fs, which
// blocks the backend for ~16ms a call. The HUD chip and the office crew list both want it, and
// when each polled on its own 4s clock the backend was scanning roughly every two seconds, per
// open tab. They now share one store with a freshness window; this test holds that line by
// counting what actually reaches the wire.
//
// It lives in its own file because the transport reads its base URL once, at import time: pointing
// it at the stub here would otherwise fight the live-backend test in local-agents.test.mjs.
//
//   node --test scripts/local-agents-cache.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'

let hits = 0
const server = createServer((req, res) => {
  if (!req.url.startsWith('/api/v1/office/processes')) {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end('{"error":{"code":"NOT_FOUND","message":"route not found"}}')
    return
  }
  hits += 1
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({
    supported: true,
    scannedAt: new Date().toISOString(),
    items: [{ id: 'cli:1', pid: 1, runtime: 'claude', tty: 'pts/1', cwd: null, startedAt: '', uptimeSeconds: 1 }],
  }))
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
process.env.VITE_GG_API_URL = `http://127.0.0.1:${server.address().port}`

const { useLocalAgentsStore } = await import('../src/store/localAgents.ts')

test.after(() => server.close())

test('readers asking at once share one request', async () => {
  const { load } = useLocalAgentsStore.getState()
  await Promise.all([load(), load(), load()])
  assert.equal(hits, 1)
  assert.equal(useLocalAgentsStore.getState().items.length, 1)
})

test('a reader asking again inside the freshness window does not hit the backend', async () => {
  const before = hits
  await useLocalAgentsStore.getState().load()
  await useLocalAgentsStore.getState().load()
  assert.equal(hits, before)
})

test('force refetches even when what we hold is fresh', async () => {
  const before = hits
  await useLocalAgentsStore.getState().load(true)
  assert.equal(hits, before + 1)
})

test('a stale scan is refetched once the window passes', async () => {
  const before = hits
  // Age what we hold rather than waiting out the real window.
  useLocalAgentsStore.setState({ fetchedAt: Date.now() - 10_000 })
  await useLocalAgentsStore.getState().load()
  assert.equal(hits, before + 1)
})

test('a failed scan is reported, and still backs off', async () => {
  server.close()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  useLocalAgentsStore.setState({ fetchedAt: 0 })
  await useLocalAgentsStore.getState().load()
  // The stub's new port is not the one the transport read, so this is an unreachable backend.
  assert.equal(useLocalAgentsStore.getState().errorKind, 'unreadable')
  assert.equal(useLocalAgentsStore.getState().items.length, 0)
  const before = hits
  await useLocalAgentsStore.getState().load()
  assert.equal(hits, before)
})
