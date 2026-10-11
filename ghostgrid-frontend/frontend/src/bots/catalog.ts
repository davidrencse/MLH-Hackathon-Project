// Vendored copy of the backend's demo bot catalog.
// Source of truth: ghostgrid-backend/examples/bots/catalog.json (catalog version 1).
// Re-copy this file when that catalog changes; the backend has no HTTP route for it yet
// (`/api/v1/bots` is still unimplemented, see ghostgrid-backend/FRONTEND.md).
//
// Every script in the backend catalog is self-contained, stdlib-only and paper/simulation
// first. `inspiredBy` points at the open-source project each demo mimics in spirit — no
// third-party code is bundled or executed. Nothing here makes a request.

export type CatalogBotKind = 'trading' | 'security' | 'monitoring' | 'automation'
export type CatalogRuntime = 'python' | 'node'

export interface CatalogBot {
  id: string
  name: string
  kind: CatalogBotKind
  runtime: CatalogRuntime
  entry: string // path relative to ghostgrid-backend/examples/bots
  args: string[]
  category: string
  district: string
  building: string // the city building name this bot was written for
  paperMode: boolean
  networkRequired: boolean
  everySeconds: number
  description: string
  inspiredBy: { name: string; url: string }
  emits: string[] // NDJSON event types on stdout
}

export const CATALOG_VERSION = 1

export const CATALOG_BOTS: CatalogBot[] = [
  {
    id: 'paper-trader',
    name: 'Paper Trading Bot',
    kind: 'trading',
    runtime: 'python',
    entry: 'scripts/paper_trader.py',
    args: ['--symbol', 'BTC-USD', '--cash', '10000'],
    category: 'quant',
    district: 'Market District',
    building: 'Quant Exchange',
    paperMode: true,
    networkRequired: false,
    everySeconds: 5,
    description:
      'Simulated SMA-crossover strategy over a synthetic random-walk price. Tracks a paper portfolio and emits buy/sell signals and PnL. No real orders, no exchange keys.',
    inspiredBy: { name: 'Freqtrade', url: 'https://github.com/freqtrade/freqtrade' },
    emits: ['bot.log', 'bot.signal', 'bot.metric'],
  },
  {
    id: 'market-signal',
    name: 'Market Signal Bot',
    kind: 'trading',
    runtime: 'node',
    entry: 'scripts/market_signal.mjs',
    args: [],
    category: 'quant',
    district: 'Market District',
    building: 'Signal Lab',
    paperMode: true,
    networkRequired: false,
    everySeconds: 3,
    description:
      'Generates RSI / momentum signals on a simulated order book. Flashes volatility as signal intensity — good for driving neon ticker animations.',
    inspiredBy: { name: 'Hummingbot', url: 'https://github.com/hummingbot/hummingbot' },
    emits: ['bot.log', 'bot.signal', 'bot.metric'],
  },
  {
    id: 'log-watchtower',
    name: 'Security Log Watchtower',
    kind: 'security',
    runtime: 'python',
    entry: 'scripts/log_watchtower.py',
    args: ['--source', 'sample-data/auth.sample.txt'],
    category: 'security',
    district: 'Security District',
    building: 'Packet Watchtower',
    paperMode: false,
    networkRequired: false,
    everySeconds: 4,
    description:
      'Tails a log file and flags suspicious lines (failed logins, sudo, port scans) with severity. Drives red-alert visuals in the Security District.',
    inspiredBy: { name: 'grobomo/github-agent', url: 'https://github.com/grobomo/github-agent' },
    emits: ['bot.log', 'bot.alert', 'bot.metric'],
  },
  {
    id: 'http-healthcheck',
    name: 'Network Healthcheck Bot',
    kind: 'monitoring',
    runtime: 'node',
    entry: 'scripts/http_healthcheck.mjs',
    args: ['--targets', 'https://example.com,https://api.github.com'],
    category: 'network',
    district: 'Browser / Network District',
    building: 'Extraction Relay',
    paperMode: false,
    networkRequired: true,
    everySeconds: 30,
    description: 'Pings a list of URLs, records latency and up/down status. Building goes offline-red when a target fails.',
    inspiredBy: { name: 'Uptime Kuma', url: 'https://github.com/louislam/uptime-kuma' },
    emits: ['bot.log', 'bot.metric', 'bot.alert'],
  },
  {
    id: 'rss-watcher',
    name: 'RSS Feed Watcher',
    kind: 'automation',
    runtime: 'python',
    entry: 'scripts/rss_watcher.py',
    args: ['--feed', 'https://hnrss.org/frontpage'],
    category: 'memory',
    district: 'Memory District',
    building: 'Research Terminal',
    paperMode: false,
    networkRequired: true,
    everySeconds: 60,
    description:
      "Polls an RSS/Atom feed, de-dupes by item id (watermark), emits new items. Feeds the Memory District's knowledge intake.",
    inspiredBy: { name: 'joobert/Mitten', url: 'https://github.com/joobert/Mitten' },
    emits: ['bot.log', 'bot.item', 'bot.metric'],
  },
  {
    id: 'repo-commit-watcher',
    name: 'Repo Commit Watcher',
    kind: 'automation',
    runtime: 'node',
    entry: 'scripts/repo_commit_watcher.mjs',
    args: ['--repo', 'freqtrade/freqtrade'],
    category: 'code',
    district: 'Code District',
    building: 'Debug Garage',
    paperMode: false,
    networkRequired: true,
    everySeconds: 120,
    description:
      'Watches a public GitHub repo for new commits via the public API (no token needed for low rate). Emits a pulse per new commit — drives Code District activity lights.',
    inspiredBy: { name: 'joobert/Mitten', url: 'https://github.com/joobert/Mitten' },
    emits: ['bot.log', 'bot.item', 'bot.metric'],
  },
]

/** "every 5s" / "every 2m" — what the panel's SCHEDULE field shows. */
export function scheduleLabel(everySeconds: number): string {
  if (everySeconds % 60 === 0 && everySeconds >= 60) return `every ${everySeconds / 60}m`
  return `every ${everySeconds}s`
}
