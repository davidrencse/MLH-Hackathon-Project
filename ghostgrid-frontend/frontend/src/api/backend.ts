// Typed wrapper over the Ghostgrid backend REST + SSE surface (`/api/v1`).
// Shapes mirror ghostgrid-backend/FRONTEND.md and `GET /api/v1/openapi.json`.
// Nothing in here knows about city buildings — see live.ts for that mapping.
import { apiUrl, authHeaders } from './config'

export interface BackendError extends Error {
  status: number
  code?: string
  requestId?: string
}

export interface Project {
  id: string
  name: string
  description?: string
  workspace?: string
  instructions?: string
  library?: LibraryConnection | null
  createdAt: string
  updatedAt: string
}

export interface ProviderCapabilities {
  inference: boolean
  coding: boolean
  streaming: boolean
  resume: boolean
  cancellation: boolean
  tools: boolean
  approvals: boolean
}

export type BackendProviderType = 'mock' | 'codex' | 'claude' | 'deepseek' | 'openai-compatible' | 'chatgpt-browser' | 'claude-browser' | 'deepseek-browser'

export type OfficeRuntime = 'codex' | 'claude' | 'chatgpt-browser' | 'claude-browser'
export interface OfficeWorker {
  id: string
  name: string
  buildingId: string
  runtime: OfficeRuntime
  workspace?: string
  openedAt: string
}

export interface BackendProvider {
  id: string
  name: string
  type: BackendProviderType
  model?: string
  baseUrl?: string
  apiKeyEnv?: string
  auth?: 'bearer' | 'none' | 'header'
  concurrency: number
  timeoutMs: number
  pricing?: { inputPerMillion: number; outputPerMillion: number }
  capabilities?: ProviderCapabilities
  availability?: { available: boolean; message?: string; models?: string[] }
  checkedAt?: string
  createdAt: string
  updatedAt: string
}

export interface BackendAgent {
  id: string
  name: string
  buildingId?: string
  projectId: string
  providerId: string
  role?: string
  workspace?: string
  permissions: ('read' | 'write')[]
  createdAt: string
  updatedAt: string
}

export interface BackendSession {
  id: string
  projectId: string
  agentId: string
  buildingId?: string
  name: string
  status: 'active' | 'archived'
  memory?: string
  messages?: { role: 'user' | 'assistant' | 'system'; content: string }[]
  taskCount?: number
  activeTaskCount?: number
  taskCounts?: Record<string, number>
  providerSessionId?: string | null
  workspace?: string
  createdAt: string
  updatedAt: string
}

export type BackendTaskStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface BackendTask {
  id: string
  projectId: string
  agentId: string
  sessionId?: string | null
  workflowId?: string | null
  title: string
  prompt: string
  status: BackendTaskStatus
  priority: number
  attempts: number
  result: string | null
  error: { code?: string; message?: string } | null
  usage: BackendUsage | null
  workspace?: string
  timeoutMs?: number
  maxRetries?: number
  createdAt: string
  startedAt?: string
  completedAt?: string
  updatedAt: string
  dependencies?: string[]
}

export interface BackendUsage {
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number | null
  estimatedCostUsd: number | null
  costSource: 'reported' | 'estimated' | 'unknown'
}

export interface BackendUsageTotals {
  requests: number
  inputTokens: number
  outputTokens: number
  reportedCostUsd: number
  estimatedCostUsd: number
  unknownCostRequests: number
  unknownTokenRequests: number
}

export interface BackendUsageSummary {
  totals: BackendUsageTotals
  today: BackendUsageTotals
  providers: (BackendUsageTotals & { providerId: string | null; name: string | null; type: string | null })[]
  tokensLastMinute: number
  fetchedAt: string
  dayStart: string
}

export interface BackendUsageRecord extends BackendUsage {
  id: string
  taskId: string
  agentId: string
  providerId: string
  projectId: string
  createdAt: string
}

export interface BackendEvent {
  id: string
  seq: number
  type: string
  taskId: string | null
  sessionId?: string | null
  agentId?: string | null
  projectId?: string | null
  buildingId?: string | null
  data?: Record<string, unknown>
  timestamp: string
}

export interface BackendMetrics {
  tasks: Record<BackendTaskStatus, number>
  activeAgents: number
  workflowCompletionRate: number | null
  durations: { taskId: string; durationMs: number }[]
  durationsTotal: number
  durationLimit: number
  durationOffset: number
  capacity: { concurrency: number; inUse: number; utilization: number }
  providers: { id: string; availability: BackendProvider['availability'] | null }[]
}

export interface LibraryConnection {
  name: string
  buildingId: string
  baseUrl: string
  apiKeyEnv?: string
  timeoutMs: number
  repositoryUrl?: string
  connectedAt?: string
}

export interface Page<T> {
  items: T[]
  total: number
}

export interface EventPage {
  items: BackendEvent[]
  nextCursor: number
}

export interface ContextEntry {
  id: string
  projectId: string
  title: string
  content: string
  kind?: string
  source?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

type Query = Record<string, string | number | boolean | undefined | null>

function queryString(query?: Query) {
  if (!query) return ''
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query))
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
  const text = search.toString()
  return text ? `?${text}` : ''
}

async function fail(response: Response): Promise<never> {
  let code: string | undefined
  let message = `HTTP ${response.status}`
  let requestId: string | undefined
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string; requestId?: string } }
    code = body.error?.code
    message = body.error?.message ?? message
    requestId = body.error?.requestId
  } catch {
    // Non-JSON error body: keep the status line.
  }
  const error = new Error(message) as BackendError
  error.status = response.status
  error.code = code
  error.requestId = requestId
  throw error
}

export async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  options: { query?: Query; body?: unknown; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const signals = [options.signal, AbortSignal.timeout(options.timeoutMs ?? 120_000)].filter(
    (value): value is AbortSignal => Boolean(value),
  )
  const response = await fetch(apiUrl(path) + queryString(options.query), {
    method,
    headers: authHeaders(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.any(signals),
  })
  if (!response.ok) await fail(response)
  if (response.status === 204) return undefined as T
  const text = await response.text()
  if (!text) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    return text as unknown as T
  }
}

export const backend = {
  officeOptions: () => request<{ runtimes: OfficeRuntime[]; terminal: string | null; workspaces: string[] }>('GET', '/api/v1/office/options'),
  officeWorkers: (projectId: string, buildingId: string) => request<{ items: OfficeWorker[] }>('GET', '/api/v1/office/workers', { query: { projectId, buildingId } }),
  createOfficeWorker: (body: { projectId: string; buildingId: string; name: string; runtime: OfficeRuntime; workspace?: string }) =>
    request<OfficeWorker>('POST', '/api/v1/office/workers', { body }),
  removeOfficeWorker: (id: string) => request<void>('DELETE', `/api/v1/office/workers/${id}`),
  openOfficeWorker: (id: string) => request<{ opened: true }>('POST', `/api/v1/office/workers/${id}/open`),
  status: () => request<{ status: string; version: string; workerConcurrency: number; storage: string }>('GET', '/api/v1/status'),

  listProjects: (query?: Query) => request<Page<Project>>('GET', '/api/v1/projects', { query }),
  createProject: (body: { name: string; description?: string; instructions?: string; workspace?: string }) =>
    request<Project>('POST', '/api/v1/projects', { body }),

  listProviders: (query?: Query) => request<Page<BackendProvider>>('GET', '/api/v1/providers', { query }),
  getProvider: (id: string) => request<BackendProvider>('GET', `/api/v1/providers/${id}`),
  testProvider: (id: string) =>
    request<{ available: boolean; message?: string; models?: string[]; capabilities: ProviderCapabilities }>(
      'POST',
      `/api/v1/providers/${id}/test`,
      { timeoutMs: 30_000 },
    ),

  listAgents: (query?: Query) => request<Page<BackendAgent>>('GET', '/api/v1/agents', { query }),
  createAgent: (body: {
    name: string
    projectId: string
    providerId: string
    buildingId?: string
    role?: string
    workspace?: string
    permissions?: ('read' | 'write')[]
  }) => request<BackendAgent>('POST', '/api/v1/agents', { body }),
  patchAgent: (id: string, body: Record<string, unknown>) =>
    request<BackendAgent>('PATCH', `/api/v1/agents/${id}`, { body }),
  deleteAgent: (id: string) => request<void>('DELETE', `/api/v1/agents/${id}`),

  listSessions: (query?: Query) => request<Page<BackendSession>>('GET', '/api/v1/sessions', { query }),
  getSession: (id: string) => request<BackendSession>('GET', `/api/v1/sessions/${id}`),
  agentSessions: (agentId: string) => request<{ items: BackendSession[] }>('GET', `/api/v1/agents/${agentId}/sessions`),
  createAgentSession: (agentId: string, name: string) =>
    request<BackendSession>('POST', `/api/v1/agents/${agentId}/sessions`, { body: { name } }),
  patchSession: (id: string, body: { name?: string; status?: 'active' | 'archived'; memory?: string }) =>
    request<BackendSession>('PATCH', `/api/v1/sessions/${id}`, { body }),
  resumeSession: (id: string) => request<BackendSession>('POST', `/api/v1/sessions/${id}/resume`),
  cancelSession: (id: string) => request<BackendSession & { cancelledTaskIds: string[] }>('POST', `/api/v1/sessions/${id}/cancel`),
  sessionTasks: (id: string) => request<{ items: BackendTask[] }>('GET', `/api/v1/sessions/${id}/tasks`),
  sendMessage: (
    sessionId: string,
    body: { prompt: string; title?: string; contextIds?: string[]; priority?: number; timeoutMs?: number; maxRetries?: number },
  ) => request<BackendTask>('POST', `/api/v1/sessions/${sessionId}/messages`, { body }),

  listTasks: (query?: Query) => request<Page<BackendTask>>('GET', '/api/v1/tasks', { query }),
  getTask: (id: string) => request<BackendTask>('GET', `/api/v1/tasks/${id}`),
  submitTask: (body: {
    projectId: string
    agentId: string
    sessionId?: string
    prompt: string
    title?: string
    priority?: number
    dependencies?: string[]
    contextIds?: string[]
    timeoutMs?: number
    maxRetries?: number
  }) => request<BackendTask>('POST', '/api/v1/tasks', { body }),
  cancelTask: (id: string) => request<BackendTask>('POST', `/api/v1/tasks/${id}/cancel`),
  taskEvents: (id: string, query?: Query) => request<EventPage>('GET', `/api/v1/tasks/${id}/events`, { query }),
  taskArtifacts: (id: string) =>
    request<{ items: { id: string; name: string; mimeType: string; createdAt: string }[] }>('GET', `/api/v1/tasks/${id}/artifacts`),
  artifactContent: (id: string) => request<string>('GET', `/api/v1/artifacts/${id}/content`),

  events: (query?: Query) => request<EventPage>('GET', '/api/v1/events', { query }),
  sessionEvents: (id: string, query?: Query) => request<EventPage>('GET', `/api/v1/sessions/${id}/events`, { query }),

  usage: (query?: Query) => request<Page<BackendUsageRecord>>('GET', '/api/v1/usage', { query }),
  providerCredits: (force = false) => request<{ fetchedAt: number; rows: import('./providerCredits').CreditRow[] }>('GET', '/api/v1/provider-credits', { query: { refresh: force ? '1' : '0' }, timeoutMs: 25_000 }),
  usageSummary: (projectId?: string) => request<BackendUsageSummary>('GET', '/api/v1/usage/summary', { query: { projectId } }),
  metrics: (query?: Query) => request<BackendMetrics>('GET', '/api/v1/metrics', { query }),

  listContext: (projectId: string) => request<{ items: ContextEntry[] }>('GET', `/api/v1/projects/${projectId}/context`),
  createContext: (projectId: string, body: { title: string; content: string; agentId?: string; sourceTaskId?: string }) =>
    request<ContextEntry>('POST', `/api/v1/projects/${projectId}/context`, { body }),

  // Library of Babel (read-only shared context)
  getLibrary: (projectId: string) => request<{ connection: LibraryConnection | null }>('GET', `/api/v1/projects/${projectId}/library`),
  connectLibrary: (projectId: string, body: { baseUrl: string; name?: string; buildingId?: string; apiKeyEnv?: string; timeoutMs?: number }) =>
    request<LibraryConnection>('PUT', `/api/v1/projects/${projectId}/library`, { body }),
  disconnectLibrary: (projectId: string) => request<void>('DELETE', `/api/v1/projects/${projectId}/library`),
  libraryStatus: (projectId: string) =>
    request<{ available: boolean; readOnly: boolean; repositoryUrl: string; catalogVersion: number | null; checkedAt: string }>(
      'GET',
      `/api/v1/projects/${projectId}/library/status`,
    ),
  libraryCatalog: (projectId: string, query?: Query) =>
    request<{ articles: Record<string, unknown>[]; total: number }>('GET', `/api/v1/projects/${projectId}/library/catalog`, { query }),
  librarySearch: (projectId: string, q: string, limit?: number) =>
    request<{ items: Record<string, unknown>[]; total: number }>('GET', `/api/v1/projects/${projectId}/library/search`, {
      query: { q, limit },
    }),
  libraryPapers: (projectId: string) =>
    request<{ items: Record<string, unknown>[] }>('GET', `/api/v1/projects/${projectId}/library/papers`),
  libraryNotebook: (projectId: string) =>
    request<{ entries: Record<string, unknown>[] }>('GET', `/api/v1/projects/${projectId}/library/notebook`),
  libraryNotes: (projectId: string, articleId: string) =>
    request<{ notes?: string; summary?: string; highlights?: unknown[] }>(
      'GET',
      `/api/v1/projects/${projectId}/library/articles/${articleId}/notes`,
    ),
  importLibraryContext: (projectId: string, body: { articleId?: string; paperId?: string; title?: string }) =>
    request<ContextEntry>('POST', `/api/v1/projects/${projectId}/library/context`, { body }),
}

/**
 * Sequence number of the newest durable event, so a stream can start at "now"
 * instead of replaying history. The events API only pages forward, so this walks
 * to the end in 1000-event steps.
 */
export async function tailEventCursor(filters: Omit<StreamFilters, 'after'> = {}): Promise<number> {
  const limit = 1000
  let cursor = 0
  for (let page = 0; page < 100; page++) {
    const result = await backend.events({ ...filters, after: cursor, limit })
    cursor = result.nextCursor
    if (result.items.length < limit) break
  }
  return cursor
}

export interface StreamFilters {
  after?: number
  taskId?: string
  sessionId?: string
  agentId?: string
  projectId?: string
}

/**
 * Durable SSE subscription to `/api/v1/events/stream`.
 *
 * Uses fetch rather than EventSource so the bearer token can be sent, and
 * reconnects from the last delivered `seq` so no event is missed across drops.
 * Returns an unsubscribe function.
 */
export function subscribeEvents(
  filters: StreamFilters,
  onEvent: (event: BackendEvent) => void,
  onError?: (error: unknown) => void,
): () => void {
  const controller = new AbortController()
  let cursor = filters.after ?? 0
  let stopped = false

  const run = async () => {
    let backoff = 500
    while (!stopped) {
      try {
        const response = await fetch(
          apiUrl('/api/v1/events/stream') +
            queryString({ ...filters, after: cursor }),
          { headers: authHeaders({ Accept: 'text/event-stream' }), signal: controller.signal },
        )
        if (!response.ok || !response.body) throw new Error(`stream returned HTTP ${response.status}`)
        backoff = 500
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (!stopped) {
          const { done, value } = await reader.read()
          if (done) break
          buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n')
          let boundary: number
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + 2)
            const data = frame
              .split('\n')
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trimStart())
              .join('\n')
            if (!data) continue // comment frame: ": heartbeat"
            try {
              const event = JSON.parse(data) as BackendEvent
              if (typeof event.seq === 'number') cursor = event.seq
              onEvent(event)
            } catch {
              // A truncated frame is re-sent from `cursor` after reconnect.
            }
          }
        }
      } catch (error) {
        if (stopped || controller.signal.aborted) return
        onError?.(error)
        await new Promise((resolve) => setTimeout(resolve, backoff))
        backoff = Math.min(backoff * 2, 10_000)
      }
    }
  }
  void run()

  return () => {
    stopped = true
    controller.abort()
  }
}
