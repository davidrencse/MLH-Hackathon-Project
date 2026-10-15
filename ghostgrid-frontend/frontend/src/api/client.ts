// Single entry point for all backend calls. UI and stores call `api.*`, never live.ts
// or liveOps.ts directly.
//
// Every call runs against the real Ghost Grid backend. There is no offline substitute:
// a call the backend cannot serve rejects, and the caller shows the failure. The mock
// backend that used to stand in here is gone — it had already been emptied of invented
// data, so all it still did was turn "the backend is not answering" into a panel that
// looked like a healthy, empty city.
import { BUILDINGS } from '../constants.ts'
import { resolveBuildingKey, useKeys } from '../store/keys.ts'
import type { BuildingId, PlaygroundParams, Provider, ProviderKey } from '../types'
import { backendStatus, isLive, markBackendUnavailable, type BackendStatus } from './config.ts'
import { isBackendError, offlineError, shouldDegrade, type BackendError } from './http.ts'
import * as live from './live.ts'
import * as liveOps from './liveOps.ts'

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

// ---------- pipeline faults ----------
//
// Every failure reaches the caller, but they do not all mean the same thing, and
// http.ts classifies them:
//
//   unreachable / timed out / 5xx → the connection having a bad moment; logged as a
//                                   warning, and the connection badge already says so
//   401 or 403                    → the backend will not serve this app; the badge
//                                   reports the rejection
//   malformed, or any other 4xx   → a contract break (a stale id, a schema mismatch, a
//                                   proxy serving HTML); logged as an error and
//                                   published to `onPipelineFault`
//
// The classification is for reporting only. In every case the promise rejects, so no
// screen can show a rejected read as data.

export interface PipelineFault {
  label: string
  message: string
  status: number
  code?: string
  requestId?: string
  at: number
}

let faultListeners: ((fault: PipelineFault) => void)[] = []
let lastFault: PipelineFault | null = null

/** Subscribe to contract faults (the backend answered, and said no). */
export function onPipelineFault(listener: (fault: PipelineFault) => void): () => void {
  faultListeners.push(listener)
  if (lastFault) listener(lastFault)
  return () => {
    faultListeners = faultListeners.filter((candidate) => candidate !== listener)
  }
}

/** The most recent contract fault, for a panel that mounts after it happened. */
export function getLastPipelineFault(): PipelineFault | null {
  return lastFault
}

function publishFault(label: string, error: BackendError) {
  lastFault = {
    label,
    message: error.message,
    status: error.status,
    code: error.code,
    requestId: error.requestId,
    at: Date.now(),
  }
  console.error(
    `[ghostgrid] backend rejected ${label}: ${error.status} ${error.code ?? ''} ${error.message}`.trimEnd(),
    error.requestId ? `(requestId ${error.requestId})` : '',
  )
  for (const listener of faultListeners) listener(lastFault)
}

/**
 * Runs `liveCall` against the backend, reporting the failure by the policy above and
 * then rethrowing it. Nothing is substituted for an answer the backend did not give.
 *
 * The reachability probe is checked first so that a backend known to be down fails
 * immediately instead of every panel paying for a round trip and its retries.
 */
async function call<T>(label: string, liveCall: () => Promise<T>): Promise<T> {
  if (!(await isLive())) throw offlineError(label, (await backendStatus()).message)
  try {
    return await liveCall()
  } catch (error) {
    if (isBackendError(error) && error.kind !== 'aborted') {
      if (error.kind !== 'malformed' && shouldDegrade(error)) {
        console.warn(`[ghostgrid] live ${label} unavailable:`, error)
      } else if (error.status === 401 || error.status === 403) {
        markBackendUnavailable(`backend rejected the app: ${error.status} ${error.code ?? error.message}`)
      } else {
        // Reachable, answering, answering wrongly — a proxy serving an HTML error page, a
        // stale id, a route that regressed. A contract break, not a bad connection.
        publishFault(label, error)
      }
    }
    throw error
  }
}

export interface RequestFilter {
  agentId?: BuildingId | 'all'
  status?: 'all' | '2xx' | '4xx' | '5xx'
  q?: string
}

export const api = {
  /** Which backend the app is talking to; drives the connection badge. */
  status: (): Promise<BackendStatus> => backendStatus(),

  // A building with no events shows none. Seeded lines read better, and that was the
  // problem: "workspace mounted · tests 24/24 passed" under a building that had never run.
  getLogs: (buildingId: BuildingId, limit = 5) => call('getLogs', () => live.getLogs(buildingId, limit)),

  // An empty answer is a real answer; a rejected one is not an answer at all. Substituting
  // rows for either put invented 24h request counts and error rates on the dashboard beside
  // the real ledger, with the badge green.
  listAgents: () => call('listAgents', () => live.listAgents()),

  // "The backend recorded nothing" is a real answer, not a missing one: substituting demo
  // rows here used to put invented request counts and usage charts next to the ledger's real
  // token numbers, on the same screen, with no way to tell which was which.
  listRequests: (filter?: RequestFilter) => call('listRequests', () => live.listRequests(filter)),

  getUsage: (days: 7 | 30) => call('getUsage', () => live.getUsage(days)),

  /** Sessions a building actually has on the backend (empty when it has none). */
  listSessions: (buildingId: BuildingId) => call('listSessions', () => liveOps.listBuildingSessions(buildingId)),

  // Only the backend can reach a vendor, so with the backend down the honest answer is that
  // the key was not tested — never a verdict derived from the key's own shape.
  testConnection: (key: Pick<ProviderKey, 'provider' | 'baseUrl' | 'key'>) =>
    call('testConnection', () => liveOps.testConnection(key)),

  // A desk is opened by hiring a backend employee (api/backend.ts, the office panel). The
  // runtime-picker version of this never reached the backend — it slept, flipped a status and
  // logged a host it had not connected to — so it is gone rather than kept as scaffolding.

  // There is no honest offline answer to "what did the model say". A failure throws, and the
  // caller (city/panel/AgentAskSection) shows it. The run shows up in Request Logs through the
  // backend's own events, which is the only place that record is real.
  runPlayground: (
    agentId: BuildingId,
    prompt: string,
    params: PlaygroundParams,
    onToken: (chunk: string) => void,
    signal?: AbortSignal,
  ) => call('runPlayground', () => live.runPlayground(agentId, prompt, params, onToken, signal)),
}

export { library } from './library.ts'
