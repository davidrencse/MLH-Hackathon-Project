// Wall Street district: one city building per open-source quant trading project.
//
// The roster below is static (it is city layout, not user data). Everything that can go stale —
// stars, language, last push, description — is read from the GitHub REST API on demand, cached in
// memory, and degraded gracefully: a slow or rate-limited GitHub never fails the request, the
// district just reports `static` or `cached` for that building.
//
// Nothing here clones or executes third-party code. The service only reads public repository
// metadata over HTTPS.
import { registerSecret } from "../security/index.js";

export const WALL_STREET_DISTRICT = "Wall Street";
const GITHUB_API = "https://api.github.com";
const CACHE_TTL_MS = 10 * 60 * 1000; // GitHub's unauthenticated budget is 60 req/h per IP
const DEFAULT_TIMEOUT_MS = 6000;

export type RepoStatus = "live" | "cached" | "static";

export interface WallStreetSeed {
  slug: string; // stable id, also the building id in the city
  name: string; // building name on the tower
  short: string; // pixel-font label, <= 10 characters
  lot: number; // index into the frontend's LOTS table (city3d/world.ts)
  accent: string; // neon accent hex
  ticker: string; // fake exchange ticker shown on the building's band
  strategy: string; // one line: what this bot actually does
  asset: string; // what it trades
  repo: { owner: string; name: string };
}

export interface RepoStats {
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  watchers: number;
  topics: string[];
  license: string | null;
  pushedAt: string | null;
  homepage: string | null;
}

export interface WallStreetBuilding extends WallStreetSeed {
  url: string;
  status: RepoStatus;
  stats: RepoStats | null;
  checkedAt: string | null;
  error?: string;
}

// One building per project, and the lot numbers must match the frontend's LOTS table
// (city3d/world.ts) — keep these two lists in step. Lots 25-29 are the original wall of towers
// down the district plate's core-facing rim; 37-43 are its downtown, on the plate's inner blocks.
// Every repo here is public, and nothing is cloned or executed: the service only reads GitHub
// metadata.
export const WALL_STREET_ROSTER: WallStreetSeed[] = [
  {
    slug: "freqtrade",
    name: "Freqtrade Exchange",
    short: "FREQTRADE",
    lot: 25,
    accent: "#39ff14",
    ticker: "FRQ",
    strategy:
      "Crypto trading bot: strategy backtesting, hyperopt parameter search and dry-run paper trading before any real order.",
    asset: "Crypto spot + futures",
    repo: { owner: "freqtrade", name: "freqtrade" },
  },
  {
    slug: "hummingbot",
    name: "Hummingbot Pit",
    short: "HUMMING",
    lot: 26,
    accent: "#00f0ff",
    ticker: "HBOT",
    strategy:
      "Market-making and arbitrage bot that runs the same strategy across centralised and decentralised exchanges.",
    asset: "CEX + DEX liquidity",
    repo: { owner: "hummingbot", name: "hummingbot" },
  },
  {
    slug: "nautilus",
    name: "Nautilus Clearing",
    short: "NAUTILUS",
    lot: 27,
    accent: "#ff2bd6",
    ticker: "NTLS",
    strategy:
      "Event-driven trading platform with a Rust core: the same code backtests on tick data and runs live.",
    asset: "Multi-venue, tick level",
    repo: { owner: "nautechsystems", name: "nautilus_trader" },
  },
  {
    slug: "lean",
    name: "Lean Engine Hall",
    short: "LEAN",
    lot: 28,
    accent: "#ffd400",
    ticker: "LEAN",
    strategy:
      "QuantConnect's algorithmic trading engine: one algorithm, many brokerages and asset classes, C# or Python.",
    asset: "Equities, FX, futures, crypto",
    repo: { owner: "QuantConnect", name: "Lean" },
  },
  {
    slug: "qlib",
    name: "Qlib Research",
    short: "QLIB",
    lot: 29,
    accent: "#ff9d4d",
    ticker: "QLIB",
    strategy:
      "AI-first quant research platform: data pipelines, factor models and ML forecasting from idea to live signal.",
    asset: "Equity factor research",
    repo: { owner: "microsoft", name: "qlib" },
  },
  {
    slug: "backtrader",
    name: "Backtrader Floor",
    short: "BACKTRADER",
    lot: 37,
    accent: "#b6f36b",
    ticker: "BTD",
    strategy:
      "Python backtesting framework: multiple data feeds, broker simulation and a large indicator library, run offline over historical bars.",
    asset: "Equities + futures",
    repo: { owner: "mementum", name: "backtrader" },
  },
  {
    slug: "zipline",
    name: "Zipline Archive",
    short: "ZIPLINE",
    lot: 38,
    accent: "#8f8ab8",
    ticker: "ZIP",
    strategy:
      "Quantopian's event-driven backtester. The repository is archived, so the tower stands as the district's records office rather than a working floor.",
    asset: "US equities (historical)",
    repo: { owner: "quantopian", name: "zipline" },
  },
  {
    slug: "vectorbt",
    name: "Vectorbt Terminal",
    short: "VECTORBT",
    lot: 39,
    accent: "#42e8ed",
    ticker: "VBT",
    strategy:
      "Vectorised backtesting on NumPy and pandas: sweeps thousands of parameter combinations at once instead of looping bar by bar.",
    asset: "Any OHLCV series",
    repo: { owner: "polakowo", name: "vectorbt" },
  },
  {
    slug: "ccxt",
    name: "CCXT Gateway",
    short: "CCXT",
    lot: 40,
    accent: "#688dff",
    ticker: "CCX",
    strategy:
      "One unified API over a hundred-odd crypto exchanges: market data, order books and order routing behind a single interface. The district's switchboard.",
    asset: "Crypto spot + derivatives",
    repo: { owner: "ccxt", name: "ccxt" },
  },
  {
    slug: "jesse",
    name: "Jesse Desk",
    short: "JESSE",
    lot: 41,
    accent: "#ffcd70",
    ticker: "JSE",
    strategy:
      "Crypto strategy framework: the same Python strategy class is backtested, paper traded and run live, so the desk never rewrites it to ship.",
    asset: "Crypto spot + futures",
    repo: { owner: "jesse-ai", name: "jesse" },
  },
  {
    slug: "octobot",
    name: "OctoBot Tower",
    short: "OCTOBOT",
    lot: 42,
    accent: "#ff4da6",
    ticker: "OCT",
    strategy:
      "Trading bot with a web console and swappable strategy profiles — grid, DCA, market making — tuned from the interface rather than in code.",
    asset: "Crypto spot",
    repo: { owner: "Drakkar-Software", name: "OctoBot" },
  },
  {
    slug: "quantlib",
    name: "QuantLib Vault",
    short: "QUANTLIB",
    lot: 43,
    accent: "#ff995a",
    ticker: "QLV",
    strategy:
      "The quantitative finance library the rest of the street links against: term structures, option pricing, Monte Carlo and date arithmetic, in C++.",
    asset: "Rates + derivatives",
    repo: { owner: "lballabio", name: "QuantLib" },
  },
];

const repoUrl = (seed: WallStreetSeed) =>
  `https://github.com/${seed.repo.owner}/${seed.repo.name}`;

interface CacheEntry {
  stats: RepoStats;
  fetchedAt: number;
}

export interface WallStreetOptions {
  /** Injected in tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  cacheTtlMs?: number;
  /** Reads GITHUB_TOKEN by default: a token only raises the rate limit, it is never required. */
  token?: string;
}

export class WallStreetService {
  private cache = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<RepoStats | null>>();
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly token?: string;

  constructor(options: WallStreetOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.cacheTtlMs = options.cacheTtlMs ?? CACHE_TTL_MS;
    this.token = options.token ?? process.env.GITHUB_TOKEN;
    if (this.token) registerSecret(this.token);
  }

  seeds(): WallStreetSeed[] {
    return WALL_STREET_ROSTER;
  }

  find(slug: string): WallStreetSeed | undefined {
    return WALL_STREET_ROSTER.find((seed) => seed.slug === slug);
  }

  /** The whole district. Never rejects: a building whose repo cannot be read falls back to static. */
  async list(options: { refresh?: boolean } = {}) {
    const buildings = await Promise.all(
      WALL_STREET_ROSTER.map((seed) => this.building(seed, options.refresh)),
    );
    const live = buildings.filter((b) => b.status === "live").length;
    return {
      district: WALL_STREET_DISTRICT,
      updatedAt: new Date().toISOString(),
      source: live === buildings.length ? "github" : live ? "partial" : "static",
      count: buildings.length,
      buildings,
    };
  }

  async building(
    seed: WallStreetSeed,
    refresh = false,
  ): Promise<WallStreetBuilding> {
    const cached = this.cache.get(seed.slug);
    const fresh = cached && Date.now() - cached.fetchedAt < this.cacheTtlMs;
    if (fresh && !refresh)
      return {
        ...seed,
        url: repoUrl(seed),
        status: "cached",
        stats: cached.stats,
        checkedAt: new Date(cached.fetchedAt).toISOString(),
      };
    let error: string | undefined;
    const stats = await this.load(seed).catch((cause: unknown) => {
      error = cause instanceof Error ? cause.message : "repository unavailable";
      return null;
    });
    if (stats)
      return {
        ...seed,
        url: repoUrl(seed),
        status: "live",
        stats,
        checkedAt: new Date().toISOString(),
      };
    // GitHub unreachable: serve the stale copy if there is one, otherwise the static seed.
    return {
      ...seed,
      url: repoUrl(seed),
      status: cached ? "cached" : "static",
      stats: cached?.stats ?? null,
      checkedAt: cached ? new Date(cached.fetchedAt).toISOString() : null,
      ...(error ? { error } : {}),
    };
  }

  /** One GitHub read per slug at a time; concurrent callers share the same request. */
  private load(seed: WallStreetSeed): Promise<RepoStats | null> {
    const pending = this.inflight.get(seed.slug);
    if (pending) return pending;
    const request = this.fetchRepo(seed)
      .then((stats) => {
        if (stats) this.cache.set(seed.slug, { stats, fetchedAt: Date.now() });
        return stats;
      })
      .finally(() => this.inflight.delete(seed.slug));
    this.inflight.set(seed.slug, request);
    return request;
  }

  private async fetchRepo(seed: WallStreetSeed): Promise<RepoStats | null> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "ghostgrid-wallstreet",
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const response = await this.fetchImpl(
      `${GITHUB_API}/repos/${seed.repo.owner}/${seed.repo.name}`,
      { headers, signal: AbortSignal.timeout(this.timeoutMs) },
    );
    if (!response.ok)
      throw Object.assign(
        new Error(
          response.status === 403 || response.status === 429
            ? "GitHub rate limit reached"
            : `GitHub returned HTTP ${response.status}`,
        ),
        { statusCode: 502 },
      );
    const data = (await response.json()) as Record<string, any>;
    return {
      description: typeof data.description === "string" ? data.description : null,
      language: typeof data.language === "string" ? data.language : null,
      stars: Number(data.stargazers_count ?? 0),
      forks: Number(data.forks_count ?? 0),
      openIssues: Number(data.open_issues_count ?? 0),
      watchers: Number(data.subscribers_count ?? data.watchers_count ?? 0),
      topics: Array.isArray(data.topics)
        ? data.topics.filter((t: unknown) => typeof t === "string").slice(0, 12)
        : [],
      license:
        data.license && typeof data.license.spdx_id === "string"
          ? data.license.spdx_id
          : null,
      pushedAt: typeof data.pushed_at === "string" ? data.pushed_at : null,
      homepage:
        typeof data.homepage === "string" && data.homepage.startsWith("https://")
          ? data.homepage
          : null,
    };
  }
}
