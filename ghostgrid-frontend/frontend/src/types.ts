// Shared contracts for Ghost Grid. City, console, store and api all import from here.

// Default buildings use these ids: 'codex' | 'claude' | 'deepseek' | 'security'.
// Player-built buildings get generated ids ("b_xxx"), so the id type is string.
export type BuildingId = string

export type BuildingType = 'codex' | 'cursor' | 'claude' | 'deepseek' | 'groq' | 'security' | 'bot' | 'library' | 'quant' | 'agent'

export type BuildingStatus = 'idle' | 'working' | 'error' | 'needs_approval'

// A custom bot the player builds. The backend team connects it later via `endpoint`.
export type BotKind = 'trading' | 'webhook' | 'scraper' | 'custom'

// ---- Wall Street ----
// Each Wall Street tower is one open-source quant trading project on GitHub. The static half
// (ticker, strategy, lot, accent) is city layout; `stats` is live repository metadata served by
// the backend's /api/v1/wallstreet. Nothing is cloned or executed — this is read-only metadata.
export interface QuantRepoStats {
  description: string | null
  language: string | null
  stars: number
  forks: number
  openIssues: number
  watchers: number
  topics: string[]
  license: string | null
  pushedAt: string | null // ISO
  homepage: string | null
}

export interface QuantRepo {
  slug: string // 'freqtrade'
  name: string // building name, "Freqtrade Exchange"
  short: string // pixel label, <= 10 chars
  lot: number
  accent: string
  ticker: string // exchange ticker on the building's band
  strategy: string
  asset: string
  url: string // https://github.com/<owner>/<name>
  repo: { owner: string; name: string }
  status: 'live' | 'cached' | 'static' // where `stats` came from
  stats: QuantRepoStats | null
  checkedAt: string | null
  error?: string
}

export interface BotConfig {
  kind: BotKind
  endpoint: string // backend URL the bot will call / be called from (stored only, no requests made)
  schedule: string // e.g. "every 5m", "on event"
  notes: string
  color: string // neon accent, one of the palette hexes
}

// Where a session's work actually happens: on this machine, or against a hosted provider.
export type SessionMode = 'local' | 'connected'

// One runtime a session can be started on (see RUNTIMES in constants.ts).
// 'local-*' run on the player's machine; the rest call a provider API with that provider's key.
export type RuntimeId = 'local-cli' | 'local-ollama' | 'openai' | 'anthropic' | 'deepseek' | 'groq'

// A working session inside an agent building (Codex / Claude / DeepSeek / Groq).
// Sessions are the desks in the building's office (src/city/office).
export interface Session {
  id: string
  title: string // "Fix failing auth test"
  status: 'running' | 'queued' | 'done' | 'error'
  startedAt: number
  tokens: number
  runtime: RuntimeId // local CLI / local Ollama / ChatGPT / Claude / …
  model: string // the model id this session runs on
  branch?: string
}

export interface Building {
  id: BuildingId
  type: BuildingType
  name: string // "Codex Tower"
  short: string // "CODEX"
  role: string // one line, shown in panels
  model: string // default model id, e.g. "gpt-5-codex"
  status: BuildingStatus
  lot: number // index into LOTS (src/city3d/world.ts)
  sessions: Session[]
  bot?: BotConfig // only for type 'bot'
  repo?: QuantRepo // only for type 'quant' (Wall Street)
  builtAt: number
}

export type LogLevel = 'info' | 'ok' | 'warn' | 'error'

export interface LogEntry {
  id: string
  ts: number // epoch ms
  buildingId: BuildingId
  level: LogLevel
  text: string
}

// Task phases for the main demo flow (dispatch → drone → work → approval → result)
export type TaskPhase = 'dispatch' | 'working' | 'approval' | 'done' | 'rejected'

export interface TaskResult {
  title: string
  summary: string
  files: { path: string; change: 'added' | 'modified' | 'deleted' }[]
  tokens: number
  latencyMs: number
  costUsd: number
}

export interface Task {
  id: string
  command: string
  phase: TaskPhase
  createdAt: number
  approval?: { buildingId: BuildingId; requester: BuildingId; message: string; action: string }
  result?: TaskResult
}

// A drone / packet flying between two buildings. Rendered by city/FlightLayer.
export type FlightKind = 'drone' | 'drone-cargo' | 'packet'

export interface Flight {
  id: string
  kind: FlightKind
  from: BuildingId
  to: BuildingId
  durationMs: number
  startedAt: number
  /**
   * A drone sent home because its approval was rejected; it trails grey smoke.
   *
   * This used to be read from a single global `task.phase === 'rejected'`, which made every
   * drone in the air smoke at once and, since nothing ever set that task, meant none ever did.
   * It belongs to the one flight it describes.
   */
  rejected?: boolean
}

// ---- Console ----

export interface AgentSummary {
  id: BuildingId
  name: string
  model: string
  provider: Provider
  status: BuildingStatus
  lastActivity: number // epoch ms
  requests24h: number
  errorRate: number // 0..1
  p50LatencyMs: number
}

export type HttpMethod = 'GET' | 'POST' | 'DELETE'

export interface RequestLog {
  id: string
  ts: number
  agentId: BuildingId
  method: HttpMethod
  path: string // "/v1/agents/codex/run"
  status: number // 200, 201, 400, 403, 429, 500
  latencyMs: number
  tokensIn: number
  tokensOut: number
  request: unknown // JSON body
  response: unknown // JSON body
}

export interface UsagePoint {
  date: string // "2026-10-05"
  requests: number
  tokens: number
  errors: number
  costUsd: number
}

export interface UsageSummary {
  days: 7 | 30
  points: UsagePoint[]
  totals: { requests: number; errorRate: number; avgLatencyMs: number; costUsd: number }
}

// Provider keys the user adds (stored only in this browser, localStorage)
export type Provider = 'deepseek' | 'groq' | 'openai' | 'anthropic' | 'gemini' | 'custom'

export interface ProviderKey {
  id: string
  name: string
  provider: Provider
  baseUrl: string
  key: string // full secret; UI must only ever show last 4
  createdAt: number
}

// Ghost Grid platform keys (issued by "our" API, mock). Full secret shown once on create.

// Per-building choice of which provider key + model to use
export interface BuildingConfig {
  keyId: string | null
  model: string
}

export interface PlaygroundParams {
  temperature: number // 0..2
  maxTokens: number // 1..4096
}
