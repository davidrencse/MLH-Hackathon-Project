import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSecurityOverview, sessionActivity, totalSpend } from '../src/city/office/securityOverview.ts'
const session = (id, agentId = 'a') => ({ id, agentId, name: id, status: 'active', createdAt: '2026-10-11T00:00:00Z', updatedAt: '2026-10-11T01:00:00Z' })
const task = (id, sessionId, status = 'completed', agentId = 'a') => ({ id, sessionId, agentId, status, title: id, createdAt: '2026-10-11T01:00:00Z', updatedAt: '2026-10-11T02:00:00Z' })
const usage = (taskId, agentId, costUsd, estimatedCostUsd = null) => ({ taskId, agentId, costUsd, estimatedCostUsd, inputTokens: 100, outputTokens: 50 })
test('open sessions are idle until work runs; active tasks outrank history', () => {
  assert.equal(sessionActivity(session('s'), []), 'idle')
  assert.equal(sessionActivity(session('s'), [task('failed', 's', 'failed'), task('running', 's', 'running')]), 'running')
  assert.equal(sessionActivity(session('s'), [task('approval', 's', 'awaiting_approval')]), 'awaiting_approval')
  assert.equal(sessionActivity(session('s'), [task('waiting', 's', 'pending')]), 'queued')
  assert.equal(sessionActivity({ ...session('s'), status: 'archived' }, [task('done', 's')]), 'archived')
  assert.equal(sessionActivity(session('s'), [task('failed', 's', 'failed')]), 'error')
})
test('reported and estimated spend rank agents and attach to the correct sessions', () => {
  const view = buildSecurityOverview([session('s'), session('b-session', 'b')], [{ id: 'a', name: 'Codex' }, { id: 'b', name: 'Claude' }], [task('t', 's'), task('b-task', 'b-session', 'running', 'b')], [usage('t', 'a', 0.2, 99), usage('b-task', 'b', null, 0.5)])
  assert.equal(view.agents[0].name, 'Claude')
  assert.equal(view.agents[0].running, 1)
  assert.equal(totalSpend(view.totals), 0.7)
  assert.equal(view.sessions[0].spend.reported, 0.2)
  assert.equal(view.sessions[1].spend.estimated, 0.5)
  assert.equal(view.totals.tokens, 300)
})
test('unpriced requests remain unknown and standalone work is visible and counted', () => {
  const view = buildSecurityOverview([session('s')], [{ id: 'a', name: 'Codex' }], [task('t', 's'), task('solo', null, 'running')], [usage('t', 'a', null), usage('solo', 'a', 2)])
  assert.equal(view.sessions[0].spend.unknown, 1)
  assert.equal(view.sessions[0].spend.records, 1)
  assert.equal(totalSpend(view.sessions[0].spend), 0)
  assert.equal(totalSpend(view.agents[0].spend), 2)
  assert.equal(view.standaloneTasks[0].id, 'solo')
  assert.equal(view.totals.unknown, 1)
})
test('reported zero is known; no usage is not a known zero', () => {
  const view = buildSecurityOverview([session('s'), session('empty')], [], [task('t', 's')], [usage('t', 'a', 0)])
  assert.equal(view.sessions[0].spend.unknown, 0)
  assert.equal(view.sessions[0].spend.records, 1)
  assert.equal(view.sessions[1].spend.records, 0)
})
