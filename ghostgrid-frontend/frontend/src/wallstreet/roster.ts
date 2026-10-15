// Vendored copy of the backend's Wall Street roster.
// Source of truth: ghostgrid-backend/src/wallstreet/service.ts (WALL_STREET_ROSTER).
//
// The city seeds its Wall Street strip from this list so the district exists with no backend
// running; `api/wallstreet.ts` then replaces it with the live payload from
// GET /api/v1/wallstreet, which carries the same fields plus GitHub stats.
//
// One building = one open-source quant trading project. Nothing here is cloned or executed:
// the city only ever shows public repository metadata and links out to GitHub.
import type { QuantRepo } from '../types'

export type QuantSeed = Omit<QuantRepo, 'status' | 'stats' | 'checkedAt' | 'error'>

export const WALL_STREET_DISTRICT = 'Wall Street'

// Two rows of lots, both on the plate the city names Wall St — the east cell of the 3x3 grid,
// WALL_ST_PLOT in city3d/world.ts:
//
//   25-29  the original wall of skyscrapers down the plate's west rim, the side facing the core,
//          so those five still read as one skyline seen from the centre of the city.
//   37-43  downtown, on the plate's inner 3x3 blocks. Every other plate leases those blocks out;
//          Wall Street is built out instead, which is why the plate offers no lease pads at all
//          (see OUTER_LOTS). (15,15) is left as the trading-floor plaza.
//
// The two demo trading bots sit on the annex plots 35-36 between the two rows.
//
// Every entry is a real public repository and nothing here is cloned or executed — the city only
// shows repository metadata and links out to GitHub. Zipline is archived upstream, and its
// building says so rather than pretending the project is live.
export const WALL_STREET_SEEDS: QuantSeed[] = [
  {
    slug: 'freqtrade',
    name: 'Freqtrade Exchange',
    short: 'FREQTRADE',
    lot: 25,
    accent: '#39ff14',
    ticker: 'FRQ',
    strategy:
      'Crypto trading bot: strategy backtesting, hyperopt parameter search and dry-run paper trading before any real order.',
    asset: 'Crypto spot + futures',
    url: 'https://github.com/freqtrade/freqtrade',
    repo: { owner: 'freqtrade', name: 'freqtrade' },
  },
  {
    slug: 'hummingbot',
    name: 'Hummingbot Pit',
    short: 'HUMMING',
    lot: 26,
    accent: '#00f0ff',
    ticker: 'HBOT',
    strategy:
      'Market-making and arbitrage bot that runs the same strategy across centralised and decentralised exchanges.',
    asset: 'CEX + DEX liquidity',
    url: 'https://github.com/hummingbot/hummingbot',
    repo: { owner: 'hummingbot', name: 'hummingbot' },
  },
  {
    slug: 'nautilus',
    name: 'Nautilus Clearing',
    short: 'NAUTILUS',
    lot: 27,
    accent: '#ff2bd6',
    ticker: 'NTLS',
    strategy:
      'Event-driven trading platform with a Rust core: the same code backtests on tick data and runs live.',
    asset: 'Multi-venue, tick level',
    url: 'https://github.com/nautechsystems/nautilus_trader',
    repo: { owner: 'nautechsystems', name: 'nautilus_trader' },
  },
  {
    slug: 'lean',
    name: 'Lean Engine Hall',
    short: 'LEAN',
    lot: 28,
    accent: '#ffd400',
    ticker: 'LEAN',
    strategy:
      "QuantConnect's algorithmic trading engine: one algorithm, many brokerages and asset classes, C# or Python.",
    asset: 'Equities, FX, futures, crypto',
    url: 'https://github.com/QuantConnect/Lean',
    repo: { owner: 'QuantConnect', name: 'Lean' },
  },
  {
    slug: 'qlib',
    name: 'Qlib Research',
    short: 'QLIB',
    lot: 29,
    accent: '#ff9d4d',
    ticker: 'QLIB',
    strategy:
      'AI-first quant research platform: data pipelines, factor models and ML forecasting from idea to live signal.',
    asset: 'Equity factor research',
    url: 'https://github.com/microsoft/qlib',
    repo: { owner: 'microsoft', name: 'qlib' },
  },
  {
    slug: 'backtrader',
    name: 'Backtrader Floor',
    short: 'BACKTRADER',
    lot: 37,
    accent: '#b6f36b',
    ticker: 'BTD',
    strategy:
      'Python backtesting framework: multiple data feeds, broker simulation and a large indicator library, run offline over historical bars.',
    asset: 'Equities + futures',
    url: 'https://github.com/mementum/backtrader',
    repo: { owner: 'mementum', name: 'backtrader' },
  },
  {
    slug: 'zipline',
    name: 'Zipline Archive',
    short: 'ZIPLINE',
    lot: 38,
    accent: '#8f8ab8',
    ticker: 'ZIP',
    strategy:
      "Quantopian's event-driven backtester. The repository is archived, so the tower stands as the district's records office rather than a working floor.",
    asset: 'US equities (historical)',
    url: 'https://github.com/quantopian/zipline',
    repo: { owner: 'quantopian', name: 'zipline' },
  },
  {
    slug: 'vectorbt',
    name: 'Vectorbt Terminal',
    short: 'VECTORBT',
    lot: 39,
    accent: '#42e8ed',
    ticker: 'VBT',
    strategy:
      'Vectorised backtesting on NumPy and pandas: sweeps thousands of parameter combinations at once instead of looping bar by bar.',
    asset: 'Any OHLCV series',
    url: 'https://github.com/polakowo/vectorbt',
    repo: { owner: 'polakowo', name: 'vectorbt' },
  },
  {
    slug: 'ccxt',
    name: 'CCXT Gateway',
    short: 'CCXT',
    lot: 40,
    accent: '#688dff',
    ticker: 'CCX',
    strategy:
      'One unified API over a hundred-odd crypto exchanges: market data, order books and order routing behind a single interface. The district\'s switchboard.',
    asset: 'Crypto spot + derivatives',
    url: 'https://github.com/ccxt/ccxt',
    repo: { owner: 'ccxt', name: 'ccxt' },
  },
  {
    slug: 'jesse',
    name: 'Jesse Desk',
    short: 'JESSE',
    lot: 41,
    accent: '#ffcd70',
    ticker: 'JSE',
    strategy:
      'Crypto strategy framework: the same Python strategy class is backtested, paper traded and run live, so the desk never rewrites it to ship.',
    asset: 'Crypto spot + futures',
    url: 'https://github.com/jesse-ai/jesse',
    repo: { owner: 'jesse-ai', name: 'jesse' },
  },
  {
    slug: 'octobot',
    name: 'OctoBot Tower',
    short: 'OCTOBOT',
    lot: 42,
    accent: '#ff4da6',
    ticker: 'OCT',
    strategy:
      'Trading bot with a web console and swappable strategy profiles — grid, DCA, market making — tuned from the interface rather than in code.',
    asset: 'Crypto spot',
    url: 'https://github.com/Drakkar-Software/OctoBot',
    repo: { owner: 'Drakkar-Software', name: 'OctoBot' },
  },
  {
    slug: 'quantlib',
    name: 'QuantLib Vault',
    short: 'QUANTLIB',
    lot: 43,
    accent: '#ff995a',
    ticker: 'QLV',
    strategy:
      'The quantitative finance library the rest of the street links against: term structures, option pricing, Monte Carlo and date arithmetic, in C++.',
    asset: 'Rates + derivatives',
    url: 'https://github.com/lballabio/QuantLib',
    repo: { owner: 'lballabio', name: 'QuantLib' },
  },
]

/** The offline shape of one tower: static layout, no GitHub stats yet. */
export const staticRepo = (seed: QuantSeed): QuantRepo => ({
  ...seed,
  status: 'static',
  stats: null,
  checkedAt: null,
})

export const WALL_STREET_FALLBACK: QuantRepo[] = WALL_STREET_SEEDS.map(staticRepo)
