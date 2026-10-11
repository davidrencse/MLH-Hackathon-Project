// Signal engines. The MVP ships a deterministic SMA crossover rule — it is NOT AI and the UI says so.
// To plug in an LLM agent later, implement SignalProvider and call marketDataService.setSignalProvider().
import type { AssetSymbol, PriceHistory, SignalAction, TradingSignal } from '../types';

export interface SignalProvider {
  readonly engine: TradingSignal['engine'];
  analyze(symbol: AssetSymbol, history: PriceHistory): Promise<TradingSignal>;
}

export const SMA_SHORT = 12;
export const SMA_LONG = 48;
/** Spread (short vs long, %) needed before we leave HOLD. */
export const SMA_THRESHOLD_PCT = 0.5;

export function sma(values: number[], window: number, endIndex = values.length - 1): number {
  if (endIndex + 1 < window) return NaN;
  let s = 0;
  for (let i = endIndex - window + 1; i <= endIndex; i++) s += values[i];
  return s / window;
}

/** Pure rule: uses only closes[0..endIndex] — no look-ahead. */
export function smaRule(closes: number[], endIndex = closes.length - 1, shortW = SMA_SHORT, longW = SMA_LONG) {
  const smaShort = sma(closes, shortW, endIndex);
  const smaLong = sma(closes, longW, endIndex);
  const spreadPct = ((smaShort - smaLong) / smaLong) * 100;
  let action: SignalAction = 'HOLD';
  if (Number.isFinite(spreadPct)) {
    if (spreadPct > SMA_THRESHOLD_PCT) action = 'BUY';
    else if (spreadPct < -SMA_THRESHOLD_PCT) action = 'SELL';
  }
  return { action, smaShort, smaLong, spreadPct };
}

export const smaSignalProvider: SignalProvider = {
  engine: 'RULE_SMA',
  async analyze(symbol, history) {
    const closes = history.points.map((p) => p.price);
    const last = closes[closes.length - 1];
    const { action, smaShort, smaLong, spreadPct } = smaRule(closes);
    const reasons: string[] = [];
    const risks: string[] = [
      'Rule-based SMA crossover — not AI reasoning, not financial advice.',
      'Moving averages lag price; signals arrive after the move has started.',
      'Sideways markets cause frequent false crossovers (whipsaw).',
    ];
    if (!Number.isFinite(spreadPct)) {
      reasons.push(`Not enough history (${closes.length} bars, need ${SMA_LONG}).`);
    } else {
      reasons.push(`SMA${SMA_SHORT} = ${smaShort.toFixed(2)}, SMA${SMA_LONG} = ${smaLong.toFixed(2)}.`);
      reasons.push(`Short SMA is ${Math.abs(spreadPct).toFixed(2)}% ${spreadPct >= 0 ? 'above' : 'below'} long SMA (threshold ±${SMA_THRESHOLD_PCT}%).`);
      reasons.push(`Last bar close ${last.toFixed(2)} is ${last >= smaLong ? 'above' : 'below'} SMA${SMA_LONG}.`);
      if (action === 'HOLD') reasons.push('Spread inside threshold → no clear trend → HOLD.');
      if (action === 'BUY') reasons.push('Short-term trend above long-term trend → momentum BUY.');
      if (action === 'SELL') reasons.push('Short-term trend below long-term trend → momentum SELL.');
    }
    if (history.source === 'DEMO') risks.unshift('Computed on DEMO data — signal has no relation to the real market.');
    const strength = Number.isFinite(spreadPct) ? Math.min(1, Math.abs(spreadPct) / (SMA_THRESHOLD_PCT * 4)) : 0;
    return {
      symbol,
      action,
      strength,
      reasons,
      risks,
      engine: 'RULE_SMA',
      generatedAt: Date.now(),
      dataSource: history.source,
      metrics: { smaShort, smaLong, shortWindow: SMA_SHORT, longWindow: SMA_LONG, spreadPct },
    };
  },
};
