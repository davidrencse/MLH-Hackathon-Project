// Live backend operations that live.ts does not cover: task completion/cancel for
// the city's approval step, provider connection tests, a building's real sessions,
// and the event → log-line formatting the city ticker uses.
//
// Kept beside live.ts rather than inside it so the two can be edited independently;
// both are reached through client.ts and both throw on failure, which client.ts reports
// and passes on to the caller.
import type { BuildingId, LogLevel, ProviderKey, Session, TaskResult } from '../types'
import { backend, type BackendEvent, type BackendProviderType, type BackendSession, type BackendTask } from './backend.ts'
import { bootstrap } from './live.ts'

const ACTIVE = new Set(['pending', 'queued', 'running', 'awaiting_approval'])
const ms = (iso?: string) => (iso ? Date.parse(iso) : Number.NaN)

/** Which backend provider types can answer for one of the UI's provider families. */
const BACKEND_TYPES_OF_PROVIDER: Record<string, BackendProviderType[]> = {
  openai: ['codex', 'openai-compatible'],
  anthropic: ['claude'],
  deepseek: ['deepseek'],
  groq: ['openai-compatible'],
  gemini: ['openai-compatible'],
  custom: ['openai-compatible', 'mock'],
}

/** How a backend provider type presents as a session runtime in the office view. */
const RUNTIME_OF_BACKEND_TYPE: Record<BackendProviderType, Session['runtime']> = {
  'chatgpt-browser': 'openai',
  'claude-browser': 'anthropic',
  'deepseek-browser': 'deepseek',
  codex: 'local-cli',
  claude: 'local-cli',
  deepseek: 'deepseek',
  'openai-compatible': 'openai',
  mock: 'local-cli',
}

async function waitForTask(taskId: string, signal?: AbortSignal): Promise<BackendTask> {
  for (;;) {
    const task = await backend.getTask(taskId)
    if (!ACTIVE.has(task.status) || signal?.aborted) return task
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
}

/**
 * The city's "approve" step against a real task.
 *
 * The backend has no approval endpoint — a task that needs a human is reported
 * through `agent.approval.required` and its tool call is denied — so approving in
 * the city means "let the real task finish and report what it actually did".
 */
export async function approve(taskId: string): Promise<TaskResult> {
  const task = await waitForTask(taskId)
  const events = await backend.taskEvents(taskId, { limit: 1000 }).catch(() => ({ items: [], nextCursor: 0 }))
  const files = events.items
    .filter((event) => event.type === 'agent.file.changed')
    .map((event) => {
      const path = (event.data ?? {}) as { path?: string }
      return { path: typeof path.path === 'string' ? path.path : 'workspace', change: 'modified' as const }
    })
  const latency = ms(task.completedAt) - ms(task.startedAt)
  return {
    title: task.title || 'Task',
    summary:
      task.status === 'completed'
        ? (task.result ?? '').slice(0, 1200) || 'Task completed with no textual output.'
        : `Task ${task.status}: ${task.error?.message ?? task.error?.code ?? 'no details'}`,
    files,
    tokens: (task.usage?.inputTokens ?? 0) + (task.usage?.outputTokens ?? 0),
    latencyMs: Number.isFinite(latency) ? latency : 0,
    costUsd: task.usage?.costUsd ?? task.usage?.estimatedCostUsd ?? 0,
  }
}

/** The city's "reject" step: cancel the real task. */
export async function reject(taskId: string): Promise<{ ok: true }> {
  await backend.cancelTask(taskId)
  return { ok: true }
}

/**
 * Tests the backend provider that matches this key's provider family.
 *
 * The key itself is never sent: the backend reads credentials from its own
 * environment (`apiKeyEnv`), so a browser-held key cannot be installed remotely.
 * A missing provider is reported rather than faked.
 */
export async function testConnection(
  key: Pick<ProviderKey, 'provider' | 'baseUrl' | 'key'>,
): Promise<{ ok: boolean; latencyMs: number; message: string }> {
  const started = Date.now()
  const candidates = BACKEND_TYPES_OF_PROVIDER[key.provider] ?? ['openai-compatible']
  const available = (await backend.listProviders({ limit: 200 })).items
  const match = candidates.map((type) => available.find((provider) => provider.type === type)).find(Boolean)
  if (!match)
    return {
      ok: false,
      latencyMs: Date.now() - started,
      message: `No ${key.provider} provider on the backend. Create one referencing its key through apiKeyEnv.`,
    }
  const result = await backend.testProvider(match.id)
  return {
    ok: result.available,
    latencyMs: Date.now() - started,
    message: `${match.name} (${match.type})${result.message ? ` · ${result.message}` : result.available ? ' · available' : ' · unavailable'}`,
  }
}

function sessionStatus(session: BackendSession): Session['status'] {
  if (session.activeTaskCount) return 'running'
  const counts = session.taskCounts ?? {}
  if (counts.failed) return 'error'
  if (counts.completed) return 'done'
  return session.status === 'archived' ? 'done' : 'queued'
}

/** Real persistent sessions of one building, shaped for the building's office view. */
export async function listBuildingSessions(buildingId: BuildingId): Promise<Session[]> {
  const { agents } = await bootstrap()
  const agentId = agents[buildingId]
  if (!agentId) return []
  const [sessions, providers] = await Promise.all([
    backend.agentSessions(agentId),
    backend.listProviders({ limit: 200 }),
  ])
  const agent = await backend.listAgents({ limit: 200 }).then((page) => page.items.find((candidate) => candidate.id === agentId))
  const provider = providers.items.find((candidate) => candidate.id === agent?.providerId)
  // `provider.type` is cast out of backend JSON, never validated against this union, and the
  // backend keeps its own copy of it — so an unknown type must land on a real runtime here
  // rather than travelling on as an `undefined` typed `RuntimeId`.
  const runtime = RUNTIME_OF_BACKEND_TYPE[provider?.type ?? 'mock'] ?? 'local-cli'
  return sessions.items.map((session) => ({
    id: session.id,
    title: session.name ?? 'Session',
    status: sessionStatus(session),
    startedAt: ms(session.createdAt) || Date.now(),
    tokens: 0,
    runtime,
    model: provider?.model ?? 'unknown',
    branch: session.workspace?.split('/').pop(),
  }))
}

/** Human line + severity for one backend event, used by the city log ticker. */
export function describeEvent(event: BackendEvent): { level: LogLevel; text: string } {
  const data = (event.data ?? {}) as Record<string, unknown>
  const text = (key: string) => (typeof data[key] === 'string' ? (data[key] as string) : undefined)
  const error = (data.error ?? {}) as { code?: string; message?: string }
  switch (event.type) {
    case 'task.created':
      return { level: 'info', text: 'task created' }
    case 'task.queued':
      return { level: 'info', text: data.retry ? `queued for retry #${String(data.retry)}` : 'queued' }
    case 'task.started':
      return { level: 'info', text: 'started' }
    case 'task.completed':
      return { level: 'ok', text: 'completed' }
    case 'task.failed':
      return { level: 'error', text: `failed: ${error.message ?? error.code ?? 'unknown error'}` }
    case 'task.cancelled':
      return { level: 'warn', text: 'cancelled' }
    case 'agent.connected':
      return { level: 'info', text: 'provider session connected' }
    case 'agent.output':
      return { level: 'info', text: (text('text') ?? '').replace(/\s+/g, ' ').slice(0, 120) || 'output' }
    case 'agent.tool.started':
      return { level: 'info', text: `tool: ${text('name') ?? text('command') ?? 'running'}` }
    case 'agent.tool.completed':
      return { level: 'ok', text: `tool done: ${text('name') ?? text('command') ?? 'ok'}` }
    case 'agent.file.changed':
      return { level: 'ok', text: `edit ${text('path') ?? 'files changed'}` }
    case 'agent.approval.required':
      return { level: 'warn', text: `blocked ${text('tool') ?? 'action'}: ${text('reason') ?? 'policy'}` }
    case 'agent.workspace.created':
      return { level: 'info', text: `worktree ${text('path')?.split('/').pop() ?? 'created'}` }
    case 'agent.session.recovered':
      return { level: 'warn', text: `session recovered (${text('reason') ?? 'unknown'})` }
    case 'usage.updated':
      return { level: 'info', text: `usage ${data.inputTokens ?? '?'} in / ${data.outputTokens ?? '?'} out` }
    case 'session.created':
      return { level: 'info', text: 'session created' }
    case 'session.archived':
      return { level: 'warn', text: 'session archived' }
    case 'session.resumed':
      return { level: 'ok', text: 'session resumed' }
    case 'library.connected':
      return { level: 'ok', text: `library connected: ${text('name') ?? 'Library'}` }
    case 'library.disconnected':
      return { level: 'warn', text: 'library disconnected' }
    case 'context.created':
      return { level: 'ok', text: `context added${data.kind ? ` (${String(data.kind)})` : ''}` }
    default:
      return { level: event.type.includes('fail') ? 'error' : 'info', text: event.type.replace(/\./g, ' ') }
  }
}
