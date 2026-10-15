// End-to-end check of the backend↔frontend pipeline against a *running* backend.
// Not part of `npm test` (that one needs no server). Start the backend, then:
//
//   GG_BACKEND_URL=http://127.0.0.1:3001 node scripts/pipeline-e2e.mjs
//
// It exercises the parts only a real server can: the one-call tail cursor, a live
// SSE subscription with resume, and a task's events arriving in order.
import assert from 'node:assert/strict'

const base = process.env.GG_BACKEND_URL ?? 'http://127.0.0.1:3001'
process.env.VITE_GG_API_URL = base
if (process.env.GG_API_TOKEN) process.env.VITE_GG_API_TOKEN = process.env.GG_API_TOKEN

const { backend, subscribeEvents, tailEventCursor } = await import('../src/api/backend.ts')

const status = await backend.status()
console.log(`backend ${base} · version ${status.version} · concurrency ${status.workerConcurrency}`)

const head = await tailEventCursor()
console.log(`tail cursor: ${head}`)
assert.equal(typeof head, 'number')

const provider =
  (await backend.listProviders({ limit: 200 })).items.find((p) => p.type === 'mock') ??
  (await backend.createProvider?.({ name: 'Mock Runtime', type: 'mock', concurrency: 2 })) ??
  (await backend.listProviders({ limit: 200 })).items[0]
const project = (await backend.listProjects({ limit: 1 })).items[0] ?? (await backend.createProject({ name: 'Pipeline e2e' }))
const agents = await backend.listAgents({ projectId: project.id, limit: 200 })
const agent =
  agents.items[0] ??
  (await backend.createAgent({ name: 'Pipeline e2e', projectId: project.id, providerId: provider.id, permissions: ['read'] }))

const seen = []
const stop = subscribeEvents({ after: head }, (event) => seen.push(event))

const task = await backend.submitTask({ projectId: project.id, agentId: agent.id, title: 'e2e', prompt: 'hello pipeline' })
console.log(`submitted task ${task.id}`)

const deadline = Date.now() + 20_000
while (Date.now() < deadline && !seen.some((e) => e.taskId === task.id && (e.type === 'task.completed' || e.type === 'task.failed')))
  await new Promise((resolve) => setTimeout(resolve, 100))
stop()

const mine = seen.filter((e) => e.taskId === task.id)
console.log(`streamed ${mine.length} events: ${mine.map((e) => e.type).join(' → ')}`)
assert.ok(mine.some((e) => e.type === 'task.completed'), 'the task never completed on the stream')

const seqs = seen.map((e) => e.seq)
assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), 'events arrived out of order')
assert.equal(new Set(seqs).size, seqs.length, 'an event was delivered twice')
assert.ok(seqs.every((seq) => seq > head), 'history before the tail cursor was replayed')

const replay = await backend.taskEvents(task.id, { limit: 1000 })
assert.ok(replay.items.length >= mine.length, 'REST replay returned fewer events than the stream')

const final = await backend.getTask(task.id)
console.log(`task ${final.status}; REST replay has ${replay.items.length} events`)
console.log('pipeline e2e OK')
