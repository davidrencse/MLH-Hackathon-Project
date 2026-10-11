// Shared contracts for Ghostgrid. City, console, store and api all import from here.

// Default buildings use these ids: 'router' | 'codex' | 'claude' | 'deepseek' | 'security'.
// Player-built buildings get generated ids ("b_xxx"), so the id type is string.
export type BuildingId = string

export type BuildingType = 'router' | 'codex' | 'cursor' | 'claude' | 'deepseek' | 'groq' | 'security' | 'bot' | 'library'

export type BuildingStatus = 'idle' | 'working' | 'error' | 'needs_approval'

// A custom bot the player builds. The backend team connects it later via `endpoint`.
export type BotKind = 'trading' | 'webhook' | 'scraper' | 'custom'

// Where a bot came from when it was seeded out of the backend's demo catalog
// (ghostgrid-backend/examples/bots/catalog.json) instead of the NEW BOT dialog.
export interface BotSource {
  botId: string // catalog id, e.g. "paper-trader"
  catalogKind: string // the catalog's own kind: trading | security | monitoring | automation
  runtime: 'python' | 'node'
  entry: string // script path inside ghostgrid-backend/examples/bots
  args: string[]
  district: string
  paperMode: boolean
  networkRequired: boolean
  emits: string[] // NDJSON event types the script writes to stdout
  inspiredBy: { name: string; url: string }
}

export interface BotConfig {
  kind: BotKind
  endpoint: string // backend URL the bot will call / be called from (stored only, no requests made)
  schedule: string // e.g. "every 5m", "on event"
  notes: string
  color: string // neon accent, one of the palette hexes
  source?: BotSource // set for catalog-seeded bots, absent for player-built ones
}

// Where a session's work actually happens: on this machine, or against a hosted provider.
export type SessionMode = 'local' | 'connected'

// One runtime a session can be started on (see RUNTIMES in constants.ts).
// 'local-*' run on the player's machine; the rest call a provider API with that provider's key.
export type RuntimeId = 'local-cli' | 'local-ollama' | 'openai' | 'anthropic' | 'deepseek' | 'groq'

// A working session inside an agent building (Codex / Claude / DeepSeek / Groq / Router).
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
  name: string // "Router Spire"
  short: string // "ROUTER"
  role: string // one line, shown in panels
  model: string // default model id, e.g. "gpt-5-codex"
  status: BuildingStatus
  lot: number // index into LOTS (src/city3d/world.ts)
  sessions: Session[]
  bot?: BotConfig // only for type 'bot'
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

// Task phases for the main demo flow (CommandBar → drone → work → approval → result)
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

// Ghostgrid platform keys (issued by "our" API, mock). Full secret shown once on create.
export interface PlatformKey {
  id: string
  name: string
  masked: string // "gg-…a1b2"
  createdAt: number
  lastUsed: number | null
  revoked: boolean
}

// Per-building choice of which provider key + model to use
export interface BuildingConfig {
  keyId: string | null
  model: string
}

export interface PlaygroundParams {
  temperature: number // 0..2
  maxTokens: number // 1..4096
}
