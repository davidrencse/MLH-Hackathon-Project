// The HUD's AGENTS chip counts coding CLIs running on the machine. The chip cannot be opened in
// a browser from this workspace, so its two pieces of logic are checked here: the runtime tally
// that builds the sub-line, and — against a running backend — the live shape of the scan it reads.
//
//   node --test scripts/local-agents.test.mjs
//   GG_BACKEND_URL=http://127.0.0.1:3001 node --test scripts/local-agents.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'

// The transport reads its base URL once, at import time, so point it before anything loads.
const base = process.env.GG_BACKEND_URL
if (base) process.env.VITE_GG_API_URL = base
const { countByRuntime } = await import('../src/store/localAgents.ts')

const cli = (pid, runtime) => ({ id: `cli:${pid}`, pid, runtime, tty: `pts/${pid}`, cwd: null, startedAt: '', uptimeSeconds: 1 })

test('tallies runtimes biggest first', () => {
  assert.deepEqual(
    countByRuntime([cli(1, 'claude'), cli(2, 'codex'), cli(3, 'claude'), cli(4, 'claude')]),
    [{ runtime: 'claude', count: 3 }, { runtime: 'codex', count: 1 }],
  )
})

test('ties are ordered by name so the sub-line does not reshuffle between polls', () => {
  assert.deepEqual(
    countByRuntime([cli(2, 'codex'), cli(1, 'claude')]),
    [{ runtime: 'claude', count: 1 }, { runtime: 'codex', count: 1 }],
  )
})

test('an empty scan tallies nothing', () => {
  assert.deepEqual(countByRuntime([]), [])
})

// Opt-in: only runs against a backend that is actually up, so `npm test` stays server-free.
test('a live scan answers with the fields the chip reads', { skip: !base }, async () => {
  const { backend } = await import('../src/api/backend.ts')
  const scan = await backend.officeProcesses()
  assert.equal(typeof scan.supported, 'boolean')
  assert.equal(typeof scan.scannedAt, 'string')
  assert.ok(Array.isArray(scan.items))
  for (const item of scan.items) {
    assert.equal(typeof item.pid, 'number')
    assert.ok(['codex', 'claude', 'deepseek', 'cursor', 'gemini'].includes(item.runtime))
  }
  const tally = countByRuntime(scan.items).map((r) => `${r.count} ${r.runtime}`).join(' · ')
  console.log(`   live: AGENTS chip would read "${scan.items.length}" · "${tally || 'none running'}"`)
})
