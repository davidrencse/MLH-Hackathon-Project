import type { BotConfig, BotKind, BuildingId, BuildingStatus, BuildingType, Provider, RuntimeId, SessionMode } from './types'

// What each building type is. Used by the build menu, panels, dashboard and 3D components.
export interface CatalogEntry {
  type: BuildingType
  label: string // "Codex Tower"
  short: string // "CODEX"
  role: string
  model: string
  provider: Provider
  cost: number // credits to build (game currency, not real money)
  accent: string // neon accent hex for this building
  buildable: boolean // can the player build more of these?
}

export const CATALOG: Record<BuildingType, CatalogEntry> = {
  router: {
    type: 'router',
    label: '',
    short: '',
    role: '',
    model: '',
    provider: 'anthropic',
    cost: 0,
    accent: '#00f0ff',
    buildable: false,
  },
  codex: {
    type: 'codex',
    label: 'Codex Tower',
    short: 'CODEX',
    role: 'Writes and edits code in parallel sessions, runs builds and tests.',
    model: 'gpt-5-codex',
    provider: 'openai',
    cost: 300,
    accent: '#39ff14',
    buildable: true,
  },
  cursor: {
    type: 'cursor',
    label: 'Cursor Studio',
    short: 'CURSOR',
    role: 'Editor-focused coding sessions. Plan changes, review diffs and iterate.',
    model: 'cursor-agent',
    provider: 'custom',
    cost: 300,
    accent: '#00f0ff',
    buildable: true,
  },
  claude: {
    type: 'claude',
    label: 'Claude Nexus',
    short: 'CLAUDE',
    role: 'Architecture, code review and long-horizon reasoning.',
    model: 'claude-opus-5-5',
    provider: 'anthropic',
    cost: 300,
    accent: '#ff9d4d',
    buildable: true,
  },
  deepseek: {
    type: 'deepseek',
    label: 'DeepSeek Forge',
    short: 'DEEPSEEK',
    role: 'Cheap batch jobs: tests, refactors, data crunching.',
    model: 'deepseek-v4-pro',
    provider: 'deepseek',
    cost: 200,
    accent: '#4d7cff',
    buildable: true,
  },
  groq: {
    type: 'groq',
    label: 'Groq Speedway',
    short: 'GROQ',
    role: 'Low-latency inference. Burst traffic, fast drafts, realtime replies.',
    model: 'openai/gpt-oss-120b',
    provider: 'groq',
    cost: 250,
    accent: '#b36bff',
    buildable: true,
  },
  security: {
    type: 'security',
    label: 'Security Checkpoint',
    short: 'SECURITY',
    role: 'Gates risky actions. Asks a human before anything destructive.',
    model: 'deepseek-v4-pro',
    provider: 'deepseek',
    cost: 0,
    accent: '#ffd400',
    buildable: false,
  },
  bot: {
    type: 'bot',
    label: 'Custom Bot',
    short: 'BOT',
    role: 'Your own bot. The backend connects it through its endpoint.',
    model: 'custom-model',
    provider: 'custom',
    cost: 150,
    accent: '#ff2bd6',
    buildable: true,
  },
  library: {
    type: 'library',
    label: 'Library',
    short: 'LIBRARY',
    role: 'Offline knowledge archive. Curated Medium articles saved as searchable PDFs, with recommendations from what you read.',
    model: 'local-index',
    provider: 'custom',
    cost: 0,
    accent: '#ffd400',
    buildable: false,
  },
}

export const BOT_KINDS: Record<BotKind, { label: string; description: string; color: string }> = {
  trading: { label: 'Trading Bot', description: 'Paper-trades a strategy. Shows signals and PnL.', color: '#39ff14' },
  webhook: { label: 'Webhook Bot', description: 'Reacts to incoming events from your backend.', color: '#00f0ff' },
  scraper: { label: 'Scraper Bot', description: 'Fetches pages and extracts structured data.', color: '#ffd400' },
  custom: { label: 'Custom Bot', description: 'Anything else. You define the endpoint.', color: '#ff2bd6' },
}

// Nice one-line label for a bot. Catalog-seeded bots all use the trading tower art (so their
// `kind` is always 'trading'), but carry their real identity in `source` — prefer that over the
// generic kind so a security monitor is not labeled a trading bot.
const CATALOG_BOT_NAMES: Record<string, string> = {
  'paper-trader': 'Paper Trading',
  'market-signal': 'Market Signal',
}
const CATALOG_KIND_LABELS: Record<string, string> = {
  trading: 'Trading',
  security: 'Security',
  monitoring: 'Monitoring',
  automation: 'Automation',
}

export function botLabel(bot: BotConfig): string {
  const named = bot.source ? CATALOG_BOT_NAMES[bot.source.botId] : undefined
  if (named) return named
  const kind = bot.source ? CATALOG_KIND_LABELS[bot.source.catalogKind] : undefined
  if (kind) return kind
  return BOT_KINDS[bot.kind]?.label ?? BOT_KINDS.custom.label
}

// Agent buildings with fixed ids for console data and backend bootstrap.
export const BUILDING_IDS: BuildingId[] = ['codex', 'cursor', 'claude', 'deepseek', 'groq', 'security']

export const DEFAULT_BUILDINGS: { id: BuildingId; type: BuildingType; lot: number }[] = [
  { id: 'router', type: 'router', lot: 0 },
  { id: 'codex', type: 'codex', lot: 3 }, // left of the spire in the iso view (the demo's main building)
  { id: 'cursor', type: 'cursor', lot: 13 }, // N block — editor studio beside the Library
  { id: 'claude', type: 'claude', lot: 2 }, // right
  { id: 'deepseek', type: 'deepseek', lot: 1 }, // back (low and wide, still visible behind the spire)
  { id: 'groq', type: 'groq', lot: 6 }, // N block, next to the Library — the low-latency track
  { id: 'security', type: 'security', lot: 4 },
  { id: 'library', type: 'library', lot: 5 }, // N block — the Library of Babel (news/Medium archive)
]

// Back-compat lookup for the default buildings: BUILDINGS.codex.name etc.
export const BUILDINGS: Record<string, { id: BuildingId; name: string; short: string; role: string; model: string }> =
  Object.fromEntries(
    DEFAULT_BUILDINGS.map((b) => [
      b.id,
      { id: b.id, name: CATALOG[b.type].label, short: CATALOG[b.type].short, role: CATALOG[b.type].role, model: CATALOG[b.type].model },
    ]),
  )

export const STATUS_COLOR: Record<BuildingStatus | 'offline', string> = {
  idle: 'var(--gg-cyan)',
  working: 'var(--gg-green)',
  needs_approval: 'var(--gg-yellow)',
  error: 'var(--gg-red)',
  offline: 'var(--gg-grey)',
}

export const STATUS_LABEL: Record<BuildingStatus | 'offline', string> = {
  idle: 'IDLE',
  working: 'WORKING',
  needs_approval: 'NEEDS APPROVAL',
  error: 'ERROR',
  offline: 'NO KEY',
}

export const PROVIDERS: Record<Provider, { label: string; baseUrl: string; models: string[] }> = {
  // Model ids verified against the live /models endpoints on 2026-10-11.
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', models: ['deepseek-v4-pro', 'deepseek-flash'] },
  groq: {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'],
  },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: ['gpt-5-codex', 'gpt-5', 'gpt-5-mini'] },
  anthropic: {
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
  },
  gemini: {
    label: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    models: ['gemini-3-pro', 'gemini-3-flash'],
  },
  custom: { label: 'Custom', baseUrl: '', models: ['custom-model'] },
}

// ---- Session runtimes: what the office's session menu offers ----
// 'local' runtimes run on the player's machine and need no API key. 'connected' runtimes call a
// provider API and are only usable once a key for that provider exists (see store/keys.ts).
export interface RuntimeEntry {
  id: RuntimeId
  label: string // "Claude · Anthropic API"
  short: string // "CLAUDE" — the chip on a desk
  mode: SessionMode
  provider: Provider | null // null for local runtimes
  host: string // shown under the label: "localhost:11434", "api.openai.com"
  models: string[]
  accent: string
  hint: string
}

export const RUNTIMES: Record<RuntimeId, RuntimeEntry> = {
  'local-cli': {
    id: 'local-cli',
    label: 'Local agent CLI',
    short: 'LOCAL CLI',
    mode: 'local',
    provider: null,
    host: 'this machine · git worktree',
    models: ['codex-cli', 'cursor-agent', 'claude-code', 'gemini-cli'],
    accent: '#39ff14',
    hint: 'Spawns the agent’s own CLI in an isolated worktree. No key leaves your machine.',
  },
  'local-ollama': {
    id: 'local-ollama',
    label: 'Local models (Ollama)',
    short: 'OLLAMA',
    mode: 'local',
    provider: null,
    host: 'localhost:11434',
    models: ['qwen3-coder:30b', 'llama4:16b', 'deepseek-r2:14b'],
    accent: '#00f0ff',
    hint: 'Runs a model on your own GPU. Free, slower, fully offline.',
  },
  openai: {
    id: 'openai',
    label: 'ChatGPT · OpenAI API',
    short: 'CHATGPT',
    mode: 'connected',
    provider: 'openai',
    host: 'api.openai.com',
    models: PROVIDERS.openai.models,
    accent: '#39ff14',
    hint: 'Sends the session to OpenAI with your OpenAI key.',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Claude · Anthropic API',
    short: 'CLAUDE',
    mode: 'connected',
    provider: 'anthropic',
    host: 'api.anthropic.com',
    models: PROVIDERS.anthropic.models,
    accent: '#ff9d4d',
    hint: 'Sends the session to Anthropic with your Anthropic key.',
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek API',
    short: 'DEEPSEEK',
    mode: 'connected',
    provider: 'deepseek',
    host: 'api.deepseek.com',
    models: PROVIDERS.deepseek.models,
    accent: '#4d7cff',
    hint: 'Cheap bulk work. Good for tests, refactors and summaries.',
  },
  groq: {
    id: 'groq',
    label: 'Groq API',
    short: 'GROQ',
    mode: 'connected',
    provider: 'groq',
    host: 'api.groq.com',
    models: PROVIDERS.groq.models,
    accent: '#b36bff',
    hint: 'Fastest first token. Best for drafts and realtime replies.',
  },
}

// Which runtime a provider key maps onto. Partial on purpose: providers without a runtime of
// their own (Gemini, custom endpoints) fall back to the local CLI.
export const RUNTIME_OF_PROVIDER: Partial<Record<Provider, RuntimeId>> = {
  openai: 'openai',
  anthropic: 'anthropic',
  deepseek: 'deepseek',
  groq: 'groq',
}

// Menu order inside each mode group.
export const RUNTIME_ORDER: Record<SessionMode, RuntimeId[]> = {
  local: ['local-cli', 'local-ollama'],
  connected: ['openai', 'anthropic', 'deepseek', 'groq'],
}

// What a building's office preselects in the session menu.
export const DEFAULT_RUNTIME: Record<BuildingType, RuntimeId> = {
  router: 'anthropic',
  codex: 'openai',
  cursor: 'local-cli',
  claude: 'anthropic',
  deepseek: 'deepseek',
  groq: 'groq',
  security: 'deepseek',
  bot: 'local-cli',
  library: 'local-ollama',
}

// Main demo flow timings (ms). Store and FlightLayer both read these.
export const TIMING = {
  droneFlight: 1500,
  codexWork: 4000,
  packetFlight: 800,
  returnFlight: 1500,
  sessionQueue: 700, // queued → running, while the backend accepts the session
  sessionWork: 6000, // running → done in the office demo
}
