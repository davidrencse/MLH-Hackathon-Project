// Reproducible demo price series. Clearly labelled DEMO in the UI — these are NOT market prices.
import type { AssetSymbol, PricePoint } from '../types';

const BASE: Record<AssetSymbol, { price: number; vol: number; seed: number }> = {
  BTC: { price: 64000, vol: 0.006, seed: 1337 },
  ETH: { price: 3100, vol: 0.008, seed: 4242 },
  SOL: { price: 145, vol: 0.012, seed: 9001 },
};

export const DEMO_POINTS = 168; // 7 days of hourly bars
export const HOUR = 3_600_000;

/** mulberry32 — tiny deterministic PRNG. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller standard normal from a uniform PRNG. */
function gauss(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Hourly geometric random walk with a slow sine drift so SMA crossovers actually happen.
 * Same symbol + same `endHour` always yields the same series.
 */
export function generateDemoHistory(symbol: AssetSymbol, endMs: number = Date.now(), points = DEMO_POINTS): PricePoint[] {
  const cfg = BASE[symbol];
  const endHour = Math.floor(endMs / HOUR) * HOUR;
  const rand = prng(cfg.seed);
  const out: PricePoint[] = [];
  let price = cfg.price;
  for (let i = 0; i < points; i++) {
    const drift = 0.0012 * Math.sin(i / 18 + cfg.seed);
    price = price * Math.exp(drift + cfg.vol * gauss(rand));
    out.push({ t: endHour - (points - 1 - i) * HOUR, price: round(price) });
  }
  return out;
}

/** Next simulated tick for demo mode, deterministic per (symbol, tick index). */
export function nextDemoTick(symbol: AssetSymbol, last: number, tickIndex: number): number {
  const cfg = BASE[symbol];
  const rand = prng(cfg.seed * 31 + tickIndex);
  return round(last * Math.exp((cfg.vol / 3) * gauss(rand)));
}

const round = (p: number) => (p >= 100 ? Math.round(p * 100) / 100 : Math.round(p * 10000) / 10000);
