// Live backend adapter. Mirrors the signatures the UI/stores already call through client.ts,
// but talks to the real Ghost Grid backend (REST + SSE) described in ghostgrid-backend/docs/FRONTEND.md.
//
// client.ts calls this when the backend is reachable (see config.isLive) and nothing else when
// it is not. Each function here fails by throwing; client.ts reports the failure and rethrows it,
// so a route the backend cannot serve reads as a failure on screen, never as an empty city.
//
// Scope: the city's read paths (logs, agents, request log, usage) and the playground stream.
// Task approval, provider connection tests and a building's sessions live in liveOps.ts — this
// module carried a second, diverging copy of each that nothing had called since client.ts was
// pointed at liveOps.
//
// Bootstrap: the frontend's building ids (codex/claude/deepseek/…) are mapped to real backend
// agents via the backend's own `buildingId` field. One project is ensured lazily, and one agent
// per building that has a vendor behind it. The map is cached for the page's lifetime.
//
// A building with no configured vendor gets no agent at all. It used to get one on a
// credential-free `mock` provider "so tasks actually execute without API keys", which meant every
// tower in the city reported itself as running a model whether or not anything was configured.
// An agent left over from that era is also left unreported, so nothing is routed to it
// (scripts/bootstrap.test.mjs pins both rules).
//
// The seeded Agent Row houses that used to be bootstrapped here are gone with the rest of the
// demo city.
import { BUILDINGS, BUILDING_IDS } from '../constants.ts'
import type {
  AgentSummary,
  BuildingId,
  LogEntry,
  LogLevel,
  PlaygroundParams,
  Provider,
  RequestLog,
  UsageSummary,
} from '../types.ts'
import { PROJECT_ID } from './config.ts'
import { asPage, isBackendError, openStream, readEventStream, request, type Query } from './http.ts'

// ---------- HTTP helpers ----------
//
// Thin aliases over the shared transport in http.ts, which owns retries, timeouts,
// error classification and body checking. This module used to keep its own `fetch`
// pair; two transports meant two sets of behaviour for the same backend.

const ggPost = <T = any>(path: string, body: unknown) => request<T>('POST', path, { body })
/** A `{ items, total }` route. A body that is not a page is a failure, never an empty list. */
const ggList = async <T>(path: string, query?: Query) => asPage<T>(await request<unknown>('GET', path, { query }), path)

// The agents list, the request log and the usage chart each derive themselves from
// the same recent-event window, and the console refreshes them together. One cached
// pull serves all three instead of three 1000-event downloads per refresh.
const RECENT_EVENT_LIMIT = 1000
const RECENT_EVENT_TTL_MS = 2_000
let recentEventsCache: { at: number; promise: Promise<{ items: GgEvent[] }> } | null = null

function recentEvents(): Promise<{ items: GgEvent[] }> {
  if (recentEventsCache && Date.now() - recentEventsCache.at < RECENT_EVENT_TTL_MS) return recentEventsCache.promise
  const promise = ggList<GgEvent>('/api/v1/events', { limit: RECENT_EVENT_LIMIT }).catch((error) => {
    recentEventsCache = null // never cache a failure
    throw error
  })
  recentEventsCache = { at: Date.now(), promise }
  return promise
}

// ---------- Bootstrap (project + provider + agents) ----------

export interface Bootstrap {
  projectId: string
  /**
   * building id → backend agent id, for the buildings that have one. A building whose vendor
   * key is not configured is absent: it used to be bound to a credential-free "Mock Runtime"
   * provider, which made every such tower look like it was running a model.
   */
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

async function ensureProject(): Promise<string> {
  if (PROJECT_ID) return PROJECT_ID
  const list = await ggList<{ id: string }>('/api/v1/projects', { limit: 1 })
  if (list.items?.length) return list.items[0].id
  const created = await ggPost<{ id: string }>('/api/v1/projects', { name: 'Ghost Grid City' })
  return created.id
}

/**
 * The buildings named after a vendor run on that vendor when its key is configured.
 *
 * The mock runtime reports no token counts, so a city wired entirely to it can never show
 * real usage. The keys live in the backend's environment and are never sent here: the
 * backend's own `/test` route answers whether a provider can run, and a building falls back
 * to the mock when the answer is no.
 *
 * A model is named (and must still be offered by the vendor) because `/test` verifies it
 * against the vendor's model list.
 */
const VENDOR_BUILDINGS: Record<string, { provider: Record<string, unknown>; permissions: ('read' | 'write')[] }> = {
  deepseek: {
    provider: { name: 'DeepSeek API', type: 'deepseek', apiKeyEnv: 'DEEPSEEK_API_KEY', model: 'deepseek-flash', concurrency: 2 },
    permissions: ['read'],
  },
  groq: {
    provider: {
      name: 'Groq API', type: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1',
      apiKeyEnv: 'GROQ_API_KEY', model: 'openai/gpt-oss-20b', concurrency: 2,
    },
    permissions: ['read'],
  },
  claude: {
    provider: { name: 'Claude Agent SDK', type: 'claude', apiKeyEnv: 'ANTHROPIC_API_KEY', concurrency: 1 },
    // The Claude adapter refuses file tools without an explicit workspace, and the city
    // project has none, so this agent runs inference only.
    permissions: [],
  },
}

interface ProviderRecord {
  id: string
  name?: string
  type: string
  baseUrl?: string | null
  model?: string | null
  availability?: { available?: boolean } | null
  checkedAt?: string | null
}

/** How long a recorded `/test` verdict is trusted before the provider is probed again. */
const AVAILABILITY_TTL_MS = 86_400_000

/** Provider id for a vendor building, or null when the backend cannot run it. */
async function ensureVendorProvider(
  building: string,
  providers: ProviderRecord[],
): Promise<string | null> {
  const spec = VENDOR_BUILDINGS[building]
  if (!spec) return null
  const wanted = spec.provider
  // Matched on type + name only. The backend fills in its own default `baseUrl` when the
  // record omits one, so comparing baseUrl against the spec never matched and every
  // bootstrap minted a fresh duplicate provider (plus a `/test` round trip for it).
  const match = providers.find((p) => p.type === wanted.type && p.name === wanted.name)
  try {
    const provider = match ?? (await ggPost<ProviderRecord>('/api/v1/providers', wanted))
    if (!match) providers.push(provider) // so a later building in the same bootstrap reuses it
    // `/test` reaches out to the vendor (a models fetch, or an SDK import), so it must not
    // run on every page load: the backend records each verdict with a timestamp, and a
    // recent "available" is good enough to start the city with.
    const checkedAt = provider.checkedAt ? Date.parse(provider.checkedAt) : NaN
    if (provider.availability?.available && Number.isFinite(checkedAt) && Date.now() - checkedAt < AVAILABILITY_TTL_MS)
      return provider.id
    const test = await ggPost<{ available?: boolean; models?: string[] }>(`/api/v1/providers/${provider.id}/test`, {})
    if (test.available) return provider.id
    // A model the vendor no longer serves is the common cause, and the vendor just listed
    // what it does serve: adopt one rather than dropping the building to the mock.
    const fallback = wanted.model ? test.models?.find((m) => m.startsWith(String(wanted.model).split('/')[0])) ?? test.models?.[0] : undefined
    if (!fallback) return null
    await request('PATCH', `/api/v1/providers/${provider.id}`, { body: { model: fallback } })
    const retry = await ggPost<{ available?: boolean }>(`/api/v1/providers/${provider.id}/test`, {})
    return retry.available ? provider.id : null
  } catch {
    return null // no key, no network, or the backend refused: the mock still works
  }
}

/** Every building that can own a backend agent, with the name and role to create it under. */
const AGENT_BUILDINGS: { id: BuildingId; name: string; role: string }[] =
  BUILDING_IDS.map((id) => ({ id, name: BUILDINGS[id]?.name ?? id, role: BUILDINGS[id]?.role ?? '' }))

async function ensureAgents(
  projectId: string,
  providers: ProviderRecord[],
): Promise<Record<string, string>> {
  const list = await ggList<{ id: string; buildingId?: string; providerId: string }>('/api/v1/agents', { projectId, limit: 200 })
  const existingAgents = new Map((list.items ?? []).map((a) => [a.buildingId ?? a.id, a]))
  // Sequential: two buildings resolving the same vendor at once would each create a record.
  const vendorProviders: Record<string, string | null> = {}
  for (const { id } of AGENT_BUILDINGS) if (VENDOR_BUILDINGS[id]) vendorProviders[id] = await ensureVendorProvider(id, providers)
  const providerType = new Map(providers.map((provider) => [provider.id, provider.type]))
  const agents: Record<string, string> = {}
  await Promise.all(AGENT_BUILDINGS.map(async ({ id, name, role }) => {
    const wantedProvider = vendorProviders[id] ?? null
    const permissions = VENDOR_BUILDINGS[id]?.permissions ?? ['read']
    const existing = existingAgents.get(id)
    if (!wantedProvider) {
      // No vendor for this building, or its key is not configured: it stays unconfigured
      // instead of being wired to a stand-in. An agent left behind on the old mock provider is
      // kept — its tasks and sessions reference it — but not reported, so the city routes
      // nothing to it and the building reads as having no provider.
      if (existing && providerType.get(existing.providerId) !== 'mock') agents[id] = existing.id
      return
    }
    if (existing) {
      if (existing.providerId === wantedProvider) {
        agents[id] = existing.id
        return
      }
      // An agent's provider is immutable by design, so moving a building onto its real
      // vendor means replacing the agent. An agent that owns any task cannot be deleted
      // (the task rows reference it), and keeping the old agent is better than losing
      // that history — so ask before trying, rather than firing a DELETE that is certain
      // to fail and log a 409 in the console on every single page load.
      // Tasks *and* sessions carry a foreign key to the agent, so either one makes the
      // delete fail; asking first is what keeps a certain-to-fail DELETE (and its 409 in
      // the console) off every page load.
      const [tasks, sessions] = await Promise.all([
        ggList<{ id: string }>('/api/v1/tasks', { agentId: existing.id, limit: 1 }).catch(() => null),
        ggList<{ id: string }>('/api/v1/sessions', { agentId: existing.id, limit: 1 }).catch(() => null),
      ])
      if (!tasks || !sessions || tasks.items.length || sessions.items.length) {
        // The old agent stays (its history references it), but an agent on the retired mock
        // provider is never reported: routing work to it would run a credential-free stand-in
        // under a building whose vendor key is configured, which is exactly the illusion this
        // city is getting rid of. The building reads as unconfigured until the stale agent is
        // deleted on the backend.
        if (providerType.get(existing.providerId) !== 'mock') agents[id] = existing.id
        return
      }
      try {
        await request('DELETE', `/api/v1/agents/${encodeURIComponent(existing.id)}`)
      } catch {
        if (providerType.get(existing.providerId) !== 'mock') agents[id] = existing.id
        return
      }
    }
    const created = await ggPost<{ id: string }>('/api/v1/agents', {
      name,
      buildingId: id,
      projectId,
      providerId: wantedProvider,
      role,
      permissions,
    })
    agents[id] = created.id
  }))
  return agents
}

async function doBootstrap(): Promise<Bootstrap> {
  // One providers read for the whole bootstrap: every vendor lookup shares it, and each
  // creation appends to it.
  const [projectId, providerPage] = await Promise.all([
    ensureProject(),
    ggList<ProviderRecord>('/api/v1/providers', { limit: 200 }),
  ])
  const providers = providerPage.items ?? []
  const agents = await ensureAgents(projectId, providers)
  const agentToBuilding = Object.fromEntries(Object.entries(agents).map(([b, a]) => [a, b]))
  return { projectId, agents, agentToBuilding }
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

// ---------- public API (the shapes client.ts exposes as `api.*`) ----------

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

/**
 * Reads the backend SSE firehose filtered to one task, emitting `agent.output` text
 * as it arrives, and returns when the task reaches a terminal state.
 *
 * Hardening over a plain reader: a stall watchdog (the backend heartbeats every
 * 15s, so silence is a dead socket), one reconnect that resumes from the last
 * delivered `seq`, an overall deadline so a task that never terminates cannot
 * wedge the playground, and a cap on buffered text.
 */
const STREAM_DEADLINE_MS = 10 * 60_000
const MAX_STREAM_TEXT = 2_000_000

async function streamTask(
  taskId: string,
  prompt: string,
  onToken: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  signal?.addEventListener('abort', onAbort)
  const deadline = setTimeout(() => ctrl.abort(), STREAM_DEADLINE_MS)
  let text = ''
  let truncated = false
  let tokensIn = Math.ceil(prompt.length / 4)
  let tokensOut = 0
  let cursor = 0
  let finished = false
  // One reconnect: a drop mid-task is common, an endless loop is not useful here
  // because the caller is awaiting a single answer.
  let attemptsLeft = 2

  try {
    while (!finished && attemptsLeft-- > 0 && !ctrl.signal.aborted) {
      try {
        const response = await openStream('/api/v1/events/stream', {
          query: { after: cursor, taskId },
          signal: ctrl.signal,
          lastEventId: cursor || null,
        })
        for await (const data of readEventStream(response)) {
          let ev: GgEvent
          try {
            ev = JSON.parse(data) as GgEvent
          } catch {
            continue
          }
          if (typeof ev.seq === 'number') {
            if (ev.seq <= cursor) continue // replay after a reconnect
            cursor = ev.seq
          }
          if (ev.type === 'agent.output') {
            const chunk = typeof ev.data?.text === 'string' ? ev.data.text : ''
            if (chunk && !truncated) {
              if (text.length + chunk.length > MAX_STREAM_TEXT) {
                truncated = true
                text += '\n[output truncated]'
              } else {
                text += chunk
                onToken(chunk)
              }
            }
          } else if (ev.type === 'usage.updated') {
            if (typeof ev.data?.inputTokens === 'number') tokensIn = ev.data.inputTokens
            if (typeof ev.data?.outputTokens === 'number') tokensOut = ev.data.outputTokens
          } else if (ev.type === 'task.completed' || ev.type === 'task.failed' || ev.type === 'task.cancelled') {
            finished = true
            break
          }
        }
      } catch (error) {
        // A rejected stream (bad token, unknown task) will not succeed on a retry,
        // and an aborted one was cancelled on purpose.
        if (isBackendError(error) && (error.kind === 'rejected' || error.kind === 'aborted')) throw error
        if (attemptsLeft <= 0) throw error
      }
    }
  } catch (error) {
    // If nothing streamed, surface so client.ts can fall back; otherwise keep the partial text.
    if (!text) throw error
  } finally {
    clearTimeout(deadline)
    signal?.removeEventListener('abort', onAbort)
    ctrl.abort()
  }
  if (!tokensOut) tokensOut = Math.ceil(text.length / 4)
  return { text, tokensIn, tokensOut }
}

export async function listAgents(): Promise<AgentSummary[]> {
  const { projectId, agentToBuilding } = await bootstrap()
  const [agentsRes, providersRes, eventsRes] = await Promise.all([
    ggList<{ id: string; name: string; buildingId?: string; providerId: string }>('/api/v1/agents', { projectId, limit: 200 }),
    ggList<{ id: string; type: string; model?: string }>('/api/v1/providers', { limit: 200 }),
    recentEvents(),
  ])
  const providerById = new Map((providersRes.items ?? []).map((p) => [p.id, p]))
  const events = eventsRes.items ?? []
  const since = Date.now() - 86_400_000
  return (agentsRes.items ?? []).map((a) => {
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
  const res = await ggList<GgEvent>('/api/v1/events', { agentId, limit: Math.max(limit * 4, 20) })
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
  const res = await recentEvents()
  const rows: RequestLog[] = (res.items ?? [])
    .filter((ev) => ev.type.startsWith('task.') || ev.type.startsWith('agent.'))
    .map((ev) => {
      const buildingId = ev.agentId ? (agentToBuilding[ev.agentId] ?? ev.agentId) : 'codex'
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
    .reverse() // newest first
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
    ggList<{ createdAt?: string; inputTokens?: number | null; outputTokens?: number | null; costUsd?: number | null }>(
      '/api/v1/usage',
      { projectId, limit: 500 },
    ),
    recentEvents(),
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
