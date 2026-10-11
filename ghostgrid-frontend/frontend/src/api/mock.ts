// Mock backend. Every function is async so it can be swapped for real HTTP calls.
// Do not import the store here. client.ts is the only caller.
import { BUILDINGS, BUILDING_IDS } from '../constants'
import type {
  AgentSummary,
  BuildingId,
  LogEntry,
  LogLevel,
  PlatformKey,
  PlaygroundParams,
  ProviderKey,
  RequestLog,
  RuntimeId,
  SessionMode,
  TaskResult,
  UsageSummary,
} from '../types'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Deterministic PRNG so charts and tables look the same on every reload.
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

let idCounter = 0
export const uid = (prefix = 'id') => `${prefix}_${Date.now().toString(36)}${(idCounter++).toString(36)}`

// ---------- Logs ----------

const SEED_LOGS: Record<string, [LogLevel, string][]> = {
  router: [
    ['info', 'heartbeat ok · 3 agents online'],
    ['info', 'route table refreshed (codex, security)'],
    ['ok', 'task t_8f2 merged · 2 agents · 41.2s'],
    ['info', 'budget check: $0.42 / $5.00 today'],
    ['warn', 'codex p95 latency 2.1s (> 2.0s target)'],
  ],
  codex: [
    ['info', 'workspace mounted: ~/ghostgrid'],
    ['ok', 'npm run build · 0 errors'],
    ['info', 'edit src/App.tsx (+12 −3)'],
    ['ok', 'tests 24/24 passed'],
    ['info', 'idle · waiting for router'],
  ],
  claude: [
    ['info', 'context loaded: 38 files · 92k tokens'],
    ['ok', 'review posted on PR #12 (4 comments)'],
    ['info', 'design doc: plugin bots v1'],
    ['ok', 'architecture check passed'],
    ['info', 'session running · architecture: plugin bots'],
  ],
  deepseek: [
    ['info', 'batch queue: 3 jobs'],
    ['ok', 'generated 18 unit tests'],
    ['ok', 'summarized 120 request logs'],
    ['warn', 'rate limit 80% · slowing down'],
    ['info', 'batch running · 2 jobs left'],
  ],
  groq: [
    ['info', 'pit lane open · 3 stalls'],
    ['ok', 'first token 71ms · streamed 480 tok'],
    ['ok', 'drafted 40 commit messages'],
    ['info', 'queue empty · idling at 0.9 laps/s'],
    ['ok', 'realtime reply · 1.2s end to end'],
  ],
  security: [
    ['info', 'policy v3 loaded · 14 rules'],
    ['ok', 'allowed: read src/**'],
    ['warn', 'blocked: curl to unknown host'],
    ['ok', 'allowed: npm install (lockfile match)'],
    ['info', 'idle · 0 pending approvals'],
  ],
}

export async function getLogs(buildingId: BuildingId, limit = 5): Promise<LogEntry[]> {
  await sleep(120)
  const now = Date.now()
  return (SEED_LOGS[buildingId] ?? [['info', 'online']]).slice(-limit).map(([level, text], i, arr) => ({
    id: uid('log'),
    ts: now - (arr.length - i) * 47_000,
    buildingId,
    level,
    text,
  }))
}

// ---------- Main demo flow ----------

export async function submitCommand(command: string): Promise<{ taskId: string; plan: string[] }> {
  await sleep(250)
  return {
    taskId: uid('task'),
    plan: [
      `parse: "${command.slice(0, 48)}"`,
      'assign: codex → implement',
      'assign: security → review destructive ops',
      'merge: router → report',
    ],
  }
}

export async function approve(taskId: string): Promise<TaskResult> {
  await sleep(300)
  void taskId
  return {
    title: 'Build cleaned and rebuilt',
    summary: 'Codex removed /tmp/build, rebuilt the project and ran the test suite. All checks passed.',
    files: [
      { path: '/tmp/build', change: 'deleted' },
      { path: 'src/App.tsx', change: 'modified' },
      { path: 'src/api/client.ts', change: 'added' },
    ],
    tokens: 18_432,
    latencyMs: 7_840,
    costUsd: 0.0712,
  }
}

export async function reject(taskId: string): Promise<{ ok: true }> {
  await sleep(200)
  void taskId
  return { ok: true }
}

// ---------- Console: agents ----------

export async function listAgents(): Promise<AgentSummary[]> {
  await sleep(150)
  const r = rng(7)
  const providers: Record<string, AgentSummary['provider']> = { router: 'anthropic', codex: 'openai', cursor: 'custom', claude: 'anthropic', deepseek: 'deepseek', groq: 'groq', security: 'deepseek' }
  return BUILDING_IDS.map((id) => ({
    id,
    name: BUILDINGS[id].name,
    model: BUILDINGS[id].model,
    provider: providers[id],
    status: 'idle',
    lastActivity: Date.now() - Math.floor(r() * 3_600_000),
    requests24h: 200 + Math.floor(r() * 1800),
    errorRate: Math.round(r() * 40) / 1000,
    p50LatencyMs: 300 + Math.floor(r() * 1500),
  }))
}

// ---------- Console: request logs ----------

const PATHS: Record<string, string[]> = {
  router: ['/v1/tasks', '/v1/tasks/plan', '/v1/route'],
  codex: ['/v1/agents/codex/run', '/v1/agents/codex/patch', '/v1/agents/codex/build'],
  claude: ['/v1/agents/claude/review', '/v1/agents/claude/plan', '/v1/agents/claude/run'],
  deepseek: ['/v1/agents/deepseek/batch', '/v1/agents/deepseek/run', '/v1/agents/deepseek/tests'],
  groq: ['/v1/agents/groq/stream', '/v1/agents/groq/run', '/v1/agents/groq/sessions'],
  security: ['/v1/agents/security/check', '/v1/approvals', '/v1/agents/security/policy'],
}
const STATUSES = [200, 200, 200, 200, 200, 200, 201, 200, 400, 403, 429, 500]

function makeRequests(count: number): RequestLog[] {
  const r = rng(42)
  const now = Date.now()
  const out: RequestLog[] = []
  for (let i = 0; i < count; i++) {
    const agentId = BUILDING_IDS[Math.floor(r() * BUILDING_IDS.length)]
    const path = PATHS[agentId][Math.floor(r() * 3)]
    const status = STATUSES[Math.floor(r() * STATUSES.length)]
    const method = path.includes('policy') ? 'GET' : 'POST'
    const tokensIn = 200 + Math.floor(r() * 4000)
    const tokensOut = status >= 400 ? 0 : 50 + Math.floor(r() * 2000)
    out.push({
      id: `req_${(100000 + i).toString(36)}`,
      ts: now - i * (60_000 + Math.floor(r() * 240_000)),
      agentId,
      method,
      path,
      status,
      latencyMs: 80 + Math.floor(r() * (status === 500 ? 9000 : 2400)),
      tokensIn,
      tokensOut,
      request: {
        model: BUILDINGS[agentId].model,
        input: agentId === 'codex' ? 'Refactor the drone flight path to use arcs' : 'Check: rm -rf /tmp/build',
        temperature: 0.2,
        max_tokens: 1024,
      },
      response:
        status >= 400
          ? { error: { code: status, message: status === 429 ? 'rate_limited' : status === 403 ? 'policy_denied' : 'bad_request' } }
          : { id: `resp_${i}`, output: 'ok', usage: { input_tokens: tokensIn, output_tokens: tokensOut } },
    })
  }
  return out
}

let requestStore: RequestLog[] | null = null

export async function listRequests(filter?: {
  agentId?: BuildingId | 'all'
  status?: 'all' | '2xx' | '4xx' | '5xx'
  q?: string
}): Promise<RequestLog[]> {
  await sleep(150)
  requestStore ??= makeRequests(120)
  return requestStore.filter((req) => {
    if (filter?.agentId && filter.agentId !== 'all' && req.agentId !== filter.agentId) return false
    if (filter?.status && filter.status !== 'all' && `${Math.floor(req.status / 100)}xx` !== filter.status) return false
    if (filter?.q && !`${req.path} ${req.id}`.toLowerCase().includes(filter.q.toLowerCase())) return false
    return true
  })
}

// Called by client when the city or playground produces a real (mock) request.
export function recordRequest(req: RequestLog) {
  requestStore ??= makeRequests(120)
  requestStore.unshift(req)
}

// ---------- Console: usage ----------

export async function getUsage(days: 7 | 30): Promise<UsageSummary> {
  await sleep(150)
  const r = rng(days)
  const points = Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.now() - (days - 1 - i) * 86_400_000)
    const requests = 900 + Math.floor(r() * 900) + i * 25
    const errors = Math.floor(requests * (0.005 + r() * 0.03))
    const tokens = requests * (900 + Math.floor(r() * 600))
    return {
      date: d.toISOString().slice(0, 10),
      requests,
      tokens,
      errors,
      costUsd: Math.round(tokens * 0.0000021 * 100) / 100,
    }
  })
  const req = points.reduce((a, p) => a + p.requests, 0)
  const err = points.reduce((a, p) => a + p.errors, 0)
  return {
    days,
    points,
    totals: {
      requests: req,
      errorRate: err / req,
      avgLatencyMs: 640 + Math.floor(r() * 300),
      costUsd: Math.round(points.reduce((a, p) => a + p.costUsd, 0) * 100) / 100,
    },
  }
}

// ---------- Console: Ghostgrid platform keys ----------

let platformKeys: PlatformKey[] = [
  { id: 'pk_1', name: 'demo-laptop', masked: 'gg-…7f3a', createdAt: Date.now() - 6 * 86_400_000, lastUsed: Date.now() - 3_600_000, revoked: false },
  { id: 'pk_2', name: 'ci-runner', masked: 'gg-…c21d', createdAt: Date.now() - 20 * 86_400_000, lastUsed: Date.now() - 86_400_000, revoked: false },
]

export async function listPlatformKeys(): Promise<PlatformKey[]> {
  await sleep(100)
  return [...platformKeys]
}

export async function createPlatformKey(name: string): Promise<{ key: PlatformKey; secret: string }> {
  await sleep(250)
  const secret = `gg-${Array.from({ length: 40 }, () => 'abcdef0123456789'[Math.floor(Math.random() * 16)]).join('')}`
  const key: PlatformKey = { id: uid('pk'), name, masked: `gg-…${secret.slice(-4)}`, createdAt: Date.now(), lastUsed: null, revoked: false }
  platformKeys = [key, ...platformKeys]
  return { key, secret }
}

export async function revokePlatformKey(id: string): Promise<void> {
  await sleep(150)
  platformKeys = platformKeys.map((k) => (k.id === id ? { ...k, revoked: true } : k))
}

// ---------- Provider key test ----------

export async function testConnection(key: Pick<ProviderKey, 'provider' | 'baseUrl' | 'key'>): Promise<{ ok: boolean; latencyMs: number; message: string }> {
  const latencyMs = 200 + Math.floor(Math.random() * 600)
  await sleep(latencyMs)
  // Mock rule: keys shorter than 8 chars or containing "bad" fail.
  const ok = key.key.length >= 8 && !key.key.includes('bad')
  return { ok, latencyMs, message: ok ? `200 OK · ${key.baseUrl || 'custom endpoint'}` : '401 Unauthorized · invalid key' }
}

// ---------- Office sessions ----------
// The office (src/city/office) starts and stops the sessions that fill a building's desks.
// A local runtime never leaves the machine; a connected one would carry the provider key.

export async function startSession(
  agentId: BuildingId,
  input: { title: string; runtime: RuntimeId; mode: SessionMode; model: string },
): Promise<{ sessionId: string; host: string; etaMs: number }> {
  await sleep(input.mode === 'local' ? 420 : 260)
  void agentId
  return {
    sessionId: uid('s'),
    host: input.mode === 'local' ? 'localhost' : `api.${input.runtime}.com`,
    etaMs: input.mode === 'local' ? 9_000 : 6_000,
  }
}

export async function stopSession(agentId: BuildingId, sessionId: string): Promise<{ ok: true }> {
  await sleep(180)
  void agentId
  void sessionId
  return { ok: true }
}

// ---------- Playground ----------

const PLAYGROUND_REPLIES: Record<string, string> = {
  router:
    'Plan:\n1. codex → implement the change on a branch\n2. security → review any shell or file-system writes\n3. router → merge results and report back\nEstimated cost: $0.04 · 3 agents · ~20s',
  codex:
    "Sure. Here is the patch:\n\n```ts\nexport function flightPath(from: Point, to: Point) {\n  const mid = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 24 }\n  return [from, mid, to]\n}\n```\n\nBuild passes. 24/24 tests green.",
  security:
    'Risk review:\n- rm -rf /tmp/build → MEDIUM (outside repo, temp dir)\n- npm install → LOW (lockfile unchanged)\nVerdict: allow with human approval for the delete.',
}

export async function runPlayground(
  agentId: BuildingId,
  prompt: string,
  params: PlaygroundParams,
  onToken: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<{ text: string; tokensIn: number; tokensOut: number; latencyMs: number }> {
  const started = Date.now()
  const full = PLAYGROUND_REPLIES[agentId] ?? PLAYGROUND_REPLIES.router
  const limit = Math.min(full.length, params.maxTokens * 4)
  const text = full.slice(0, limit)
  await sleep(350)
  for (let i = 0; i < text.length; i += 3) {
    if (signal?.aborted) break
    onToken(text.slice(i, i + 3))
    await sleep(18)
  }
  return {
    text,
    tokensIn: Math.ceil(prompt.length / 4),
    tokensOut: Math.ceil(text.length / 4),
    latencyMs: Date.now() - started,
  }
}
