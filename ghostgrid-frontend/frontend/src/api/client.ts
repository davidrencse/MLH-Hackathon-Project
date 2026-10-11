// Single entry point for all backend calls. UI and stores call `api.*`, never mock.ts
// or live.ts directly.
//
// Each call runs against the real Ghostgrid backend when it is reachable (see
// config.ts) and falls back to the mock backend otherwise, so the demo still works
// with no server running. Calls the backend cannot serve at all stay on the mock:
//   · platform keys  — the backend authenticates with one static GHOSTGRID_API_TOKEN
//   · seeded request-log/usage history before the city has produced any
import { BUILDINGS } from '../constants'
import { resolveBuildingKey, useKeys } from '../store/keys'
import type { BuildingId, PlaygroundParams, Provider, ProviderKey, RequestLog, RuntimeId, SessionMode } from '../types'
import { backendStatus, isLive, type BackendStatus } from './config'
import * as live from './live'
import * as liveOps from './liveOps'
import * as mock from './mock'

export interface ApiConfig {
  provider: Provider | null
  baseUrl: string | null
  apiKey: string | null
  model: string
}

export function getApiConfig(buildingId: BuildingId): ApiConfig {
  const state = useKeys.getState()
  const key = resolveBuildingKey(state, buildingId)
  return {
    provider: key?.provider ?? null,
    baseUrl: key?.baseUrl ?? null,
    apiKey: key?.key ?? null,
    model: state.buildingConfig[buildingId]?.model ?? BUILDINGS[buildingId]?.model ?? 'custom-model',
  }
}

// Adds a row to Request Logs so the console mirrors what happened in the city.
function record(agentId: BuildingId, method: RequestLog['method'], path: string, status: number, started: number, request: unknown, response: unknown, tokensIn = 0, tokensOut = 0) {
  mock.recordRequest({
    id: mock.uid('req'),
    ts: Date.now(),
    agentId,
    method,
    path,
    status,
    latencyMs: Date.now() - started,
    tokensIn,
    tokensOut,
    request,
    response,
  })
}

/**
 * Runs `liveCall` against the backend, falling back to `mockCall` when the backend
 * is absent or the call fails. Failures are logged once, never thrown at the UI.
 */
async function withBackend<T>(label: string, liveCall: () => Promise<T>, mockCall: () => Promise<T>): Promise<T> {
  if (!(await isLive())) return mockCall()
  try {
    return await liveCall()
  } catch (error) {
    console.warn(`[ghostgrid] live ${label} failed, using mock data:`, error)
    return mockCall()
  }
}

export const api = {
  /** Which backend the app is talking to; drives the connection badge. */
  status: (): Promise<BackendStatus> => backendStatus(),

  getLogs: (buildingId: BuildingId, limit = 5) =>
    withBackend(
      'getLogs',
      async () => {
        const entries = await live.getLogs(buildingId, limit)
        // A brand-new building has no events yet: seeded lines read better than nothing.
        return entries.length ? entries : mock.getLogs(buildingId, limit)
      },
      () => mock.getLogs(buildingId, limit),
    ),

  async submitCommand(command: string) {
    const started = Date.now()
    const cfg = getApiConfig('router')
    const res = await withBackend(
      'submitCommand',
      () => live.submitCommand(command),
      () => mock.submitCommand(command),
    )
    record('router', 'POST', '/api/v1/sessions/:id/messages', 202, started, { command, model: cfg.model }, res, Math.ceil(command.length / 4), 0)
    return res
  },

  async approve(taskId: string) {
    const started = Date.now()
    const res = await withBackend(
      'approve',
      () => liveOps.approve(taskId),
      () => mock.approve(taskId),
    )
    record('security', 'POST', `/api/v1/tasks/${taskId}`, 200, started, { taskId }, res, 0, res.tokens)
    return res
  },

  async reject(taskId: string) {
    const started = Date.now()
    const res = await withBackend(
      'reject',
      () => liveOps.reject(taskId),
      () => mock.reject(taskId),
    )
    record('security', 'POST', `/api/v1/tasks/${taskId}/cancel`, 200, started, { taskId }, res)
    return res
  },

  listAgents: () =>
    withBackend(
      'listAgents',
      async () => {
        const agents = await live.listAgents()
        return agents.length ? agents : mock.listAgents()
      },
      () => mock.listAgents(),
    ),

  listRequests: (filter?: Parameters<typeof mock.listRequests>[0]) =>
    withBackend(
      'listRequests',
      async () => {
        const rows = await live.listRequests(filter)
        return rows.length ? rows : mock.listRequests(filter)
      },
      () => mock.listRequests(filter),
    ),

  getUsage: (days: 7 | 30) =>
    withBackend(
      'getUsage',
      async () => {
        const usage = await live.getUsage(days)
        return usage.totals.requests ? usage : mock.getUsage(days)
      },
      () => mock.getUsage(days),
    ),

  /** Sessions a building actually has on the backend (empty when it has none). */
  listSessions: (buildingId: BuildingId) =>
    withBackend(
      'listSessions',
      () => liveOps.listBuildingSessions(buildingId),
      async () => [],
    ),

  // The backend issues no per-client keys: it authenticates with one static
  // GHOSTGRID_API_TOKEN. These stay local to the browser.
  listPlatformKeys: mock.listPlatformKeys,
  createPlatformKey: mock.createPlatformKey,
  revokePlatformKey: mock.revokePlatformKey,

  testConnection: (key: Pick<ProviderKey, 'provider' | 'baseUrl' | 'key'>) =>
    withBackend(
      'testConnection',
      () => liveOps.testConnection(key),
      () => mock.testConnection(key),
    ),

  /**
   * Opens one office desk (src/city/office). `runtime` says where the work runs: a 'local'
   * runtime stays on this machine, a 'connected' one calls that provider's API.
   * Mock-only for now: the backend binds a provider to the agent, not to the session, so it
   * has nowhere to put the runtime choice yet.
   */
  async startSession(agentId: BuildingId, input: { title: string; runtime: RuntimeId; mode: SessionMode; model: string }) {
    const started = Date.now()
    const res = await mock.startSession(agentId, input)
    record(
      agentId,
      'POST',
      `/api/v1/agents/${agentId}/sessions`,
      201,
      started,
      { name: input.title, runtime: input.runtime, mode: input.mode, model: input.model },
      res,
      Math.ceil(input.title.length / 4),
      0,
    )
    return res
  },

  async stopSession(agentId: BuildingId, sessionId: string) {
    const started = Date.now()
    const res = await mock.stopSession(agentId, sessionId)
    record(agentId, 'POST', `/api/v1/sessions/${sessionId}/cancel`, 200, started, { sessionId }, res)
    return res
  },

  async runPlayground(agentId: BuildingId, prompt: string, params: PlaygroundParams, onToken: (chunk: string) => void, signal?: AbortSignal) {
    const started = Date.now()
    const cfg = getApiConfig(agentId)
    const res = await withBackend(
      'runPlayground',
      () => live.runPlayground(agentId, prompt, params, onToken, signal),
      () => mock.runPlayground(agentId, prompt, params, onToken, signal),
    )
    record(agentId, 'POST', `/api/v1/sessions/:id/messages`, 200, started, { model: cfg.model, input: prompt, ...params }, { output: res.text }, res.tokensIn, res.tokensOut)
    return res
  },
}

export { library } from './library'
