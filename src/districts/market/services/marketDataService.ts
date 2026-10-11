// MarketDataService: one place that knows where prices come from.
// Live adapter = CoinGecko public API (no key). On any failure we fall back to DEMO data and say so.
import type { Asset, AssetSymbol, LatestPrice, PriceHistory, TradingSignal } from '../types';
import { generateDemoHistory } from './demoData';
import { smaSignalProvider, type SignalProvider } from './signalService';

export const ASSETS: Asset[] = [
  { symbol: 'BTC', name: 'Bitcoin', coingeckoId: 'bitcoin', color: '#f7931a' },
  { symbol: 'ETH', name: 'Ethereum', coingeckoId: 'ethereum', color: '#8c9eff' },
  { symbol: 'SOL', name: 'Solana', coingeckoId: 'solana', color: '#14f195' },
];

const API_BASE = 'https://api.coingecko.com/api/v3';
const TIMEOUT_MS = 6000;
const HISTORY_TTL_MS = 5 * 60_000; // keep well under the public rate limit
const LATEST_TTL_MS = 30_000;

export interface MarketDataOptions {
  /** Force demo mode (e.g. offline demo, tests). */
  forceDemo?: boolean;
  fetchImpl?: typeof fetch;
  signalProvider?: SignalProvider;
}

export class MarketDataService {
  private historyCache = new Map<AssetSymbol, PriceHistory>();
  private latestCache: { at: number; data: Record<string, LatestPrice> } | null = null;
  private forceDemo: boolean;
  private fetchImpl: typeof fetch;
  private signalProvider: SignalProvider;

  constructor(opts: MarketDataOptions = {}) {
    this.forceDemo = !!opts.forceDemo;
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
    this.signalProvider = opts.signalProvider ?? smaSignalProvider;
  }

  setForceDemo(v: boolean) {
    this.forceDemo = v;
    this.historyCache.clear();
    this.latestCache = null;
  }
  isForceDemo() {
    return this.forceDemo;
  }
  /** Swap the signal engine (e.g. an LLM agent) without touching the UI. */
  setSignalProvider(p: SignalProvider) {
    this.signalProvider = p;
  }

  getAssets(): Asset[] {
    return ASSETS;
  }

  async getPriceHistory(symbol: AssetSymbol, { refresh = false } = {}): Promise<PriceHistory> {
    const cached = this.historyCache.get(symbol);
    if (!refresh && cached && Date.now() - cached.updatedAt < HISTORY_TTL_MS) return cached;

    let result: PriceHistory;
    if (this.forceDemo) {
      result = demoHistory(symbol);
    } else {
      try {
        const asset = assetOf(symbol);
        const json = await this.getJson(`${API_BASE}/coins/${asset.coingeckoId}/market_chart?vs_currency=usd&days=7`);
        const prices: [number, number][] = json?.prices;
        if (!Array.isArray(prices) || prices.length < 30) throw new Error('Malformed history response');
        result = {
          symbol,
          points: prices.map(([t, price]) => ({ t, price })),
          source: 'LIVE',
          updatedAt: Date.now(),
        };
      } catch (e) {
        result = demoHistory(symbol, errMsg(e));
      }
    }
    this.historyCache.set(symbol, result);
    return result;
  }

  async getLatestPrice(symbol: AssetSymbol): Promise<LatestPrice> {
    const all = await this.getLatestPrices();
    return all[symbol];
  }

  /** Batched latest prices (one HTTP request for all assets). */
  async getLatestPrices({ refresh = false } = {}): Promise<Record<AssetSymbol, LatestPrice>> {
    if (!refresh && this.latestCache && Date.now() - this.latestCache.at < LATEST_TTL_MS) {
      return this.latestCache.data as Record<AssetSymbol, LatestPrice>;
    }
    const out = {} as Record<AssetSymbol, LatestPrice>;
    let live: any = null;
    if (!this.forceDemo) {
      try {
        const ids = ASSETS.map((a) => a.coingeckoId).join(',');
        live = await this.getJson(
          `${API_BASE}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true`,
        );
      } catch {
        live = null;
      }
    }
    for (const a of ASSETS) {
      const row = live?.[a.coingeckoId];
      if (row && typeof row.usd === 'number') {
        out[a.symbol] = {
          symbol: a.symbol,
          price: row.usd,
          change24hPct: Number(row.usd_24h_change ?? 0),
          source: 'LIVE',
          updatedAt: row.last_updated_at ? row.last_updated_at * 1000 : Date.now(),
        };
      } else {
        const h = await this.getPriceHistory(a.symbol);
        out[a.symbol] = latestFromHistory(h);
      }
    }
    this.latestCache = { at: Date.now(), data: out };
    return out;
  }

  /** Pass `history` to analyze exactly what the UI is showing (e.g. including demo ticks). */
  async getTradingSignal(symbol: AssetSymbol, history?: PriceHistory): Promise<TradingSignal> {
    const h = history ?? (await this.getPriceHistory(symbol));
    return this.signalProvider.analyze(symbol, h);
  }

  private async getJson(url: string): Promise<any> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
      if (res.status === 429) throw new Error('Rate limited by CoinGecko (HTTP 429)');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e: any) {
      if (e?.name === 'AbortError') throw new Error(`Timeout after ${TIMEOUT_MS / 1000}s`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function latestFromHistory(h: PriceHistory): LatestPrice {
  const pts = h.points;
  const last = pts[pts.length - 1];
  // ~24 bars back for hourly data
  const dayAgo = pts.find((p) => p.t >= last.t - 24 * 3_600_000) ?? pts[0];
  return {
    symbol: h.symbol,
    price: last.price,
    change24hPct: ((last.price - dayAgo.price) / dayAgo.price) * 100,
    source: h.source,
    updatedAt: h.updatedAt,
  };
}

function demoHistory(symbol: AssetSymbol, error?: string): PriceHistory {
  return { symbol, points: generateDemoHistory(symbol), source: 'DEMO', updatedAt: Date.now(), error };
}

const assetOf = (s: AssetSymbol) => ASSETS.find((a) => a.symbol === s)!;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Default singleton used by the district. */
export const marketDataService = new MarketDataService();
