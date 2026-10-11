// Simple SMA backtest on historical bars. Signal at bar i uses closes[0..i] only and is
// applied to the return from bar i to bar i+1, so there is no look-ahead.
import type { PricePoint } from '../types';
import { SMA_LONG, smaRule } from './signalService';

export interface BacktestResult {
  bars: number;
  startEquity: number;
  endEquity: number;
  strategyReturnPct: number;
  buyHoldReturnPct: number;
  maxDrawdownPct: number;
  trades: number;
  winRatePct: number;
  exposurePct: number;
  equityCurve: PricePoint[];
}

/** Long-only: in the market after a BUY signal, flat after a SELL signal, HOLD keeps prior state. */
export function runSmaBacktest(points: PricePoint[], startEquity = 10_000): BacktestResult | null {
  if (points.length < SMA_LONG + 2) return null;
  const closes = points.map((p) => p.price);
  let equity = startEquity;
  let peak = equity;
  let maxDd = 0;
  let inMarket = false;
  let entryEquity = 0;
  let trades = 0;
  let wins = 0;
  let barsIn = 0;
  const curve: PricePoint[] = [];
  const first = SMA_LONG - 1;

  for (let i = first; i < closes.length - 1; i++) {
    const { action } = smaRule(closes, i); // only data up to i
    if (action === 'BUY' && !inMarket) {
      inMarket = true;
      entryEquity = equity;
      trades++;
    } else if (action === 'SELL' && inMarket) {
      inMarket = false;
      if (equity > entryEquity) wins++;
    }
    if (inMarket) {
      equity *= closes[i + 1] / closes[i];
      barsIn++;
    }
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, (peak - equity) / peak);
    curve.push({ t: points[i + 1].t, price: equity });
  }
  if (inMarket && equity > entryEquity) wins++;
  const tested = closes.length - 1 - first;
  return {
    bars: tested,
    startEquity,
    endEquity: equity,
    strategyReturnPct: (equity / startEquity - 1) * 100,
    buyHoldReturnPct: (closes[closes.length - 1] / closes[first] - 1) * 100,
    maxDrawdownPct: maxDd * 100,
    trades,
    winRatePct: trades ? (wins / trades) * 100 : 0,
    exposurePct: tested ? (barsIn / tested) * 100 : 0,
    equityCurve: curve,
  };
}
