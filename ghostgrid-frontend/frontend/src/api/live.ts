// Live backend adapter. Mirrors the signatures the UI/stores already call through client.ts,
// but talks to the real Ghostgrid backend (REST + SSE) described in ghostgrid-backend/FRONTEND.md.
//
// client.ts decides per-call whether to use this (backend reachable, see config.isLive) or the
// mock. Each function here degrades by throwing — client.ts catches and falls back to the mock,
// so a partial backend never breaks the demo.
//
// Bootstrap: the frontend's building ids (router/codex/claude/deepseek/security) are mapped to
// real backend agents via the backend's own `buildingId` field. We lazily ensure one project, one
// credential-free `mock` provider (so tasks actually execute without API keys), and one agent per
// building. The map is cached for the page's lifetime.
import { BUILDINGS, BUILDING_IDS } from '../constants'
import type {
  AgentSummary,
  BuildingId,
  LogEntry,
  LogLevel,
  PlaygroundParams,
  Provider,
  ProviderKey,
  RequestLog,
  Session,
  TaskResult,
  UsageSummary,
} from '../types'
import { PROJECT_ID, apiUrl, authHeaders } from './config'

// ---------- HTTP helpers ----------

async function ggGet<T = any>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path), { headers: authHeaders({ accept: 'application/json' }), signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`)
  return (await res.json()) as T
}

async function ggPost<T = any>(path: string, body: unknown): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: authHeaders({ accept: 'application/json', 'content-type': 'application/json' }),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`POST ${path} → HTTP ${res.status}`)
  return (await res.json()) as T
}

interface ListResponse<T> {
  items: T[]
  total?: number
}

// ---------- Bootstrap (project + provider + agents) ----------

export interface Bootstrap {
  projectId: string
  providerId: string
  /** building id → backend agent id */
  agents: Record<string, string>
  /** backend agent id → building id */
  agentToBuilding: Record<string, string>
}

let bootstrapPromise: Promise<Bootstrap> | null = null

export function bootstrap(): Promise<Bootstrap> {
  bootstrapPromise ??= doBootstrap().catch((e) => {
    bootstrapPromise = null // let the next call retry a transient failure
    throw e
  })
  return bootstrapPromise
}

export function resetBootstrap() {
  bootstrapPromise = null
}

async function ensureProject(): Promise<string> {
  if (PROJECT_ID) return PROJECT_ID
  const list = await ggGet<ListResponse<{ id: string }>>('/api/v1/projects?limit=1')
  if (list.items?.length) return list.items[0].id
  const created = await ggPost<{ id: string }>('/api/v1/projects', { name: 'Ghostgrid City' })
  return created.id
}

async function ensureProvider(): Promise<string> {
  // Credential-free mock provider: tasks stream real agent.output events with no API keys set.
  const list = await ggGet<ListResponse<{ id: string; type: string }>>('/api/v1/providers?limit=200')
  const existing = list.items?.find((p) => p.type === 'mock')
  if (existing) return existing.id
  const created = await ggPost<{ id: string }>('/api/v1/providers', { name: 'Demo Runtime', type: 'mock', concurrency: 4 })
  return created.id
}

async function ensureAgents(projectId: string, providerId: string): Promise<Record<string, string>> {
  const list = await ggGet<ListResponse<{ id: string; buildingId?: string }>>(`/api/v1/agents?projectId=${projectId}&limit=200`)
  const byBuilding = new Map((list.items ?? []).map((a) => [a.buildingId ?? a.id, a.id]))
  const agents: Record<string, string> = {}
  await Promise.all(BUILDING_IDS.map(async (id) => {
    const existing = byBuilding.get(id)
    if (existing) {
      agents[id] = existing
      return
    }
    const created = await ggPost<{ id: string }>('/api/v1/agents', {
      name: BUILDINGS[id]?.name ?? id,
      buildingId: id,
      projectId,
      providerId,
      role: BUILDINGS[id]?.role ?? '',
      permissions: ['read'],
    })
    agents[id] = created.id
  }))
  return agents
}

async function doBootstrap(): Promise<Bootstrap> {
  const [projectId, providerId] = await Promise.all([ensureProject(), ensureProvider()])
  const agents = await ensureAgents(projectId, providerId)
  const agentToBuilding = Object.fromEntries(Object.entries(agents).map(([b, a]) => [a, b]))
  return { projectId, providerId, agents, agentToBuilding }
}

// ---------- event / provider mapping ----------

interface GgEvent {
  type: string
  seq?: number
  taskId?: string
  agentId?: string
  projectId?: string
  sessionId?: string
  timestamp?: string
  data?: any
}

const PROVIDER_MAP: Record<string, Provider> = {
  mock: 'custom',
  codex: 'openai',
  claude: 'anthropic',
  deepseek: 'deepseek',
  'openai-compatible': 'custom',
}

function levelForEvent(type: string): LogLevel {
  if (type.includes('failed') || type.endsWith('.error')) return 'error'
  if (type.includes('approval')) return 'warn'
  if (type.includes('completed') || type.includes('connected')) return 'ok'
  return 'info'
}

function textForEvent(ev: GgEvent): string {
  if (typeof ev.data?.text === 'string' && ev.data.text.trim()) return ev.data.text.trim().slice(0, 240)
  if (ev.data?.error?.message) return `${ev.type}: ${ev.data.error.message}`
  return ev.type.replace(/\./g, ' ')
}

function statusForEvent(type: string): number {
  if (type.includes('failed')) return 500
  if (type.includes('approval')) return 202
  if (type.includes('cancelled')) return 499
  if (type.includes('created')) return 201
  return 200
}

const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10)

// ---------- public API (same shapes as mock) ----------

export async function submitCommand(command: string): Promise<{ taskId: string; plan: string[] }> {
  const { projectId, agents } = await bootstrap()
  const task = await ggPost<{ id: string }>('/api/v1/tasks', {
    projectId,
    agentId: agents.codex,
    title: command.slice(0, 80) || 'Task',
    prompt: command,
  })
  return {
    taskId: task.id,
    plan: [
      `parse: "${command.slice(0, 48)}"`,
      'route: Router Spire → agents',
      'execute: backend worker (mock runtime)',
      'report: stream events back to the city',
    ],
  }
}

export async function runPlayground(
  agentId: BuildingId,
  prompt: string,
  _params: PlaygroundParams,
  onToken: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<{ text: string; tokensIn: number; tokensOut: number; latencyMs: number }> {
  const started = Date.now()
  const { projectId, agents } = await bootstrap()
  const backendAgent = agents[agentId] ?? agents.codex
  const task = await ggPost<{ id: string }>('/api/v1/tasks', {
    projectId,
    agentId: backendAgent,
    title: 'Playground',
    prompt,
  })
  const { text, tokensIn, tokensOut } = await streamTask(task.id, prompt, onToken, signal)
  return { text, tokensIn, tokensOut, latencyMs: Date.now() - started }
}

/** Reads the backend SSE firehose filtered to one task, emitting agent.output text as it arrives. */
async function streamTask(
  taskId: string,
  prompt: string,
  onToken: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  signal?.addEventListener('abort', onAbort)
  let text = ''
  let tokensIn = Math.ceil(prompt.length / 4)
  let tokensOut = 0
  try {
    const res = await fetch(apiUrl(`/api/v1/events/stream?after=0&taskId=${taskId}`), {
      headers: authHeaders({ accept: 'text/event-stream' }),
      signal: ctrl.signal,
    })
    if (!res.body) throw new Error('no event stream body')
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    done: for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const ev = parseFrame(frame)
        if (!ev) continue
        if (ev.type === 'agent.output') {
          const chunk = typeof ev.data?.text === 'string' ? ev.data.text : ''
          if (chunk) {
            text += chunk
            onToken(chunk)
          }
        } else if (ev.type === 'usage.updated') {
          if (typeof ev.data?.inputTokens === 'number') tokensIn = ev.data.inputTokens
          if (typeof ev.data?.outputTokens === 'number') tokensOut = ev.data.outputTokens
        } else if (ev.type === 'task.completed' || ev.type === 'task.failed' || ev.type === 'task.cancelled') {
          break done
        }
      }
    }
    ctrl.abort()
  } catch (e) {
    // If nothing streamed, surface so client.ts can fall back; otherwise keep the partial text.
    if (!text) throw e
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
  if (!tokensOut) tokensOut = Math.ceil(text.length / 4)
  return { text, tokensIn, tokensOut }
}

function parseFrame(frame: string): GgEvent | null {
  const dataLines = frame
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
  if (!dataLines.length) return null
  try {
    return JSON.parse(dataLines.join('\n')) as GgEvent
  } catch {
    return null
  }
}

export async function listAgents(): Promise<AgentSummary[]> {
  const { projectId, agentToBuilding } = await bootstrap()
  const [agentsRes, providersRes, eventsRes] = await Promise.all([
    ggGet<ListResponse<{ id: string; name: string; buildingId?: string; providerId: string }>>(`/api/v1/agents?projectId=${projectId}&limit=200`),
    ggGet<ListResponse<{ id: string; type: string; model?: string }>>('/api/v1/providers?limit=200'),
    ggGet<{ items: GgEvent[] }>('/api/v1/events?limit=1000'),
  ])
  const providerById = new Map((providersRes.items ?? []).map((p) => [p.id, p]))
  const events = eventsRes.items ?? []
  const since = Date.now() - 86_400_000
  return (agentsRes.items ?? []).filter((a) => a.buildingId !== 'router').map((a) => {
    const buildingId = a.buildingId ?? agentToBuilding[a.id] ?? a.id
    const provider = providerById.get(a.providerId)
    const mine = events.filter((e) => e.agentId === a.id)
    const recent = mine.filter((e) => (e.timestamp ? Date.parse(e.timestamp) : 0) >= since)
    const requests24h = recent.filter((e) => e.type === 'task.created').length
    const failed = mine.filter((e) => e.type === 'task.failed').length
    const completed = mine.filter((e) => e.type === 'task.completed').length
    const running = mine.some((e) => e.type === 'task.started') && !mine.some((e) => e.type === 'task.completed' || e.type === 'task.failed')
    const lastTs = mine.reduce((max, e) => Math.max(max, e.timestamp ? Date.parse(e.timestamp) : 0), 0)
    return {
      id: buildingId,
      name: a.name,
      model: provider?.model ?? BUILDINGS[buildingId]?.model ?? 'mock-model',
      provider: PROVIDER_MAP[provider?.type ?? 'mock'] ?? 'custom',
      status: running ? 'working' : 'idle',
      lastActivity: lastTs || Date.now(),
      requests24h,
      errorRate: completed + failed ? failed / (completed + failed) : 0,
      p50LatencyMs: 0,
    }
  })
}

export async function getLogs(buildingId: BuildingId, limit = 5): Promise<LogEntry[]> {
  const { agents } = await bootstrap()
  const agentId = agents[buildingId]
  if (!agentId) return [] // player-built building with no backend agent yet
  const res = await ggGet<{ items: GgEvent[] }>(`/api/v1/events?agentId=${agentId}&limit=${Math.max(limit * 4, 20)}`)
  const items = res.items ?? []
  return items.slice(-limit).map((ev) => ({
    id: `log_${ev.seq ?? Math.random().toString(36).slice(2)}`,
    ts: ev.timestamp ? Date.parse(ev.timestamp) : Date.now(),
    buildingId,
    level: levelForEvent(ev.type),
    text: textForEvent(ev),
  }))
}

export async function listRequests(filter?: {
  agentId?: BuildingId | 'all'
  status?: 'all' | '2xx' | '4xx' | '5xx'
  q?: string
}): Promise<RequestLog[]> {
  const { agentToBuilding } = await bootstrap()
  const res = await ggGet<{ items: GgEvent[] }>('/api/v1/events?limit=1000')
  const rows: RequestLog[] = (res.items ?? [])
    .filter((ev) => ev.type.startsWith('task.') || ev.type.startsWith('agent.'))
    .map((ev) => {
      const buildingId = ev.agentId ? (agentToBuilding[ev.agentId] ?? ev.agentId) : 'router'
      const status = statusForEvent(ev.type)
      return {
        id: `req_${ev.seq ?? Math.random().toString(36).slice(2)}`,
        ts: ev.timestamp ? Date.parse(ev.timestamp) : Date.now(),
        agentId: buildingId,
        method: ev.type.includes('created') ? 'POST' : 'GET',
        path: `/v1/events/${ev.type.replace(/\./g, '/')}`,
        status,
        latencyMs: 0,
        tokensIn: typeof ev.data?.inputTokens === 'number' ? ev.data.inputTokens : 0,
        tokensOut: typeof ev.data?.outputTokens === 'number' ? ev.data.outputTokens : 0,
        request: { taskId: ev.taskId, type: ev.type },
        response: ev.data ?? {},
      } satisfies RequestLog
    })
    .reverse() // newest first, matching the mock
  return rows.filter((req) => {
    if (filter?.agentId && filter.agentId !== 'all' && req.agentId !== filter.agentId) return false
    if (filter?.status && filter.status !== 'all' && `${Math.floor(req.status / 100)}xx` !== filter.status) return false
    if (filter?.q && !`${req.path} ${req.id}`.toLowerCase().includes(filter.q.toLowerCase())) return false
    return true
  })
}

export async function getUsage(days: 7 | 30): Promise<UsageSummary> {
  const { projectId } = await bootstrap()
  const [usageRes, eventsRes] = await Promise.all([
    ggGet<{ items: { createdAt?: string; inputTokens?: number | null; outputTokens?: number | null; costUsd?: number | null }[] }>(
      `/api/v1/usage?projectId=${projectId}&limit=500`,
    ),
    ggGet<{ items: GgEvent[] }>('/api/v1/events?limit=1000'),
  ])
  // Bucket real usage records + failures by day.
  const buckets = new Map<string, { requests: number; tokens: number; errors: number; costUsd: number }>()
  const bucket = (k: string) => {
    let b = buckets.get(k)
    if (!b) buckets.set(k, (b = { requests: 0, tokens: 0, errors: 0, costUsd: 0 }))
    return b
  }
  for (const u of usageRes.items ?? []) {
    const b = bucket(dayKey(u.createdAt ? Date.parse(u.createdAt) : Date.now()))
    b.requests += 1
    b.tokens += (u.inputTokens ?? 0) + (u.outputTokens ?? 0)
    b.costUsd += u.costUsd ?? 0
  }
  for (const ev of eventsRes.items ?? []) {
    if (ev.type === 'task.failed') bucket(dayKey(ev.timestamp ? Date.parse(ev.timestamp) : Date.now())).errors += 1
  }
  const points = Array.from({ length: days }, (_, i) => {
    const date = dayKey(Date.now() - (days - 1 - i) * 86_400_000)
    const b = buckets.get(date) ?? { requests: 0, tokens: 0, errors: 0, costUsd: 0 }
    return { date, requests: b.requests, tokens: b.tokens, errors: b.errors, costUsd: Math.round(b.costUsd * 100) / 100 }
  })
  const requests = points.reduce((a, p) => a + p.requests, 0)
  const errors = points.reduce((a, p) => a + p.errors, 0)
  return {
    days,
    points,
    totals: {
      requests,
      errorRate: requests ? errors / requests : 0,
      avgLatencyMs: 0,
      costUsd: Math.round(points.reduce((a, p) => a + p.costUsd, 0) * 100) / 100,
    },
  }
}

// ---------- approval flow ----------
//
// The backend gates writes internally and has no dedicated approve route, so "approve" here means
// "read the finished task's result". Tasks run by the mock provider complete on their own, so this
// returns real artifacts/usage when present. "reject" maps to the real task-cancel route.

export async function approve(taskId: string): Promise<TaskResult> {
  const task = await ggGet<any>(`/api/v1/tasks/${taskId}`)
  let files: TaskResult['files'] = []
  try {
    const arts = await ggGet<{ items: any[] }>(`/api/v1/tasks/${taskId}/artifacts`)
    files = (arts.items ?? []).map((a) => ({
      path: a.path ?? a.relativePath ?? a.name ?? 'artifact',
      change: 'modified' as const,
    }))
  } catch {
    // artifacts are optional
  }
  const startedAt = task.startedAt ? Date.parse(task.startedAt) : task.createdAt ? Date.parse(task.createdAt) : Date.now()
  const completedAt = task.completedAt ? Date.parse(task.completedAt) : Date.now()
  let tokens = 0
  let costUsd = 0
  try {
    const usage = await ggGet<{ items: any[] }>(`/api/v1/usage?limit=500`)
    for (const u of usage.items ?? [])
      if (u.taskId === taskId) {
        tokens += (u.inputTokens ?? 0) + (u.outputTokens ?? 0)
        costUsd += u.costUsd ?? 0
      }
  } catch {
    // usage is optional
  }
  return {
    title: task.title ?? 'Task complete',
    summary: task.result?.summary ?? task.summary ?? `Task ${task.status ?? 'completed'} on the backend.`,
    files,
    tokens,
    latencyMs: Math.max(0, completedAt - startedAt),
    costUsd: Math.round(costUsd * 10000) / 10000,
  }
}

export async function reject(taskId: string): Promise<{ ok: true }> {
  await ggPost(`/api/v1/tasks/${taskId}/cancel`, {})
  return { ok: true }
}

// ---------- sessions ----------

function sessionStatus(s: string | undefined): Session['status'] {
  if (s === 'active') return 'running'
  if (s === 'archived') return 'done'
  if (s === 'error' || s === 'failed') return 'error'
  return 'queued'
}

export async function listBuildingSessions(buildingId: BuildingId): Promise<Session[]> {
  const { agents } = await bootstrap()
  const agentId = agents[buildingId]
  if (!agentId) return [] // player-built building with no backend agent
  const res = await ggGet<ListResponse<any>>(`/api/v1/agents/${agentId}/sessions?limit=100`)
  return (res.items ?? []).map((s) => ({
    id: s.id,
    title: s.name ?? 'Session',
    status: sessionStatus(s.status),
    startedAt: s.createdAt ? Date.parse(s.createdAt) : Date.now(),
    tokens: typeof s.totalTokens === 'number' ? s.totalTokens : 0,
    runtime: (s.runtime ?? 'backend') as Session['runtime'],
    model: s.model ?? BUILDINGS[buildingId]?.model ?? 'mock-model',
  }))
}

/** Turns a backend event into a city log line (level + text). Used by store/live.ts. */
export function describeEvent(ev: { type: string; data?: any }): { level: LogLevel; text: string } {
  return { level: levelForEvent(ev.type), text: textForEvent(ev as GgEvent) }
}

// ---------- provider connection test ----------
//
// The browser never holds the real key (keys live in the backend .env), so a true test of a raw
// pasted key is impossible. Instead we probe a backend provider of the matching type via its
// /test route. If none exists, we throw so client.ts falls back to the local mock test.

const FRONTEND_TO_BACKEND_PROVIDER: Record<Provider, string[]> = {
  deepseek: ['deepseek'],
  openai: ['openai-compatible'],
  anthropic: ['claude'],
  gemini: ['openai-compatible'],
  groq: ['openai-compatible'],
  custom: ['openai-compatible', 'mock'],
}

export async function testConnection(key: Pick<ProviderKey, 'provider' | 'baseUrl' | 'key'>): Promise<{ ok: boolean; latencyMs: number; message: string }> {
  const list = await ggGet<ListResponse<{ id: string; type: string }>>('/api/v1/providers?limit=200')
  const wanted = FRONTEND_TO_BACKEND_PROVIDER[key.provider] ?? []
  const provider = (list.items ?? []).find((p) => wanted.includes(p.type))
  if (!provider) throw new Error(`No backend provider of type ${key.provider} to test`)
  const started = Date.now()
  const res = await ggPost<{ available?: boolean; message?: string }>(`/api/v1/providers/${provider.id}/test`, {})
  return {
    ok: !!res.available,
    latencyMs: Date.now() - started,
    message: res.message ?? (res.available ? 'Provider reachable' : 'Provider unavailable'),
  }
}
